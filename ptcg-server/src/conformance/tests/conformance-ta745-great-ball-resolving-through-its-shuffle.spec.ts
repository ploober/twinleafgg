import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-745 / #916 / B.80: Great Ball pal-183 ("Look at the top 7 cards of your deck. You may reveal a Pokémon you find there
 * and put it into your hand. Shuffle the other cards back into your deck.") stays on the playing field (`resolving`) until
 * its shuffle is done (TA-378's shape: Dusk Ball, Precious Trolley). It discarded itself before the shuffle, so the pause at
 * the shuffle showed it in the discard pile. Rotomancer (f430e5217): resolving.
 */

const GREAT_BALL = 'pal-183';
const GRASS = 'sve-001';
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
function mon(iid: string): PokemonInPlay {
  return { stack: [{ iid, printing: MON }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string): PrizeRef[] {
  return cards(tag, 6, GRASS).map(c => ({ ...c, faceUp: false }));
}
const DECK = [{ iid: 'am0', printing: MON }, ...cards('ag', 9, GRASS)];
const board = (): NeutralState => ({
  schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
  players: {
    A: player({ active: mon('a1'), hand: [{ iid: 'ah0', printing: GREAT_BALL }], deck: DECK, prizes: prizes('ap') }),
    B: player({ active: mon('b1'), deck: cards('bd', 8, GRASS), prizes: prizes('bp') }),
  },
});
const play = { actor: 'A', type: 'playItem', card: 'ah0' } as never;
const take = { actor: 'A', type: 'choose', target: 'am0' } as never;
const stop = { actor: 'A', type: 'confirm', value: false } as never;
const resolving = (s: NeutralState) => (s.players.A.resolving ?? []).map(c => c.iid);
const discard = (s: NeutralState) => s.players.A.discard.map(c => c.iid);

describe('TA-745 / #916: Great Ball (pal-183) stays on the field through its own shuffle', () => {
  it('[TA-745 pal-183] a Pokémon taken: Great Ball is resolving at the shuffle pause, not in the discard pile', () => {
    const r = step(board(), [play, take]);
    expect(r.state.players.A.hand.map(c => c.iid)).toEqual(['am0']);
    expect(r.pending?.actor).toBe('system');
    expect(resolving(r.state)).toEqual(['ah0']);
    expect(discard(r.state)).not.toContain('ah0');
  });

  it('[TA-745 pal-183 none] nothing taken: Great Ball is resolving at the shuffle pause', () => {
    const r = step(board(), [play, stop]);
    expect(r.pending?.actor).toBe('system');
    expect(resolving(r.state)).toEqual(['ah0']);
    expect(discard(r.state)).not.toContain('ah0');
  });

  it('[TA-745 pal-183 after] after the shuffle Great Ball is in the discard pile, once', () => {
    const r1 = step(board(), [play, take]);
    const order = r1.state.players.A.deck.map(c => c.iid);
    const r = step(board(), [play, take, { actor: 'system', type: 'shuffle', order } as never]);
    expect(r.applied).toBe(3);
    expect(resolving(r.state)).toEqual([]);
    expect(discard(r.state)).toEqual(['ah0']);
    expect(r.state.players.A.deck.length).toBe(9);
  });
});
