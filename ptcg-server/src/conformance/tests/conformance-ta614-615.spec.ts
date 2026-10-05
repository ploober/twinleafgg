import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-614: Metagross cri-061 Bounce Back — "Switch out your opponent's Active Pokémon to the Bench. (Your opponent
 * chooses the new Active Pokémon.)" The new-Active pick was raised to the attacker.
 * TA-615: Inteleon meg-142 Bring Down — "Choose a Pokémon in play (yours or your opponent's) that has the least HP
 * remaining, except for this Pokémon, and it is Knocked Out." The candidates were filtered on printed HP (the
 * CheckHpEffect was never reduced and damage was ignored), so every Pokémon with the same printed HP was offered.
 */

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = [], damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, 'sve-001').map(c => ({ ...c, faceUp: false }));
}
function game(a: PlayerState, b: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B', phase: 'main', outcome: 'ongoing', stadium: null, players: { A: a, B: b } };
}
const GRENINJA = 'twm-106';   // 310 HP

describe('TA-614: Bounce Back cri-061 — the opponent chooses the new Active', () => {
  it('with two Benched Pokémon the new-Active pick is asked of B, not A [TA-614]', () => {
    const res = step(game(
      player({ active: mon('a1', 'cri-061', cards('ae', 1, 'sve-008')), deck: cards('ad', 4, 'sve-001'), prizes: prizes('ap', 6) }),
      player({ active: mon('b1', GRENINJA), bench: [mon('bb1', GRENINJA), mon('bb2', GRENINJA)], deck: cards('bd', 4, 'sve-001'), prizes: prizes('bp', 6) })),
      [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Bounce Back' } as never]);
    expect(res.pending?.actor).toBe('B');
    expect((res.pending?.legalActions ?? []).map(a => (a as { target?: string }).target).sort()).toEqual(['bb1', 'bb2']);
  });
});

describe('TA-615: Bring Down meg-142 — only the Pokémon with the least HP remaining', () => {
  it('B\'s damaged Active is the only one with the least HP remaining: it is Knocked Out with no pick [TA-615]', () => {
    const res = step(game(
      player({ active: mon('a1', 'meg-142', cards('ae', 1, 'sve-003')), deck: cards('ad', 4, 'sve-001'), prizes: prizes('ap', 6) }),
      player({ active: mon('b1', GRENINJA, [], 110), bench: [mon('bb1', GRENINJA), mon('bb2', GRENINJA)], deck: cards('bd', 4, 'sve-001'), prizes: prizes('bp', 6) })),
      [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Bring Down' } as never]);
    expect(res.events.some(e => e.kind === 'ko' && (e as { target?: string }).target === 'b1')).toBe(true);
    expect((res.pending?.legalActions ?? []).some(a => a.type === 'choose')).toBe(false);
  });

  it('two Pokémon tie for the least HP remaining: exactly those two are offered [TA-615]', () => {
    const res = step(game(
      player({ active: mon('a1', 'meg-142', cards('ae', 1, 'sve-003')), deck: cards('ad', 4, 'sve-001'), prizes: prizes('ap', 6) }),
      player({ active: mon('b1', GRENINJA, [], 110), bench: [mon('bb1', GRENINJA, [], 110), mon('bb2', GRENINJA)], deck: cards('bd', 4, 'sve-001'), prizes: prizes('bp', 6) })),
      [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Bring Down' } as never]);
    expect((res.pending?.legalActions ?? []).filter(a => a.type === 'choose').map(a => (a as { target?: string }).target).sort()).toEqual(['b1', 'bb1']);
  });
});
