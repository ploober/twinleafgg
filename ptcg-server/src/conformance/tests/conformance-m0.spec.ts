import { importState } from '../state-adapter';
import { projectGame, applyActions } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';

// Boards carry the contract's set-number printings (sit-067, sve-004, …); import accepts these and the
// projection emits them, so a round-trip is a true identity.
const RALTS = toPrinting(getCardByName('Ralts SIT'));
const LIGHTNING = toPrinting(getCardByName('Lightning Energy SVE'));
const WATER = toPrinting(getCardByName('Water Energy SVE'));
const GENERATOR = toPrinting(getCardByName('Electric Generator PAF'));

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
      stack: [{ iid: 'A-active', printing: RALTS }],
      energy: [
        { iid: 'A-e1', printing: LIGHTNING },
        { iid: 'A-e2', printing: WATER },
      ],
      tools: [],
      damage: 30,
      conditions: ['poisoned'],
      poisonDamagePerTurn: 20,
      markers: defaultMarkers(1),
    };

    const benchA: PokemonInPlay = {
      stack: [{ iid: 'A-bench0', printing: RALTS }],
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
          hand: [{ iid: 'A-h1', printing: GENERATOR }],
          deck: [
            { iid: 'A-d1', printing: LIGHTNING },
            { iid: 'A-d2', printing: WATER },
          ],
          discard: [{ iid: 'A-x1', printing: WATER }],
          lostZone: [],
          prizes: [
            { iid: 'A-p1', printing: WATER, faceUp: false },
            { iid: 'A-p2', printing: LIGHTNING, faceUp: false },
          ],
          flags: defaultFlags(),
        },
        B: {
          active: {
            stack: [{ iid: 'B-active', printing: RALTS }],
            energy: [],
            tools: [],
            damage: 0,
            conditions: [],
            markers: defaultMarkers(0),
          },
          bench: [],
          hand: [],
          deck: [{ iid: 'B-d1', printing: WATER }],
          discard: [],
          lostZone: [],
          prizes: [{ iid: 'B-p1', printing: WATER, faceUp: false }],
          flags: defaultFlags(),
        },
      },
      activeEffects: [],
    };

    const game = importState(initial);
    const projected = projectGame(game);

    // CF-42 + CF-48 — TWO optional fields are deliberately NOT round-trip-symmetric, for ONE reason.
    //
    // This comment used to say `resolving` was the only one, and drew the contrast with
    // `prizesTaken`: `[]` vs ABSENT differ for `resolving` ("nothing is staged" vs "this engine does
    // not model the mid-resolution zone"), while `0` vs ABSENT were the same board and so `0` could
    // be omitted. **The second half of that was wrong, and it is the reason CF-48's comparison sat
    // switched off for two weeks.** Rotomancer always emits `prizesTaken`; we omitted it while zero;
    // so on every board where no Prize had been taken the two engines shipped the same board on
    // different wire, and anything keyed on presence split them. Same board, different wire is
    // exactly the `resolving` argument — it applies to a scalar no differently than to an array.
    //
    // So the projection ADDS both fields to a hand-authored board that need not carry either, and
    // ingest tolerates the absence of both.
    const withProjectionOnlyFields = {
      ...initial,
      players: {
        A: { ...initial.players.A, resolving: [],
          flags: { ...initial.players.A.flags, prizesTaken: 0 } },
        B: { ...initial.players.B, resolving: [],
          flags: { ...initial.players.B.flags, prizesTaken: 0 } },
      },
    };
    expect(projected).toEqual(withProjectionOnlyFields);

    // Idempotence: re-importing the projection and projecting again is stable. This is the property
    // that actually matters — a projection fed back in must be a fixed point, even though the FIRST
    // projection of a hand-authored board is not identity.
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
            stack: [{ iid: 'A-active', printing: RALTS }],
            energy: [],
            tools: [],
            damage: 0,
            conditions: [],
            markers: defaultMarkers(1),
          },
          hand: [{ iid: 'A-energy', printing: LIGHTNING }],
          deck: [{ iid: 'A-d1', printing: WATER }],
          prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
        }),
        B: emptyPlayer({
          active: {
            stack: [{ iid: 'B-active', printing: RALTS }],
            energy: [],
            tools: [],
            damage: 0,
            conditions: [],
            markers: defaultMarkers(1),
          },
          deck: [{ iid: 'B-d1', printing: WATER }],
          prizes: [{ iid: 'B-p1', printing: WATER, faceUp: false }],
        }),
      },
    };

    const game = importState(initial);

    // Precondition: energy is in hand, not yet attached.
    const before = projectGame(game);
    expect(before.players.A.active!.energy).toEqual([]);
    expect(before.players.A.hand).toEqual([{ iid: 'A-energy', printing: LIGHTNING }]);
    expect(before.players.A.flags.energyAttachedThisTurn).toBe(false);

    applyActions(game, [
      { actor: 'A', type: 'attachEnergy', card: 'A-energy', target: 'A-active' },
    ]);

    expect(game.handler.isBlocked()).toBe(false);

    const after = projectGame(game);
    // The energy moved hand -> the active Pokemon's energy, and the once-per-turn gate flipped.
    expect(after.players.A.active!.energy).toEqual([{ iid: 'A-energy', printing: LIGHTNING }]);
    expect(after.players.A.hand).toEqual([]);
    expect(after.players.A.flags.energyAttachedThisTurn).toBe(true);

    // The opponent's board is untouched.
    expect(after.players.B).toEqual(before.players.B);
  });
});
