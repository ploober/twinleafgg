import { ChoosePrizePrompt, ChoosePrizePromptType } from '../../game/store/prompts/choose-prize-prompt';
import { State } from '../../game/store/state/state';
import { Player } from '../../game/store/state/player';
import { CardList } from '../../game/store/state/card-list';
import { LegalAction, NeutralState } from '../neutral-types';
import { PromptDecomposer, WirePick, realPicks, buildPending } from './decomposer';
import { playerIdToActor } from '../iid-targets';

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
      legalActions.push({ type: 'takePrize', index: w });
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, _ctx, state, picks) {
    if (action.type !== 'takePrize') {
      throw new Error(`[conformance] ChoosePrize expected 'takePrize', got '${action.type}'`);
    }
    const wire = (action as { index: number }).index;
    const remaining = remainingNativeIndexes(prompt, state, picks ?? []);
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
    }
  },
};
