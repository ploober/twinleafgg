import { MoveDamagePrompt, DamageTransfer } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

const COUNTER = 10;

/** MoveDamagePrompt: one pick = {from, to}; raw = DamageTransfer[]. State-dependent: sources deplete. */
export const moveDamageDecomposer: PromptDecomposer<MoveDamagePrompt> = {
  type: 'Move damage',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks) as Array<{ from: CardTarget; to: CardTarget }>;
    const { min, max } = prompt.options;
    if (max !== undefined && rp.length >= max) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const blockedFromKeys = new Set(prompt.options.blockedFrom.map(targetKey));

    // remaining movable damage per source = cap − 10 × prior transfers from it
    const movedFrom = new Map<string, number>();
    rp.forEach(p => {
      const k = targetKey(p.from);
      movedFrom.set(k, (movedFrom.get(k) ?? 0) + COUNTER);
    });
    const firstFrom = rp.length > 0 ? targetKey(rp[0].from) : undefined;
    const firstTo = rp.length > 0 ? targetKey(rp[0].to) : undefined;

    const sources = prompt.maxAllowedDamage.filter(entry => {
      const k = targetKey(entry.target);
      if (blockedFromKeys.has(k) || entry.damage <= 0) { return false; }
      if ((movedFrom.get(k) ?? 0) >= entry.damage) { return false; }
      if (prompt.options.singleSourceTarget && firstFrom !== undefined && k !== firstFrom) { return false; }
      return true;
    });

    const dests = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blockedTo)
      .filter(t => !(prompt.options.singleDestinationTarget && firstTo !== undefined && targetKey(t) !== firstTo));

    const legalActions: LegalAction[] = [];
    for (const source of sources) {
      for (const dest of dests) {
        if (targetKey(source.target) === targetKey(dest)) {
          continue; // can't move a counter onto its own Pokemon
        }
        legalActions.push({
          type: 'moveCounter',
          from: pokemonTargetToIid(state, player, ctx, source.target),
          to: pokemonTargetToIid(state, player, ctx, dest),
        });
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
    if (action.type !== 'moveCounter') {
      throw new Error(`[conformance] MoveDamage expected 'moveCounter', got '${action.type}'`);
    }
    const fromCard = ctx.iidToCard.get(action.from as string);
    const toCard = ctx.iidToCard.get(action.to as string);
    if (fromCard === undefined || toCard === undefined) {
      throw new Error('[conformance] moveCounter from/to iid unknown');
    }
    const player = promptPlayer(state, _prompt.playerId);
    return {
      kind: 'transfer',
      from: resolveAnyPokemonTarget(state, player, fromCard),
      to: resolveAnyPokemonTarget(state, player, toCard),
    };
  },

  assemble(_prompt, picks): DamageTransfer[] {
    return (realPicks(picks) as Array<{ from: CardTarget; to: CardTarget }>).map(p => ({ from: p.from, to: p.to }));
  },
};
