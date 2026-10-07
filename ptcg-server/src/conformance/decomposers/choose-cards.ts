import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { GameMessage } from '../../game/game-message';
import { Card } from '../../game/store/card/card';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { TrainerCard } from '../../game/store/card/trainer-card';
import { EnergyCard } from '../../game/store/card/energy-card';
import { SuperType, Stage, TrainerType, EnergyType } from '../../game/store/card/card-types';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter } from './decomposer';
import { playerIdToActor } from '../iid-targets';
import { liftToTransit, placeInDiscard } from '../transit-projection';
import { State } from '../../game/store/state/state';

/**
 * TA-204 / SD-14: would adding `candidate` to the already-picked set violate a constraint that
 * `ChooseCardsPrompt.validate()` enforces? If so the candidate must not be OFFERED — the menu has to
 * mirror validate(), or we advertise a pick that makes the assembled result fail validation, which the
 * driver reports as `engineFault` → HTTP 500.
 *
 * Every constraint below is MONOTONE in the picked set: adding a card only ever increases a category
 * count or introduces a type/superType. So "the extended set is already invalid" is exactly the right
 * test — no lookahead is needed, and a candidate rejected here can never become legal later.
 *
 * Deliberately NOT implemented by calling `prompt.validate()`: that also enforces `min`, so a partial
 * selection below `min` would be rejected wholesale and every candidate would be filtered out.
 *
 * `getCardType` is the prompt's own public static, called rather than reimplemented, so the type
 * classification cannot drift from the rule it is mirroring.
 */
function violatesConstraints(prompt: ChooseCardsPrompt, pickedCards: Card[], candidate: Card): boolean {
  const o = prompt.options;
  const result = [...pickedCards, candidate];

  if (!o.allowDifferentSuperTypes) {
    if (new Set(result.map(r => r.superType)).size > 1) {
      return true;
    }
  }

  if (o.differentTypes) {
    const seen = new Set<number>();
    for (const card of result) {
      const t = ChooseCardsPrompt.getCardType(card);
      if (seen.has(t)) {
        return true;
      }
      seen.add(t);
    }
  }

  // countMap keys mirror validate() exactly: superType, superType-trainerType, superType-energyType,
  // superType-stage.
  const countMap: { [key: string]: number } = {};
  for (const card of result) {
    countMap[card.superType.toString()] = (countMap[card.superType.toString()] || 0) + 1;
    if (card.superType === SuperType.TRAINER) {
      const k = `${card.superType}-${(card as TrainerCard).trainerType}`;
      countMap[k] = (countMap[k] || 0) + 1;
    }
    if (card.superType === SuperType.ENERGY) {
      const k = `${card.superType}-${(card as EnergyCard).energyType}`;
      countMap[k] = (countMap[k] || 0) + 1;
    }
    if (card.superType === SuperType.POKEMON) {
      const k = `${card.superType}-${(card as PokemonCard).stage}`;
      countMap[k] = (countMap[k] || 0) + 1;
    }
  }

  const {
    maxPokemons, maxBasicEnergies, maxTrainers, maxItems, maxTools, maxStadiums, maxSupporters,
    maxSpecialEnergies, maxEnergies, maxBasics, maxEvolutions, maxStage1, maxStage2,
  } = o;

  // The "old pattern": with maxBasics/maxEvolutions set but no per-stage caps, the selection must be
  // EITHER basics OR evolutions, never a mix.
  if ((maxBasics !== undefined || maxEvolutions !== undefined) && maxStage1 === undefined && maxStage2 === undefined) {
    const basics = countMap[`${SuperType.POKEMON}-${Stage.BASIC}`] || 0;
    const evolutions = (countMap[`${SuperType.POKEMON}`] || 0) - basics;
    if (basics > 0 && evolutions > 0) {
      return true;
    }
  }

  const evolutionCount = (countMap[`${SuperType.POKEMON}`] || 0) - (countMap[`${SuperType.POKEMON}-${Stage.BASIC}`] || 0);
  return (
    (maxPokemons !== undefined && maxPokemons < (countMap[`${SuperType.POKEMON}`] || 0))
    || (maxBasicEnergies !== undefined && maxBasicEnergies < (countMap[`${SuperType.ENERGY}-${EnergyType.BASIC}`] || 0))
    || (maxEnergies !== undefined && maxEnergies < (countMap[`${SuperType.ENERGY}`] || 0))
    || (maxTrainers !== undefined && maxTrainers < (countMap[`${SuperType.TRAINER}`] || 0))
    || (maxItems !== undefined && maxItems < (countMap[`${SuperType.TRAINER}-${TrainerType.ITEM}`] || 0))
    || (maxStadiums !== undefined && maxStadiums < (countMap[`${SuperType.TRAINER}-${TrainerType.STADIUM}`] || 0))
    || (maxSupporters !== undefined && maxSupporters < (countMap[`${SuperType.TRAINER}-${TrainerType.SUPPORTER}`] || 0))
    || (maxSpecialEnergies !== undefined && maxSpecialEnergies < (countMap[`${SuperType.ENERGY}-${EnergyType.SPECIAL}`] || 0))
    || (maxTools !== undefined && maxTools < (countMap[`${SuperType.TRAINER}-${TrainerType.TOOL}`] || 0))
    || (maxBasics !== undefined && maxBasics < (countMap[`${SuperType.POKEMON}-${Stage.BASIC}`] || 0))
    || (maxEvolutions !== undefined && maxEvolutions < evolutionCount)
    || (maxStage1 !== undefined && maxStage1 < (countMap[`${SuperType.POKEMON}-${Stage.STAGE_1}`] || 0))
    || (maxStage2 !== undefined && maxStage2 < (countMap[`${SuperType.POKEMON}-${Stage.STAGE_2}`] || 0))
  );
}

/** A card-pick whose purpose is discarding surfaces as `discard {owner, target}` (the wire's
 * specific type — matches the retreat-cost / energy-discard convention and rotomancer). */
export function isDiscardPick(prompt: ChooseCardsPrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_CARD_TO_DISCARD;
}

/**
 * CF-8 forced-atomic: a pick the player can neither decline (`allowCancel:false`) nor vary — the
 * required count is at least the whole eligible pool (`min >= |eligible|`), so every valid selection is
 * "all eligible" — is a NON-decision. The adapter resolves it atomically (no pending), matching
 * rotomancer (and the `DISCARD_X_ENERGY` prefab's own-Pokémon atomic path, and the CF-11 ≤1-card-shuffle
 * collapse). e.g. Crunch ("Discard an Energy from your opponent's Active") when the Active has exactly
 * one Energy. Genuine decisions (2+ candidates for a single pick) still surface — those already match
 * rotomancer. Secret (randomized) picks are excluded: they are the system actor's, not a forced choice.
 */
/**
 * TA-190 / CF-14: the decision KINDS whose forced case is allowed to collapse. This is an ALLOW-list,
 * and the choice of an allow-list over "collapse everything except a carve-out" is load-bearing.
 *
 * `ChooseCardsPrompt` is raised with **43 distinct GameMessages across ~1530 sites**, and they are not
 * all effect-internal. `CHOOSE_PRIZE_CARD` is one of them — so a deny-list would have collapsed a PRIZE
 * TAKE down to nothing whenever a single prize remained, which is the exact case B.25/CF-14 names as
 * having to SURVIVE ("a structural step the actor performs in turn flow"). `CHOOSE_PRIZES_SETUP` and
 * `CHOOSE_STARTING_POKEMONS` are structural too, and `CHOOSE_CARDS_ORDER` /
 * `CHOOSE_CARDS_TO_PUT_ON_TOP_OF_THE_DECK` are decisions whose whole content is an ORDER, where "every
 * selection is the same set" does not mean "every selection is the same outcome".
 *
 * So membership here requires the kind to be effect-internal AND measured on both engines:
 *   CHOOSE_CARD_TO_DISCARD — Klefki ssp-128 / Salazzle scr-024 pair, a 2-candidate negative control, and
 *                            Ceruledge pfl-020 "Infernal Slash" for the forced MULTI-card boundary
 *                            (4-of-4 collapses on BOTH engines; 4-of-5 surfaces on BOTH)
 *   CHOOSE_CARD_TO_HAND    — Sudowoodo ssp-087 "Electromagnetic Sonar", plus its own negative control
 *   CHOOSE_CARD_TO_SHUFFLE — Banette jtg-060 "Cursed Words" (see the divergence note below)
 *   CHOOSE_CARD_TO_DECK    — Gumshoos meg-110 "Evidence Gathering" (B.30, added 2026-08-06)
 *
 *   CHOOSE_CARD_TO_ATTACH  — added 2026-09-01 (TA-350 / B.46) on driven cells: Teal Dance twm-025 and
 *                            Charging Up dri-020, ONE eligible Energy (hand / discard) -> roto COLLAPSES and
 *                            applies the attach, twinleaf surfaced; TWO -> BOTH surface the WHICH pick. The
 *                            hazard found on the way: Quilladin cri-006 "Leafy Charge" raised this message
 *                            over the DECK with `min: 1`, and a hidden-zone pick must never be forced (a
 *                            search may fail to find, #903; roto keeps the decline there) — its floor is
 *                            now `min: 0`, so `min >= |eligible|` cannot hold and the collapse cannot reach
 *                            it. That is the only in-pool deck-sourced site of this message.
 *
 *   CHOOSE_CARD_TO_EVOLVE  — added 2026-10-06 (TA-619) on driven cells, Rare Candy svi-191 onto Pidgey mew-016:
 *                            ONE fitting Stage 2 in hand (obf-164) -> roto COLLAPSES and evolves, twinleaf surfaced
 *                            choose{obf-164}; TWO (obf-164 + mew-018) -> BOTH surface the WHICH pick. The source is
 *                            the acting player's own HAND, a zone they see, so the #903 hidden-zone hazard does not
 *                            reach it. Census of the in-pool sites of this message (2026-10-06): forced-capable
 *                            (`min: 1, allowCancel: false`, hand) are Rare Candy svi-191 / svi-256 HR / paf-089 (the
 *                            svi class) and Phantump cri-038's Ability pick of an evolution from hand -- both collapse
 *                            at one fitting card. Rare Candy meg-125 / meg-175 / "Rare Candy2" svi-256 run the Holon
 *                            Phantoms class (`allowCancel: true`), so they cannot. Every in-pool DECK-sourced site
 *                            (Finizen, Palafin, Pidove, Duosion, Reuniclus, Exeggcute, Misdreavus, Team Rocket's
 *                            Nidorina, Grand Tree, Technical Machine: Evolution; Salvatore, Glimmet, Team Rocket's
 *                            Pupitar, Dwebble) is `min: 0` or `allowCancel: true`, so `min >= |eligible|` or the
 *                            non-cancel term fails and a deck search is never forced (out-of-pool Vivillion ssp-007
 *                            and Sandshrew M6-035 have the same shape).
 *
 * The other 37 messages are UNMEASURED, which is not the same as judged-unsafe or judged-safe. Any
 * candidate needs the same cells driven before it is added, because "obviously the same shape" is how
 * the zone rule this change removes got written in the first place.
 *
 * CHOOSE_CARD_TO_DECK was the candidate this note named, and the cells it demanded were driven (B.30):
 *   meg-110 "Evidence Gathering", hand = 1 card  -> roto COLLAPSES and applies the swap, twinleaf surfaced
 *   meg-110 "Evidence Gathering", hand = 3 cards -> BOTH surface three picks   <-- the negative control
 * The counts are identical on both engines in the forced cell (a swap is 1-out/1-in), so it is only
 * visible by comparing card IDENTITIES — worth recording, because a size-only diff reads as convergence.
 *
 * The ORDER worry that keeps CHOOSE_CARDS_ORDER and CHOOSE_CARDS_TO_PUT_ON_TOP_OF_THE_DECK out does not
 * bite here, and that was CHECKED rather than assumed. Collapse needs `min >= |eligible|`, so it can only
 * touch a multi-card pick when `min >= 2`. Across the WHOLE card corpus (92 files raise this message)
 * exactly two sites have `min >= 2` — `erikas-maids.ts` and `furret.ts`, both far out-of-pool — and both
 * move the cards with `moveCardsTo` into the deck and then raise a `ShuffleDeckPrompt` + `applyOrder`
 * before anything else can observe the deck. That is the same reason CHOOSE_CARD_TO_SHUFFLE is listed
 * above. In the in-pool sets the multi-card boundary is vacuous by construction: all 12 in-pool sites are
 * `min: 0` (which never satisfies `min >= |eligible| > 0`) or `min: 1`.
 *
 * ⚠️ CHOOSE_CARD_TO_SHUFFLE KNOWINGLY DIVERGES FROM ROTOMANCER AT THE MULTI-CARD BOUNDARY, and it is
 * listed here on CORRECTNESS rather than agreement. Measured on Banette jtg-060 "Cursed Words" ("your
 * opponent chooses 3 cards from their hand and shuffles those cards into their deck"):
 *     opponent hand = 1 card  -> rotomancer COLLAPSES, twinleaf surfaced   (this is the TA-190 row)
 *     opponent hand = 3 cards -> rotomancer SURFACES 3 picks, twinleaf now collapses  <-- new divergence
 *     opponent hand = 4 cards -> BOTH surface (a genuine choice; not forced)
 * At 3-of-3 every legal selection ships the same three cards to the same destination, so CF-14's "one
 * effective outcome" is satisfied and the pick must collapse. The usual reason to hold back at the
 * multi-card boundary — that pick ORDER can be observable at an ordered destination — cannot apply here
 * by construction: the destination is the deck and the very next node is the `system` shuffle, which both
 * engines already emit identically. Filed against rotomancer as RE-88; this row diverges until they take
 * it. Deliberately NOT matched to their behaviour, per the standing rule that convergence is not the goal.
 */
const COLLAPSIBLE_PICK_MESSAGES: ReadonlySet<GameMessage> = new Set([
  GameMessage.CHOOSE_CARD_TO_DISCARD,
  GameMessage.CHOOSE_CARD_TO_HAND,
  GameMessage.CHOOSE_CARD_TO_SHUFFLE,
  GameMessage.CHOOSE_CARD_TO_DECK,
  GameMessage.CHOOSE_CARD_TO_ATTACH,
  GameMessage.CHOOSE_CARD_TO_EVOLVE,
]);

/**
 * TA-190 / CF-14: is the pick FORCED — i.e. does the decision have exactly one effective outcome?
 * Non-cancelable, not secret, and the required count is at least the whole eligible pool, so every
 * valid selection is "all eligible" and the player's answer carries no information.
 *
 * Kind plus forcedness are the ONLY keys. There is deliberately no zone term and no actor term — see
 * the collapse site in `next()` for the measurement that retired both.
 */
function forcedPickIndices(prompt: ChooseCardsPrompt, state: State | undefined): number[] | null {
  if (!(COLLAPSIBLE_PICK_MESSAGES.has(prompt.message) || orderFollowsActiveSelection(prompt, state)
    || prompt.deferredMove === true)
    || prompt.options.allowCancel !== false || prompt.options.isSecret === true) {
    return null;
  }
  const blocked = new Set(prompt.options.blocked);
  const eligible: number[] = [];
  for (let i = 0; i < prompt.cards.cards.length; i++) {
    if (blocked.has(i) || !matchesFilter(prompt.cards.cards[i], prompt.filter)) {
      continue;
    }
    eligible.push(i);
  }
  return eligible.length > 0 && prompt.options.min >= eligible.length ? eligible : null;
}

/**
 * TA-607 (B.73 order step, CF-14): a selection the card marks `orderFollows` — its text asks the selected cards'
 * order in its OWN decision right after (Kofu scr-138 / scr-165: "Put 2 cards from your hand on the bottom of your
 * deck in any order", an OrderCardsPrompt over exactly the picked cards) — carries no information in its pick order,
 * so when forced (min >= |eligible|) every valid answer is the same set with the same downstream decision: one
 * outcome. That is the one thing that kept the order-content messages (CHOOSE_CARDS_TO_PUT_ON_BOTTOM_OF_THE_DECK
 * and its kin) off the allow-list above, and the marker answers it per card rather than per message: Weavile
 * brs-087 (out of pool) raises the same message over the opponent's hand with NO order step after, where the pick order IS the
 * bottom order, and it is not marked. Scoped to the ACTIVE player's own selection (the B.11 / CF-17 active-player
 * collapse scope); a selection handed to the opponent surfaces.
 *
 * Census (2026-10-05, every in-pool ChooseCardsPrompt followed by an OrderCardsPrompt): Kofu scr-138/165 (hand,
 * this message, marked); Dialga ssp-135 Time Manipulation (deck, CHOOSE_CARD_TO_HAND, already on the allow-list);
 * Cryptomaniac's Deciphering tef-145 (deck, CHOOSE_CARDS, NOT marked: a deck search, left alone here).
 */
function orderFollowsActiveSelection(prompt: ChooseCardsPrompt, state: State | undefined): boolean {
  // `state` is undefined only from `assemble`, which runs after `next()` already took the decision with the state in
  // hand (a zero-pick assemble of a marked prompt is reached only through that collapse).
  return prompt.orderFollows === true
    && (state === undefined || prompt.player.id === state.players[state.activePlayer].id);
}

/**
 * ChooseCardsPrompt: one pick = one index into prompt.cards.cards; raw result = number[].
 *
 * When `options.isSecret` is set the selection is hidden/random (e.g. "discard a random card from
 * your opponent's hand", or any pick from a face-down zone). The acting player has no agency over
 * which card, so it is surfaced as the `system` actor's `pick` (the externalized-randomness analog
 * of player `choose`) rather than a player decision — keeping the choice reproducible across engines.
 */
export const chooseCardsDecomposer: PromptDecomposer<ChooseCardsPrompt> = {
  type: 'Choose cards',

  /**
   * CF-14 (TA-124): a single SECRET pick (`isSecret`, `max === 1`) forced to exactly one candidate is
   * resolved atomically instead of surfacing a 1-option `pick` pending.
   *
   * Scoped to SECRET deliberately, and the scope is MEASURED, not assumed. A secret pick is
   * externalized as the `system` actor's `pick` purely to make the randomness reproducible across
   * engines (the coin-flip analog); over exactly ONE candidate there is no entropy to reproduce, so the
   * node carries nothing — the same reasoning as CF-11's ≤1-card shuffle collapse cited above. Measured
   * divergence: `pre-064` (opponent's hand holds exactly one card) — rotomancer resolves and moves on
   * to prize selection, twinleaf pended `pick{actor=system, target=B.hand:sve-003}`.
   *
   * I first wrote this as a bare `max === 1`, mirroring choose-pokemon. That was WRONG and a bisect
   * caught it: it regressed `fz-ta27-sonar-mandatory-pick` and `xfz-jtg-060` from conform to FAIL. The
   * reason it was wrong is the one that still holds: `max === 1` is a CANDIDATE-COUNT key, and a pick
   * with one candidate is not thereby a non-decision — a CANCELABLE one still carries the decline. That
   * is why the CF-8 path above keys on forcedness (`allowCancel:false` AND `min >= |eligible|`) and not
   * on count, and why `atomicResolvable` here stays scoped to secret picks.
   *
   * ⚠️ The evidence this note originally cited has since INVERTED, and the claim is retracted rather
   * than quietly dropped. It read: "the decisive evidence is what rotomancer does on `jtg-060` — it
   * surfaces the 1-option non-secret `choose` itself, so both engines already AGREE." Rotomancer has
   * since shipped their collapse change, and on the measured pair (TA-190) they collapse the forced
   * single-candidate pick that we were pointing at them to justify keeping ours open. That argument was
   * from AGREEMENT rather than correctness, which is exactly why it did not survive them moving. `jtg-060`
   * is also no longer a witness for anything here: its pending is CHOOSE_CARD_TO_SHUFFLE against their
   * `system shuffle`, i.e. the CF-9/11/13 shuffle-externalization question, not a collapse question.
   */
  atomicResolvable: (prompt) => prompt.options.isSecret === true && prompt.options.max === 1,

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    if (rp.length >= max) {
      return null;
    }
    // CF-8 / CF-14 (TA-190): a forced pick is a non-decision — auto-resolve atomically (assemble fills
    // in the forced indices), no 1-option pending. Keyed on the DECISION KIND alone.
    //
    // This rule previously carried two extra terms, and BOTH were defects:
    //   (i)  `ownerIsActive` — collapse only when the ACTIVE player makes the pick; and
    //   (ii) `isInPlayEnergyDiscard` — otherwise collapse only for Energy off an in-play Pokémon (TA-176).
    //
    // The re-worded CF-14 (B.25, adopted from rotomancer's note twenty-five) says a pick collapses when the
    // decision is INTERNAL TO AN EFFECT'S RESOLUTION and has one effective outcome, and is "never keyed on
    // source zone, never on candidate count alone, never on who holds the pick". (i) is the holder key and
    // (ii) is the zone key, so both are exactly what the contract forbids.
    //
    // MEASURED before removing them, not argued (the pair B.25 required, driven at /v1/step on both
    // engines — `tools/collapse_probe.py`):
    //   Klefki  ssp-128 "Stick 'n' Draw", own hand, 1 candidate, ACTIVE holder     -> BOTH collapse
    //   Salazzle scr-024 "Sudden Scorching", opp hand, 1 candidate, NON-active     -> roto collapses,
    //                                                                                 twinleaf surfaced
    //   Salazzle scr-024, opp hand, TWO candidates (min=1 < |eligible|)            -> BOTH surface
    // Same zone and same verb across all three, so neither zone nor holder can be the axis; the only line
    // the evidence draws is forced-vs-genuine, which is what `forcedPickIndices` already tests. The
    // negative control is the load-bearing one — it is what keeps this from widening into "any opponent
    // hand discard collapses". Rows: `ta190-ssp-128-klefki-*`, `cf39-scr-024-*`, `ta190-scr-024-*-negative-control`.
    //
    // The OLD justification for keeping the hand case open was that "rotomancer itself surfaces it, so
    // collapsing would move us away from them" — an argument from AGREEMENT, not correctness, which duly
    // inverted the moment they shipped their change. The basis here is CF-14's kind axis on its merits; if
    // roto reverted tomorrow this would not change, and the negative control would still hold the line.
    //
    // WHY NO STRUCTURAL CARVE-OUT: CF-14 also says a pick SURVIVES when it is a structural turn-flow step
    // (promote, take a prize, pay retreat, cap discard-down). None of those can reach this decomposer —
    // promote and the retreat cost are `ChoosePokemonPrompt`/`ChooseEnergyPrompt` (retreat-effect.ts), and
    // an enumeration of every `new ChooseCardsPrompt(..., GameMessage.X)` in `game/` finds CHOOSE_CARD_TO_
    // DISCARD at exactly three sites (attack-effects.ts, prefabs.ts, trainer-prefabs.ts), all of them
    // effect-internal. So the carve-out is vacuous for this prompt class TODAY — it is not a claim that no
    // structural discard could ever exist. If one is ever added it MUST be carved out here by message, the
    // way `choose-pokemon.ts` carves out CHOOSE_NEW_ACTIVE_POKEMON.
    const forcedIndices = rp.length === 0 ? forcedPickIndices(prompt, state) : null;
    if (forcedIndices !== null) {
      return null;
    }

    const secret = prompt.options.isSecret === true;
    const picked = new Set(rp.map(p => (p as { index: number }).index));
    const pickedCards = rp.map(p => prompt.cards.cards[(p as { index: number }).index]);
    const blocked = new Set(prompt.options.blocked);
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.cards.cards.length; i++) {
      if (blocked.has(i) || picked.has(i)) {
        continue;
      }
      const card = prompt.cards.cards[i];
      if (!matchesFilter(card, prompt.filter)) {
        continue;
      }
      // TA-204: mirror validate()'s content constraints, not just its count/blocked/filter ones.
      if (violatesConstraints(prompt, pickedCards, card)) {
        continue;
      }
      const iid = ctx.cardToIid.get(card);
      if (iid !== undefined) {
        if (secret) {
          legalActions.push({ type: 'pick', target: iid });
        } else if (isDiscardPick(prompt)) {
          // CF-8: `owner` is WHOSE CARD is being discarded, not who is being asked — `actor` already
          // carries the chooser. Deriving it from `prompt.player` conflates the two and is only ever
          // right when a player discards their own cards, which is the common case and is why it
          // survived. Turtonator por-017's "Shell Spikes" is the discriminator: its controller
          // chooses (compendium #2310, "YOU will get to discard your choice") an Energy attached to
          // the OPPONENT's Attacking Pokémon, so actor and owner are opposite sides. This is the
          // RE-52 owner-from-iid class, in the same shape, on our side. Fall back to the prompt's
          // player only if the card is not in the import-origin map.
          const cardOwnerIdx = ctx.cardOwner.get(card);
          const ownerId = cardOwnerIdx !== undefined ? state.players[cardOwnerIdx].id : prompt.player.id;
          legalActions.push({
            type: 'discard', owner: playerIdToActor(state, ownerId), target: iid,
            op: 'discard', destination: 'discardPile', // CF-70 Phase 2
          } as LegalAction);
        } else if (prompt.message === GameMessage.CHOOSE_STARTING_POKEMONS) {
          // CF-84: setup placement. The engine puts pick 0 in the Active Spot and the rest on the Bench
          // (setup-reducer putStartingPokemonsAndPrizes); the compensation pass (allowExtraBenchPlacement)
          // reuses this message with the Active already placed, so every pick there is a Bench pick.
          const toActive = rp.length === 0 && prompt.player.active.cards.length === 0;
          legalActions.push({ type: 'choose', target: iid, op: 'moveTo', destination: toActive ? 'active' : 'bench' } as LegalAction);
        } else {
          legalActions.push({ type: 'choose', target: iid });
        }
      }
    }
    if (rp.length >= min && max > min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — complete with what we have (validate adjudicates)
    }
    return buildPending(prompt, state, legalActions, secret ? 'system' : undefined);
  },

  toPick(prompt, action, ctx) {
    const expected = prompt.options.isSecret === true ? 'pick'
      : isDiscardPick(prompt) ? 'discard' : 'choose';
    if (action.type !== expected) {
      throw new Error(`[conformance] ChooseCards expected '${expected}', got '${action.type}'`);
    }
    const targetIid = action.target as string;
    const card = ctx.iidToCard.get(targetIid);
    if (card === undefined) {
      throw new Error(`[conformance] choose target iid '${targetIid}' unknown`);
    }
    const index = prompt.cards.cards.indexOf(card);
    if (index === -1) {
      throw new Error(`[conformance] choose target '${action.target}' is not in the prompt's card list`);
    }
    return { kind: 'index', index };
  },

  /**
   * B.80 / CF-91: the picks already made read as made. A `discard` pick is in the discard pile at once
   * (#916: "those go into the Discard Pile right away"). A `choose` / `pick` is a SELECTION whose placement
   * the text performs later (the reveal, the put-into-hand, the attach), so the card is LIFTED into its
   * owner's `transit`: `visibility: owner` (the picker knows it; nothing has been revealed yet), `origin`
   * from the zone it was taken out of, `destination` absent — this prompt does not carry it, and a guess
   * keyed on the message is the TA-142 mistake.
   */
  /** B.82 / CF-93 (TA-651): the cards an attack's pre-damage choice of its own cards in play picked (the prompt is
   *  `deferredMove`). They stay where they are until after the damage; the adapter records them as `chosen`.
   *  TA-660 / B.93: a forced pick (no picks, every eligible card) is no decision and names nothing: no `chosen`. */
  pickedCards(prompt, picks) {
    const rp = realPicks(picks) as Array<{ index: number }>;
    return rp.map(p => prompt.cards.cards[p.index]).filter((c): c is Card => c !== undefined);
  },

  fixupProjection(prompt, picks, ctx, _state, projected) {
    if (prompt.deferredMove === true) { return; }   // B.82: a pre-damage choice; the picked cards stay where they are
    const discard = isDiscardPick(prompt);
    for (const p of realPicks(picks) as Array<{ index: number }>) {
      const card = prompt.cards.cards[p.index];
      const iid = card === undefined ? undefined : ctx.cardToIid.get(card);
      if (iid === undefined) { continue; }
      if (discard) {
        placeInDiscard(projected, iid);
      } else {
        liftToTransit(projected, iid, { visibility: 'owner' });
      }
    }
  },

  assemble(prompt, picks): number[] {
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    if (picked.length === 0) {
      // Auto-resolved forced discard (next() returned null with no picks): take all eligible (CF-8).
      const forced = forcedPickIndices(prompt, undefined);
      if (forced !== null) {
        return forced;
      }
      // An empty search that can't satisfy `min` (Love Ball with no same-named Pokémon in the deck) is a
      // WHIFF: `[]` fails validate against a positive min, and the driver resolves that uniformly as CANCEL
      // (null) for every ChooseXxx prompt — see driver.ts `sub === null`. No decomposer-specific handling.
    }
    return picked;
  },
};
