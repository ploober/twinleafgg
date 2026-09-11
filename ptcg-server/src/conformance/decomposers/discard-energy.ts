import { DiscardEnergyPrompt } from '../../game/store/prompts/discard-energy-prompt';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget, PlayerType } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, resolveAnyPokemonTarget, playerIdToActor } from '../iid-targets';

/** DiscardEnergyPrompt: one pick = {from, index} (energy in a source list); raw = {from,index}[]. */
export const discardEnergyDecomposer: PromptDecomposer<DiscardEnergyPrompt> = {
  type: 'Discard energy',

  // CF-14: a forced single discard (a min>=1 discard whose eligible pool is exactly one energy —
  // e.g. Croconaw ASC "Crunch" discarding the defender's lone Energy) has one resolution and no
  // decision content, so the driver applies it atomically instead of surfacing a 1-option pending
  // (matching rotomancer). Always eligible: discarding an Energy is terminal — it raises no further
  // client-driven decision — and the driver's `forced.length===1 && !canStopNow` guard already
  // excludes a genuine "discard up to N" (which carries an END_CHOICE stop) and a >=2-candidate choice.
  atomicResolvable: () => true,

  // CF-14 addendum 2026-09-09 (TA-286 direct route / TA-401): a FORCED discard whose remaining pool is
  // no larger than the picks it still requires ("discard 3 Energy" with exactly 3 attached) has no
  // decision in any pick — rotomancer resolves the set atomically; we surfaced pick 1 and pick 2 and
  // collapsed only the last. `forcedCount` is the driver's count of non-stop candidates at this step.
  collapseWholeSet: (prompt, picks, _state, forcedCount) => {
    if (prompt.options.allowCancel !== false) {
      return false;
    }
    const remaining = prompt.options.min - realPicks(picks).length;
    return remaining > 1 && forcedCount <= remaining;
  },

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
    const opponent = StateUtils.getOpponent(state, player);
    const pickedKeys = new Set(rp.map(p => `${targetKey(p.from)}-${p.index}`));
    const blockedBySource = new Map<string, Set<number>>();
    for (const entry of prompt.options.blockedMap) {
      blockedBySource.set(targetKey(entry.source), new Set(entry.blocked));
    }

    const sources = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedFrom);
    const legalActions: LegalAction[] = [];
    for (const source of sources) {
      const list = StateUtils.getTarget(state, player, source);
      const owner = playerIdToActor(state, source.player === PlayerType.BOTTOM_PLAYER ? player.id : opponent.id);
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
          legalActions.push({ type: 'discard', owner, target: iid, op: 'discard', destination: 'discardPile' }); // CF-70
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
