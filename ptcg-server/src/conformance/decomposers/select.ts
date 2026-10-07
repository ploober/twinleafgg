import { SelectPrompt } from '../../game/store/prompts/select-prompt';
import { LegalAction, SelectOptionAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * SelectPrompt ('Select'): pick ONE option from `values` — a branch chooser, the twin of
 * SelectOptionPrompt ('SelectOption'). Both are `Prompt<number>` resolving to the chosen index; the only
 * shape difference is that `Select` carries no per-index `disabled` mask (every value is selectable) and
 * a `defaultValue`. Cards raise it for an in-effect "Choose 1: …" (e.g. Kieran ssp — "Switch your Active
 * with a Benched Pokémon" vs "your Pokémon's attacks do 30 more damage"). Each index surfaces as a
 * `selectOption{option}` legalAction — the SAME neutral verb as SelectOption, since the decision is
 * identical (pick one labeled branch) — and one pick completes it.
 */
export const selectDecomposer: PromptDecomposer<SelectPrompt> = {
  type: 'Select',

  // TA-656 (CF-14): a "Choose 1" menu raised with one value (Kieran with no Benched Pokemon: the Switch mode is
  // withheld, B.91) has one resolution, so it is applied with no pending; the mode's own later prompts still surface.
  atomicResolvable: () => true,

  next(prompt, picks, _ctx, state) {
    if (realPicks(picks).length >= 1) {
      return null; // single option chosen
    }
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.values.length; i++) {
      legalActions.push({ type: 'selectOption', option: i, label: String(prompt.values[i]) });
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, _ctx, _state) {
    if (action.type !== 'selectOption') {
      throw new Error(`[conformance] Select expected 'selectOption', got '${action.type}'`);
    }
    const option = (action as SelectOptionAction).option;
    if (!Number.isInteger(option) || option < 0 || option >= prompt.values.length) {
      throw new Error(`[conformance] selectOption index ${option} out of range (0..${prompt.values.length - 1})`);
    }
    return { kind: 'option', index: option };
  },

  assemble(_prompt, picks): number {
    const rp = realPicks(picks) as Array<{ kind: 'option'; index: number }>;
    return rp.length > 0 ? rp[0].index : 0;
  },
};
