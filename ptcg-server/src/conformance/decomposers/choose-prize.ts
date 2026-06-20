import { ChoosePrizePrompt, ChoosePrizePromptType } from '../../game/store/prompts/choose-prize-prompt';
import { State } from '../../game/store/state/state';
import { Player } from '../../game/store/state/player';
import { CardList } from '../../game/store/state/card-list';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ChoosePrizePrompt ('Choose prize'): take `options.count` prize piles after a knockout (or an effect
 * that takes/discards prizes). The raw wire form `decode` expects is `number[]` — indices into the
 * target player's *non-empty* prize piles. So this is a fixed-count multi-select: one pick names one
 * pile by the iid of its (single) card, accumulated until `count` are chosen. `blocked` is also an
 * index into the same filtered list. `useOpponentPrizes` retargets to the opponent's prizes.
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

export const choosePrizeDecomposer: PromptDecomposer<ChoosePrizePrompt> = {
  type: ChoosePrizePromptType,

  next(prompt, picks, ctx, state) {
    const rp = realPicks(picks) as Array<{ kind: 'prize'; index: number }>;
    if (rp.length >= prompt.options.count) {
      return null; // enough prizes chosen
    }

    const prizes = nonEmptyPrizes(prompt, state);
    const picked = new Set(rp.map(p => p.index));
    const blocked = new Set(prompt.options.blocked);
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prizes.length; i++) {
      if (picked.has(i) || blocked.has(i)) {
        continue;
      }
      const iid = ctx.cardToIid.get(prizes[i].cards[0]);
      if (iid === undefined) {
        continue;
      }
      legalActions.push({ type: 'choosePrize', prize: iid });
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, state) {
    if (action.type !== 'choosePrize') {
      throw new Error(`[conformance] ChoosePrize expected 'choosePrize', got '${action.type}'`);
    }
    const prizeIid = (action as { prize: string }).prize;
    const card = ctx.iidToCard.get(prizeIid);
    if (card === undefined) {
      throw new Error(`[conformance] choosePrize iid '${prizeIid}' not found in this game`);
    }
    const prizes = nonEmptyPrizes(prompt, state);
    const index = prizes.findIndex(p => p.cards[0] === card);
    if (index === -1) {
      throw new Error(`[conformance] choosePrize iid '${prizeIid}' is not a takeable prize pile`);
    }
    return { kind: 'prize', index };
  },

  assemble(_prompt, picks): number[] {
    return (realPicks(picks) as Array<{ kind: 'prize'; index: number }>).map(p => p.index);
  },
};
