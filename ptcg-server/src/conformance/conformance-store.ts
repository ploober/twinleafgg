import { Store } from '../game/store/store';
import { ConformanceStoreHandler } from './conformance-store-handler';
import { conformanceLegacyStateSnapshots, graphStateSnapshots, StateSnapshotBackend } from '../game/store/state-snapshot';

export function conformanceSnapshotBackend(): StateSnapshotBackend {
  const mode = process.env.CONFORMANCE_STATE_SNAPSHOTS ?? 'legacy';
  if (mode === 'legacy') { return conformanceLegacyStateSnapshots; }
  if (mode === 'graph') { return graphStateSnapshots; }
  throw new Error(`Invalid CONFORMANCE_STATE_SNAPSHOTS: ${mode}; expected legacy or graph`);
}

export function createConformanceStore(handler = new ConformanceStoreHandler()): Store {
  const store = new Store(handler, { snapshotBackend: conformanceSnapshotBackend() });
  handler.setStore(store);
  return store;
}
