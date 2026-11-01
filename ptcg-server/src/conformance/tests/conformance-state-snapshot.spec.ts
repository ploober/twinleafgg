import { createConformanceStore, conformanceSnapshotBackend } from '../conformance-store';
import { createConformanceApp } from '../http/app';
import { Store } from '../../game/store/store';
import { State } from '../../game/store/state/state';

describe('Conformance snapshot selection', () => {
  let prior: string | undefined;
  beforeEach(() => { prior = process.env.CONFORMANCE_STATE_SNAPSHOTS; });
  afterEach(() => {
    if (prior === undefined) { delete process.env.CONFORMANCE_STATE_SNAPSHOTS; }
    else { process.env.CONFORMANCE_STATE_SNAPSHOTS = prior; }
  });

  it('keeps ordinary gameplay Stores on legacy even when conformance selects graph', () => {
    process.env.CONFORMANCE_STATE_SNAPSHOTS = 'graph';
    const store = new Store({ onStateChange: () => undefined });
    expect(Object.getPrototypeOf(store.snapshot())).toBe(store.state);
    const conformance = createConformanceStore();
    expect(Object.getPrototypeOf(conformance.snapshot())).toBe(State.prototype);
  });

  it('defaults to legacy until promotion', () => {
    delete process.env.CONFORMANCE_STATE_SNAPSHOTS;
    expect(conformanceSnapshotBackend().name).toBe('legacy');
  });

  it('refuses invalid configuration before creating an HTTP application', () => {
    process.env.CONFORMANCE_STATE_SNAPSHOTS = 'typo';
    expect(() => createConformanceStore()).toThrowError(/Invalid CONFORMANCE_STATE_SNAPSHOTS/);
    expect(() => createConformanceApp()).toThrowError(/Invalid CONFORMANCE_STATE_SNAPSHOTS/);
  });
});
