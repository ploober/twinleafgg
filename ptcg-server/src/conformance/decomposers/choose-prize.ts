import { ChoosePrizePrompt, ChoosePrizePromptType } from '../../game/store/prompts/choose-prize-prompt';
import { State } from '../../game/store/state/state';
import { Player } from '../../game/store/state/player';
import { CardList } from '../../game/store/state/card-list';
import { LegalAction, NeutralState } from '../neutral-types';
import { PromptDecomposer, WirePick, realPicks, buildPending } from './decomposer';
import { playerIdToActor } from '../iid-targets';
import { GameMessage } from '../../game/game-message';

/**
 * TA-403 / CF-32: the wire verb names the OPERATION. `takePrize` is the KO/effect prize TAKE (the
 * prompt's message says so: CHOOSE_PRIZE_CARD, or …_TO_DISCARD for a prize sent to the discard). Any
 * other ChoosePrizePrompt — Crescent Purge's "turn 1 of your face-down Prize cards face up"
 * (sfa-021, message CHOOSE_POKEMON) — takes nothing, and is lowered as `choose {target: prize iid}`.
 * Whether that face-down pick should surface at all is CF-66's open question; the verb is ours.
 */
function isTakePick(prompt: ChoosePrizePrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_PRIZE_CARD
    || prompt.message === GameMessage.CHOOSE_PRIZE_CARD_TO_DISCARD;
}

/**
 * ChoosePrizePrompt ('Choose prize'): take `options.count` prize piles after a knockout (or an effect
 * that takes/discards prizes). The raw wire form `decode` expects is `number[]` — NATIVE indices into
 * the target player's *non-empty* prize piles. So this is a fixed-count multi-select: one pick names
 * one pile, accumulated until `count` are chosen. `blocked` is also a native index into the same
 * filtered list. `useOpponentPrizes` retargets to the opponent's prizes.
 *
 * WIRE semantics are take-immediately with CURRENT-pile indexing (CF-1, adjudicated 2026-07-01):
 * each `takePrize{index}` indexes the pile as currently projected (already-picked piles removed),
 * and a picked prize reads as already-taken in the projection (`fixupProjection` moves it to the
 * destination zone) even though the native prompt resolves atomically at the end. The pick stored
 * internally is the NATIVE index (what `decode` wants); the wire<->native translation happens at
 * the menu/toPick boundary.
 */

function targetPlayer(prompt: ChoosePrizePrompt, state: State): Player | undefined {
  const self = state.players.find(p => p.id === prompt.playerId);
  if (self === undefined) {
    return undefined;
  }
  return prompt.options.useOpponentPrizes
    ? state.players.find(p => p.id !== prompt.playerId)
    : self;
}

function nonEmptyPrizes(prompt: ChoosePrizePrompt, state: State): CardList[] {
  const player = targetPlayer(prompt, state);
  return player ? player.prizes.filter(p => p.cards.length > 0) : [];
}

function pickedNativeIndexes(picks: WirePick[]): Set<number> {
  return new Set((realPicks(picks) as Array<{ kind: 'prize'; index: number }>).map(p => p.index));
}

/** Native indexes still visible on the wire (non-empty piles minus already-picked), in pile order. */
function remainingNativeIndexes(prompt: ChoosePrizePrompt, state: State, picks: WirePick[]): number[] {
  const picked = pickedNativeIndexes(picks);
  const prizes = nonEmptyPrizes(prompt, state);
  const remaining: number[] = [];
  for (let i = 0; i < prizes.length; i++) {
    if (!picked.has(i)) {
      remaining.push(i);
    }
  }
  return remaining;
}

export const choosePrizeDecomposer: PromptDecomposer<ChoosePrizePrompt> = {
  type: ChoosePrizePromptType,

  next(prompt, picks, ctx, state) {
    const rp = realPicks(picks) as Array<{ kind: 'prize'; index: number }>;
    if (rp.length >= prompt.options.count) {
      return null; // enough prizes chosen
    }

    const prizes = nonEmptyPrizes(prompt, state);
    const blocked = new Set(prompt.options.blocked);
    const legalActions: LegalAction[] = [];
    const remaining = remainingNativeIndexes(prompt, state, picks);
    for (let w = 0; w < remaining.length; w++) {
      const i = remaining[w];
      if (blocked.has(i)) {
        continue; // visible in the pile but not takeable
      }
      const iid = ctx.cardToIid.get(prizes[i].cards[0]);
      if (iid === undefined) {
        continue; // pile has no projectable card → not an offerable index
      }
      if (isTakePick(prompt)) {
        legalActions.push({ type: 'takePrize', index: w });
      } else {
        legalActions.push({ type: 'choose', target: iid });   // TA-403
      }
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, state, picks) {
    const remaining = remainingNativeIndexes(prompt, state, picks ?? []);
    if (!isTakePick(prompt)) {
      // TA-403: a non-take prize pick is `choose {target}` — resolve the iid to its pile.
      if (action.type !== 'choose') {
        throw new Error(`[conformance] ChoosePrize (non-take) expected 'choose', got '${action.type}'`);
      }
      const card = ctx.iidToCard.get((action as { target: string }).target);
      const prizes = nonEmptyPrizes(prompt, state);
      const native = remaining.find(i => card !== undefined && prizes[i].cards[0] === card);
      if (native === undefined || new Set(prompt.options.blocked).has(native)) {
        throw new Error(`[conformance] choose target '${(action as { target: string }).target}' is not a choosable prize pile`);
      }
      return { kind: 'prize', index: native };
    }
    if (action.type !== 'takePrize') {
      throw new Error(`[conformance] ChoosePrize expected 'takePrize', got '${action.type}'`);
    }
    const wire = (action as { index: number }).index;
    if (!Number.isInteger(wire) || wire < 0 || wire >= remaining.length) {
      throw new Error(`[conformance] takePrize index ${wire} is not a takeable prize pile`);
    }
    const native = remaining[wire];
    if (new Set(prompt.options.blocked).has(native)) {
      throw new Error(`[conformance] takePrize index ${wire} names a blocked prize pile`);
    }
    return { kind: 'prize', index: native };
  },

  assemble(_prompt, picks): number[] {
    return (realPicks(picks) as Array<{ kind: 'prize'; index: number }>).map(p => p.index);
  },

  /** CF-1 take-immediately: project already-picked prizes as taken (pile → destination zone). */
  fixupProjection(prompt, picks, ctx, state, projected: NeutralState) {
    const picked = pickedNativeIndexes(picks);
    if (picked.size === 0) {
      return;
    }
    const player = targetPlayer(prompt, state);
    if (player === undefined) {
      return;
    }
    const prizes = nonEmptyPrizes(prompt, state);
    const actor = playerIdToActor(state, player.id);
    const proj = projected.players[actor];
    const toDiscard = prompt.options.destination === player.discard;
    for (const i of picked) {
      const iid = ctx.cardToIid.get(prizes[i].cards[0]);
      if (iid === undefined) {
        continue;
      }
      const at = proj.prizes.findIndex(p => p.iid === iid);
      if (at === -1) {
        continue;
      }
      const [ref] = proj.prizes.splice(at, 1);
      (toDiscard ? proj.discard : proj.hand).push({ iid: ref.iid, printing: ref.printing });
      if (!toDiscard) {
        // 🚨 THE COUNTERS ARE PART OF "READS AS ALREADY-TAKEN", AND THEY WERE NOT MOVED WITH THE CARD.
        // Moving the pile card and leaving `flags.prizesTaken` alone made the projection contradict
        // itself: mid-cascade on a 2-prize KO the card sat in the hand while the tally still said 0,
        // and rotomancer -- who counts per pick -- read 1 on the identical board. Not a granularity
        // difference (CF-43): the card is in the HAND on both engines, so twinleaf was disagreeing
        // with its own projection rather than deferring an effect. 27 in-pool cards read the
        // cumulative tally, so a card resolving between the two takes reads a stale number.
        //
        // The `!toDiscard` gate MIRRORS the engine's own rule in `TAKE_SPECIFIC_PRIZES`, which
        // increments only when `destination === player.hand`: a prize an effect sends to the discard
        // was never TAKEN by the player. Deriving the condition from the engine rather than restating
        // it is what keeps the adapter's arithmetic and the engine's from drifting apart.
        proj.flags.prizesTaken = (proj.flags.prizesTaken ?? 0) + 1;
        proj.flags.prizesTakenThisTurn = (proj.flags.prizesTakenThisTurn ?? 0) + 1;
      }
    }
  },
};
