import { Store } from './store';
import { State } from './state/state';
import { Action } from './actions/action';
import { StoreLike } from './store-like';
import { GameError } from '../game-error';
import { GameMessage } from '../game-message';
import * as setup from './reducers/setup-reducer';
import * as checks from './effect-reducers/check-effect';
import * as utils from '../../utils/utils';

const outer: Action = { type: 'outer-probe-test' };
const inner: Action = { type: 'inner-probe-test' };

function fixture() {
  const handler = { onStateChange: (state: State) => { store.state = state; } };
  const store = new Store(handler);
  return store;
}

describe('Store disposable probe dispatch', () => {
  beforeEach(() => {
    spyOn(checks, 'checkState').and.callFake((_store: StoreLike, state: State) => state);
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
