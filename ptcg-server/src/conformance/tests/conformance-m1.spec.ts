import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION
} from '../neutral-types';

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

const PSY = 'Psychic Energy SVE';
const WATER = 'Water Energy SVE';

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
      stack: [{ iid: 'A-active', printing: 'Ralts SIT' }],
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
          { iid: 'A-kirlia', printing: 'Kirlia SIT' },
          { iid: 'A-psy', printing: PSY },
        ],
        deck: [{ iid: 'A-d1', printing: WATER }],
        prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      B: emptyPlayer({
        active: {
          stack: [{ iid: 'B-active', printing: 'Ralts SIT' }],
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
      { actor: 'A', type: 'endTurn' },             // reconciled no-op (attack already ended the turn)
    ];

    const res = step(initial, actions);

    // ── response envelope ──
    expect(res.status).toBe('awaitingAction');
    expect(res.applied).toBe(4);
    // The attack auto-ended A's turn, so the quiescent menu now belongs to B (M5).
    expect(res.pending!.actor).toBe('B');
    expect(res.pending!.descriptor).toBe('main');

    // ── projection ──
    expect(res.state.players.A.active!.stack).toEqual([
      { iid: 'A-active', printing: 'Ralts SIT' },
      { iid: 'A-kirlia', printing: 'Kirlia SIT' },
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
      { kind: 'evolved', actor: 'A', card: 'Kirlia', pokemon: 'Ralts' },
      { kind: 'attachedEnergy', actor: 'A', card: 'Psychic Energy', pokemon: 'Kirlia' },
      { kind: 'usedAttack', actor: 'A', attack: 'Slap' },
      { kind: 'dealtDamage', actor: 'A', damage: 30, target: 'Ralts' },
      { kind: 'turnEnded', actor: 'A' },
      { kind: 'turnStarted', turn: 4 },
      { kind: 'drew', actor: 'B' },
    ]);
    // determinism: no wall-clock timestamp leaks into events
    expect(res.events.some(e => 'timestamp' in (e as object))).toBe(false);
  });

  it('Test B — drives attach/retreat/endTurn; explicit pass crosses the boundary', () => {
    const initial = base({
      A: emptyPlayer({
        active: {
          stack: [{ iid: 'A-active', printing: 'Ralts SIT' }],
          energy: [{ iid: 'A-pre', printing: PSY }],   // exactly retreat cost [C] -> prompt-free
          tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        bench: [{
          stack: [{ iid: 'A-bench0', printing: 'Ralts SIT' }],
          energy: [], tools: [], damage: 0, conditions: [], markers: markers(1),
        }],
        hand: [{ iid: 'A-psy', printing: PSY }],
        deck: [{ iid: 'A-d1', printing: WATER }],
        prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      B: emptyPlayer({
        active: {
          stack: [{ iid: 'B-active', printing: 'Ralts SIT' }],
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
      { actor: 'A', type: 'retreat', to: 0 },                                   // exact-energy retreat (A-pre discarded)
      { actor: 'A', type: 'endTurn' },                                          // real PassTurnAction
    ];

    const res = step(initial, actions);

    expect(res.status).toBe('awaitingAction');
    expect(res.applied).toBe(3);

    // the benched Ralts (with its freshly attached energy) is now active
    expect(res.state.players.A.active!.stack).toEqual([{ iid: 'A-bench0', printing: 'Ralts SIT' }]);
    expect(res.state.players.A.active!.energy).toEqual([{ iid: 'A-psy', printing: PSY }]);
    // the retreat cost was paid by discarding the previously-active Pokemon's energy
    expect(res.state.players.A.discard).toEqual([{ iid: 'A-pre', printing: PSY }]);
    expect(res.state.turn).toBe(4);
    expect(res.state.activePlayer).toBe('B');
    expect(res.state.players.B.hand.length).toBe(1);

    expect(res.events).toEqual([
      { kind: 'attachedEnergy', actor: 'A', card: 'Psychic Energy', pokemon: 'Ralts' },
      { kind: 'retreated', actor: 'A', from: 'Ralts', to: 'Ralts' },
      { kind: 'turnEnded', actor: 'A' },
      { kind: 'turnStarted', turn: 4 },
      { kind: 'drew', actor: 'B' },
    ]);
  });

  it('replays deterministically — identical events + state across two runs', () => {
    const initial = base({
      A: emptyPlayer({
        active: {
          stack: [{ iid: 'A-active', printing: 'Ralts SIT' }],
          energy: [{ iid: 'A-pre', printing: PSY }],
          tools: [], damage: 0, conditions: [], markers: markers(1),
        },
        hand: [{ iid: 'A-psy', printing: PSY }],
        deck: [{ iid: 'A-d1', printing: WATER }],
        prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      B: emptyPlayer({
        active: {
          stack: [{ iid: 'B-active', printing: 'Ralts SIT' }],
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

    const first = step(initial, actions);
    const second = step(initial, actions);
    expect(second.events).toEqual(first.events);
    expect(second.state).toEqual(first.state);
  });
});
