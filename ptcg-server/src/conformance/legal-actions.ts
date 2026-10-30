import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { TrainerCard } from '../game/store/card/trainer-card';
import { EnergyCard } from '../game/store/card/energy-card';
import { GameError } from '../game/game-error';
import { Store } from '../game/store/store';
import {
  UseAbilityAction as UseAbilityGameAction, AttackAction as AttackGameAction,
  UseStadiumAction as UseStadiumGameAction, RetreatAction as RetreatGameAction
} from '../game/store/actions/game-actions';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { CardTarget, PlayerType, SlotType, PlayCardAction } from '../game/store/actions/play-card-action';
import { deepClone } from '../utils/utils';
import { ConformanceStoreHandler } from './conformance-store-handler';
import { atOnceWireSpec } from './at-once';
import {
  SuperType, TrainerType, Stage, SpecialCondition, BoardEffect, CardType, EnergyType
} from '../game/store/card/card-types';
import { Attack, PowerType } from '../game/store/card/pokemon-types';
import { State, GamePhase } from '../game/store/state/state';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { Marker } from '../game/store/state/card-marker';
import { StateUtils } from '../game/store/state-utils';
import { StoreLike } from '../game/store/store-like';
import {
  CheckPokemonAttacksEffect, CheckAttackCostEffect, CheckRetreatCostEffect,
  CheckProvidedEnergyEffect, CheckPokemonPowersEffect, CheckPokemonToolCapacityEffect
} from '../game/store/effects/check-effects';
import { ImportedGame, IidContext } from './state-adapter';
import { LegalAction, PendingDecision, NeutralPlayerId } from './neutral-types';

/**
 * The active player's top-level main-phase menu (impl §4.6, M5). Returned by the driver at a
 * quiescent boundary (no open prompt, action log exhausted) when the game is ongoing and in the
 * main phase. Each LegalAction mirrors a dispatchable top-level NeutralAction, so the menu is
 * directly executable — the M5 spec round-trips every entry through `step` to prove soundness.
 *
 * Legality is enumerated by mirroring the engine's own gates: Pokemon/Energy hand playability comes
 * from the store's per-dispatch `player.playableCardIds`; trainers use `trainerPlayable` (which
 * matches what `playCardAction` accepts, not the conservative `playableCardIds` that hides most
 * Item/Supporter plays); attacks/retreat/abilities reuse the same Check*
 * effects the reducers use (`CheckPokemonAttacksEffect`, `CheckAttackCostEffect`,
 * `CheckProvidedEnergyEffect`, `CheckRetreatCostEffect`, `CheckPokemonPowersEffect`). These are
 * the engine's read-only query effects (the same ones `calculatePlayability` drives), so reducing
 * them here does not mutate the observable projection.
 */

interface OwnSlot {
  list: PokemonCardList;
  /** iid of the stack's bottom/basic card — the Pokemon-in-play's stable identity. */
  iid: string;
  /** Bench slot index, or null for the active slot. */
  benchIndex: number | null;
}

/** The active player's in-play Pokemon (active + occupied bench), each with its identifying iid. */
function ownInPlay(player: Player, ctx: IidContext): OwnSlot[] {
  const slots: OwnSlot[] = [];
  const push = (list: PokemonCardList, benchIndex: number | null) => {
    if (list.getPokemonCard() === undefined) { return; }
    const iid = ctx.cardToIid.get(list.getPokemons()[0]);
    if (iid !== undefined) { slots.push({ list, iid, benchIndex }); }
  };
  push(player.active, null);
  player.bench.forEach((b, i) => push(b, i));
  return slots;
}

// ── Phase 1: hand plays (from the store's precomputed playability) ───────────

function handMenu(store: StoreLike, state: State, player: Player, ctx: IidContext): LegalAction[] {
  const out: LegalAction[] = [];
  const playable = new Set(player.playableCardIds);
  const own = ownInPlay(player, ctx);
  const hasBenchSpace = player.bench.some(b => b.cards.length === 0);
  /** CF-55: card NAMES that have already contributed their one at-once template to this menu. */
  const atOnceEmitted = new Set<string>();

  for (const card of player.hand.cards) {
    const iid = ctx.cardToIid.get(card);
    if (iid === undefined) { continue; }

    if (card.superType === SuperType.POKEMON && card instanceof PokemonCard) {
      if (handPlayVerbFor(card) === 'benchBasic') {
        if (!playable.has(card.id)) { continue; }
        // TA-809: static playability does not propagate opposing PlayPokemonEffect locks.
        const benchIndex = player.bench.findIndex(b => b.cards.length === 0);
        if (hasBenchSpace && pokemonPlayProbeAccepts(state, player, card, benchIndex)) {
          out.push({ type: 'benchBasic', card: iid });
        }
      } else {
        // Evolutions are NOT gated on playableCardIds — the same call already made for trainers
        // above, and for the same reason. `CAN_PLAY_POKEMON_CARD` (which fills playableCardIds)
        // decides an evolution with a raw `pokemonPlayedTurn < state.turn` read, so it is false for
        // exactly the printed first-turn-exception cards whose handler rewrites that field during
        // dispatch. Gating on it hid wht-008 Shelmet's legal turn-1 evolution from the menu while
        // playCardAction accepted it. The probe below IS the engine's real predicate, so it
        // subsumes the conservative static one.
        // Evolution: one entry per in-play Pokemon it legally evolves. The name match is the only
        // check that can be made statically; both legality gates are settled by a dry run
        // (TA-263).
        //
        // Why a probe and not a static test. The reducer's gates are
        // `state.turn <= 2 && !player.canEvolve` (CANNOT_EVOLVE_ON_YOUR_FIRST_TURN) and
        // `pokemonPlayedTurn >= state.turn` (POKEMON_CANT_EVOLVE_THIS_TURN) — but BOTH operands are
        // rewritten mid-dispatch by the printed first-turn-exception cards (Shelmet wht-008,
        // Clamperl, Metapod). Those cards react to the PlayPokemonEffect itself, setting
        // `canEvolve = true` and back-dating `pokemonPlayedTurn`, and the gates are evaluated only
        // AFTER that propagation. So at menu time both fields still read "banned" and no static
        // check can be right: reading them withholds a legal evolution, ignoring them offers an
        // illegal one. The menu was doing the latter (over-offering on a first turn), and the
        // obvious fix would have silently converted it into the former.
        //
        // Note the ban is the ACTING PLAYER's first turn — global turn 1 going first, turn 2 going
        // second. Keying it to turn 1 alone is rotomancer's RE-112 defect; the probe inherits the
        // engine's own predicate and cannot drift from it.
        for (const s of own) {
          const top = s.list.getPokemonCard();
          if (!top || top.name !== card.evolvesFrom) { continue; }
          if (pokemonPlayProbeAccepts(state, player, card, s.benchIndex)) {
            out.push({ type: 'evolve', card: iid, target: s.iid });
          }
        }
      }
    } else if (card.superType === SuperType.ENERGY && card instanceof EnergyCard) {
      if (!playable.has(card.id)) { continue; }
      for (const s of own) {
        // TA-337: mirror the reducer's fromHand denial (play-energy-effect.ts) — a slot carrying
        // cannotAttachEnergyFromHandNextTurn (Cursed Roots cri-039 et al.) refuses the hand attach,
        // so offering it makes the menu reject its own action (the fuzz CONTRACT class).
        if (s.list.cannotAttachEnergyFromHandNextTurn) { continue; }
        // TA-374: a Special Energy with a printed attachment restriction ("can only be attached to
        // a Team Rocket's Pokémon", asc-217) enforces it as a `throw` inside its OWN reduceEffect —
        // invisible to every static check here — so the menu offered the attach onto an ineligible
        // Pokémon and the dispatcher then rejected it (same CONTRACT class as TA-337). Dry-run the
        // concrete attach, the Trainer/evolve-probe idiom (TA-248/TA-263). Scoped to SPECIAL energy:
        // Basic energy carries no attachment restriction, so it is never probed (behaviour unchanged,
        // and the clone cost is bounded to the few special energies actually in hand).
        if (card.energyType === EnergyType.SPECIAL && !attachEnergyProbeAccepts(state, player, card, s)) { continue; }
        out.push({ type: 'attachEnergy', card: iid, target: s.iid });
      }
    } else if (card.superType === SuperType.TRAINER && card instanceof TrainerCard) {
      // Trainers are NOT gated on playableCardIds: that mirrors CAN_PLAY_CARD, which defaults
      // Items/Supporters lacking a canPlay() override to `false` — yet the playCardAction reducer
      // accepts them, so mirroring it would make legalActions under-report most trainer plays
      // (a §10.3 contract gap). Enumerate by the engine's real play-time gates instead.
      if (!trainerPlayable(store, state, player, card)) { continue; }
      // TA-280 (Trainer side, the TA-248/Dusk Ball class): a deck-sourced Item/Supporter on an EMPTY deck
      // provably does nothing (B.41) — withheld here, once, from the printed text. Tools/Stadiums carry no
      // deck-sourced play effect and pass through untouched.
      if ((card.trainerType === TrainerType.ITEM || card.trainerType === TrainerType.SUPPORTER)
          && deckSourcedEffectUnusable(player, card.text)) { continue; }
      // Final gate: dry-run on a clone, the Trainer analog of `attackProbeAccepts` / TA-14's ability
      // probe. Cards whose play gate lives as a `throw` inside their own reduceEffect are invisible to
      // every static check above. TA-248.
      // TA-789: a Tool's probe needs its target. Probed onto the Active alone, a Tool was withheld from every Benched
      // Pokemon as soon as the Active held one (one Tool per Pokemon), so each target is probed on its own.
      if (card.trainerType !== TrainerType.TOOL && !trainerProbeAccepts(state, player, card)) { continue; }
      switch (card.trainerType) {
        case TrainerType.TOOL:
          for (const s of own) {
            const capacity = new CheckPokemonToolCapacityEffect(player, s.list);
            store.reduceEffect(state, capacity);
            if (s.list.tools.length < capacity.capacity && trainerProbeAccepts(state, player, card, s)) {
              out.push({ type: 'attachTool', card: iid, target: s.iid });
            }
          }
          break;
        case TrainerType.ITEM:
        case TrainerType.SUPPORTER:
        case TrainerType.STADIUM: {
          // Read from the shared derivation (TA-273), never re-derived here: this line and the
          // dispatcher's check must be the same fact or they drift apart again.
          const playType = handPlayVerbFor(card) as 'playItem' | 'playSupporter' | 'playStadium';
          // CF-55 — an at-once printing gets ONE template for the whole NAME, carrying `candidates`
          // and `counts`, instead of one `card` offer per copy in hand. Emitted at the FIRST copy
          // encountered and suppressed for the rest, so four Transformation Tomes yield one entry
          // rather than four — and, crucially, not the C(4,2)=6 combinations that enumerating
          // concrete plays would produce.
          //
          // ⚠️ THE PROBE AND THE OFFER ARE DIFFERENT OBJECTS, and the split is deliberate. Every
          // trainer here is gated on `trainerProbeAccepts`, a DRY RUN of the concrete play. A
          // template is not dispatchable by construction — it names no single card — so probing the
          // template would fail its own dry run and the offer would vanish from the menu silently.
          // We probe the CONCRETE play (already done above, against `card`) and offer the TEMPLATE.
          // Rotomancer hit exactly this in their own enumerator and warned us before we wrote it.
          const spec = atOnceWireSpec(card);
          if (spec !== null) {
            if (atOnceEmitted.has(card.name)) { break; }
            atOnceEmitted.add(card.name);
            // Keyed on NAME, not printing: a hand holding Custom Catcher LOT-171 and LOT-231 holds
            // two Custom Catchers and may play them together — they are the same card by rule.
            const candidates = player.hand.cards
              .filter(c => c.name === card.name)
              .map(c => ctx.cardToIid.get(c))
              .filter((x): x is string => x !== undefined)
              .sort();
            // A count the hand cannot supply is not a legal length HERE, whatever the text permits
            // in principle.
            const counts = spec.counts.filter(n => n <= candidates.length);
            if (counts.length > 0) {
              out.push({ type: playType, candidates, counts });
            }
            break;
          }
          out.push({ type: playType, card: iid });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The ONE hand-play verb a card in hand can be played with (CF-54: the verb selects the gates).
 * Returns null for a card that cannot be played from hand at all.
 *
 * ⚠️ THIS EXISTS SO THE MENU AND THE DISPATCHER CANNOT DRIFT. TA-273: `benchBasic`,
 * `playSupporter`, `attachTool` and `attachEnergy` all resolved an Item, because the executor
 * dispatched `PlayCardAction` and let the ENGINE pick from the card's own category while the menu
 * derived the verb separately and correctly. Every engine's menu offered exactly `playItem` for
 * Ultra Ball; only the executor did not check. Rotomancer hit the same class twice (RE-117, RE-121)
 * and it is the shape they named: **the menu and the dispatcher are written in two places.** So the
 * derivation lives here, once, and both callers read it.
 *
 * The distinction is `evolvesFrom === '' && stage === BASIC` for `benchBasic` and everything else
 * Pokémon for `evolve` — the same test the menu already used. A FOSSIL is a `TrainerType.ITEM` in
 * hand and therefore `playItem`, which is B.37's settled reading (*in hand a Fossil is an Item, not
 * a Pokémon*) and matches what the menu offers for it.
 */
export function handPlayVerbFor(card: Card): string | null {
  if (card.superType === SuperType.POKEMON && card instanceof PokemonCard) {
    return card.evolvesFrom === '' && card.stage === Stage.BASIC ? 'benchBasic' : 'evolve';
  }
  if (card.superType === SuperType.ENERGY && card instanceof EnergyCard) {
    return 'attachEnergy';
  }
  if (card.superType === SuperType.TRAINER && card instanceof TrainerCard) {
    switch (card.trainerType) {
      case TrainerType.TOOL: return 'attachTool';
      case TrainerType.ITEM: return 'playItem';
      case TrainerType.SUPPORTER: return 'playSupporter';
      case TrainerType.STADIUM: return 'playStadium';
      default: return null;
    }
  }
  return null;
}

/**
 * Whether a trainer in hand is playable right now, for legalAction enumeration. CAN_PLAY_CARD (which
 * feeds player.playableCardIds) defaults Items/Supporters without a canPlay() override to false —
 * but playCardAction accepts them, so mirroring playableCardIds under-reports. We defer to
 * CAN_PLAY_CARD when it says yes (covers Energy/Pokemon/Tool/Stadium and trainers that DO implement
 * canPlay()), honor an explicit canPlay() verdict, and otherwise enumerate the canPlay-less majority
 * of Items/Supporters by the engine's basic play-time gates (the same ones CAN_PLAY_TRAINER_CARD
 * checks before its conservative fallback). Over-reporting is self-correcting: the fuzzer's
 * "never reject your own legalAction" invariant flags any enumerated play the reducer refuses.
 */
/**
 * TA-280 — the empty-deck gate, ONCE, at the offer (B.27 / B.29 rule 1, B.41): an Ability or Trainer whose
 * printed effect is sourced from the player's own deck — a search, a look at the top N, a reveal from the
 * top, a draw — has an action that CANNOT be carried out when that deck is empty (#13 "can't search an
 * empty deck", #840, #2042 "you have to be able to draw", #2115 a payable cost is no licence). TA-216 fixed
 * this by hand-writing `if (deck.length === 0) throw` into ONE card file and the class recurred in every
 * other card (X-Boot, Scent Collection, Metal Maker, Dusk Ball …), because the menu probe is a throw-only
 * dry run that accepts whatever does not throw. This reads the printed text instead of each file.
 *
 * Gated on EMPTINESS only — never on whether a search would find a match (#127/#1114: a fruitless search
 * of a stocked deck is legal, and gating on the match leaks deck contents through the menu).
 *
 * NOT gated (left to the card's own logic), because the text says the deck is (re)stocked first or has
 * an alternative source: a put-back from the hand/discard into the deck ("Shuffle your hand into your
 * deck. Then, draw …" — Lacey, whose deck-0 answer is B.41's ARITHMETIC, TA-349), and a choice of source
 * ("from your deck or discard pile"). Attacks are never gated here (B.33: an attack has no play gate; a
 * deck-sourced rider whiffs).
 */
// Source phrases only. "on the bottom of your deck" / "into your deck" are DESTINATIONS (a put-back onto an
// empty deck is fine) and deliberately absent; Dusk Ball reads "Look at the BOTTOM 7 cards of your deck".
const DECK_SOURCED = /search your deck|look at the (?:top|bottom)|reveal the (?:top|bottom)|from (?:the (?:top|bottom) of )?your deck|\bdraw\b/i;
// A restock from ANY other zone counts — Redeemable Ticket jtg-156 puts the PRIZE cards on the bottom of an
// empty deck and then takes from the top (measured 2026-09-07: the first cut withheld it, rotomancer offers).
const DECK_RESTOCKED_FIRST = /(?:hand|discard pile|in play|prize cards?)[^.]{0,80}\b(?:into|(?:on|at) the bottom of|on top of) (?:your|their) deck|shuffle your hand into your deck/i;
const ALTERNATIVE_SOURCE = /deck or (?:your )?discard pile|discard pile or (?:your )?deck/i;
// A sentence about the OPPONENT's deck ("Your opponent … they draw 4" — Grand Wing por-009, Special Red
// Card) or about EACH player (Judge, Iono) is not sourced from the acting player's deck; only a sentence
// with no such subject counts. (Iono/Judge at own deck 0 are the restock case anyway.)
const NOT_OWN_DECK = /opponent|\bthey\b|\btheir\b|each player/i;
export function deckSourcedEffectUnusable(player: Player, text: string | undefined): boolean {
  if (player.deck.cards.length > 0 || !text) { return false; }
  if (DECK_RESTOCKED_FIRST.test(text) || ALTERNATIVE_SOURCE.test(text)) { return false; }
  return text.split(/(?<=[.!?])\s+/).some(sentence => DECK_SOURCED.test(sentence) && !NOT_OWN_DECK.test(sentence));
}

function trainerPlayable(store: StoreLike, state: State, player: Player, card: TrainerCard): boolean {
  const { CAN_PLAY_CARD } = require('../game/store/prefabs/prefabs');
  if (CAN_PLAY_CARD(store, state, player, card)) { return true; }
  if (card.canPlay) { return false; } // had a card-specific verdict above — honor it, don't override
  switch (card.trainerType) {
    case TrainerType.SUPPORTER:
      if (state.turn === 1 && !card.firstTurn) { return false; }
      return player.supporterTurn === 0;
    case TrainerType.ITEM:
      // Remapped during the upstream merge: the removed OPPONENT_CANNOT_PLAY_ITEM_CARDS_MARKER and
      // player.ATTACK_EFFECT_ITEM_LOCK markers are now the single `cannotPlayItemCards` play-lock field
      // that PlayLockEffect sets (effect-of-attack-effects.ts → Player.applyPlayLocks). CAN_PLAY_CARD at
      // line 130 already returns false under item-lock, but this ITEM branch deliberately over-reports
      // past a false CAN_PLAY_CARD, so we must still detect the real lock here to avoid offering a
      // locked Item (the same intent the two marker checks had).
      if (player.cannotPlayItemCards) { return false; }
      return true;
    default:
      return false; // Tool/Stadium were already adjudicated by CAN_PLAY_CARD above
  }
}

// ── Phase 2: attacks / retreat / abilities (new legality enumeration) ────────

function enoughEnergyFor(store: StoreLike, state: State, player: Player, source: PokemonCardList, attack: Attack): boolean {
  const cost = new CheckAttackCostEffect(player, attack);
  store.reduceEffect(state, cost);
  const provided = new CheckProvidedEnergyEffect(player, source);
  store.reduceEffect(state, provided);
  return StateUtils.checkEnoughEnergy(provided.energyMap, cost.cost as CardType[]);
}

/**
 * The per-attack locks `useAttack` enforces on the attacking Pokemon.
 *
 * The FIRST-TURN ban is deliberately NOT checked here (TA-226). It is not a static property of the
 * attack: an Ability can grant the exemption at declare time. `blk-044` Meloetta ex's "Debut
 * Performance" ("If you go first, this Pokémon can use attacks during your first turn") sets
 * `canUseOnFirstTurn` from its `reduceEffect` on the UseAttackEffect, so the flag is false when the
 * menu is built and true by the time the attack resolves. Every other first-turn attacker in the pool
 * sets the flag STATICALLY on its attack definition, which is why the static test held until an
 * Ability-granted one appeared.
 *
 * The consequence of testing it here was an attack twinleaf REFUSES TO OFFER and then happily
 * ACCEPTS when sent — the mirror of the TA-225 offer-then-reject family, and just as much a
 * self-contradiction. `attackProbeAccepts` below is authoritative instead: it dispatches the same
 * `AttackGameAction` the driver does, so the ban is enforced by the code that actually owns it
 * (`useAttack` throws `GameError(CANNOT_ATTACK_ON_FIRST_TURN)`, which the probe reads as "don't
 * offer"). Costs one extra clone per attack on turn 1 only.
 */
function attackUnlocked(state: State, source: PokemonCardList, attack: Attack): boolean {
  if (source.cannotAttackNextTurn) { return false; }
  if (source.cannotUseAttacksNextTurn.includes(attack.name)) { return false; }
  return true;
}

/**
 * Dry-run one attack declaration on a CLONED store — the attack analog of `abilityProbeAccepts`
 * (TA-14). Some attacks gate usage only by throwing inside their `reduceEffect` on the AttackEffect,
 * invisible to the static `attackUnlocked`/`enoughEnergyFor` checks: a card-imposed "that Pokemon
 * can't use that attack" marker (the ~28-card `OPPONENTS_POKEMON_CANNOT_USE_THAT_ATTACK_MARKER`
 * family — Klefki "Memory Lock", Murkrow "Torment", …) or a printed use-restriction ("You can use
 * this attack only if you go second …" — Illumise "Slowing Perfume", per compendium #1079 / RE-25).
 * Without probing, the menu offers an attack the engine then rejects — a §10.3 contract violation the
 * fuzzer flags as "rejected its own legalAction". This mirrors exactly what the driver dispatches
 * (`AttackAction(id, name)`), so a `GameError` here = the real declaration would `invalidAction` =
 * don't offer. Any other throw (an effect reaching a coin flip / prompt with no provider on the
 * clone) gets the benefit of the doubt and the move is offered, as with the ability probe.
 */
function attackProbeAccepts(state: State, player: Player, attackName: string): boolean {
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  const cloned = probe.state.players[state.players.indexOf(player)];
  try {
    probe.dispatchProbe(new AttackGameAction(cloned.id, attackName));
    return true;
  } catch (err) {
    return !(err instanceof GameError);
  }
}

/**
 * Dry-run one Trainer play on a CLONED store — the Trainer analog of {@link attackProbeAccepts} and
 * of TA-14's ability probe. Mirrors exactly what `dispatchPlayTrainer` sends (a `PlayCardAction` at
 * the card's hand index), so a `GameError` here means the real play would `invalidAction`, and the
 * menu must not offer it. Any other throw (an effect reaching a prompt with no provider on the clone)
 * gets the benefit of the doubt and the play is offered, as with the other two probes.
 *
 * TA-248. `trainerPlayable` deliberately over-reports past a false CAN_PLAY_CARD, on the recorded
 * reasoning that "over-reporting is self-correcting: the fuzzer's never-reject-your-own-legalAction
 * invariant flags any enumerated play the reducer refuses". It does — that alarm is how this was
 * found — but the alarm is not the fix, and until now nothing closed the loop. A whole family of
 * Trainers gate their play by throwing inside `reduceEffect`, and none of the static checks can see
 * it: `Cheren` (asc-258, and its EPO original) throws `CANNOT_PLAY_THIS_CARD` when the deck is empty,
 * which is *correct* — compendium #924, "you cannot play a Trainer when it is known that it will have
 * no effect", of any draw Trainer with no cards in deck (also #1124 Juniper/Sycamore, #1497 Roxie,
 * #973 Cynthia & Caitlin). Rotomancer withholds it. We offered it and then refused it.
 */
/**
 * Dry-run an evolution on a clone: does `card` legally evolve the Pokemon in `slot` right now?
 * The Trainer/attack-probe idiom (TA-14/TA-248) applied to PlayPokemonEffect, because the
 * first-turn and played-this-turn gates read operands that the evolved Pokemon's own handler
 * rewrites during the same dispatch — see the call site. Throw-only: B.29 endorses "can the
 * prescribed ACTION be carried out" and warns off state-diff inertness tests.
 */
function pokemonPlayProbeAccepts(state: State, player: Player, card: PokemonCard, benchIndex: number | null): boolean {
  const handIndex = player.hand.cards.indexOf(card);
  if (handIndex === -1) { return true; }
  const playerIndex = state.players.indexOf(player);
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  const cloned = probe.state.players[playerIndex];
  const target = benchIndex === null
    ? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
    : { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: benchIndex };
  try {
    probe.dispatchProbe(new PlayCardAction(cloned.id, handIndex, target));
    return true;
  } catch (err) {
    return !(err instanceof GameError);
  }
}

/**
 * Dry-run an energy attach from hand onto `slot` on a clone: does `card` legally attach there right
 * now? The Trainer/evolve-probe idiom (TA-248/TA-263) applied to AttachEnergyEffect — the attachment
 * restriction of a Special Energy ("can only be attached to a Team Rocket's Pokémon", asc-217) lives
 * as a `throw new GameError` inside the card's own reduceEffect and is invisible to any static test.
 * Throw-only, like the siblings: a GameError means the engine refuses the attach, so the menu must
 * not offer it; any other throw (a prompt with no provider on the clone) gets the benefit of the
 * doubt and the attach is offered. Only special energies reach here (see the call site). TA-374.
 */
function attachEnergyProbeAccepts(state: State, player: Player, card: EnergyCard, slot: OwnSlot): boolean {
  const handIndex = player.hand.cards.indexOf(card);
  if (handIndex === -1) { return true; }
  const playerIndex = state.players.indexOf(player);
  const benchIndex = slot.benchIndex;
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  const cloned = probe.state.players[playerIndex];
  const target = benchIndex === null
    ? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
    : { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: benchIndex };
  try {
    probe.dispatchProbe(new PlayCardAction(cloned.id, handIndex, target));
    return true;
  } catch (err) {
    return !(err instanceof GameError);
  }
}

/** TA-789: a Tool is probed onto the slot it would be attached to (`slot`); every other Trainer onto the Active. */
function trainerProbeAccepts(state: State, player: Player, card: TrainerCard, slot?: OwnSlot): boolean {
  const handIndex = player.hand.cards.indexOf(card);
  if (handIndex === -1) { return true; }
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  const cloned = probe.state.players[state.players.indexOf(player)];
  const target = slot === undefined || slot.benchIndex === null
    ? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
    : { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: slot.benchIndex };
  try {
    probe.dispatchProbe(new PlayCardAction(cloned.id, handIndex, target));
    return true;
  } catch (err) {
    return !(err instanceof GameError);
  }
}

function attackMenu(store: StoreLike, state: State, player: Player, ctx: IidContext): LegalAction[] {
  // PARALYZED / ASLEEP block ALL attacks (checked on the active regardless of attacker).
  const sp = player.active.specialConditions;
  if (sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) { return []; }

  const out: LegalAction[] = [];
  const emit = (source: PokemonCardList, attacks: Attack[]) => {
    const iid = source.getPokemonCard() ? ctx.cardToIid.get(source.getPokemons()[0]) : undefined;
    if (iid === undefined) { return; }
    for (const attack of attacks) {
      if (!attackUnlocked(state, source, attack)) { continue; }
      if (!enoughEnergyFor(store, state, player, source, attack)) { continue; }
      // Final gate: dry-run on a clone — card-private "can't use this attack" blocks (markers,
      // printed use-restrictions) live inside reduceEffect and are invisible to the static checks.
      if (!attackProbeAccepts(state, player, attack.name)) { continue; }
      out.push({ type: 'declareAttack', source: iid, name: attack.name });
    }
  };

  const activeCard = player.active.getPokemonCard();
  if (activeCard) {
    const toolAttacks = new CheckPokemonAttacksEffect(player);
    store.reduceEffect(state, toolAttacks);
    emit(player.active, [...activeCard.attacks, ...toolAttacks.attacks]);
  }
  // Bench Pokemon with `useOnBench` attacks can attack from the bench.
  for (const b of player.bench) {
    const bc = b.getPokemonCard();
    if (bc) { emit(b, bc.attacks.filter(a => a.useOnBench === true)); }
  }
  return out;
}

function retreatMenu(store: StoreLike, state: State, player: Player): LegalAction[] {
  if (player.active.getPokemonCard() === undefined) { return []; }
  const sp = player.active.specialConditions;
  if (sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) { return []; }
  if (player.retreatedTurn === state.turn) { return []; }
  // "The Defending Pokémon can't retreat during your opponent's next turn" (BLOCK_RETREAT /
  // preventRetreatEffect, 179 cards) sets `cannotRetreatNextTurn`, which the retreat dispatch enforces
  // via assertCanRetreat. Mirror it here so the MENU is gated too — otherwise twinleaf offers a retreat
  // it then rejects (offer-then-reject vs rotomancer). TA-47 menu-gate class (meg-001 Bind Down repro).
  // Gated here rather than by throwing from CheckRetreatCostEffect: ~30 reader cards query the opponent's
  // retreat cost (Sharpedo "Aqua Impact" &c.) and a throw would crash them.
  if (player.active.cannotRetreatNextTurn) { return []; }

  const benchSlots = player.bench
    .map((b, i) => ({ b, i }))
    .filter(x => x.b.cards.length > 0);
  if (benchSlots.length === 0) { return []; }

  // A card effect may forbid the retreat outright (e.g. "this Pokemon can't
  // retreat during your next turn") by throwing from the cost query.
  const cost = new CheckRetreatCostEffect(player);
  try {
    store.reduceEffect(state, cost);
  } catch (e) {
    return [];
  }
  if (cost.cost.length > 0) {
    const provided = new CheckProvidedEnergyEffect(player, player.active);
    store.reduceEffect(state, provided);
    if (!StateUtils.checkEnoughEnergy(provided.energyMap, cost.cost)) { return []; }
  }
  // `to` indexes the PROJECTED bench (occupied slots only, in order) — native slot numbers are
  // engine-private and drift from the projection once a promote/KO leaves a hole (TA-9). The
  // driver's dispatchRetreat translates back to the native slot.
  //
  // Final gate (TA-340 / TA-271): dry-run the real RetreatAction on a clone. A card-private
  // "can't retreat" lives as a `throw` on RetreatEffect (the Fossils: "This card … can't retreat"),
  // invisible to the cost query above, so the menu advertised a retreat the executor then refused.
  // Same idiom as attackProbeAccepts: a GameError = don't offer; any other throw = offer.
  return benchSlots
    .filter(x => retreatProbeAccepts(state, player, x.i))
    .map((_slot, k) => ({ type: 'retreat', to: k } as LegalAction));
}

function retreatProbeAccepts(state: State, player: Player, nativeSlot: number): boolean {
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  const cloned = probe.state.players[state.players.indexOf(player)];
  try {
    probe.dispatchProbe(new RetreatGameAction(cloned.id, nativeSlot));
    return true;
  } catch (err) {
    return !(err instanceof GameError);
  }
}

/**
 * Dry-run one ability on a CLONED store. Many abilities gate usage only by throwing inside their
 * `reduceEffect` (e.g. Lunar Cycle's "if you have Solrock in play" / "a Basic [F] Energy in hand")
 * — invisible to any static enumeration, so without probing the menu offers moves the engine then
 * rejects (a §10.3 contract violation the fuzzer flags as "rejected its own legalAction").
 * `deepClone(state, [Card])` preserves Card instances, so the source card locates the same slot on
 * the clone. A GameError rejection = not offered; any other throw (e.g. the effect reaching a coin
 * flip with no provider installed) gets the benefit of the doubt and the move is offered.
 */
function abilityProbeAccepts(state: State, player: Player, ability: string, sourceCard: PokemonCard): boolean {
  return abilityProbeOutcome(state, player, ability, sourceCard).accepted;
}

/** What one probed `useAbility` would do: accepted (the engine would run it), or the GameError it throws. */
interface ProbeOutcome { accepted: boolean; reason?: string }

/**
 * The probe behind `abilityProbeAccepts`, with the OUTCOME kept: `prepare` edits the throwaway clone
 * before the dispatch (drop an open prompt, clear a marker) so a caller can ask the counterfactual
 * "would it be accepted if X were not so?" — `abilitiesUsedLabels` (G-59) needs exactly that.
 */
function abilityProbeOutcome(state: State, player: Player, ability: string, sourceCard: PokemonCard,
  prepare?: (cloned: State) => void): ProbeOutcome {
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  if (prepare !== undefined) { prepare(probe.state); }
  const cloned = probe.state.players[state.players.indexOf(player)];
  let target: CardTarget | undefined;
  if (cloned.active.cards.includes(sourceCard)) {
    target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  } else {
    for (let i = 0; i < cloned.bench.length; i++) {
      if (cloned.bench[i].cards.includes(sourceCard)) {
        target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: i };
        break;
      }
    }
  }
  if (target === undefined) {
    return { accepted: false, reason: 'not in play' };
  }
  try {
    probe.dispatchProbe(new UseAbilityGameAction(cloned.id, ability, target));
    // Since engine b0cdfed96 ("More Animation Additions") an activated ability first raises a no-op
    // WaitPrompt (animation overlay); its real precondition — which may throw CANNOT_USE_POWER — runs
    // only AFTER that prompt. Drive the probe past any WaitPrompt so the precondition surfaces. A
    // genuine decision prompt (e.g. MoveDamagePrompt) means the ability IS usable → accept.
    for (let guard = 0; guard < 32; guard++) {
      const pending = probe.state.prompts.find(p => p.result === undefined);
      if (pending === undefined) { return { accepted: true }; }
      if (pending.type !== 'WaitPrompt') { return { accepted: true }; }
      // Resolve with a non-undefined value: reducePrompt only fires the continuation when the result
      // is !== undefined (WaitPrompt is Prompt<void> — its `then` ignores the value).
      probe.dispatch(new ResolvePromptAction(pending.id, true));
    }
    return { accepted: true };
  } catch (err) {
    // A GameError is the engine's refusal; anything else gets the benefit of the doubt (as before).
    return err instanceof GameError ? { accepted: false, reason: String(err.message) } : { accepted: true };
  }
}

/** One piece of once-per-turn state a Pokemon's Ability use may have left behind (see abilitiesUsedLabels). */
type OncePerTurnItem =
  | { kind: 'board' }                                            // BoardEffect.ABILITY_USED on the slot
  | { kind: 'ingested' }                                         // slot.abilitiesUsedThisTurn (imported labels)
  | { kind: 'marker'; holder: (s: State) => Marker; name: string } // a marker SOURCED by this Pokemon
  | { kind: 'flag'; name: string }
  | { kind: 'cardmarker'; name: string };                       // a marker the card keeps on ITSELF (this.marker)                              // a bespoke per-turn `used…` boolean on the owner

/**
 * Player carries a dozen bespoke once-per-turn booleans that predate the marker prefabs
 * (`usedTableTurner`, `usedMinusCharge`, `usedLunarCycle`, …): a card sets one instead of a marker
 * and reads it back as its own once-per-turn gate. They are once-per-turn state a use leaves behind,
 * so the derivation clears them too. The two per-GAME flags are excluded: clearing `usedVSTAR` /
 * `usedGX` would make a VSTAR Power read as "used this turn" on every later turn of the game.
 */
const PER_GAME_USED_FLAGS = new Set(['usedGX', 'usedVSTAR']);
function bespokeUsedFlags(player: Player): string[] {
  return Object.keys(player).filter(k =>
    k.startsWith('used') && !PER_GAME_USED_FLAGS.has(k) && (player as unknown as Record<string, unknown>)[k] === true);
}

/**
 * G-59 — the once-per-turn Ability labels this Pokemon has fired this turn, DERIVED FROM ENFORCEMENT.
 *
 * A label is emitted for an activated Ability iff (1) the engine would REFUSE a `useAbility` for it
 * right now (the same dry-run the menu uses), and (2) that refusal rests on once-per-turn state the
 * use left behind: clearing that state on a throwaway clone changes the probe's outcome (accepted, or
 * a different refusal — a card whose inert-guard fires only once its marker is out of the way still
 * counts as "used"). twinleaf has no uniform use-up signal — 318 of 651 once-per-turn cards flag
 * `ABILITY_USED`, the rest a player/slot marker sourced by the card, under half a dozen spellings and
 * with a card-dependent commit point — so the label is computed from what the engine DOES, never from
 * "the announcement happened": a card that checks a marker it never sets (Charizard teu-014, OOP-84)
 * projects `[]` while it is re-offered, which is the truth the wire must carry (a projected "used"
 * label must mean the engine would refuse a re-use). The clearing is tried all-at-once and then one
 * item at a time, so a card whose ability ALSO needs one of its own markers as a precondition
 * (Fezandipiti ex sfa-038 Flip the Script needs OPPONENT_KNOCKOUT_MARKER) is not mis-read as unused.
 *
 * At a pending state the clone's open prompt is dropped before the dispatch, so mid-body the label
 * reads whatever twinleaf's own commit point says for that card (reservation- or completion-time);
 * B.57 adjudicates that timing on the honest reading, not on a hook that fires for every card.
 *
 * Known under-report (documented, not hidden): a card that throws the SAME GameMessage for "already
 * used" and "nothing to do" whose body precondition is gone after the use reads `[]`.
 */
export function abilitiesUsedLabels(state: State, player: Player, slot: PokemonCardList): string[] {
  const pokemon = slot.getPokemonCard();
  if (pokemon === undefined) { return []; }
  const pi = state.players.indexOf(player);
  const bi = player.bench.indexOf(slot);
  if (pi < 0 || (bi < 0 && slot !== player.active)) { return []; }
  const slotOf = (s: State): PokemonCardList => (bi >= 0 ? s.players[pi].bench[bi] : s.players[pi].active);

  const items: OncePerTurnItem[] = [];
  if (slot.boardEffect.includes(BoardEffect.ABILITY_USED)) { items.push({ kind: 'board' }); }
  if (slot.abilitiesUsedThisTurn.length > 0) { items.push({ kind: 'ingested' }); }
  state.players.forEach((p, pIdx) => {
    const holders: Array<[Marker, (s: State) => Marker]> = [
      [p.marker, s => s.players[pIdx].marker],
      [p.active.marker, s => s.players[pIdx].active.marker],
      ...p.bench.map((b, i): [Marker, (s: State) => Marker] => [b.marker, s => s.players[pIdx].bench[i].marker]),
    ];
    for (const [m, holder] of holders) {
      for (const item of m.markers) {
        if (item.source === pokemon) { items.push({ kind: 'marker', holder, name: item.name }); }
      }
    }
  });
  for (const name of bespokeUsedFlags(player)) { items.push({ kind: 'flag', name }); }
  // TA-451: a card can keep its once-per-turn marker on ITSELF (`this.marker`, Quaquaval ssp-052
  // Up-Tempo). The card object is shared between the state and the probe clone (deepClone skips
  // Card), so clearing it is done on the live object and restored after every probe — see `outcome`.
  for (const item of pokemon.marker.markers) {
    if (item.source === pokemon) { items.push({ kind: 'cardmarker', name: item.name }); }
  }
  if (items.length === 0) { return []; } // nothing a use could have left behind → nothing to attribute

  const clear = (s: State, which: OncePerTurnItem[]): void => {
    for (const it of which) {
      if (it.kind === 'board') { slotOf(s).removeBoardEffect(BoardEffect.ABILITY_USED); }
      else if (it.kind === 'ingested') { slotOf(s).abilitiesUsedThisTurn = []; }
      else if (it.kind === 'flag') { (s.players[pi] as unknown as Record<string, unknown>)[it.name] = false; }
      else if (it.kind === 'cardmarker') { pokemon.marker.removeMarker(it.name, pokemon); }
      else { it.holder(s).removeMarker(it.name, pokemon); }
    }
  };
  const dropPending = (s: State): void => { s.prompts = s.prompts.filter(p => p.result !== undefined); };
  const outcome = (ability: string, which: OncePerTurnItem[]): ProbeOutcome => {
    // The card object's own markers live outside the clone: snapshot and restore around the probe so
    // neither the clearing nor anything the dry run adds leaks into the real state (TA-440's rule).
    const saved = pokemon.marker.markers.slice();
    try {
      return abilityProbeOutcome(state, player, ability, pokemon, s => { dropPending(s); clear(s, which); });
    } finally {
      pokemon.marker.markers = saved;
    }
  };

  const out: string[] = [];
  // TA-459 / B.58 (stack membership): a once-per-turn use is remembered BY NAME on the in-play Pokémon
  // (usePower / ABILITY_USED push it; #798: the evolved Pokémon still remembers), so a label belongs
  // to EVERY card in the stack whose printed once-per-turn power is in that memory — the Trevenant
  // stack still carries [Spiteful Evolution]. Keyed on the stack's own powers so a replacement that
  // arrived in the same slot (Palafin ex after Zero to Hero, #1589) carries nothing.
  for (const card of slot.getPokemons()) {
    for (const power of card.powers) {
      if (power.powerType !== PowerType.ABILITY && power.powerType !== PowerType.POKEPOWER) { continue; }
      if (/once during your (?:first )?turn/i.test(power.text ?? '') && slot.abilitiesUsedThisTurn.includes(power.name) && !out.includes(power.name)) {
        out.push(power.name);
      }
    }
  }
  for (const power of pokemon.powers) {
    if (power.powerType !== PowerType.ABILITY && power.powerType !== PowerType.POKEPOWER) { continue; }
    if (out.includes(power.name)) { continue; }
    if (power.useWhenInPlay !== true) {
      // TA-455 (CF-77): a TRIGGERED once-per-turn Ability ("when you play this Pokemon…", "when this
      // Pokemon moves…") has no useAbility to dry-run, so its label is read from the ABILITY_USED slot
      // flag the card sets when its "you may" is ACCEPTED (the commit; nothing before the answer —
      // RE-167's mirror). Never from a marker: three cards mark the player on a DECLINE as well
      // (TA-457), and a declined trigger is not a use (compendium #43, Burning Road). A from-hand
      // activation (Klinklang scr-101 Emergency Rotation, useFromHand) sets no state and is not
      // derived here.
      if (slot.boardEffect.includes(BoardEffect.ABILITY_USED) && /once during your (?:first )?turn/i.test(power.text ?? '')) {
        out.push(power.name);
      }
      continue;
    }
    // TA-454: since TA-452 (the reducer refuses the flag) and TA-453 (usePower sets it at the
    // announcement) the ABILITY_USED slot flag IS the once-per-turn state for every power printed
    // "Once during your turn" — read it directly. The counterfactual probe below is refused for
    // PHASE reasons while an attack is resolving (Morpeko twm-072 read [Snack Seek] at its own pick and
    // [] at the attack cost pick two actions later), so it stays for marker-keyed cards only.
    if (slot.boardEffect.includes(BoardEffect.ABILITY_USED) && /once during your (?:first )?turn/i.test(power.text ?? '')) {
      out.push(power.name);
      continue;
    }
    const now = outcome(power.name, []);
    if (now.accepted) { continue; } // a re-use would be accepted: NOT used, whatever was announced
    const differs = (o: ProbeOutcome): boolean => o.accepted || o.reason !== now.reason;
    if (differs(outcome(power.name, items)) || items.some(it => differs(outcome(power.name, [it])))) {
      out.push(power.name);
    }
  }
  return out;
}

function abilityMenu(store: StoreLike, state: State, player: Player, ctx: IidContext): LegalAction[] {
  const out: LegalAction[] = [];
  for (const s of ownInPlay(player, ctx)) {
    const pokemon = s.list.getPokemonCard();
    if (pokemon === undefined) { continue; }
    // Once-per-turn activated abilities flag the slot with ABILITY_USED (cleared at EndTurnEffect).
    if (s.list.boardEffect.includes(BoardEffect.ABILITY_USED)) { continue; }
    // TA-807: a card-sourced marker can record a prerequisite (Janine played),
    // not a spent use. Let the native ability probe below enforce its own markers.
    const powersEffect = new CheckPokemonPowersEffect(player, pokemon);
    store.reduceEffect(state, powersEffect);
    for (const power of powersEffect.powers) {
      // Player-activated in-play powers span two powerType eras: modern PowerType.ABILITY and the
      // older PowerType.POKEPOWER (e.g. Dragonite DS "Delta Charge"). Both are activated by the player;
      // only PowerType.POKEBODY is purely passive (never in the menu). The useWhenInPlay gate below plus
      // the abilityProbeAccepts dry-run keep passive/unusable powers out either way (F-027).
      if (power.powerType !== PowerType.ABILITY && power.powerType !== PowerType.POKEPOWER) { continue; }
      if (power.useWhenInPlay !== true) { continue; } // only player-activated in-play abilities
      // TA-280: a deck-sourced Ability on an EMPTY deck cannot be carried out (B.29 rule 1) — one gate here
      // instead of a hand-written throw per card file. Text-keyed; see deckSourcedEffectUnusable.
      if (deckSourcedEffectUnusable(player, power.text)) { continue; }
      // Final gate: dry-run on a clone — card-private preconditions live inside reduceEffect (TA-14).
      if (!abilityProbeAccepts(state, player, power.name, pokemon)) { continue; }
      out.push({ type: 'useAbility', source: s.iid, ability: power.name });
    }
  }
  return out;
}

/**
 * Every card in every zone, by zone, as a comparable string — enough to tell whether an effect MOVED
 * or CHANGED anything observable. Card ids (not iids) are fine here: both sides of the comparison are
 * the same game, so a difference in the per-zone id lists means cards actually moved.
 */
function zoneFingerprint(state: State): string {
  const ids = (list: { cards: Card[] }) => list.cards.map(c => c.id).join(',');
  return state.players.map(p => [
    ids(p.hand), ids(p.deck), ids(p.discard), ids(p.lostzone), ids(p.stadium), ids(p.supporter),
    p.prizes.map(ids).join('|'),
    [p.active, ...p.bench].map(s =>
      `${ids(s)}/${s.tools.map(t => t.id).join(',')}/${s.damage}/${s.specialConditions.join(',')}`
    ).join('|'),
  ].join(';')).join('#');
}

/**
 * Dry-run the Stadium activation on a CLONED store — the Stadium analog of `abilityProbeAccepts`,
 * and the detector for "does this Stadium even HAVE an activated effect".
 *
 * A GameError means don't offer, as with the ability/attack probes. That alone covers most of the
 * ground, because twinleaf's convention is that a Stadium which cannot be activated THROWS
 * CANNOT_USE_STADIUM — both the purely passive kind (Beach Court `svi-167`) and an activated one
 * whose effect is inert on this board (Levincia with no Basic [L] in the discard; Surfing Beach with
 * no benched [W]), which is CF-33's zero-achievable rule arriving through the engine's own gate.
 *
 * But the convention is not universal: 4 of the 26 in-pool Stadium printings are passive and simply
 * DON'T answer UseStadiumEffect (Neutralization Zone, Forest of Vitality, Risky Ruins, Festival
 * Grounds), so the dispatch "succeeds" having done nothing but burn the once-per-turn flag. Offering
 * that is a phantom action — nothing to decide, nothing changed — so a silent no-op is also a
 * not-offered. This is deliberately fixed in the ADAPTER rather than by bolting a throw onto ~100
 * passive Stadium cards: the engine under test is not wrong here (its real client never shows the
 * button), the wire projection is what needs the gate.
 *
 * "It did something" = a decision opened, OR it narrated beyond the one use-Stadium log line, OR a
 * card moved / a Pokemon's damage or conditions changed.
 */
function stadiumProbeAccepts(state: State, player: Player): boolean {
  const handler = new ConformanceStoreHandler();
  const probe = new Store(handler);
  handler.setStore(probe);
  probe.state = deepClone(state, [Card]);
  const cloned = probe.state.players[state.players.indexOf(player)];
  const before = zoneFingerprint(probe.state);
  const logsBefore = probe.state.logs.length;
  try {
    probe.dispatchProbe(new UseStadiumGameAction(cloned.id));
    for (let guard = 0; guard < 32; guard++) {
      const pending = probe.state.prompts.find(p => p.result === undefined);
      if (pending === undefined) { break; }
      if (pending.type !== 'WaitPrompt') { return true; }   // a genuine decision opened
      probe.dispatch(new ResolvePromptAction(pending.id, true));
    }
  } catch (err) {
    return !(err instanceof GameError);
  }
  // Ran to completion with nothing left to decide: offer only if it actually did something. The
  // single LOG_PLAYER_USES_STADIUM line the game reducer always writes doesn't count.
  return probe.state.logs.length > logsBefore + 1 || zoneFingerprint(probe.state) !== before;
}

/**
 * The in-play Stadium's activated effect (CF-37) — one menu entry, no card/source, because there is
 * exactly one shared Stadium slot. Gated by mirroring the reducer's own checks (a Stadium in play and
 * this player's use unspent) plus the probe above. The per-turn flag is reset when a player PLAYS a
 * new Stadium (`play-trainer-effect.ts`), so "use → replace → use again" is offered — the cap rides
 * on the physical card, per compendium #926/#975.
 */
function stadiumMenu(state: State, player: Player): LegalAction[] {
  if (StateUtils.getStadiumCard(state) === undefined) { return []; }
  if (player.stadiumUsedTurn === state.turn) { return []; }
  if (!stadiumProbeAccepts(state, player)) { return []; }
  return [{ type: 'useStadium' }];
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * The main-phase menu, or null when there is nothing to choose (game over, or a non-main boundary —
 * e.g. a checkup the engine resolves itself). `endTurn` is always legal for the active player.
 */
export function topLevelMenu(game: ImportedGame): PendingDecision | null {
  const state = game.state;
  if (state.phase !== GamePhase.PLAYER_TURN) { return null; }

  const player = state.players[state.activePlayer];
  const actor: NeutralPlayerId = state.activePlayer === 0 ? 'A' : 'B';

  // Refresh hand playability. The store recomputes `playableCardIds` at the end of every
  // reduceEffect (store.ts); a boundary reached by replay is already fresh, but a no-op step
  // (reading the menu with an empty action log) never dispatched — so trigger the same recompute
  // here with a read-only effect.
  game.store.reduceEffect(state, new CheckProvidedEnergyEffect(player));

  const legalActions: LegalAction[] = [
    ...handMenu(game.store, state, player, game.ctx),
    ...attackMenu(game.store, state, player, game.ctx),
    ...retreatMenu(game.store, state, player),
    ...abilityMenu(game.store, state, player, game.ctx),
    ...stadiumMenu(state, player),
    { type: 'endTurn' },
  ];

  return { actor, descriptor: 'main', legalActions };
}
