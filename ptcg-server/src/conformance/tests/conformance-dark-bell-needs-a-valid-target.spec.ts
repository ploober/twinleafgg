import { step } from '../driver';
import { NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Compendium #2418 (Pitch Black FAQ): "Can I use Dark Bell if both Active Pokemon are {D} type and/or Confused? — No, you
 * cannot. You cannot play the card if there are no valid targets." Dark Bell pbl-075: "Both Active non-[D] Pokémon are now
 * Confused." A valid target is an Active Pokémon that is not [D] and not already Confused.
 */

const GRASS = 'sve-001';
const THIEVUL = 'pbl-054';   // [D]
const KINGAMBIT = 'asc-148'; // [M]
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, confused = false): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: confused ? ['confused'] : [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } } as PokemonInPlay;
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function side(tag: string, active: PokemonInPlay, hand: string[]): PlayerState {
  return { active, bench: [], hand: hand.map((printing, i) => ({ iid: `${tag}h${i}`, printing })),
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(a: PokemonInPlay, b: PokemonInPlay): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main',
    outcome: 'ongoing', stadium: null, players: { A: side('a', a, ['pbl-075']), B: side('b', b, []) } };
}
const offered = (b: NeutralState) => (step(b, []).pending?.legalActions ?? []).some(x => (x as { card?: string }).card === 'ah0');

describe('Dark Bell needs a valid target (#2418)', () => {
  it('A\'s Active is [D] and B\'s Active is already Confused: not playable [TA-794 pbl-075 mixed]', () => {
    expect(offered(board(mon('a1', THIEVUL), mon('b1', KINGAMBIT, true)))).toBe(false);
  });
  it('A\'s Active is Confused and B\'s Active is [D]: not playable [TA-794 pbl-075 mixed-mirror]', () => {
    expect(offered(board(mon('a1', KINGAMBIT, true), mon('b1', THIEVUL)))).toBe(false);
  });
  it('control: both [D], not playable; one plain non-[D] Active, playable [TA-794 pbl-075 control]', () => {
    expect(offered(board(mon('a1', THIEVUL), mon('b1', THIEVUL)))).toBe(false);
    expect(offered(board(mon('a1', THIEVUL), mon('b1', KINGAMBIT)))).toBe(true);
  });
});
