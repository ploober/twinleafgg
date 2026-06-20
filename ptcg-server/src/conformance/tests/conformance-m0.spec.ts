import { importState } from '../state-adapter';
import { projectGame, applyActions } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';

// ── builders that mirror the projection's exact default shapes ─────────────
// (so a full round-trip deep-equal is a real guard, not a fudge)

function defaultMarkers(playedOnTurn = 0): PokemonMarkers {
  return {
    playedOnTurn,
    movedToActiveOnTurn: -1,
    damageTakenThisTurn: 0,
    abilitiesUsedThisTurn: [],
    cannotAttackNextTurn: false,
  };
}

function defaultFlags(overrides: Partial<PlayerFlags> = {}): PlayerFlags {
  return {
    supporterPlayedThisTurn: false,
    energyAttachedThisTurn: false,
    stadiumPlayedThisTurn: false,
    retreatedThisTurn: false,
    cardsPlayedThisTurn: 0,
    prizesTakenThisTurn: 0,
    prizesTakenLastTurn: 0,
    vstarUsed: false,
    ...overrides,
  };
}

function emptyPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    active: null,
    bench: [],
    hand: [],
    deck: [],
    discard: [],
    lostZone: [],
    prizes: [],
    flags: defaultFlags(),
    ...overrides,
  };
}

describe('Conformance M0 — import/project + attach energy', () => {

  it('round-trips a static no-prompt board through import -> project', () => {
    const activeA: PokemonInPlay = {
      stack: [{ iid: 'A-active', printing: 'Ralts SIT' }],
      energy: [
        { iid: 'A-e1', printing: 'Lightning Energy SVE' },
        { iid: 'A-e2', printing: 'Water Energy SVE' },
      ],
      tools: [],
      damage: 30,
      conditions: ['poisoned'],
      poisonDamagePerTurn: 20,
      markers: defaultMarkers(1),
    };

    const benchA: PokemonInPlay = {
      stack: [{ iid: 'A-bench0', printing: 'Ralts SIT' }],
      energy: [],
      tools: [],
      damage: 0,
      conditions: [],
      markers: defaultMarkers(2),
    };

    const initial: NeutralState = {
      schemaVersion: SCHEMA_VERSION,
      turn: 3,
      activePlayer: 'A',
      firstPlayer: 'A',
      phase: 'main',
      outcome: 'ongoing',
      stadium: null,
      players: {
        A: {
          active: activeA,
          bench: [benchA],
          hand: [{ iid: 'A-h1', printing: 'Electric Generator PAF' }],
          deck: [
            { iid: 'A-d1', printing: 'Lightning Energy SVE' },
            { iid: 'A-d2', printing: 'Water Energy SVE' },
          ],
          discard: [{ iid: 'A-x1', printing: 'Water Energy SVE' }],
          lostZone: [],
          prizes: [
            { iid: 'A-p1', printing: 'Water Energy SVE', faceUp: false },
            { iid: 'A-p2', printing: 'Lightning Energy SVE', faceUp: false },
          ],
          flags: defaultFlags(),
        },
        B: {
          active: {
            stack: [{ iid: 'B-active', printing: 'Ralts SIT' }],
            energy: [],
            tools: [],
            damage: 0,
            conditions: [],
            markers: defaultMarkers(0),
          },
          bench: [],
          hand: [],
          deck: [{ iid: 'B-d1', printing: 'Water Energy SVE' }],
          discard: [],
          lostZone: [],
          prizes: [{ iid: 'B-p1', printing: 'Water Energy SVE', faceUp: false }],
          flags: defaultFlags(),
        },
      },
    };

    const game = importState(initial);
    const projected = projectGame(game);

    expect(projected).toEqual(initial);

    // Idempotence: re-importing the projection and projecting again is stable.
    const reprojected = projectGame(importState(projected));
    expect(reprojected).toEqual(projected);
  });

  it('drives an "attach a basic Energy" action and the projection changes correctly', () => {
    const initial: NeutralState = {
      schemaVersion: SCHEMA_VERSION,
      turn: 3,
      activePlayer: 'A',
      firstPlayer: 'A',
      phase: 'main',
      outcome: 'ongoing',
      stadium: null,
      players: {
        A: emptyPlayer({
          active: {
            stack: [{ iid: 'A-active', printing: 'Ralts SIT' }],
            energy: [],
            tools: [],
            damage: 0,
            conditions: [],
            markers: defaultMarkers(1),
          },
          hand: [{ iid: 'A-energy', printing: 'Lightning Energy SVE' }],
          deck: [{ iid: 'A-d1', printing: 'Water Energy SVE' }],
          prizes: [{ iid: 'A-p1', printing: 'Water Energy SVE', faceUp: false }],
        }),
        B: emptyPlayer({
          active: {
            stack: [{ iid: 'B-active', printing: 'Ralts SIT' }],
            energy: [],
            tools: [],
            damage: 0,
            conditions: [],
            markers: defaultMarkers(1),
          },
          deck: [{ iid: 'B-d1', printing: 'Water Energy SVE' }],
          prizes: [{ iid: 'B-p1', printing: 'Water Energy SVE', faceUp: false }],
        }),
      },
    };

    const game = importState(initial);

    // Precondition: energy is in hand, not yet attached.
    const before = projectGame(game);
    expect(before.players.A.active!.energy).toEqual([]);
    expect(before.players.A.hand).toEqual([{ iid: 'A-energy', printing: 'Lightning Energy SVE' }]);
    expect(before.players.A.flags.energyAttachedThisTurn).toBe(false);

    applyActions(game, [
      { actor: 'A', type: 'attachEnergy', card: 'A-energy', target: 'A-active' },
    ]);

    expect(game.handler.isBlocked()).toBe(false);

    const after = projectGame(game);
    // The energy moved hand -> the active Pokemon's energy, and the once-per-turn gate flipped.
    expect(after.players.A.active!.energy).toEqual([{ iid: 'A-energy', printing: 'Lightning Energy SVE' }]);
    expect(after.players.A.hand).toEqual([]);
    expect(after.players.A.flags.energyAttachedThisTurn).toBe(true);

    // The opponent's board is untouched.
    expect(after.players.B).toEqual(before.players.B);
  });
});
