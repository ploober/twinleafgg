import { Action } from './actions/action';
import { Effect } from './effects/effect';
import { KnockOutEffect } from './effects/game-effects';
import { Prompt } from './prompts/prompt';
import { State } from './state/state';
import { StateLogParam } from './state/state-log';
import { GameLog } from '../game-message';

export interface StoreLike {
  dispatch(action: Action): void;

  reduceEffect(state: State, effect: Effect): State;

  /** CF-38 KO window: resolve the simultaneous reactions to every KO of one sweep before the KOs themselves. */
  resolveKnockOutReactions(state: State, effects: KnockOutEffect[]): State;

  log(state: State, message: GameLog, params?: StateLogParam, client?: number): void;

  waitPrompt(state: State, callback: () => void): State;

  hasPrompts(): boolean;

  /**
   * True while a candidate handler is being PROBED on a throwaway clone (`resolveSimultaneous` /
   * `resolveKnockOutReactions`). A handler — or a prefab it calls — that consumes a resource living
   * OUTSIDE the cloned state (scripted randomness, an arbiter draw) must not do so while probing:
   * the clone is discarded, the consumption is not. See TA-440.
   */
  isProbing(): boolean;

  /**
   * TA-737: the PlayPokemonEffect whose card handlers are running. They see it while the card is still in the
   * hand (the reducer moves it afterwards), so IS_ABILITY_BLOCKED reads this to judge a "when you play this Pokémon
   * from your hand" Ability where the card is going. Optional: test doubles of the store need not carry it.
   */
  pokemonBeingPlayed?(): { pokemonCard: object; target: { cards: object[] } } | undefined;

  prompt<T>(
    state: State, prompt: Prompt<T>,
    then: (result: T) => void): State;

  prompt<T>(
    state: State, prompt: [Prompt<T>],
    then: (result: T) => void): State;

  prompt<T, S>(
    state: State, prompt: [Prompt<T>, Prompt<S>],
    then: (result: [T, S]) => void): State;

  prompt<T, S, R>(
    state: State, prompt: [Prompt<T>, Prompt<S>, Prompt<R>],
    then: (result: [T, S, R]) => void): State;

  prompt<T, S, R, P>(
    state: State, prompt: [Prompt<T>, Prompt<S>, Prompt<R>, Prompt<P>],
    then: (result: [T, S, R, P]) => void): State;

  prompt<T>(
    state: State, prompt: Prompt<T>[],
    then: (result: T[]) => void): State;
}
