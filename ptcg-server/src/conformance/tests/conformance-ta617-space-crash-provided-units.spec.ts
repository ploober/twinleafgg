import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-617: Palkia ssp-136 Space Crash ("This attack does 40 damage for each Basic Energy attached to this Pokémon.")
 * counts the Energy the Basic Energy cards PROVIDE (#161, #2237, #2347). Under Meganium meg-010 Wild Growth each Basic
 * Grass Energy provides two Grass, so 2 Basic Grass + 1 Basic Water is 5 Basic Energy: 200. Twinleaf added one per card.
 * Control: without Meganium, 3 cards are 3 Energy: 120.
 */

const GRASS = 'sve-001';
const WATER = 'sve-003';
const DEFENDER = 'meg-181';   // Mega Latias ex, 280 HP, no Weakness

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, stack: string[], energy: CardRef[] = []): PokemonInPlay {
  return { stack: stack.map((printing, i) => ({ iid: `${iid}s${i}`, printing })), energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, GRASS).map(c => ({ ...c, faceUp: false }));
}
function board(meganium: boolean): NeutralState {
  const energy = [{ iid: 'a1e0', printing: GRASS }, { iid: 'a1e1', printing: GRASS }, { iid: 'a1e2', printing: WATER }];
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: mon('a1', ['ssp-136'], energy),
        bench: meganium ? [mon('ab1', ['asc-008', 'asc-009', 'meg-010'])] : [],
        deck: cards('ad', 6, GRASS), prizes: prizes('ap', 6),
      }),
      B: player({ active: mon('b1', [DEFENDER]), deck: cards('bd', 6, GRASS), prizes: prizes('bp', 6) }),
    },
  };
}

const attack = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Space Crash' } as never;

describe('TA-617: Palkia ssp-136 Space Crash counts the Basic Energy provided, not the cards', () => {
  it('Wild Growth: 2 Basic Grass (two each) + 1 Basic Water = 5: 200 [TA-617]', () => {
    expect(step(board(true), [attack]).state.players.B.active?.damage).toBe(200);
  });

  it('control: no Meganium, 3 cards = 3: 120 [TA-617]', () => {
    expect(step(board(false), [attack]).state.players.B.active?.damage).toBe(120);
  });
});
