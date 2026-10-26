import { deriveEvents } from '../events';
import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, NeutralEvent, NeutralAction, SCHEMA_VERSION,
} from '../neutral-types';
import { GameLog } from '../../game/game-message';
import { StateLog } from '../../game/store/state/state-log';

/**
 * B.134 (owner 2026-10-25, contract v0.16.1): an event states each fact once. `damaged`, `ko`, `healed`, `countersMoved`,
 * `energyAttached`, `toolAttached`, `evolved` and `promotedFromBench` name a card (a basic iid) and the side is that card's
 * owner, so they carry no `player`. Every other kind keeps `player` (draw, turnStarted, turnEnded, attackUsed ...).
 * Twinleaf's adapter emitted `player` on all eight. The derivation is driven directly on crafted before/after boards
 * (one cell per kind) and once end to end (evolve, attach, attack: m1's board).
 * Mutation guard: put `player` back on any one emit site (events.ts / event-mapper.ts) and its cell reds.
 */

const BASIC = 'sve-001';
const FIRE = 'sve-002';
const TOOL = 'svi-169';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(iid: string, over: Partial<PokemonInPlay> = {}): PokemonInPlay {
  return { stack: [{ iid, printing: BASIC }], energy: [], tools: [], damage: 0, conditions: [], markers: markers(), ...over };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const NAMES = new Map<string, string>([
  ['a1', 'Pikachu'], ['a1x', 'Raichu'], ['b1', 'Ralts'], ['b2', 'Kirlia'], ['a1e0', 'Fire Energy'], ['a1t0', 'Defiance Band'],
]);
const log = (message: string, params: Record<string, unknown>): StateLog => ({ message, params } as unknown as StateLog);
const ofKind = (evs: NeutralEvent[], kind: string): object[] => evs.filter(e => e.kind === kind) as object[];

describe('B.134 — the eight card-naming event kinds carry no player', () => {
  it('damaged: {target, hp}, no player [B.134 damaged]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: pip('b1') }));
    const after = board(player({ active: pip('a1') }), player({ active: pip('b1', { damage: 30 }) }));
    expect(ofKind(deriveEvents(before, after, []), 'damaged')).toEqual([{ kind: 'damaged', target: 'b1', hp: 30 }]);
  });

  it('ko: {target}, no player [B.134 ko]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: pip('b1', { damage: 50 }), bench: [pip('b2')] }));
    const after = board(player({ active: pip('a1') }), player({ active: null, bench: [pip('b2')], discard: [{ iid: 'b1', printing: BASIC }] }));
    const l = log(GameLog.LOG_POKEMON_KO, { name: 'Ralts' });
    expect(ofKind(deriveEvents(before, after, [l]), 'ko')).toEqual([{ kind: 'ko', target: 'b1' }]);
  });

  it('healed: {target, hp}, no player [B.134 healed]', () => {
    const before = board(player({ active: pip('a1', { damage: 50 }) }), player({ active: pip('b1') }));
    const after = board(player({ active: pip('a1', { damage: 20 }) }), player({ active: pip('b1') }));
    expect(ofKind(deriveEvents(before, after, []), 'healed')).toEqual([{ kind: 'healed', target: 'a1', hp: 30 }]);
  });

  it('energyAttached (logged): {card, pokemon}, no player [B.134 energyAttached logged]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: pip('b1') }));
    const after = board(player({ active: pip('a1', { energy: [{ iid: 'a1e0', printing: FIRE }] }) }), player({ active: pip('b1') }));
    const l = log(GameLog.LOG_PLAYER_ATTACHES_CARD, { name: 'A', card: 'Fire Energy', pokemon: 'Pikachu' });
    expect(ofKind(deriveEvents(before, after, [l], undefined, undefined, NAMES), 'energyAttached'))
      .toEqual([{ kind: 'energyAttached', card: 'Fire Energy', pokemon: 'a1' }]);
  });

  it('energyAttached (state diff, TA-412): no player [B.134 energyAttached diff]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: pip('b1') }));
    const after = board(player({ active: pip('a1', { energy: [{ iid: 'a1e0', printing: FIRE }] }) }), player({ active: pip('b1') }));
    expect(ofKind(deriveEvents(before, after, [], undefined, undefined, NAMES), 'energyAttached'))
      .toEqual([{ kind: 'energyAttached', card: 'Fire Energy', pokemon: 'a1' }]);
  });

  it('toolAttached (state diff, TA-413): no player [B.134 toolAttached]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: pip('b1') }));
    const after = board(player({ active: pip('a1', { tools: [{ iid: 'a1t0', printing: TOOL }] }) }), player({ active: pip('b1') }));
    expect(ofKind(deriveEvents(before, after, [], undefined, undefined, NAMES), 'toolAttached'))
      .toEqual([{ kind: 'toolAttached', card: 'Defiance Band', pokemon: 'a1' }]);
  });

  it('evolved (logged): {card, pokemon}, no player [B.134 evolved]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: pip('b1') }));
    const evolvedStack: CardRef[] = [{ iid: 'a1', printing: BASIC }, { iid: 'a1x', printing: BASIC }];
    const after = board(player({ active: pip('a1', { stack: evolvedStack }) }), player({ active: pip('b1') }));
    const l = log(GameLog.LOG_PLAYER_EVOLVES_POKEMON, { name: 'A', card: 'Raichu', pokemon: 'Pikachu' });
    expect(ofKind(deriveEvents(before, after, [l], undefined, undefined, NAMES), 'evolved'))
      .toEqual([{ kind: 'evolved', card: 'Raichu', pokemon: 'a1' }]);
  });

  it('promotedFromBench: {pokemon}, no player [B.134 promotedFromBench]', () => {
    const before = board(player({ active: pip('a1') }), player({ active: null, bench: [pip('b2')] }));
    const after = board(player({ active: pip('a1') }), player({ active: pip('b2') }));
    expect(ofKind(deriveEvents(before, after, []), 'promotedFromBench')).toEqual([{ kind: 'promotedFromBench', pokemon: 'b2' }]);
  });

  // End to end (m1 Test A's board): evolve, attach from hand, attack. The card-naming kinds carry no player; attackUsed,
  // turnEnded, turnStarted and draw keep theirs.
  it('a step: evolved / energyAttached / damaged carry no player; attackUsed / turn / draw keep it [B.134 step]', () => {
    const RALTS = 'sit-067', KIRLIA = 'sit-068', PSY = 'sve-005', WATER = 'sve-003';
    const res = step(board(
      player({
        active: { stack: [{ iid: 'A-active', printing: RALTS }], energy: [{ iid: 'A-pre', printing: PSY }], tools: [], damage: 0, conditions: [], markers: markers() },
        hand: [{ iid: 'A-kirlia', printing: KIRLIA }, { iid: 'A-psy', printing: PSY }],
        deck: [{ iid: 'A-d1', printing: WATER }], prizes: [{ iid: 'A-p1', printing: WATER, faceUp: false }],
      }),
      player({
        active: { stack: [{ iid: 'B-active', printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() },
        deck: [{ iid: 'B-d1', printing: WATER }, { iid: 'B-d2', printing: WATER }], prizes: [{ iid: 'B-p1', printing: WATER, faceUp: false }],
      }),
    ), [
      { actor: 'A', type: 'evolve', card: 'A-kirlia', target: 'A-active' },
      { actor: 'A', type: 'attachEnergy', card: 'A-psy', target: 'A-active' },
      { actor: 'A', type: 'declareAttack', source: 'A-active', name: 'Slap' },
    ] as NeutralAction[]);
    expect(res.events.filter(e => e.kind !== 'moved')).toEqual([
      { kind: 'evolved', card: 'Kirlia', pokemon: 'A-active' },
      { kind: 'energyAttached', card: 'Psychic Energy', pokemon: 'A-active' },
      { kind: 'attackUsed', player: 'A', attack: 'Slap' },
      { kind: 'damaged', target: 'B-active', hp: 30 },
      { kind: 'turnEnded', player: 'A' },
      { kind: 'turnStarted', player: 'B' },
      { kind: 'draw', player: 'B', count: 1 },
    ] as NeutralEvent[]);
  });
});
