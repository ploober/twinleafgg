import { ConfirmPrompt } from '../../game/store/prompts/confirm-prompt';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ConfirmPrompt ('Confirm'): a single yes/no player decision — an optional effect ("you may…"). The
 * result is a boolean, so this is a single-select: both answers surface as `confirm{value}`
 * legalActions (parallel to how a system `flip` carries `face: heads|tails`), and one pick completes
 * the decision. Requires the contract's `confirm` Action (type enum + `value` property).
 */
export const confirmDecomposer: PromptDecomposer<ConfirmPrompt> = {
  type: 'Confirm',

  next(prompt, picks, _ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // single yes/no answer chosen
    }
    const legalActions: LegalAction[] = [
      { type: 'confirm', value: true },
      { type: 'confirm', value: false },
    ];
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, _ctx, _state) {
    if (action.type !== 'confirm') {
      throw new Error(`[conformance] Confirm expected 'confirm', got '${action.type}'`);
    }
    return { kind: 'confirm', value: (action as { value: boolean }).value };
  },

  assemble(_prompt, picks): boolean {
    const rp = realPicks(picks) as Array<{ kind: 'confirm'; value: boolean }>;
    return rp.length > 0 ? rp[0].value : false;
  },
};
