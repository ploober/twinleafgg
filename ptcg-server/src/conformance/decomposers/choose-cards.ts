import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { GameMessage } from '../../game/game-message';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter } from './decomposer';
import { playerIdToActor } from '../iid-targets';

/** A card-pick whose purpose is discarding surfaces as `discard {owner, target}` (the wire's
 * specific type — matches the retreat-cost / energy-discard convention and rotomancer). */
function isDiscardPick(prompt: ChooseCardsPrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_CARD_TO_DISCARD;
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

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    if (rp.length >= max) {
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
          legalActions.push({ type: 'discard', owner: playerIdToActor(state, prompt.player.id), target: iid } as LegalAction);
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

  assemble(_prompt, picks): number[] {
    return realPicks(picks).map(p => (p as { index: number }).index);
  },
};
