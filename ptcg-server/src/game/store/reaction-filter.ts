import { createHash } from 'crypto';
import { types } from 'util';
import { Card } from './card/card';
import { Effect } from './effects/effect';
import { AfterDamageEffect } from './effects/attack-effects';
import { AttackEffect, KnockOutEffect, KnockOutAttackEffect, PowerEffect } from './effects/game-effects';
import { AfterAttackEffect, BeforeDoingDamageEffect } from './effects/game-phase-effects';
import { AttachEnergyEffect } from './effects/play-card-effects';

export type ReactionFilterMode = 'off' | 'on' | 'verify';
// Audited Card.reduceEffect: only Attack/AfterAttack/BeforeDoingDamage/Power branches.
// Fingerprinting its compiled body fails closed if that implementation/toolchain changes.
const BASE_REDUCER_SHA256 = '4ee3dc64dc76e2be1f1a7074331ddd14db7ce10b6263a251d13c38cec843652f';
let lastBase: Function | undefined, auditedBase: Function | undefined;
const counters = { considered: 0, eligible: 0, filtered: 0, verified: 0, verificationFailures: 0 };

export function reactionFilterMode(): ReactionFilterMode {
  const mode = process.env.CONFORMANCE_REACTION_FILTERS ?? 'on';
  if (mode !== 'off' && mode !== 'on' && mode !== 'verify') {
    throw new Error('Invalid CONFORMANCE_REACTION_FILTERS: expected off, on or verify');
  }
  return mode;
}

export function reactionFilterStats() {
  return { ...counters, baseReducerVerified: auditedBase !== undefined, baseReducerSha256: BASE_REDUCER_SHA256 };
}

function baseReducer(): Function | undefined {
  // Lazy evaluation preserves Store/Card's existing circular module boundaries.
  const descriptor = Object.getOwnPropertyDescriptor(Card.prototype, 'reduceEffect');
  const candidate = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  if (candidate !== lastBase) {
    lastBase = candidate; auditedBase = undefined;
    if (typeof candidate === 'function' && !types.isProxy(candidate)
      && createHash('sha256').update(Function.prototype.toString.call(candidate)).digest('hex') === BASE_REDUCER_SHA256) {
      auditedBase = candidate;
    }
  }
  return auditedBase;
}

/** Resolve the method/override shape without executing getters or prototype proxy traps. */
function hasAuditedReducer(card: Card, base: Function): boolean {
  let object: object | null = card;
  let found = false;
  while (object !== null) {
    if (types.isProxy(object) || Object.getOwnPropertyDescriptor(object, 'trainerType') !== undefined) { return false; }
    if (!found) {
      const descriptor = Object.getOwnPropertyDescriptor(object, 'reduceEffect');
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || descriptor.value !== base) { return false; }
        found = true;
      }
    }
    object = Object.getPrototypeOf(object);
  }
  return found;
}

/** Negative applicability proof, never a learned classification of previously observed no-ops. */
export function canSkipReactionProbe(card: Card, effect: Effect): boolean {
  counters.considered++;
  if (types.isProxy(card) || types.isProxy(effect)) { return false; }
  const prototype = Object.getPrototypeOf(effect);
  if (prototype !== AfterDamageEffect.prototype && prototype !== AttachEnergyEffect.prototype
    && prototype !== KnockOutEffect.prototype && prototype !== KnockOutAttackEffect.prototype) { return false; }
  // Keep the audited default handler's positive families even if an effect hierarchy changes.
  if (effect instanceof AttackEffect || effect instanceof AfterAttackEffect
    || effect instanceof BeforeDoingDamageEffect || effect instanceof PowerEffect) { return false; }
  const base = baseReducer();
  // callReduceEffect selects per-format overrides for any object with trainerType.
  if (base === undefined || !hasAuditedReducer(card, base)) { return false; }
  // Preserve the reference copier's behavior for unusual accessors/read-only effect fields.
  for (const key of Reflect.ownKeys(effect)) {
    if (typeof key !== 'string') { return false; }
    const descriptor = Object.getOwnPropertyDescriptor(effect, key)!;
    if (!('value' in descriptor) || !descriptor.writable || !descriptor.enumerable) { return false; }
  }
  counters.eligible++;
  return true;
}

export function recordReactionFilterSkipped(): void { counters.filtered++; }
export function recordReactionFilterVerified(matches: boolean): void {
  counters.verified++;
  if (!matches) { counters.verificationFailures++; }
}
