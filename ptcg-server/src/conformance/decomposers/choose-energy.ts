import { ChooseEnergyPrompt } from '../../game/store/prompts/choose-energy-prompt';
import { GameMessage } from '../../game/game-message';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, buildPending } from './decomposer';
import { playerIdToActor } from '../iid-targets';

/**
 * TA-142: `ChooseEnergyPrompt` is overwhelmingly a cost payment — retreat or an attack energy cost —
 * where the chosen energy is DISCARDED, so `discard` is the correct default verb. But a handful of
 * attacks reuse the prompt to pick attached energy that is RELOCATED to a non-discard zone ("put an
 * Energy into your hand", "shuffle 3 Energy into your Deck"). The wire verb is destination-specific
 * (CF-8): a move to hand/deck is a `choose`, not a `discard`. We key off the prompt message — the
 * card declares the destination via `CHOOSE_ENERGIES_TO_HAND` / `CHOOSE_ENERGIES_TO_DECK` — mirroring
 * how `choose-cards` keys `discard` off `CHOOSE_CARD_TO_DISCARD`. Anything else stays `discard`.
 */
function isMovePick(prompt: ChooseEnergyPrompt): boolean {
  return prompt.message === GameMessage.CHOOSE_ENERGIES_TO_HAND
    || prompt.message === GameMessage.CHOOSE_ENERGIES_TO_DECK;
}

/**
 * ChooseEnergyPrompt ('Choose energy'): pick which attached energies pay a cost (retreat, or an
 * energy-cost payment). Each chosen energy is discarded to pay, so it surfaces on the wire as a
 * contract `discard{owner,target}` (design Q2) — unless the message marks a relocation to hand/deck,
 * which surfaces as `choose` (TA-142, see `isMovePick`). One pick = one energy (by iid) → an index
 * into `prompt.energy`; the raw result is `number[]` which `decode` maps to `EnergyMap[]`. There is
 * no `endChoice`: `validate` requires the picked set to pay the cost EXACTLY (`checkExactEnergy`), so
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

    const move = isMovePick(prompt);
    const used = new Set(picked);
    const legalActions: LegalAction[] = [];
    for (let i = 0; i < prompt.energy.length; i++) {
      if (used.has(i)) {
        continue;
      }
      const iid = ctx.cardToIid.get(prompt.energy[i].card);
      if (iid !== undefined) {
        legalActions.push(move
          ? { type: 'choose', target: iid }
          : { type: 'discard', owner: playerIdToActor(state, prompt.playerId), target: iid });
      }
    }
    if (legalActions.length === 0) {
      return null; // nothing left to offer — assemble what we have (validate adjudicates exactness)
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx) {
    const expected = isMovePick(prompt) ? 'choose' : 'discard';
    if (action.type !== expected) {
      throw new Error(`[conformance] ChooseEnergy expected '${expected}', got '${action.type}'`);
    }
    const iid = action.target as string;
    const index = prompt.energy.findIndex(em => ctx.cardToIid.get(em.card) === iid);
    if (index === -1) {
      throw new Error(`[conformance] ${action.type} target '${iid}' is not an energy offered by the prompt`);
    }
    return { kind: 'index', index };
  },

  assemble(_prompt, picks): number[] {
    return realPicks(picks).map(p => (p as { index: number }).index);
  },
};
