import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

const COUNTER = 10; // one damage counter = 10 HP; PutDamagePrompt.damage is in HP units

/** PutDamagePrompt: one pick = one counter (10 HP) on a target; raw result = DamageMap[] summed per target. */
export const putDamageDecomposer: PromptDecomposer<PutDamagePrompt> = {
  type: 'Put damage',

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const placed = rp.length * COUNTER;
    if (placed >= prompt.damage) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const blockedKeys = new Set(prompt.options.blocked.map(targetKey));
    const placedByTarget = new Map<string, number>();
    for (const p of rp) {
      const k = targetKey((p as { target: CardTarget }).target);
      placedByTarget.set(k, (placedByTarget.get(k) ?? 0) + COUNTER);
    }

    const legalActions: LegalAction[] = [];
    for (const entry of prompt.maxAllowedDamage) {
      const k = targetKey(entry.target);
      if (entry.damage <= 0 || blockedKeys.has(k)) {
        continue;
      }
      if ((placedByTarget.get(k) ?? 0) >= entry.damage) {
        continue;
      }
      legalActions.push({ type: 'placeCounter', target: pokemonTargetToIid(state, player, ctx, entry.target) });
    }
    if (prompt.options.allowPlacePartialDamage && placed > 0) {
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
    if (action.type !== 'placeCounter') {
      throw new Error(`[conformance] PutDamage expected 'placeCounter', got '${action.type}'`);
    }
    const targetIid = action.target as string;
    const card = ctx.iidToCard.get(targetIid);
    if (card === undefined) {
      throw new Error(`[conformance] placeCounter target iid '${targetIid}' unknown`);
    }
    const player = promptPlayer(state, _prompt.playerId);
    return { kind: 'counter', target: resolveAnyPokemonTarget(state, player, card) };
  },

  assemble(_prompt, picks): DamageMap[] {
    const byKey = new Map<string, DamageMap>();
    for (const p of realPicks(picks)) {
      const target = (p as { target: CardTarget }).target;
      const k = targetKey(target);
      const existing = byKey.get(k);
      if (existing) {
        existing.damage += COUNTER;
      } else {
        byKey.set(k, { target, damage: COUNTER });
      }
    }
    return Array.from(byKey.values());
  },
};
