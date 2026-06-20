import { DiscardEnergyPrompt } from '../../game/store/prompts/discard-energy-prompt';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, resolveAnyPokemonTarget } from '../iid-targets';

/** DiscardEnergyPrompt: one pick = {from, index} (energy in a source list); raw = {from,index}[]. */
export const discardEnergyDecomposer: PromptDecomposer<DiscardEnergyPrompt> = {
  type: 'Discard energy',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks) as Array<{ from: CardTarget; index: number }>;
    const { min, max } = prompt.options;
    if (max !== undefined && rp.length >= max) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const pickedKeys = new Set(rp.map(p => `${targetKey(p.from)}-${p.index}`));
    const blockedBySource = new Map<string, Set<number>>();
    for (const entry of prompt.options.blockedMap) {
      blockedBySource.set(targetKey(entry.source), new Set(entry.blocked));
    }

    const sources = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedFrom);
    const legalActions: LegalAction[] = [];
    for (const source of sources) {
      const list = StateUtils.getTarget(state, player, source);
      const blockedIdx = blockedBySource.get(targetKey(source)) ?? new Set<number>();
      for (let i = 0; i < list.cards.length; i++) {
        const card = list.cards[i];
        if (card.superType !== SuperType.ENERGY || blockedIdx.has(i)) {
          continue;
        }
        if (!matchesFilter(card, prompt.filter)) {
          continue;
        }
        if (pickedKeys.has(`${targetKey(source)}-${i}`)) {
          continue;
        }
        const iid = ctx.cardToIid.get(card);
        if (iid !== undefined) {
          legalActions.push({ type: 'discard', target: iid });
        }
      }
    }
    if (rp.length >= min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
    if (action.type === 'endChoice') {
      return { kind: 'done' };
    }
    if (action.type !== 'discard') {
      throw new Error(`[conformance] DiscardEnergy expected 'discard', got '${action.type}'`);
    }
    const targetIid = action.target as string;
    const energy = ctx.iidToCard.get(targetIid);
    if (energy === undefined) {
      throw new Error(`[conformance] discard target iid '${targetIid}' unknown`);
    }
    const player = promptPlayer(state, _prompt.playerId);
    const from = resolveAnyPokemonTarget(state, player, energy);
    const list = StateUtils.getTarget(state, player, from);
    const index = list.cards.indexOf(energy);
    if (index === -1) {
      throw new Error(`[conformance] discard target '${action.target}' not found in its Pokemon's cards`);
    }
    return { kind: 'discard', from, index };
  },

  assemble(_prompt, picks): Array<{ from: CardTarget; index: number }> {
    return (realPicks(picks) as Array<{ from: CardTarget; index: number }>).map(p => ({ from: p.from, index: p.index }));
  },
};
