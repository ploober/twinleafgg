import { Store } from './store';
import { StoreHandler } from './store-handler';
import { StoreLike } from './store-like';
import { State, GamePhase } from './state/state';
import { Player } from './state/player';
import { Card } from './card/card';
import { TrainerCard } from './card/trainer-card';
import { Format, TrainerType } from './card/card-types';
import { Effect } from './effects/effect';
import * as overrides from './card/card-effect-overrides';
import * as prefabs from './prefabs/prefabs';

// Cache module resolution only: a cache of the selected function or result would make format
// changes, updated overrides, or a changed board reuse a stale verdict.
interface StoreInternals {
  callReduceEffect(card: Card, store: StoreLike, state: State, effect: Effect): State;
  calculatePlayability(state: State): State;
}

function fixture() {
  const handler = { gameSettings: { format: Format.STANDARD } };
  const store = new Store(handler as unknown as StoreHandler);
  const state = new State();
  const card = {
    name: 'Module cache test', trainerType: TrainerType.ITEM, id: 42,
    reduceEffect: (_store: StoreLike, current: State) => current
  } as unknown as TrainerCard;
  const effect: Effect = { type: 'module-cache-test', preventDefault: false };
  return { handler, store, internal: store as unknown as StoreInternals, state, card, effect };
}

describe('Store lazy module cache', () => {
  it('reads an updated override export after warming the module cache', () => {
    const { store, internal, state, card, effect } = fixture();
    expect(internal.callReduceEffect(card, store, state, effect)).toBe(state);
    const changed = new State();
    spyOn(overrides, 'getOverriddenReduceEffect').and.returnValue(() => changed);
    expect(internal.callReduceEffect(card, store, state, effect)).toBe(changed);
  });

  it('selects the override again when the same card is used under another format', () => {
    const { handler, store, internal, state, card, effect } = fixture();
    const retro = new State();
    const lookup = spyOn(overrides, 'getOverriddenReduceEffect').and.callFake(
      (_card: TrainerCard, format: Format) => () => format === Format.RSPK ? retro : state);
    expect(internal.callReduceEffect(card, store, state, effect)).toBe(state);
    handler.gameSettings.format = Format.RSPK;
    expect(internal.callReduceEffect(card, store, state, effect)).toBe(retro);
    expect(lookup.calls.count()).toBe(2);
    expect(lookup.calls.mostRecent().args).toEqual([card, Format.RSPK]);
  });

  it('recomputes playability after the board changes', () => {
    const { internal, state, card } = fixture();
    const player = new Player();
    player.hand.cards = [card];
    state.players = [player];
    state.activePlayer = 0;
    state.phase = GamePhase.PLAYER_TURN;
    state.turn = 1;
    const canPlay = spyOn(prefabs, 'CAN_PLAY_CARD').and.returnValue(true);
    internal.calculatePlayability(state);
    expect(player.playableCardIds).toEqual([42]);
    state.turn = 2;
    canPlay.and.returnValue(false);
    internal.calculatePlayability(state);
    expect(player.playableCardIds).toEqual([]);
    expect(canPlay.calls.count()).toBe(2);
  });
});
