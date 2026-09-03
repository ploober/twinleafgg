import { step } from '../driver';
import { stepChecked } from './support/invariants';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';
import { toPrinting } from '../printing';
import { getCardByName } from '../../sets/tests/test-helpers';

// ── builders ───────────────────────────────────────────────────────────────

function markers(playedOnTurn = 0): PokemonMarkers {
  return {
    playedOnTurn,
    movedToActiveOnTurn: -1,
    damageTakenThisTurn: 0,
    abilitiesUsedThisTurn: [],
    cannotAttackNextTurn: false,
  };
}

function flags(overrides: Partial<PlayerFlags> = {}): PlayerFlags {
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
    flags: flags(),
    ...overrides,
  };
}

// Set-number printings (the contract identity); events still carry bare display names ("Ralts").
const PSY = toPrinting(getCardByName('Psychic Energy SVE'));
const WATER = toPrinting(getCardByName('Water Energy SVE'));
const RALTS = toPrinting(getCardByName('Ralts SIT'));
const KIRLIA = toPrinting(getCardByName('Kirlia SIT'));

function base(players: { A: PlayerState; B: PlayerState }): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION,
    turn: 3,
    activePlayer: 'A',
    firstPlayer: 'A',
    phase: 'main',
    outcome: 'ongoing',
    stadium: null,
    players,
  };
}

describe('Conformance M1 — action mapper + event mapper (a full no-prompt turn)', () => {

  it('Test A — drives bench/evolve/attach/attack/endTurn; attack auto-ends the turn', () => {
    const active: PokemonInPlay = {
      stack: [{ iid: 'A-active', printing: RALTS }],
      energy: [{ iid: 'A-pre', printing: PSY }],   // pre-loaded so Kirlia can pay [P,C] after one attach
      tools: [],
      damage: 0,
      conditions: [],
      markers: markers(1),                          // in play since turn 1 -> evolvable at turn 3
    };

    const initial = base({
      A: emptyPlayer({
        active,
        hand: [
          { iid: 'A-kirlia', printing: KIRLIA },
          { iid: 'A-psy', printing: PSY },
        ],
        deck: [{ iid: 'A-d1', printing: WATER }],
        prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      B: emptyPlayer({
        active: {
          stack: [{ iid: 'B-active', printing: RALTS }],
          energy: [], tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        deck: [
          { iid: 'B-d1', printing: WATER },
          { iid: 'B-d2', printing: WATER },
        ],
        prizes: [{ iid: 'B-p1', printing: WATER, faceUp: false }],
      }),
    });

    const actions: NeutralAction[] = [
      { actor: 'A', type: 'evolve', card: 'A-kirlia', target: 'A-active' },
      { actor: 'A', type: 'attachEnergy', card: 'A-psy', target: 'A-active' },
      { actor: 'A', type: 'declareAttack', source: 'A-active', name: 'Slap' },
      // TA-129 / CF-12 (2026-07-24): this trailing `endTurn` used to be ABSORBED as a silent no-op.
      // The attack already crossed the turn boundary, so A is no longer the active player and this is
      // an action nobody offered — CF-12 deprecates that R1 leniency and requires `invalidAction`.
      { actor: 'A', type: 'endTurn' },
    ];

    const res = step(initial, actions);

    // ── response envelope ──
    expect(res.status).toBe('invalidAction');
    expect(res.applied).toBe(3);           // the first three applied; the fourth is rejected
    expect(res.pending).toBeNull();

    // ── projection ──
    expect(res.state.players.A.active!.stack).toEqual([
      { iid: 'A-active', printing: RALTS },
      { iid: 'A-kirlia', printing: KIRLIA },
    ]);
    expect(res.state.players.A.active!.energy).toEqual([
      { iid: 'A-pre', printing: PSY },
      { iid: 'A-psy', printing: PSY },
    ]);
    expect(res.state.players.A.hand).toEqual([]);
    expect(res.state.players.B.active!.damage).toBe(30);   // Magical Shot 30, no weakness, no KO
    expect(res.state.turn).toBe(4);
    expect(res.state.activePlayer).toBe('B');
    expect(res.state.players.B.hand.length).toBe(1);       // B's mandatory draw
    expect(res.state.players.B.deck.length).toBe(1);

    // ── events ──
    expect(res.events).toEqual([
      { kind: 'evolved', player: 'A', card: 'Kirlia', pokemon: 'A-active' },        // CF-60: pokemon is the basic iid (Ralts->Kirlia share it), not a name
      { kind: 'energyAttached', player: 'A', card: 'Psychic Energy', pokemon: 'A-active' },
      { kind: 'attackUsed', player: 'A', attack: 'Slap' },
      { kind: 'damaged', player: 'B', target: 'B-active', hp: 30 }, // CF-60: target is B's active Ralts' basic iid
      { kind: 'turnEnded', player: 'A' },
      { kind: 'turnStarted', player: 'B' },
      { kind: 'draw', player: 'B', count: 1 },          // B's mandatory start-of-turn draw
    ]);
    // determinism: no wall-clock timestamp leaks into events
    expect(res.events.some(e => 'timestamp' in (e as object))).toBe(false);
  });

  it('Test B — drives attach/retreat/endTurn; explicit pass crosses the boundary', () => {
    const initial = base({
      A: emptyPlayer({
        active: {
          stack: [{ iid: 'A-active', printing: RALTS }],
          energy: [{ iid: 'A-pre', printing: PSY }],   // covers retreat cost [C]; paying always prompts
          tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        bench: [{
          stack: [{ iid: 'A-bench0', printing: RALTS }],
          energy: [], tools: [], damage: 0, conditions: [], markers: markers(1),
        }],
        hand: [{ iid: 'A-psy', printing: PSY }],
        deck: [{ iid: 'A-d1', printing: WATER }],
        prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      B: emptyPlayer({
        active: {
          stack: [{ iid: 'B-active', printing: RALTS }],
          energy: [], tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        deck: [
          { iid: 'B-d1', printing: WATER },
          { iid: 'B-d2', printing: WATER },
        ],
        prizes: [{ iid: 'B-p1', printing: WATER, faceUp: false }],
      }),
    });

    const actions: NeutralAction[] = [
      { actor: 'A', type: 'attachEnergy', card: 'A-psy', target: 'A-bench0' },  // attach to the retreat target
      { actor: 'A', type: 'retreat', to: 0 },                                   // paying the cost always prompts
      { actor: 'A', type: 'discard', target: 'A-pre' },                         // the retreat-cost discard pick
      { actor: 'A', type: 'endTurn' },                                          // real PassTurnAction
    ] as NeutralAction[];

    const res = step(initial, actions);

    expect(res.status).toBe('awaitingAction');
    expect(res.applied).toBe(4);

    // the benched Ralts (with its freshly attached energy) is now active
    expect(res.state.players.A.active!.stack).toEqual([{ iid: 'A-bench0', printing: RALTS }]);
    expect(res.state.players.A.active!.energy).toEqual([{ iid: 'A-psy', printing: PSY }]);
    // the retreat cost was paid by discarding the previously-active Pokemon's energy
    expect(res.state.players.A.discard).toEqual([{ iid: 'A-pre', printing: PSY }]);
    expect(res.state.turn).toBe(4);
    expect(res.state.activePlayer).toBe('B');
    expect(res.state.players.B.hand.length).toBe(1);

    expect(res.events).toEqual([
      { kind: 'energyAttached', player: 'A', card: 'Psychic Energy', pokemon: 'A-bench0' }, // CF-60: basic iid, not a name
      { kind: 'retreated', player: 'A', to: 'Ralts' },
      { kind: 'turnEnded', player: 'A' },
      { kind: 'turnStarted', player: 'B' },
      { kind: 'draw', player: 'B', count: 1 },
    ]);
  });

  it('replays deterministically — identical events + state across two runs', () => {
    const initial = base({
      A: emptyPlayer({
        active: {
          stack: [{ iid: 'A-active', printing: RALTS }],
          energy: [{ iid: 'A-pre', printing: PSY }],
          tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        hand: [{ iid: 'A-psy', printing: PSY }],
        deck: [{ iid: 'A-d1', printing: WATER }],
        prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      B: emptyPlayer({
        active: {
          stack: [{ iid: 'B-active', printing: RALTS }],
          energy: [], tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        deck: [{ iid: 'B-d1', printing: WATER }, { iid: 'B-d2', printing: WATER }],
        prizes: [{ iid: 'B-p1', printing: WATER, faceUp: false }],
      }),
    });

    const actions: NeutralAction[] = [
      { actor: 'A', type: 'attachEnergy', card: 'A-psy', target: 'A-active' },
      { actor: 'A', type: 'endTurn' },
    ];

    const first = stepChecked(initial, actions);  // also asserts invariants + import determinism
    const second = stepChecked(initial, actions);
    expect(second.events).toEqual(first.events);
    expect(second.state).toEqual(first.state);
  });
});
