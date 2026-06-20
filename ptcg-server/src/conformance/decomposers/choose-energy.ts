import { ChooseEnergyPrompt } from '../../game/store/prompts/choose-energy-prompt';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';

/**
 * ChooseEnergyPrompt ('Choose energy'): pick which attached energies pay a cost (retreat, or an
 * energy-cost payment). One pick = one energy (named by iid) → an index into `prompt.energy`; the
 * raw result is `number[]` which `decode` maps to `EnergyMap[]`. There is no `endChoice`: `validate`
 * requires the picked set to pay the cost EXACTLY (`checkExactEnergy`), so the decision is complete
 * the moment the accumulated picks pay it — `next` stops there. Until then it offers the remaining
 * energies; the harness supplies a subset that pays exactly (deterministic conformance).
 */
export const chooseEnergyDecomposer: PromptDecomposer<ChooseEnergyPrompt> = {
  type: 'Choose energy',

  next(prompt, picks, ctx, state) {
    const picked = realPicks(picks).map(p => (p as { index: number }).index);
    const selected = picked.map(i => prompt.energy[i]);
    // Complete as soon as the chosen energies pay the cost exactly (validate would otherwise reject).
    if (StateUtils.checkExactEnergy(selected, prompt.cost)) {
      return null;
    }

    const used = new Set(picked);
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.energy.length; i++) {
      if (used.has(i)) {
        continue;
      }
      const iid = ctx.cardToIid.get(prompt.energy[i].card);
      if (iid !== undefined) {
        legalActions.push({ type: 'chooseEnergy', card: iid });
      }
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — assemble what we have (validate adjudicates exactness)
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    if (action.type !== 'chooseEnergy') {
      throw new Error(`[conformance] ChooseEnergy expected 'chooseEnergy', got '${action.type}'`);
    }
    const iid = action.card as string;
    const index = prompt.energy.findIndex(em => ctx.cardToIid.get(em.card) === iid);
    if (index === -1) {
      throw new Error(`[conformance] chooseEnergy card '${iid}' is not an energy offered by the prompt`);
    }
    return { kind: 'index', index };
  },

  assemble(_prompt, picks): number[] {
    return realPicks(picks).map(p => (p as { index: number }).index);
  },
};
