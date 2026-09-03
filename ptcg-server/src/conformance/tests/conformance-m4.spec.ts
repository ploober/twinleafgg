import { step } from '../driver';
import { withNoRandomness } from './support/invariants';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  ConditionToken, SCHEMA_VERSION
} from '../neutral-types';

// Turn boundaries + checkup (M4). Special conditions are set directly in `initialState`, so the
// checkup is exercised by a bare `endTurn` — no trigger card needed. The whole boundary
// (turnEnded/turnStarted, betweenTurns special conditions, deck-out) runs inside the PassTurnAction
// dispatch; burn/sleep raise CoinFlipPrompts the driver resolves through the `system` actor.

const WATER = 'Water Energy SVE';
const RALTS = 'Ralts SIT'; // HP 70 — survives a poison/burn tick without a KO

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(over: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0,
    vstarUsed: false, ...over,
  };
}
function pip(iid: string, printing: string, conditions: ConditionToken[] = [], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage, conditions, markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  const withPrize = (ps: PlayerState, tag: string): PlayerState =>
    ps.prizes.length ? ps : { ...ps, prizes: [{ iid: `${tag}-pz`, printing: WATER, faceUp: false }] };
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: { A: withPrize(A, 'A'), B: withPrize(B, 'B') },
  };
}

/** A active (optionally afflicted), B a plain Ralts. Both have a deck card so neither decks out. */
function checkupBoard(conditions: ConditionToken[], damage = 0): NeutralState {
  return board(
    player({ active: pip('A-act', RALTS, conditions, damage), deck: [{ iid: 'A-d1', printing: WATER }] }),
    player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d1', printing: WATER }, { iid: 'B-d2', printing: WATER }] }),
  );
}

const END_A: NeutralAction = { actor: 'A', type: 'endTurn' };
const FLIP = (face: 'heads' | 'tails'): NeutralAction => ({ actor: 'system', type: 'flip', face });

describe('Conformance M4 — turn boundaries & checkup', () => {

  it('poison applies automatically at checkup (no flip), turn advances to B', () => {
    const res = step(checkupBoard(['poisoned']), [END_A]);

    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.A.active!.damage).toBe(10); // +1 poison counter
    expect(res.state.players.A.active!.conditions).toEqual(['poisoned']); // poison persists
    expect(res.state.activePlayer).toBe('B');
    expect(res.state.turn).toBe(4);
    expect(res.events.some(e => e.kind === 'turnEnded' && e.player === 'A')).toBe(true);
    expect(res.events.some(e => e.kind === 'turnStarted' && e.player === 'B')).toBe(true);
  });

  it('burn: heads removes Burned (always +2 counters)', () => {
    const res = step(checkupBoard(['burned']), [END_A, FLIP('heads')]);

    expect(res.status).toBe('awaitingAction');
    expect(res.state.players.A.active!.damage).toBe(20); // burn always deals 2 counters
    expect(res.state.players.A.active!.conditions).toEqual([]); // heads cures the burn
  });

  it('burn: tails keeps Burned', () => {
    const res = step(checkupBoard(['burned']), [END_A, FLIP('tails')]);

    expect(res.state.players.A.active!.damage).toBe(20);
    expect(res.state.players.A.active!.conditions).toEqual(['burned']);
  });

  it('asleep: heads wakes up (no damage)', () => {
    const res = step(checkupBoard(['asleep']), [END_A, FLIP('heads')]);

    expect(res.state.players.A.active!.damage).toBe(0);
    expect(res.state.players.A.active!.conditions).toEqual([]);
  });

  it('asleep: tails stays asleep', () => {
    const res = step(checkupBoard(['asleep']), [END_A, FLIP('tails')]);

    expect(res.state.players.A.active!.conditions).toEqual(['asleep']);
  });

  it('a checkup flip surfaces as a system pending when the flip is not yet in the log', () => {
    const res = step(checkupBoard(['burned']), [END_A]);

    expect(res.status).toBe('awaitingAction');
    expect(res.pending!.actor).toBe('system');
    expect(res.pending!.legalActions).toEqual([{ actor: 'system', type: 'flip', face: 'heads' }, { actor: 'system', type: 'flip', face: 'tails' }]);
  });

  it('deck-out at the start of a turn ends the game (the drawing player loses)', () => {
    const initial = board(
      player({ active: pip('A-act', RALTS), deck: [{ iid: 'A-d1', printing: WATER }] }),
      player({ active: pip('B-act', RALTS), deck: [] }), // B has no deck — decks out on its draw
    );
    const res = step(initial, [END_A]);

    expect(res.status).toBe('gameOver');
    expect(res.state.outcome).toBe('winA'); // B drew from an empty deck, so A wins
    expect(res.state.phase).toBe('gameOver');
    expect(res.events.some(e => e.kind === 'turnEnded' && e.player === 'A')).toBe(true);
    // deckedOut folded into gameOver.cause (event-vocabulary standardization): B decked out, A wins.
    expect(res.events.some(e => e.kind === 'gameOver' && e.cause === 'deckOut' && e.winner === 'A')).toBe(true);
    expect(res.events.some(e => e.kind === 'gameOver' && e.outcome === 'winA')).toBe(true);
  });

  it('per-turn flags reset across the boundary; activePlayer flips at turnStarted', () => {
    const initial = board(
      player({
        active: pip('A-act', RALTS),
        deck: [{ iid: 'A-d1', printing: WATER }],
        flags: flags({ energyAttachedThisTurn: true, prizesTakenThisTurn: 1 }),
      }),
      player({ active: pip('B-act', RALTS), deck: [{ iid: 'B-d1', printing: WATER }] }),
    );
    const res = step(initial, [END_A]);

    expect(res.state.activePlayer).toBe('B');
    expect(res.state.turn).toBe(4);
    // A's energy-attached gate is keyed to turn 3; at turn 4 it reads as not-this-turn.
    expect(res.state.players.A.flags.energyAttachedThisTurn).toBe(false);
    // prizesTakenThisTurn rolls into prizesTakenLastTurn at end of turn.
    expect(res.state.players.A.flags.prizesTakenThisTurn).toBe(0);
    expect(res.state.players.A.flags.prizesTakenLastTurn).toBe(1);
  });

  it('replays a sleep checkup deterministically', () => {
    const actions: NeutralAction[] = [END_A, FLIP('tails')];
    const a = withNoRandomness(() => step(checkupBoard(['asleep']), actions));
    const b = withNoRandomness(() => step(checkupBoard(['asleep']), actions));
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
  });
});
