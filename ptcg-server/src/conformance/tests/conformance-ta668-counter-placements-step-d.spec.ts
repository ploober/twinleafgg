import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-668 / B.98 (owner 2026-10-07, extends B.89 (1)): where an attack puts damage counters on Pokemon the attacker
 * chooses is a Step-D choice: the counters are picked before the damage and placed after it (B.89 (4); #649, #543),
 * and between picks nothing is placed. Phantom Dive asc-160: "Put 6 damage counters on your opponent's Benched Pokemon
 * in any way you like." (200 damage). Twinleaf dealt the 200 first, then asked the counters (TA-128's AFTER_ATTACK).
 */

const METAL = 'sve-008';
const PSYCHIC = 'sve-005';
const FIRE = 'sve-002';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, METAL).map(c => ({ ...c, faceUp: false }));
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon([{ iid: 'a1s0', printing: 'asc-158' }, { iid: 'a1s1', printing: 'asc-159' }, { iid: 'a1s2', printing: 'asc-160' }],
          [{ iid: 'a1e0', printing: FIRE }, { iid: 'a1e1', printing: PSYCHIC }]),
        deck: cards('ad', 6, METAL), prizes: prizes('ap', 6),
      }),
      B: player({
        active: mon([{ iid: 'b1s0', printing: 'meg-181' }]),
        bench: [mon([{ iid: 'bb1s0', printing: 'asc-004' }]), mon([{ iid: 'bb2s0', printing: 'asc-004' }])],
        deck: cards('bd', 6, METAL), prizes: prizes('bp', 6),
      }),
    },
  };
}
const dive = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Phantom Dive' } as never;
const place = (target: string) => ({ actor: 'A', type: 'placeCounter', target } as never);
const damaged = (events: NeutralEvent[]) => events.filter(e => e.kind === 'damaged')
  .map(e => `${(e as { target: string }).target}:${(e as { hp: number }).hp}`);

describe('TA-668 / B.98: Phantom Dive picks its counters before the 200 and places them after it', () => {
  it('declareAttack pends the counter pick with nothing damaged yet [TA-668]', () => {
    const r = step(board(), [dive]);
    expect(r.pending?.legalActions.every(a => a.type === 'placeCounter')).toBe(true);
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(damaged(r.events)).toEqual([]);
  });

  it('between picks nothing is placed [TA-668]', () => {
    const r = step(board(), [dive, place('bb1s0'), place('bb2s0'), place('bb1s0')]);
    expect(r.state.players.B.active?.damage).toBe(0);
    expect(r.state.players.B.bench.map(b => b.damage)).toEqual([0, 0]);
    expect(damaged(r.events)).toEqual([]);
  });

  it('after the sixth pick: the 200 first, then the counters (bb1 40, bb2 20) [TA-668]', () => {
    const r = step(board(), [dive, place('bb1s0'), place('bb2s0'), place('bb1s0'), place('bb1s0'), place('bb2s0'), place('bb1s0')]);
    expect(r.state.players.B.bench.map(b => b.damage)).toEqual([40, 20]);
    const d = damaged(r.events);
    expect(d[0]).toBe('b1s0:200');
    expect(d.slice(1).sort()).toEqual(['bb1s0:40', 'bb2s0:20'].sort());
  });
});
