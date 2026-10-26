import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, NeutralEvent, NeutralAction, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-774 (contract 0.16.0, B.123 / CF-106; B.134: no player) — when damage counters move, the adapter emits
 * countersMoved {source, target, hp, landed} (basic iids; hp taken off the source, landed put on the target), one per
 * (source, target) per step, and the move is never a `damaged` / `healed`. A target protected from the effect (Battle
 * Cage pfl-085 on a Benched Pokémon) gets landed 0 while the counters still leave the source (#2257). Twinleaf emitted
 * nothing (TA-767 held the moves and deferred the event until the contract had the kind).
 * B.133 (owner 2026-10-25): every effect that moves counters, an Ability as well as an attack, chooses all its moves
 * first and moves them together. Adrena-Brain twm-095 (an Ability) projected each counter as moved at its pick; it now
 * holds them, as TA-767 does for Strange Hacking twm-082 and Damage Collection tef-107.
 * Mutation guards: drop the countersMoved derivation in events.ts -> the event cells red; restore the per-pick
 * projection in remove-damage.ts fixupProjection -> the B.133 pause cells red.
 */

const METAL = 'sve-008', DARK = 'sve-007', PSYCHIC = 'sve-005', FILLER = 'meg-100';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function mon(iid: string, printing: string, damage = 0, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage, conditions: [], markers: markers() };
}
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: METAL }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6).map(c => ({ ...c, faceUp: false }));
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return { active: null, bench: [], hand: [], deck: cards(`${tag}d`, 6), discard: [], lostZone: [], prizes: prizes(`${tag}p`), flags: flags(), ...over };
}
function base(a: Partial<PlayerState>, b: Partial<PlayerState>, stadium: NeutralState['stadium'] = null): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
    stadium, players: { A: player('a', a), B: player('b', b) },
  } as NeutralState;
}
const choose = (target: string) => ({ actor: 'A', type: 'choose', target } as unknown as NeutralAction);
const place = (target: string) => ({ actor: 'A', type: 'placeCounter', target } as unknown as NeutralAction);
const stop = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;
const moves = (r: ReturnType<typeof step>): object[] => r.events.filter(e => (e.kind as string) === 'countersMoved') as object[];
const kinds = (r: ReturnType<typeof step>, k: string): NeutralEvent[] => r.events.filter(e => e.kind === k);
const dmg = (r: ReturnType<typeof step>) => {
  const s = (p: PlayerState) => [p.active?.damage, ...p.bench.map(b => b.damage)];
  return { A: s(r.state.players.A), B: s(r.state.players.B) };
};

// Munkidori twm-095 Adrena-Brain: "Once during your turn, if this Pokémon has any [D] Energy attached, you may move up to
// 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon."
describe('TA-774 / B.133 — Adrena-Brain twm-095 (an Ability) moves its counters together and emits countersMoved', () => {
  const board = () => base({ active: mon('a1', 'twm-095', 30, [{ iid: 'a1e0', printing: DARK }]) }, { active: mon('b1', FILLER) });
  const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Adrena-Brain' } as unknown as NeutralAction;

  it('the board is unchanged while the moves are being chosen (B.133) [TA-774 twm-095 held]', () => {
    const r0 = step(board(), [use]);
    expect(r0.pending?.actor).toBe('A');
    expect(dmg(r0)).toEqual({ A: [30], B: [0] });
    const r1 = step(board(), [use, choose('a1')]);
    expect(r1.pending?.actor).toBe('A');
    expect(dmg(r1)).toEqual({ A: [30], B: [0] });
    expect(moves(r1)).toEqual([]);
  });
  it('all three moved: A 30 -> 0, B 0 -> 30, one countersMoved {a1, b1, 30, 30}, no player, no damaged / healed [TA-774 twm-095]', () => {
    const r = step(board(), [use, choose('a1'), choose('a1')]);
    expect(r.status).toBe('awaitingAction');
    expect(dmg(r)).toEqual({ A: [0], B: [30] });
    expect(moves(r)).toEqual([{ kind: 'countersMoved', source: 'a1', target: 'b1', hp: 30, landed: 30 }]);
    expect(kinds(r, 'damaged')).toEqual([]);
    expect(kinds(r, 'healed')).toEqual([]);
  });
  it('the stop after one: countersMoved {a1, b1, 10, 10} [TA-774 twm-095 stop]', () => {
    const r = step(board(), [use, stop]);
    expect(dmg(r)).toEqual({ A: [20], B: [10] });
    expect(moves(r)).toEqual([{ kind: 'countersMoved', source: 'a1', target: 'b1', hp: 10, landed: 10 }]);
    expect(kinds(r, 'damaged')).toEqual([]);
  });
});

// Battle Cage pfl-085: "Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's)
// by effects of attacks and Abilities from the opponent's Pokémon." (#2257: moved counters "just vanish from play").
describe('TA-774 — a protected target gets landed 0; the counters still leave the source', () => {
  const board = () => base(
    { active: mon('a1', 'twm-095', 30, [{ iid: 'a1e0', printing: DARK }]) },
    { active: mon('b1', FILLER), bench: [mon('bb1', FILLER)] },
    { iid: 'stad0', printing: 'pfl-085', owner: 'B' } as never);
  const use = { actor: 'A', type: 'useAbility', source: 'a1', ability: 'Adrena-Brain' } as unknown as NeutralAction;

  it('one counter to the Benched Pokémon under Battle Cage: held at the pause (B.133) [TA-774 pfl-085 held]', () => {
    const r = step(board(), [use, place('bb1')]);
    expect(r.pending?.actor).toBe('A');
    expect(dmg(r)).toEqual({ A: [30], B: [0, 0] });
  });
  it('at the close: A 30 -> 20, the Bench stays 0, countersMoved {a1, bb1, 10, landed 0} [TA-774 pfl-085]', () => {
    const r = step(board(), [use, place('bb1'), stop]);
    expect(dmg(r)).toEqual({ A: [20], B: [0, 0] });
    expect(moves(r)).toEqual([{ kind: 'countersMoved', source: 'a1', target: 'bb1', hp: 10, landed: 0 }]);
    expect(kinds(r, 'healed')).toEqual([]);
    expect(kinds(r, 'damaged')).toEqual([]);
  });
  it('control: to the Active, landed 10 [TA-774 pfl-085 control]', () => {
    const r = step(board(), [use, place('b1'), stop]);
    expect(moves(r)).toEqual([{ kind: 'countersMoved', source: 'a1', target: 'b1', hp: 10, landed: 10 }]);
  });
});

const opp = () => ({ active: mon('b1s0', FILLER, 20), bench: [mon('bb1s0', FILLER, 10), mon('bb2s0', FILLER, 30)] });

// Strange Hacking twm-082: "... You may move any number of damage counters from your opponent's Pokémon to their other
// Pokémon in any way you like."
describe('TA-774 — Strange Hacking twm-082 (Alakazam) emits countersMoved per (source, target)', () => {
  const board = () => base({ active: mon('a1s0', 'twm-082', 0, [{ iid: 'a1e0', printing: PSYCHIC }]) }, opp());
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Strange Hacking' } as unknown as NeutralAction;

  it('one move b1s0 -> bb1s0: countersMoved {b1s0, bb1s0, 10, 10}, no damaged / healed [TA-774 twm-082]', () => {
    const r = step(board(), [declare, choose('b1s0'), place('bb1s0'), stop]);
    expect(dmg(r).B).toEqual([10, 20, 30]);
    expect(moves(r)).toEqual([{ kind: 'countersMoved', source: 'b1s0', target: 'bb1s0', hp: 10, landed: 10 }]);
    expect(kinds(r, 'damaged')).toEqual([]);
    expect(kinds(r, 'healed')).toEqual([]);
  });
  it('three moves over two pairs: one event per (source, target), summed [TA-774 twm-082 pairs]', () => {
    const r = step(board(), [declare, choose('b1s0'), place('bb1s0'), choose('b1s0'), place('bb1s0'), choose('bb2s0'), place('b1s0'), stop]);
    expect(dmg(r).B).toEqual([10, 30, 20]);
    expect(moves(r)).toEqual([
      { kind: 'countersMoved', source: 'b1s0', target: 'bb1s0', hp: 20, landed: 20 },
      { kind: 'countersMoved', source: 'bb2s0', target: 'b1s0', hp: 10, landed: 10 },
    ]);
    expect(kinds(r, 'damaged')).toEqual([]);
    expect(kinds(r, 'healed')).toEqual([]);
  });
});

// Damage Collection tef-107: "Move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon."
describe('TA-774 — Damage Collection tef-107 (Sableye) emits countersMoved', () => {
  const board = () => base({ active: mon('a1s0', 'tef-107', 0, [{ iid: 'a1e0', printing: DARK }, { iid: 'a1e1', printing: DARK }]) }, opp());
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Damage Collection' } as unknown as NeutralAction;

  it('two Benched sources to the Active: {bb1s0, b1s0, 10, 10} and {bb2s0, b1s0, 20, 20}, no damaged [TA-774 tef-107]', () => {
    const r = step(board(), [declare, choose('bb1s0'), choose('bb2s0'), choose('bb2s0'), stop]);
    expect(dmg(r).B).toEqual([50, 0, 10]);
    expect(moves(r)).toEqual([
      { kind: 'countersMoved', source: 'bb1s0', target: 'b1s0', hp: 10, landed: 10 },
      { kind: 'countersMoved', source: 'bb2s0', target: 'b1s0', hp: 20, landed: 20 },
    ]);
    expect(kinds(r, 'damaged')).toEqual([]);
    expect(kinds(r, 'healed')).toEqual([]);
  });
});
