import { Card } from './card/card';
import { AfterDamageEffect } from './effects/attack-effects';
import { AttackEffect, KnockOutEffect, KnockOutAttackEffect, PowerEffect } from './effects/game-effects';
import { AttachEnergyEffect } from './effects/play-card-effects';
import { AfterAttackEffect, BeforeDoingDamageEffect } from './effects/game-phase-effects';
import { State } from './state/state';
import { Store } from './store';
import { canSkipReactionProbe, reactionFilterMode, reactionFilterStats, ReactionFilterMode } from './reaction-filter';
import * as filters from './reaction-filter';
import { conformanceLegacyStateSnapshots, StateSnapshotBackend } from './state-snapshot';
import { createConformanceStore } from '../../conformance/conformance-store';
import { ErikasBellsprout } from '../../sets/11-mega-evolution/set-ascended-heroes/erikas-bellsprout';
import { WaterEnergy } from '../../sets/10-scarlet-and-violet/set-scarlet-and-violet-energy/water-energy';

function effect(prototype: object): any { return Object.assign(Object.create(prototype), { preventDefault: false }); }
function store(mode?: ReactionFilterMode, backend: StateSnapshotBackend = conformanceLegacyStateSnapshots): Store {
  return new Store({ onStateChange: () => undefined } as any, { reactionFilter: mode, snapshotBackend: backend });
}
function probe(subject: Store, card: Card, e: any, state = new State()): any { return (subject as any).probe(card, state, e); }

describe('Conservative reaction filtering', () => {
  it('skips only the audited base reducer for the three profiled reaction families and attack KOs', () => {
    const capture = spyOn(conformanceLegacyStateSnapshots, 'capture').and.callThrough();
    for (const card of [new ErikasBellsprout(), new WaterEnergy()]) {
      for (const prototype of [AfterDamageEffect.prototype, AttachEnergyEffect.prototype, KnockOutEffect.prototype, KnockOutAttackEffect.prototype]) {
        const state = new State(), result = probe(store('on'), card, effect(prototype), state);
        expect(result).toEqual({ raised: false, dispatched: false, after: state });
        expect(result.after).toBe(state);
      }
    }
    expect(capture).not.toHaveBeenCalled();
    expect(reactionFilterStats().baseReducerVerified).toBe(true);
  });

  it('keeps gameplay Stores and the explicit off override on the reference path', () => {
    const capture = spyOn(conformanceLegacyStateSnapshots, 'capture').and.callThrough();
    for (const mode of [undefined, 'off'] as Array<ReactionFilterMode | undefined>) {
      const source = new State(), result = probe(store(mode), new ErikasBellsprout(), effect(AfterDamageEffect.prototype), source);
      expect(result.after).not.toBe(source);
    }
    expect(capture.calls.count()).toBe(2);
  });

  it('executes and verifies eligible probes in verify mode without changing enclosing probe flags', () => {
    const subject: any = store('verify'), before = reactionFilterStats().verified;
    subject.probing = true; subject.probeRaisedPrompt = true; subject.probeDispatched = true;
    const capture = spyOn(conformanceLegacyStateSnapshots, 'capture').and.callThrough();
    const result = probe(subject, new ErikasBellsprout(), effect(AttachEnergyEffect.prototype));
    expect(result.raised).toBe(false); expect(result.dispatched).toBe(false);
    expect(subject.probing).toBe(true); expect(subject.probeRaisedPrompt).toBe(true); expect(subject.probeDispatched).toBe(true);
    expect(capture.calls.count()).toBe(1); expect(reactionFilterStats().verified).toBe(before + 1);
  });

  it('retains custom handlers even when they previously did nothing, and sees later instance overrides', () => {
    const card: any = new ErikasBellsprout(), subject = store('on');
    card.reduceEffect = (_s: any, state: State) => state;
    const capture = spyOn(conformanceLegacyStateSnapshots, 'capture').and.callThrough();
    probe(subject, card, effect(AfterDamageEffect.prototype));
    delete card.reduceEffect; probe(subject, card, effect(AfterDamageEffect.prototype));
    card.reduceEffect = (_s: any, state: State) => { state.turn++; return state; };
    const source = new State(), result = probe(subject, card, effect(AfterDamageEffect.prototype), source);
    expect(result.after.turn).toBe(1); expect(source.turn).toBe(0); expect(capture.calls.count()).toBe(2);
  });

  it('does not execute a reducer getter while classifying an unknown handler', () => {
    const card = new ErikasBellsprout(); let reads = 0;
    Object.defineProperty(card, 'reduceEffect', { get: () => { reads++; return Card.prototype.reduceEffect; } });
    probe(store('on'), card, effect(AfterDamageEffect.prototype));
    expect(reads).toBe(1);
  });

  it('fails closed if the base implementation changes and recovers when it is restored', () => {
    const original = Card.prototype.reduceEffect;
    try {
      Card.prototype.reduceEffect = (_s: any, state: State) => { state.turn++; return state; };
      const result = probe(store('on'), new ErikasBellsprout(), effect(AfterDamageEffect.prototype));
      expect(result.after.turn).toBe(1);
    } finally { Card.prototype.reduceEffect = original; }
    expect(canSkipReactionProbe(new ErikasBellsprout(), effect(AfterDamageEffect.prototype))).toBe(true);
  });

  it('retains unknown effect shapes, accessors, trainer overrides and custom snapshot backends', () => {
    const card: any = new ErikasBellsprout(), capture = spyOn(conformanceLegacyStateSnapshots, 'capture').and.callThrough();
    expect(canSkipReactionProbe(card, { type: 'AFTER_DAMAGE_EFFECT' } as any)).toBe(false);
    const accessor = effect(AfterDamageEffect.prototype); let reads = 0;
    Object.defineProperty(accessor, 'extra', { enumerable: true, get: () => { reads++; return 1; } });
    expect(canSkipReactionProbe(card, accessor)).toBe(false); expect(reads).toBe(0);
    card.trainerType = undefined; probe(store('on'), card, effect(AfterDamageEffect.prototype)); delete card.trainerType;
    const custom: StateSnapshotBackend = { name: 'legacy', capture: (...args: any[]) => (conformanceLegacyStateSnapshots.capture as any)(...args) };
    probe(store('on', custom), card, effect(AfterDamageEffect.prototype));
    expect(capture.calls.count()).toBe(2);
    expect(canSkipReactionProbe(new Proxy(card, {}), effect(AfterDamageEffect.prototype))).toBe(false);
    let traps = 0;
    card.reduceEffect = Card.prototype.reduceEffect;
    Object.setPrototypeOf(card, new Proxy(Object.getPrototypeOf(card), { has: () => { traps++; return false; } }));
    expect(canSkipReactionProbe(card, effect(AfterDamageEffect.prototype))).toBe(false);
    expect(traps).toBe(0);
  });

  it('preserves reference capture failures for a frozen effect', () => {
    const frozen = Object.freeze(effect(AfterDamageEffect.prototype));
    expect(canSkipReactionProbe(new ErikasBellsprout(), frozen)).toBe(false);
    expect(() => probe(store('on'), new ErikasBellsprout(), frozen)).toThrowError(TypeError);
  });

  it('keeps the base reducer positive attack/power families and unknown subclasses', () => {
    for (const prototype of [AttackEffect.prototype, AfterAttackEffect.prototype, BeforeDoingDamageEffect.prototype, PowerEffect.prototype]) {
      expect(canSkipReactionProbe(new ErikasBellsprout(), effect(prototype))).toBe(false);
    }
    class UnknownReaction extends AfterDamageEffect { }
    expect(canSkipReactionProbe(new ErikasBellsprout(), effect(UnknownReaction.prototype))).toBe(false);
  });

  it('retains overridden Store dispatch wrappers', () => {
    const subject: any = store('on'), capture = spyOn(conformanceLegacyStateSnapshots, 'capture').and.callThrough();
    subject.callReduceEffect = (_c: Card, _s: Store, state: State) => { state.turn++; return state; };
    expect(probe(subject, new ErikasBellsprout(), effect(AfterDamageEffect.prototype)).after.turn).toBe(1);
    expect(capture.calls.count()).toBe(1);
  });

  it('fails verification when a classifier incorrectly labels a changing handler as inert', () => {
    spyOn(filters, 'canSkipReactionProbe').and.returnValue(true);
    const card: any = new ErikasBellsprout();
    card.reduceEffect = (_s: any, state: State) => { state.turn++; return state; };
    expect(() => probe(store('verify'), card, effect(AfterDamageEffect.prototype))).toThrowError(/verification failed.*changed/);
  });

  it('fails verification when a predicted no-op declines and restores enclosing probe state', () => {
    spyOn(filters, 'canSkipReactionProbe').and.returnValue(true);
    const card: any = new ErikasBellsprout(), subject: any = store('verify');
    card.reduceEffect = () => { throw new Error('declined'); };
    subject.probing = true; subject.probeRaisedPrompt = true;
    expect(() => probe(subject, card, effect(AfterDamageEffect.prototype))).toThrowError(/verification failed.*declined/);
    expect(subject.probing).toBe(true); expect(subject.probeRaisedPrompt).toBe(true);
  });

  it('validates conformance configuration and leaves normal Stores independent of the environment', () => {
    const prior = process.env.CONFORMANCE_REACTION_FILTERS;
    try {
      delete process.env.CONFORMANCE_REACTION_FILTERS; expect(reactionFilterMode()).toBe('on');
      process.env.CONFORMANCE_REACTION_FILTERS = 'invalid'; expect(() => createConformanceStore()).toThrowError(/CONFORMANCE_REACTION_FILTERS/);
      const normal: any = new Store({ onStateChange: () => undefined } as any);
      expect(normal.reactionFilter).toBe('off');
      for (const mode of ['off', 'on', 'verify'] as ReactionFilterMode[]) {
        process.env.CONFORMANCE_REACTION_FILTERS = mode; expect(reactionFilterMode()).toBe(mode);
      }
    } finally { if (prior === undefined) { delete process.env.CONFORMANCE_REACTION_FILTERS; } else { process.env.CONFORMANCE_REACTION_FILTERS = prior; } }
  });
});
