import { observeReplay, measureReplay, replayObservation, setReplayObserver } from '../replay-observer';
import { NeutralState, StepResponse } from '../neutral-types';
import { Store } from '../../game/store/store';

describe('Replay observation isolation', () => {
  afterEach(() => setReplayObserver());
  it('preserves results without an observer', () => {
    const result = {} as StepResponse;
    expect(observeReplay({} as NeutralState, [], () => result)).toBe(result);
    expect(measureReplay('test', () => 7)).toBe(7);
  });
  it('nests recursive replay and restores the parent even when a child throws', () => {
    const completed: unknown[] = [], recursive: boolean[] = [];
    setReplayObserver({ begin: (_s, _a, nested) => {
      recursive.push(nested);
      return { measure: (_p, f) => f(), boundary: () => undefined,
        finish: (_r, e) => completed.push(e) };
    } });
    observeReplay({} as NeutralState, [], () => {
      const parent = replayObservation();
      expect(() => observeReplay({} as NeutralState, [], () => { throw new Error('rejected'); })).toThrowError('rejected');
      expect(replayObservation()).toBe(parent);
      return {} as StepResponse;
    });
    expect(recursive).toEqual([false, true]);
    expect(completed.length).toBe(2);
    expect(replayObservation()).toBeUndefined();
  });
  it('rejects Store continuations and active probes as replay boundaries', () => {
    const store = new Store({ onStateChange: () => undefined });
    expect(store.replayBoundaryReason()).toBeUndefined();
    (store as any).waitItems.push(() => undefined);
    expect(store.replayBoundaryReason()).toBe('wait-continuation');
    (store as any).waitItems.length = 0;
    (store as any).probing = true;
    expect(store.replayBoundaryReason()).toBe('active-probe');
  });
});
