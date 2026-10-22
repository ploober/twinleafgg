import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-744 / CF-14: Moonlit Hill paf-081 ("Once during each player's turn, that player may discard a Basic [P] Energy card
 * from their hand in order to heal 30 damage from each of their Pokémon."). Using the Stadium is the "may"; the discard is
 * its price. With one Basic [P] Energy in hand the pick has one answer, so it is applied at once and the heal follows.
 * Twinleaf asked the pick: the prompt was cancelable, and a cancelable pick is never collapsed. Rotomancer (f430e5217)
 * discards and heals. Board: the Unlimited fuzz row enum-paf-081 (A's hand Moonlit Hill, a Grass and a Psychic Energy).
 */

const HILL = 'paf-081';
const GRASS = 'sve-001';
const PSYCHIC = 'sve-005';
const MON = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, damage = 0): PokemonInPlay {
  return { stack: [{ iid, printing: MON }], energy: [], tools: [], damage, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
const board = (hand: CardRef[]): NeutralState => ({
  schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing',
  stadium: null,
  players: {
    A: player({ active: mon('a1'), bench: [mon('ab1', 30), mon('ab2')], hand: [{ iid: 'ah0', printing: HILL }, ...hand], deck: cards('ad', 8, GRASS), prizes: prizes('ap') }),
    B: player({ active: mon('b1'), deck: cards('bd', 8, GRASS), prizes: prizes('bp') }),
  },
} as NeutralState);
const PLAY = [{ actor: 'A', type: 'playStadium', card: 'ah0' }, { actor: 'A', type: 'useStadium' }] as never[];
const discards = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).filter(a => a.type === 'discard');

describe('TA-744 Moonlit Hill: one Basic [P] Energy in hand is discarded without a pick', () => {
  it('[TA-744 paf-081] one Psychic Energy: no pick; it is discarded and A\'s Pokémon are healed', () => {
    const r = step(board([{ iid: 'ah1', printing: GRASS }, { iid: 'ah2', printing: PSYCHIC }]), PLAY);
    expect(r.applied).toBe(2);
    expect(discards(r)).toEqual([]);
    expect(r.pending?.descriptor).toBe('main');
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['ah2']);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['ah1']);
    expect(r.state.players.A.bench[0].damage).toBe(0);
  });

  it('[TA-744 paf-081 control] two Psychic Energy: the pick is asked between them', () => {
    const r = step(board([{ iid: 'ah1', printing: PSYCHIC }, { iid: 'ah2', printing: PSYCHIC }]), PLAY);
    expect(discards(r).map(a => (a as { target: string }).target).sort()).toEqual(['ah1', 'ah2']);
    expect(r.state.players.A.bench[0].damage).toBe(30);
  });
});
