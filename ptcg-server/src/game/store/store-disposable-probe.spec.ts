import { Store } from './store';
import { State } from './state/state';
import { Action } from './actions/action';
import { StoreLike } from './store-like';
import { GameError } from '../game-error';
import { GameMessage } from '../game-message';
import * as setup from './reducers/setup-reducer';
import * as checks from './effect-reducers/check-effect';
import * as utils from '../../utils/utils';
import { Card } from './card/card';
import { StateLog } from './state/state-log';
import { GameLog } from '../game-message';
import { graphStateSnapshots, StateSnapshotBackend } from './state-snapshot';

const outer: Action = { type: 'outer-probe-test' };
const inner: Action = { type: 'inner-probe-test' };

function fixture(snapshotBackend?: StateSnapshotBackend) {
  const handler = { onStateChange: (state: State) => { store.state = state; } };
  const store = new Store(handler, { snapshotBackend });
  return store;
}

describe('Store disposable probe dispatch', () => {
  beforeEach(() => {
    spyOn(checks, 'checkState').and.callFake((_store: StoreLike, state: State) => state);
  });

  for (const backend of [undefined, graphStateSnapshots]) {
    it(`preserves attack identity through the Store reaction path (${backend?.name ?? 'legacy'})`, () => {
      const store = fixture(backend);
      const attack = { name: 'identity-sensitive reaction' };
      const card = Object.assign(Object.create(Card.prototype), {
        attacks: [attack], reduceEffect: (_store: StoreLike, state: State, effect: any) => {
          if (effect.attack === attack) { state.turn++; }
          return state;
        }
      });
      const original = new State();
      const result = (store as any).probe(card, original, { attack });
      expect(result).not.toBeNull();
      expect(result.after.turn).toBe(1);
      expect(original.turn).toBe(0);
    });
  }

  it('captures card values at dispatch entry and consumes a graph inventory only once', () => {
    const store = fixture(graphStateSnapshots);
    const source: any = new State();
    const first = Object.assign(Object.create(Card.prototype), { used: false });
    const later = Object.assign(Object.create(Card.prototype), { used: false });
    source.fixture = [first];
    store.setProbeSnapshot(source, true);
    first.used = true; // Values must be captured now, not when the snapshot was made.
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
      first.used = false; later.used = true; return state;
    });
    store.dispatchProbe(outer);
    expect(first.used).toBe(true);
    later.used = false;
    (store.state as any).fixture.push(later);
    store.dispatchProbe(outer); // The consumed inventory must not miss the newly inserted Card.
    expect(later.used).toBe(false);
  });

  it('invalidates the inventory for external state assignment and prepared snapshots', () => {
    const store = fixture(graphStateSnapshots);
    store.setProbeSnapshot(new State(), true);
    const replacement: any = new State();
    const card = Object.assign(Object.create(Card.prototype), { used: false });
    replacement.fixture = [card]; store.state = replacement;
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => { card.used = true; return state; });
    store.dispatchProbe(outer);
    expect(card.used).toBe(false);
    store.setProbeSnapshot(new State(), false);
    (store.state as any).fixture = [card];
    store.dispatchProbe(outer);
    expect(card.used).toBe(false);
  });

  for (const fails of [false, true]) {
    it(`restores shared card scalars through cyclic and sparse graphs after ${fails ? 'failure' : 'success'}`, () => {
      const store = fixture();
      const card = Object.assign(Object.create(Card.prototype), {
        used: false, count: 2, label: 'before', optional: undefined, nullable: null,
      });
      const nested: any = { cards: [card, , card] };
      nested.self = nested;
      (store.state as any).probeFixture = nested;
      const failure = new Error('probe rejected');
      spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
        Object.assign(card, { used: true, count: 99, label: 'during', optional: 1, nullable: 1 });
        if (fails) { throw failure; }
        return state;
      });
      if (fails) {
        expect(() => store.dispatchProbe(outer)).toThrow(failure);
      } else {
        store.dispatchProbe(outer);
      }
      expect(card.used).toBe(false);
      expect(card.count).toBe(2);
      expect(card.label).toBe('before');
      expect(card.optional).toBeUndefined();
      expect(card.nullable).toBeNull();
    });
  }

  it('keeps append-only shared history isolated from a disposable probe', () => {
    const original = new State();
    const history = new StateLog(GameLog.LOG_PLAYER_ENDS_TURN, { name: 'A' });
    Object.freeze(history.params);
    Object.freeze(history);
    original.logs.push(history);
    const store = fixture();
    store.state = utils.deepClone(original, [Card, StateLog]);
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
      state.logs.push(new StateLog(GameLog.LOG_PLAYER_ENDS_TURN, { name: 'B' }));
      return state;
    });
    store.dispatchProbe(outer);
    expect(store.state.logs.length).toBe(2);
    expect(store.state.logs[0]).toBe(history);
    expect(original.logs).toEqual([history]);
  });

  it('keeps ordinary dispatch rollback after a partial mutation', () => {
    const store = fixture();
    const failure = new Error('partially applied action');
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
      state.turn = 99;
      state.cardNames.push('mutated');
      throw failure;
    });
    expect(() => store.dispatch(outer)).toThrow(failure);
    expect(store.state.turn).toBe(0);
    expect(store.state.cardNames).toEqual([]);
  });

  it('does not make a rollback copy of a failing disposable clone or mutate the original board', () => {
    const original = new State();
    const store = fixture();
    store.state = utils.deepClone(original);
    const clone = spyOn(utils, 'deepClone').and.callThrough();
    const failure = new Error('discard this probe');
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
      state.turn = 99;
      state.cardNames.push('probe-only');
      throw failure;
    });
    expect(() => store.dispatchProbe(outer)).toThrow(failure);
    expect(clone).not.toHaveBeenCalled();
    expect(original.turn).toBe(0);
    expect(original.cardNames).toEqual([]);
    // The failed probe is explicitly disposable, not a board the caller may resume.
    expect(store.state.turn).toBe(99);
  });

  it('preserves successful dispatch results while omitting only the probe backup', () => {
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
      state.turn++;
      state.cardNames.push('applied');
      return state;
    });
    const normal = fixture();
    const probe = fixture();
    const clone = spyOn(utils, 'deepClone').and.callThrough();
    normal.dispatch(outer);
    expect(clone.calls.count()).toBe(1);
    clone.calls.reset();
    probe.dispatchProbe(outer);
    expect(clone).not.toHaveBeenCalled();
    expect(probe.state).toEqual(normal.state);
  });

  it('retains rollback for a normal nested dispatch inside the disposable probe', () => {
    const store = fixture();
    const failure = new Error('inner action failed');
    const clone = spyOn(utils, 'deepClone').and.callThrough();
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State, action: Action) => {
      if (action === inner) {
        state.turn = 99;
        state.cardNames.push('inner mutation');
        throw failure;
      }
      state.turn = 10;
      expect(() => store.dispatch(inner)).toThrow(failure);
      expect(store.state.turn).toBe(10);
      expect(store.state.cardNames).toEqual([]);
      return store.state;
    });
    store.dispatchProbe(outer);
    expect(clone.calls.count()).toBe(1);
    expect(store.state.turn).toBe(10);
  });

  it('does not leave rollback disabled when a probe rejects before reaching the reducer', () => {
    const store = fixture();
    store.state.prompts = [{ result: undefined }] as State['prompts'];
    expect(() => store.dispatchProbe(outer)).toThrow(new GameError(GameMessage.ACTION_IN_PROGRESS));
    store.state.prompts = [];
    const failure = new Error('normal action');
    spyOn(setup, 'setupPhaseReducer').and.callFake((_store: StoreLike, state: State) => {
      state.turn = 99;
      throw failure;
    });
    expect(() => store.dispatch(outer)).toThrow(failure);
    expect(store.state.turn).toBe(0);
  });
});
