import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget, PlayerType } from '../../game/store/actions/play-card-action';
import { LegalAction, NeutralEvent } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';
import { adjustDamage, findPip } from '../transit-projection';

/**
 * PutDamagePrompt: one pick = one unit of `prompt.damage` (which is in HP) applied to a target; raw
 * result = DamageMap[] summed per target.
 *
 * The unit is `options.damageMultiple`, not a fixed 10. It is 10 for the prompt's usual job —
 * distributing N damage counters "in any way you like" — but the "Choose 1 of your opponent's Pokémon
 * K times … do X damage to it" family (Oil Salvo, Lightning Storm Star, Devilish Hands-GX, …) reuses
 * this prompt with the unit set to X. Enumerating those in 10s offered the wrong number of picks and,
 * worse, let a target end up with a total that is not a multiple of X — a distribution the card cannot
 * actually produce. `PutDamagePrompt.validate()` only checks the SUM, so nothing downstream catches it.
 */
function unitOf(prompt: PutDamagePrompt): number {
  return prompt.options.damageMultiple ?? 10;
}

/**
 * CF-32: the wire verb names the operation, and this prompt carries two of them. `placeCounters` (the
 * default) is counter placement; the repeated-choice family declares `dealDamage`, whose pick is a
 * bare target selection for damage — no typed verb exists for that, so it is the generic `choose`.
 */
function verbFor(prompt: PutDamagePrompt): 'placeCounter' | 'choose' {
  return prompt.options.operation === 'dealDamage' ? 'choose' : 'placeCounter';
}

export const putDamageDecomposer: PromptDecomposer<PutDamagePrompt> = {
  type: 'Put damage',

  /**
   * CF-14 (TA-124) — the multi-pick extension, ANALYSED AND DEFERRED (see the verdict at the end; this
   * decomposer does NOT opt in). The case for opting in ran as follows:
   *
   *  1. **Only fixed-count placements can reach the collapse.** The driver gates on `!canStopNow`, and an
   *     "up to N counters" placement always advertises `END_CHOICE` from the first pending (the CF-4
   *     rule below, keyed on `allowPlacePartialDamage`). So an optional/partial placement never
   *     collapses — only a placement that MUST place its full `prompt.damage`.
   *  2. **A forced step in a fixed-count placement is genuinely forced.** The candidate set is recomputed
   *     from the same board each step; only the per-target placed counts change. So if exactly one target
   *     is eligible and the placement cannot stop short, every remaining unit must go on that target —
   *     one whole-decision resolution, no decision content. Should a per-target cap bind part-way,
   *     `next` returns null (line below) and the decision assembles cleanly, so the driver's
   *     "zero options and cannot stop" fault is not reachable from here.
   *
   * This is the narrow, justified exception to the general rule that a multi-pick aggregate must not
   * implement `atomicResolvable` — that rule exists because a momentarily-forced SUB-pick is not a forced
   * decision, which is true precisely when the aggregate could have stopped or varied. Neither holds here.
   *
   * Measured divergence: `dri-023` "Oil Salvo" with B holding only its Active — rotomancer places all
   * 6 units of 20, KOs it, and moves to prize selection; twinleaf pends a 1-option `choose` per unit.
   *
   * ── ENABLED 2026-08-11 (TA-239), via `atomicStep` rather than `atomicResolvable` ──────────────
   *
   * It was deferred on 2026-07-29 for two measured reasons, and the STEP-level hook answers both.
   *
   * The first was conceptual and it was right: opting into `atomicResolvable` would have been wrong.
   * That hook asserts the WHOLE decision has one resolution, and the damageMultiple-cap board falsifies
   * it — a placement that began with several targets was never a forced decision, however forced its
   * tail becomes. `atomicStep` (TA-202) makes exactly the weaker claim that is actually true here:
   * forcedness is a property of the POSITION, not of the prompt. Once a cap has bound and one eligible
   * target remains, and the placement may not stop short, every remaining unit MUST go on that target.
   * That step has no decision content even though the aggregate once did.
   *
   * The gate that carries the safety is the driver's `!canStopNow`, not anything restated here:
   *   - "up to N" placements set `allowPlacePartialDamage`, so `END_CHOICE` is appended from the FIRST
   *     pending (CF-4) — `canStopNow` is true forever and no step of an optional placement collapses.
   *   - A fixed-count placement never appends `END_CHOICE`; the full `prompt.damage` must be placed, so
   *     a lone eligible target is genuinely forced.
   *   - If a cap binds and no target remains, `next` returns null (below) and the decision assembles —
   *     the driver's "zero options and cannot stop" fault is unreachable from here.
   * Placing a counter raises no client-driven decision of its own, so there is no cascade.
   *
   * The second reason was that three committed specs pinned the surfaced form: the two `slots`
   * guards in `conformance-putdamage-slots.spec.ts` build a prompt with exactly ONE eligible target
   * *precisely so they can inspect the menu*, and the damageMultiple cap guard does likewise. Those
   * were re-recorded with this change, and re-recorded the way the register requires — a forced-prompt
   * guard asserts the STATE EFFECT, not the pending (the rule that exists because a pending-shaped
   * assertion once masked TA-121). Each kept its discriminating power: the `slots` guards now assert
   * that the counters LAND on the eligible target and none land on the excluded one, which fails just
   * as loudly if `slots` is ignored again, and additionally would have caught the original HTTP-500.
   */

  atomicStep: () => true,

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const unit = unitOf(prompt);
    const rp = realPicks(picks);
    const placed = rp.length * unit;
    if (placed >= prompt.damage) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const verb = verbFor(prompt);
    const blockedKeys = new Set(prompt.options.blocked.map(targetKey));
    const placedByTarget = new Map<string, number>();
    for (const p of rp) {
      const k = targetKey((p as { target: CardTarget }).target);
      placedByTarget.set(k, (placedByTarget.get(k) ?? 0) + unit);
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
      // CF-70 Phase 2: `dealDamage` picks carry the printed per-pick damage (`damageMultiple` IS the
      // card's literal X); a counter DISTRIBUTION pick emits `op` alone — its per-pick unit is not a
      // printed count, so `amount` rides uncompared (migration plan §2a).
      legalActions.push(verb === 'choose'
        ? { type: verb, target: pokemonTargetToIid(state, player, ctx, entry.target), op: 'dealDamage', amount: unit }
        : { type: verb, target: pokemonTargetToIid(state, player, ctx, entry.target), op: 'placeCounters' });
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
    const expected = verbFor(_prompt);
    if (action.type !== expected) {
      throw new Error(`[conformance] PutDamage expected '${expected}', got '${action.type}'`);
    }
    const targetIid = action.target as string;
    const card = ctx.iidToCard.get(targetIid);
    if (card === undefined) {
      throw new Error(`[conformance] ${expected} target iid '${targetIid}' unknown`);
    }
    const player = promptPlayer(state, _prompt.playerId);
    return { kind: 'counter', target: resolveAnyPokemonTarget(state, player, card) };
  },

  /**
   * B.80: a `placeCounter` pick puts the counter on the board at once (the player places it); the projection
   * shows each placed unit before the next pick. NOT the `dealDamage` family (verb `choose`): there the picks
   * only DESIGNATE where an attack's damage will go, and the damage lands when the attack resolves, all at
   * once (#2161 Oil Salvo — the spec cell "applies NO damage until every choice is made" guards it).
   */
  fixupProjection(prompt, picks, ctx, state, projected) {
    // TA-668 / B.98: an attack's Step-D counter choice places nothing until after the damage.
    if (verbFor(prompt) !== 'placeCounter' || prompt.deferredMove === true) {
      return;
    }
    const unit = unitOf(prompt);
    const player = promptPlayer(state, prompt.playerId);
    for (const p of realPicks(picks) as Array<{ target: CardTarget }>) {
      adjustDamage(projected, pokemonTargetToIid(state, player, ctx, p.target), unit);
    }
  },

  /**
   * TA-622: the counter each `placeCounter` pick put on the board at this pause is a placement, so it is a `damaged`
   * (CF-6: one per placement; Sinistcha twm-022 Cursed Drop emitted none until the close, while the board showed it).
   * Not the `dealDamage` family: nothing lands before the attack resolves (the fix-up above leaves those boards alone).
   */
  pauseEvents(prompt, picks, ctx, state, projected): NeutralEvent[] {
    if (verbFor(prompt) !== 'placeCounter' || prompt.deferredMove === true) {
      return [];
    }
    const unit = unitOf(prompt);
    const player = promptPlayer(state, prompt.playerId);
    const out: NeutralEvent[] = [];
    for (const p of realPicks(picks) as Array<{ target: CardTarget }>) {
      const iid = pokemonTargetToIid(state, player, ctx, p.target);
      const at = findPip(projected, iid);
      if (at !== undefined) {
        out.push({ kind: 'damaged', player: at.owner, target: iid, hp: unit });
      }
    }
    return out;
  },

  assemble(_prompt, picks): DamageMap[] {
    const unit = unitOf(_prompt);
    const byKey = new Map<string, DamageMap>();
    for (const p of realPicks(picks)) {
      const target = (p as { target: CardTarget }).target;
      const k = targetKey(target);
      const existing = byKey.get(k);
      if (existing) {
        existing.damage += unit;
      } else {
        byKey.set(k, { target, damage: unit });
      }
    }
    return Array.from(byKey.values());
  },
};
