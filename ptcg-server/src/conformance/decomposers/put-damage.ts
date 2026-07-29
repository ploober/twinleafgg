import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';
import { CardTarget, PlayerType } from '../../game/store/actions/play-card-action';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

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
   * NOT ENABLED — deferred 2026-07-29, and the reason is measured, not theoretical. Turning it on does
   * converge `dri-023`, but it also broke three committed specs that deliberately pin the opposite:
   * the two `slots`-restriction guards (which build a prompt with exactly ONE eligible target precisely
   * so they can inspect the offered menu — the Phantom Dive `asc-160` HTTP-500 regression) and the
   * damageMultiple cap guard (a MULTI-target board where the cap binds part-way and leaves one target,
   * i.e. exactly the "momentarily-forced sub-pick" the interface contract warns about — my claim that
   * such a step is "genuinely forced" does not survive it, because the aggregate as a whole was never
   * forced). Enabling this is therefore a re-pin of what a put-damage aggregate reports, not a bug fix,
   * and it needs an explicit contract decision plus re-recorded guards. Tracked on `dri-023`.
   */

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
      legalActions.push({ type: verb, target: pokemonTargetToIid(state, player, ctx, entry.target) });
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
