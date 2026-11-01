import { conformanceLegacyStateSnapshots, graphStateSnapshots, legacyStateSnapshots, snapshotDiagnostics } from './state-snapshot';
import { State } from './state/state';
import { Card } from './card/card';
import { CardList } from './state/card-list';
import { StateLog } from './state/state-log';
import { GameLog } from '../game-message';
import { deepClone } from '../../utils/utils';
import { snapshotSourceMatches } from './snapshot-provenance';

function capture(state: State): State { return graphStateSnapshots.capture(state, undefined, 'test').state; }

describe('State graph snapshots', () => {
  it('specializes legacy copying without changing prototypes, cycles, pins or array aliases', () => {
    const source: any = new State(), shared = { value: 1 }, attack = { name: 'pinned' };
    source.self = source; source.shared = shared; source.a = [shared, , undefined]; source.b = source.a;
    const copied: any = conformanceLegacyStateSnapshots.capture(source, { shared, attack }, 'test', [attack]);
    expect(Object.getPrototypeOf(copied.state)).toBe(source);
    expect(copied.state.self).toBe(copied.state);
    expect(copied.state.shared).toBe(copied.effect.shared);
    expect(copied.effect.attack).toBe(attack);
    expect(copied.state.a).not.toBe(copied.state.b);
    expect(1 in copied.state.a).toBe(false);
  });

  it('specialized legacy copying preserves getter side effects and deleted-key handling', () => {
    for (const backend of [legacyStateSnapshots, conformanceLegacyStateSnapshots]) {
      const source: any = new State(); let reads = 0;
      Object.defineProperty(source, 'value', {
        enumerable: true, get: () => { reads++; delete source.deleted; return 5; },
        set: function (this: any, value: number) { Object.defineProperty(this, 'value', { value, enumerable: true }); }
      });
      source.deleted = 1;
      const copied: any = backend.capture(source, undefined, 'test').state;
      expect(reads).toBe(1); expect(copied.value).toBe(5);
      expect(Object.prototype.hasOwnProperty.call(copied, 'deleted')).toBe(false);
    }
  });

  it('preserves explicit zone provenance when graph states are copied by the specialized legacy backend', () => {
    const source: any = new State(); source.zone = new CardList(); source.zone.zoneTag = 'deck';
    const graph: any = capture(source); graph.temp = new CardList(); graph.zone.moveTo(graph.temp, 0);
    const legacy: any = conformanceLegacyStateSnapshots.capture(graph, undefined, 'test').state;
    expect(snapshotSourceMatches(legacy.temp, legacy.zone)).toBe(true);
  });
  it('uses stable class prototypes through repeated captures without retaining a source as a prototype', () => {
    const source = new State();
    const a = capture(source), b = capture(a);
    expect(Object.getPrototypeOf(a)).toBe(State.prototype);
    expect(Object.getPrototypeOf(b)).toBe(State.prototype);
    a.cardNames.push('isolated');
    expect(source.cardNames).toEqual([]);
    expect(b.cardNames).toEqual([]);
    expect(Object.getPrototypeOf(legacyStateSnapshots.capture(source, undefined, 'test').state)).toBe(source);
  });

  it('copies state/effect through one context and retains only explicitly pinned attack identity', () => {
    const source: any = new State();
    source.shared = { value: 1 }; source.self = source;
    const attack = { name: 'printed attack' };
    const effect: any = { shared: source.shared, attack };
    const result: any = graphStateSnapshots.capture(source, effect, 'test', [attack]);
    expect(result.state.self).toBe(result.state);
    expect(result.state.shared).toBe(result.effect.shared);
    expect(result.state.shared).not.toBe(source.shared);
    expect(result.effect.attack).toBe(attack);
  });

  it('preserves sparse arrays, legacy array aliases, functions and shared definitions', () => {
    const source: any = new State();
    const card = Object.create(Card.prototype), log = new StateLog(GameLog.LOG_PLAYER_ENDS_TURN, { name: 'A' });
    Object.freeze(log.params); Object.freeze(log);
    const array = [card, , null]; source.a = array; source.b = array; source.fn = () => 1; source.logs = [log];
    const result: any = graphStateSnapshots.capture(source, undefined, 'test');
    expect(result.state.a).not.toBe(result.state.b);
    expect(1 in result.state.a).toBe(false);
    expect(result.state.a[0]).toBe(card);
    expect(result.state.fn).toBe(source.fn);
    expect(result.state.logs).not.toBe(source.logs);
    expect(result.state.logs[0]).toBe(log);
    expect(result.cards).toEqual([card]);
  });

  it('flattens a legacy snapshot while preserving shared state/effect references', () => {
    const source: any = deepClone(new State());
    source.shared = { count: 1 };
    const result: any = graphStateSnapshots.capture(source, { shared: source.shared }, 'test');
    expect(Object.getPrototypeOf(result.state)).toBe(State.prototype);
    expect(result.state.shared).toBe(result.effect.shared);
  });

  it('falls back as a whole capture without dropping inherited data', () => {
    const source: any = new State();
    source.shared = Object.create({ inherited: { value: 1 } });
    const result: any = graphStateSnapshots.capture(source, { shared: source.shared }, 'test');
    expect(Object.getPrototypeOf(result.state)).toBe(source);
    expect(result.state.shared.inherited).toBe(source.shared.inherited);
    expect(result.effect.shared).toBe(result.state.shared);
    expect(result.cards).toBeUndefined();
  });

  it('preserves the legacy accessor failure without invoking a getter during the failed graph attempt', () => {
    const source: any = new State(); let reads = 0;
    Object.defineProperty(source, 'access', { enumerable: true, get: () => { reads++; return 3; } });
    expect(() => capture(source)).toThrowError(TypeError);
    expect(reads).toBe(1);
  });

  it('records unsupported shapes instead of silently accepting native containers', () => {
    const prior = process.env.CONFORMANCE_SNAPSHOT_DIAGNOSTICS;
    process.env.CONFORMANCE_SNAPSHOT_DIAGNOSTICS = '1';
    try {
      const source: any = new State(); source.native = new Map();
      const result = capture(source);
      expect(Object.getPrototypeOf(result)).toBe(source);
      expect(snapshotDiagnostics().test.fallbacks['native-container']).toBeGreaterThan(0);
    } finally {
      if (prior === undefined) { delete process.env.CONFORMANCE_SNAPSHOT_DIAGNOSTICS; }
      else { process.env.CONFORMANCE_SNAPSHOT_DIAGNOSTICS = prior; }
    }
  });

  it('does not treat an unrelated inherited fromZoneRef as CardList metadata', () => {
    const source: any = new State();
    source.custom = Object.create({ fromZoneRef: { retained: true } });
    const result: any = capture(source);
    expect(Object.getPrototypeOf(result)).toBe(source);
    expect(result.custom.fromZoneRef).toBe(source.custom.fromZoneRef);
  });

  it('preserves legacy errors for read-only owned fields', () => {
    const source = Object.freeze(new State());
    expect(() => legacyStateSnapshots.capture(source, undefined, 'test')).toThrowError(TypeError);
    expect(() => conformanceLegacyStateSnapshots.capture(source, undefined, 'test')).toThrowError(TypeError);
    expect(() => capture(source)).toThrowError(TypeError);
  });

  it('does not invoke a raw provenance getter when falling back', () => {
    const source: any = new State(); source.temp = new CardList(); let reads = 0;
    Object.defineProperty(source.temp, 'fromZoneRef', { get: () => { reads++; return undefined; } });
    const result: any = capture(source);
    expect(Object.getPrototypeOf(result)).toBe(source);
    expect(reads).toBe(0);
  });

  it('preserves origin ancestry, separates siblings and forwards temporary-pile provenance', () => {
    const source: any = new State();
    source.zone = new CardList(); source.zone.zoneTag = 'deck'; source.temp = new CardList();
    source.zone.moveTo(source.temp, 0);
    const a: any = capture(source), sibling: any = capture(source), child: any = capture(a);
    expect(snapshotSourceMatches(a.temp, a.zone)).toBe(true);
    expect(snapshotSourceMatches(a.temp, source.zone)).toBe(true);
    // A pile created from a cloned zone names that specific branch, not a common root.
    const branchPile = new CardList(); a.zone.moveTo(branchPile, 0);
    expect(snapshotSourceMatches(branchPile, child.zone)).toBe(true);
    expect(snapshotSourceMatches(branchPile, sibling.zone)).toBe(false);
    const nextPile = new CardList(); branchPile.moveTo(nextPile, 0);
    expect(snapshotSourceMatches(nextPile, a.zone)).toBe(true);
    expect((a.temp as any).fromZoneRef).toBeUndefined();
    expect((branchPile as any).fromZoneRef).toBeUndefined();
  });

  it('keeps lineage when an unsupported shape forces a legacy fallback', () => {
    const source: any = new State(); source.zone = new CardList(); source.zone.zoneTag = 'deck';
    const graph: any = capture(source); graph.temp = new CardList(); graph.zone.moveTo(graph.temp, 0);
    graph.native = new Set();
    const fallback: any = capture(graph);
    expect(Object.getPrototypeOf(fallback)).toBe(graph);
    expect(snapshotSourceMatches(fallback.temp, fallback.zone)).toBe(true);
  });
});
