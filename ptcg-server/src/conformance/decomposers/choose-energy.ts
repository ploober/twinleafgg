import { ChooseEnergyPrompt } from '../../game/store/prompts/choose-energy-prompt';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';
import { playerIdToActor } from '../iid-targets';

/**
 * ChooseEnergyPrompt ('Choose energy'): pick which attached energies pay a cost (retreat, or an
 * energy-cost payment). Each chosen energy is discarded to pay, so it surfaces on the wire as a
 * contract `discard{owner,target}` (design Q2). One pick = one energy (by iid) → an index into
 * `prompt.energy`; the raw result is `number[]` which `decode` maps to `EnergyMap[]`. There is no
 * `endChoice`: `validate` requires the picked set to pay the cost EXACTLY (`checkExactEnergy`), so
 * the decision is complete the moment the accumulated picks pay it — `next` stops there.
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
        legalActions.push({ type: 'discard', owner: playerIdToActor(state, prompt.playerId), target: iid });
      }
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — assemble what we have (validate adjudicates exactness)
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    if (action.type !== 'discard') {
      throw new Error(`[conformance] ChooseEnergy expected 'discard', got '${action.type}'`);
    }
    const iid = action.target as string;
    const index = prompt.energy.findIndex(em => ctx.cardToIid.get(em.card) === iid);
    if (index === -1) {
      throw new Error(`[conformance] discard target '${iid}' is not an energy offered by the prompt`);
    }
    return { kind: 'index', index };
  },

  assemble(_prompt, picks): number[] {
    return realPicks(picks).map(p => (p as { index: number }).index);
  },
};
