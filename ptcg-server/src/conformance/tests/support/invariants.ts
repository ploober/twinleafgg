import { State, GamePhase, GameWinner } from '../../../game/store/state/state';
import {
  collectAllCardIds, expectNoDuplicateCards, expectCardsConserved, getBenchSize
} from '../../../sets/tests/card-test-helpers';
import { GameStatsTracker } from '../../../game/store/game-stats-tracker';
import { importState } from '../../state-adapter';
import { replay, step, projectGame } from '../../driver';
import { NeutralState, NeutralAction, StepResponse } from '../../neutral-types';

/**
 * Foundations for the adapter fidelity tests (testing design doc §3). Oracle-free helpers reused by
 * the higher tiers. They build on the engine's own conservation utilities in card-test-helpers
 * (`collectAllCardIds` / `expectNoDuplicateCards` / `expectCardsConserved`).
 */

/**
 * Physical truths that must hold for any quiescent engine `State`. `idsBefore` (a
 * `collectAllCardIds` snapshot from the imported board) additionally checks card conservation —
 * cards are only ever moved between zones, never created or destroyed.
 */
export function assertInvariants(state: State, opts: { idsBefore?: number[] } = {}): void {
  expectNoDuplicateCards(state);
  if (opts.idsBefore !== undefined) {
    expectCardsConserved(state, opts.idsBefore);
  }

  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    for (const slot of [player.active, ...player.bench]) {
      if (slot.damage % 10 !== 0) {
        throw new Error(`[invariants] player ${i} slot damage ${slot.damage} is not a multiple of 10`);
      }
      // Attached energy/tools are mirrored into the slot's canonical `.cards`; the mirror must agree.
      for (const energy of slot.energies.cards) {
        if (!slot.cards.includes(energy)) {
          throw new Error(`[invariants] player ${i} attached energy "${energy.fullName}" is not in slot.cards`);
        }
      }
      for (const tool of slot.tools) {
        if (!slot.cards.includes(tool)) {
          throw new Error(`[invariants] player ${i} attached tool "${tool.fullName}" is not in slot.cards`);
        }
      }
    }
    const occupiedBench = getBenchSize(state, i);
    if (occupiedBench > 5) {
      throw new Error(`[invariants] player ${i} has ${occupiedBench} benched Pokemon (> 5)`);
    }
  }

  const over = state.winner !== GameWinner.NONE;
  const finished = state.phase === GamePhase.FINISHED;
  if (over !== finished) {
    throw new Error(`[invariants] winner/phase disagree: winner=${state.winner} phase=${state.phase}`);
  }
}

/**
 * Run `fn` (an in-scope replay) with `Math.random` stubbed to THROW, asserting it is never reached
 * on a game-logic path — the conformance boundary externalizes all randomness to the `system` actor
 * (design §5). The one cosmetic core consumer is `GameStatsTracker` (it assigns a `Math.random`-based
 * display id to a card list on the first damage event and writes `gameStats` metadata the projection
 * never reads), so its two reducer entry points are temporarily no-op'd for the duration. Any
 * remaining `Math.random` call is a genuine randomness leak and throws.
 *
 * (We do NOT inspect call stacks: under ts-node, reading `Error().stack` invokes source-map, which
 * itself calls `Math.random` thousands of times — a cascade. Throwing avoids touching `.stack` until
 * after restore.)
 */
export function withNoRandomness<T>(fn: () => T): T {
  const tracker = GameStatsTracker as unknown as Record<string, unknown>;
  const savedTrackDamage = tracker.trackDamageDealt;
  const savedHandleEvolution = tracker.handlePokemonEvolution;
  const noop = () => { /* cosmetic stats — neutralized so it can't reach Math.random */ };
  tracker.trackDamageDealt = noop;
  tracker.handlePokemonEvolution = noop;

  const original = Math.random;
  Math.random = () => {
    throw new Error('[withNoRandomness] Math.random called on the in-scope path (randomness leak)');
  };
  try {
    return fn();
  } finally {
    Math.random = original;
    tracker.trackDamageDealt = savedTrackDamage;
    tracker.handlePokemonEvolution = savedHandleEvolution;
  }
}

/** Deep-equal two neutral projections (with a documented, currently-empty ignore hook). */
export function expectProjectionsEqual(a: NeutralState, b: NeutralState): void {
  expect(b).toEqual(a);
}

/**
 * `step`, with invariants checked. Runs the actions on a held game (so invariants can be asserted on
 * the post-replay engine `State` against the imported card-id snapshot), verifies import determinism
 * (two fresh imports project identically), and returns the canonical `step` response.
 */
export function stepChecked(initial: NeutralState, actions: NeutralAction[]): StepResponse {
  // Import is a pure function of initialState — two imports must project identically.
  expectProjectionsEqual(projectGame(importState(initial)), projectGame(importState(initial)));

  const game = importState(initial);
  const idsBefore = collectAllCardIds(game.state);
  replay(game, actions);
  assertInvariants(game.state, { idsBefore });

  return step(initial, actions);
}
