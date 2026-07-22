import { MoveEnergyPrompt } from '../../game/store/prompts/move-energy-prompt';
import { SuperType } from '../../game/store/card/card-types';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import {
  PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, matchesFilter, enumerateTargets, targetKey
} from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

/**
 * MoveEnergyPrompt: relocate an attached Energy from one Pokemon to another. Each transfer is a single
 * `{from, to, index}`; the contract's existing `attachEnergy{card, target}` expresses it whole — the
 * energy iid names the SOURCE Pokemon and (via its position on that Pokemon) the `index`, and the
 * target iid names the DESTINATION `to`. (Reusing an existing Action rather than inventing `moveEnergy`
 * mirrors MoveDamage reusing `choose`/`placeCounter`.) One `attachEnergy` = one complete transfer, so
 * unlike MoveDamage this is one pick per transfer, not two.
 *
 * Enumeration mirrors the simple-bot `MoveEnergyPromptResolver`: `slots`+`playerType` define BOTH the
 * source and destination Pokemon set. Sources drop `blockedFrom`, per-source `blockedMap` indices, and
 * non-`filter` cards; destinations drop `blockedTo` and the transfer's own source (a card must move to a
 * DIFFERENT Pokemon). Picks accumulate against the stable pause-state (the prompt is not resolved until
 * every pick is in), so every `index` is relative to that one state, matching `decode()` which reads all
 * `from[index]` cards before the card applies any move.
 */
export const moveEnergyDecomposer: PromptDecomposer<MoveEnergyPrompt> = {
  type: 'Move energy',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks) as Array<{ from: CardTarget; to: CardTarget; index: number }>;
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
    const dests = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo);
    const legalActions: LegalAction[] = [];

    for (const source of sources) {
      const list = StateUtils.getTarget(state, player, source);
      const sourceKey = targetKey(source);
      const blockedIdx = blockedBySource.get(sourceKey) ?? new Set<number>();
      for (let i = 0; i < list.cards.length; i++) {
        const card = list.cards[i];
        if (card.superType !== SuperType.ENERGY || blockedIdx.has(i)) {
          continue;
        }
        if (!matchesFilter(card, prompt.filter)) {
          continue;
        }
        if (pickedKeys.has(`${sourceKey}-${i}`)) {
          continue;
        }
        const energyIid = ctx.cardToIid.get(card);
        if (energyIid === undefined) {
          continue;
        }
        for (const dest of dests) {
          if (targetKey(dest) === sourceKey) {
            continue; // a card must move to a DIFFERENT Pokemon
          }
          legalActions.push({
            type: 'attachEnergy',
            card: energyIid,
            target: pokemonTargetToIid(state, player, ctx, dest),
          });
        }
      }
    }

    if (rp.length >= min && (max === undefined || max > min)) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(prompt, action, ctx, state) {
    if (action.type === 'endChoice') {
      return { kind: 'done' };
    }
    if (action.type !== 'attachEnergy') {
      throw new Error(`[conformance] MoveEnergy expected 'attachEnergy', got '${action.type}'`);
    }
    const energy = ctx.iidToCard.get(action.card as string);
    if (energy === undefined) {
      throw new Error(`[conformance] moveEnergy.card iid '${action.card}' unknown`);
    }
    const targetCard = ctx.iidToCard.get(action.target as string);
    if (targetCard === undefined) {
      throw new Error(`[conformance] moveEnergy.target iid '${action.target}' unknown`);
    }
    const player = promptPlayer(state, prompt.playerId);
    const from = resolveAnyPokemonTarget(state, player, energy);
    const list = StateUtils.getTarget(state, player, from);
    const index = list.cards.indexOf(energy);
    if (index === -1) {
      throw new Error(`[conformance] moveEnergy.card '${action.card}' not found on its Pokemon`);
    }
    const to = resolveAnyPokemonTarget(state, player, targetCard);
    return { kind: 'move', from, to, index };
  },

  assemble(_prompt, picks): Array<{ from: CardTarget; to: CardTarget; index: number }> {
    return (realPicks(picks) as Array<{ from: CardTarget; to: CardTarget; index: number }>)
      .map(p => ({ from: p.from, to: p.to, index: p.index }));
  },
};
