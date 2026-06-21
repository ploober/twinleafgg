import { ChooseAttackPrompt } from '../../game/store/prompts/choose-attack-prompt';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ChooseAttackPrompt ('Choose attack'): pick ONE attack to copy/disable (Memory Skip, metronome-style
 * attacks). The result is a single `Attack`, so this is a single-select decomposer: one pick = a
 * `{source, name}` naming a card in `prompt.cards` and one of its attacks. The raw wire form `decode`
 * expects is `{ index, attack }` (index into `prompt.cards`).
 */
export const chooseAttackDecomposer: PromptDecomposer<ChooseAttackPrompt> = {
  type: 'Choose attack',

  next(prompt, picks, ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // single-select: one attack chosen
    }

    const blocked = new Set(prompt.options.blocked.map(b => `${b.index}:${b.attack}`));
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.cards.length; i++) {
      const iid = ctx.cardToIid.get(prompt.cards[i]);
      if (iid === undefined) {
        continue;
      }
      for (const attack of prompt.cards[i].attacks) {
        if (blocked.has(`${i}:${attack.name}`)) {
          continue;
        }
        legalActions.push({ type: 'choose', target: iid, name: attack.name });
      }
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    // ChooseAttack maps onto the generic `choose`; the attack is named via the contract-valid `name`
    // field (target = the card iid in the prompt's list).
    if (action.type !== 'choose') {
      throw new Error(`[conformance] ChooseAttack expected 'choose', got '${action.type}'`);
    }
    const source = action.target as string;
    const name = action.name as string;
    const index = prompt.cards.findIndex(c => ctx.cardToIid.get(c) === source);
    if (index === -1) {
      throw new Error(`[conformance] choose target '${source}' is not in the prompt's card list`);
    }
    if (!prompt.cards[index].attacks.some(a => a.name === name)) {
      throw new Error(`[conformance] choose target '${source}' has no attack '${name}'`);
    }
    return { kind: 'attack', index, attack: name };
  },

  assemble(_prompt, picks): { index: number; attack: string } | null {
    const rp = realPicks(picks) as Array<{ index: number; attack: string }>;
    if (rp.length === 0) {
      return null; // no attack chosen → decode treats null as cancel
    }
    return { index: rp[0].index, attack: rp[0].attack };
  },
};
