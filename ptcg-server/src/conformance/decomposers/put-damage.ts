import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget, PlayerType } from '../../game/store/actions/play-card-action';
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
      // `maxAllowedDamage` is only a per-target CAP; it is not the legality list. The prompt's
      // `slots`/`playerType` are, and `PutDamagePrompt.validate()` enforces both — so a menu built
      // from the cap map alone offers moves the engine will then reject. On a BENCH-only effect
      // (Dragapult ex asc-160 "Phantom Dive", whose prefab caps every opposing Pokemon at 9999) that
      // meant offering the Active, and taking the harness's own offer surfaced as HTTP 500.
      // Mirrors validate() exactly; do not narrow further, or an unrestricted prompt loses targets.
      if (!prompt.slots.includes(entry.target.slot)) {
        continue;
      }
      if (prompt.playerType !== PlayerType.ANY && entry.target.player !== prompt.playerType) {
        continue;
      }
      if ((placedByTarget.get(k) ?? 0) >= entry.damage) {
        continue;
      }
      legalActions.push({ type: 'placeCounter', target: pokemonTargetToIid(state, player, ctx, entry.target) });
    }
    // CF-4: partial placement ("up to N counters") means min=0 — the explicit stop is
    // advertised from the first pending, not only once a counter has been placed.
    if (prompt.options.allowPlacePartialDamage) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
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
