import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { GameMessage } from '../../game/game-message';
import { State } from '../../game/store/state/state';
import { SuperType } from '../../game/store/card/card-types';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter } from './decomposer';
import { playerIdToActor } from '../iid-targets';

/** A card-pick whose purpose is discarding surfaces as `discard {owner, target}` (the wire's
 * specific type — matches the retreat-cost / energy-discard convention and rotomancer). */
function isDiscardPick(prompt: ChooseCardsPrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_CARD_TO_DISCARD;
}

/**
 * CF-8 forced-atomic: a discard the player can neither decline (`allowCancel:false`) nor vary — the
 * required count is at least the whole eligible pool (`min >= |eligible|`), so every valid selection is
 * "all eligible" — is a NON-decision. The adapter resolves it atomically (no `discard` pending),
 * matching rotomancer (and the `DISCARD_X_ENERGY` prefab's own-Pokémon atomic path, and the CF-11
 * ≤1-card-shuffle collapse). e.g. Crunch ("Discard an Energy from your opponent's Active") when the
 * Active has exactly one Energy. Returns the forced index list, or null when the pick is a genuine
 * decision (2+ candidates for a single pick still surface — those already match rotomancer). Secret
 * (randomized) picks are excluded: they are the system actor's, not a forced player choice.
 */
/**
 * TA-176: is this pick a forced ENERGY discard off an IN-PLAY POKÉMON — the shape CF-8 is named for,
 * and the shape `discard-energy.ts` already collapses unconditionally (`atomicResolvable: () => true`,
 * with no actor scoping whatsoever)? Turtonator por-017's "Shell Spikes" builds exactly that decision
 * out of a `ChooseCardsPrompt` instead of a `DiscardEnergyPrompt`, so the SAME decision got two answers
 * purely by which prompt class the card happened to reach for — a routing accident, not a semantic one.
 *
 * The source list is matched by IDENTITY against the players' active/bench slots rather than inferred
 * from `prompt.filter`, so a hand/deck/discard-sourced pick can never satisfy it however it is filtered.
 * That zone restriction is MEASURED, not defensive: on the Salazzle scr-024 "Sudden Scorching" control
 * (a forced lone-card discard from the non-active player's HAND — same forced/non-cancelable/single-
 * candidate shape, differing only in source zone) ROTOMANCER ITSELF SURFACES the 1-option `discard`.
 * Collapsing by zone-blind rule would move twinleaf away from rotomancer while claiming to converge on
 * it, which is precisely how the earlier bare `max === 1` attempt failed. See
 * `scenarios/cf39-scr-024-sudden-scorching-forced-lone-hand-discard-control.json`.
 *
 * BOTH spellings of "that Pokémon's attached cards" are accepted: cards hand the prompt either the
 * PokemonCardList itself (Turtonator por-017 passes `effect.source`) or its `energies` sublist (~8 sites
 * pass `target.energies`). `energies` is a stable CardList property — an INDEX into `cards`, not a copy
 * (see pokemon-card-list.ts) — so identity holds for it too. Matching only one spelling would have split
 * an identical decision by which expression the card author happened to write, which is the same class of
 * routing accident this function exists to remove.
 */
function isInPlayEnergyDiscard(prompt: ChooseCardsPrompt, state: State, eligible: number[]): boolean {
  let inPlay = false;
  for (const player of state.players) {
    for (const slot of [player.active, ...player.bench]) {
      if (slot === undefined) {
        continue;
      }
      if (slot === (prompt.cards as unknown) || slot.energies === (prompt.cards as unknown)) {
        inPlay = true;
      }
    }
  }
  if (!inPlay) {
    return false;
  }
  return eligible.every(i => prompt.cards.cards[i].superType === SuperType.ENERGY);
}

function forcedDiscardIndices(prompt: ChooseCardsPrompt): number[] | null {
  if (!isDiscardPick(prompt) || prompt.options.allowCancel !== false || prompt.options.isSecret === true) {
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
   * decisive evidence is what rotomancer does on `jtg-060` — it *surfaces* the 1-option non-secret
   * `choose{target=B.hand:sve-003}` itself. So for a player-facing card pick both engines externalize
   * the lone candidate and already AGREE; collapsing it would have moved twinleaf away from rotomancer
   * while claiming to converge on it. A player choosing a card is also not the same non-decision as a
   * forced target: the engine's callback can distinguish "chose the only card" from "declined", which
   * is why the CF-8 path above is narrowly scoped to non-cancelable discards rather than to any
   * single-candidate pick.
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
    // CF-8: a forced, non-varying discard is a non-decision — auto-resolve atomically (assemble fills in
    // the forced indices), no 1-option `discard` pending. It collapses in two cases:
    //
    //   (i)  the ACTIVE player makes it (own or opponent-targeting) — a turn-flow non-decision; or
    //   (ii) it is an Energy discard off an IN-PLAY POKÉMON, whoever chooses (TA-176).
    //
    // (ii) is new and was ADDITIVE: it widens the collapse without narrowing case (i). The old rule was
    // (i) ALONE, under the since-RETIRED CF-39, which scoped the collapse to the active player on the
    // ground that "the control handoff to the opponent is observable". That was circular — the only thing
    // observable is the pending whose existence is in question — and CF-14's actual basis, that a decision
    // with one resolution carries no information, is actor-independent. RE-80 was filed against rotomancer
    // on the strength of CF-39 and has been RETRACTED; twinleaf was the defect (TA-176).
    //
    // What survives of the actor idea is case (i) only, and it survives as measured behavior rather than
    // as principle: a forced discard handed to the NON-active player from their HAND ("your opponent
    // discards a card from their hand", Salazzle scr-024) is surfaced BY BOTH ENGINES, so the boundary
    // between (i) and the hand case is drawn where the evidence puts it. The discriminator is the decision
    // KIND and its source ZONE, never the candidate count — see `isInPlayEnergyDiscard` above and the
    // `atomicResolvable` note below for the two ways a count-only rule has already gone wrong here.
    const activePlayer = state.players[state.activePlayer];
    const ownerIsActive = activePlayer !== undefined && prompt.player.id === activePlayer.id;
    const forcedIndices = rp.length === 0 ? forcedDiscardIndices(prompt) : null;
    if (forcedIndices !== null && (ownerIsActive || isInPlayEnergyDiscard(prompt, state, forcedIndices))) {
      return null;
    }

    const secret = prompt.options.isSecret === true;
    const picked = new Set(rp.map(p => (p as { index: number }).index));
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
          legalActions.push({ type: 'discard', owner: playerIdToActor(state, ownerId), target: iid } as LegalAction);
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

  assemble(prompt, picks): number[] {
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    if (picked.length === 0) {
      // Auto-resolved forced discard (next() returned null with no picks): take all eligible (CF-8).
      const forced = forcedDiscardIndices(prompt);
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
