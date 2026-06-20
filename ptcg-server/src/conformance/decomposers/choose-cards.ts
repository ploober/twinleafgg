import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter } from './decomposer';

/** ChooseCardsPrompt: one pick = one index into prompt.cards.cards; raw result = number[]. */
export const chooseCardsDecomposer: PromptDecomposer<ChooseCardsPrompt> = {
  type: 'Choose cards',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    if (rp.length >= max) {
      return null;
    }

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
        legalActions.push({ type: 'choose', target: iid });
      }
    }
    if (rp.length >= min && max > min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — complete with what we have (validate adjudicates)
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    if (action.type === 'endChoice') {
      return { kind: 'done' };
    }
    if (action.type !== 'choose') {
      throw new Error(`[conformance] ChooseCards expected 'choose', got '${action.type}'`);
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

  assemble(_prompt, picks): number[] {
    return realPicks(picks).map(p => (p as { index: number }).index);
  },
};
