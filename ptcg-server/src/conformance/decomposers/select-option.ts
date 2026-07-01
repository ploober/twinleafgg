import { SelectOptionPrompt } from '../../game/store/prompts/select-option-prompt';
import { LegalAction, SelectOptionAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * SelectOptionPrompt ('SelectOption'): pick ONE option from `values` — a branch chooser (e.g.
 * Windstorm's "discard the Stadium and up to 1 Tool" vs "discard up to 2 Tools"). The result is the
 * chosen index (`Prompt<number>`), so this is a single-select: each non-disabled index surfaces as a
 * `selectOption{option}` legalAction (parallel to Confirm's yes/no), and one pick completes it.
 * Requires the contract's `selectOption` Action (type enum + `option` index).
 */
export const selectOptionDecomposer: PromptDecomposer<SelectOptionPrompt> = {
  type: 'SelectOption',

  next(prompt, picks, _ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // single option chosen
    }
    const disabled = prompt.options.disabled ?? [];
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.values.length; i++) {
      if (disabled[i]) {
        continue;
      }
      legalActions.push({ type: 'selectOption', option: i });
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, _ctx, _state) {
    if (action.type !== 'selectOption') {
      throw new Error(`[conformance] SelectOption expected 'selectOption', got '${action.type}'`);
    }
    const option = (action as SelectOptionAction).option;
    if (!Number.isInteger(option) || option < 0 || option >= prompt.values.length) {
      throw new Error(`[conformance] selectOption index ${option} out of range (0..${prompt.values.length - 1})`);
    }
    if (prompt.options.disabled?.[option]) {
      throw new Error(`[conformance] selectOption index ${option} is disabled`);
    }
    return { kind: 'option', index: option };
  },

  assemble(_prompt, picks): number {
    const rp = realPicks(picks) as Array<{ kind: 'option'; index: number }>;
    return rp.length > 0 ? rp[0].index : 0;
  },
};
