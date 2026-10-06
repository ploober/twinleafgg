import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-625: Tyrantrum por-045 Wreak Havoc ("Flip a coin until you get tails. For each heads, discard the top card of
 * your opponent's deck.") counts the heads and discards once the sequence ends. Twinleaf discarded after each heads,
 * so the pause before the next flip already showed the card in the discard pile.
 */

const F = 'sve-006';
const DEFENDER = 'meg-181';   // Mega Latias ex, 280 HP: 160 is no KO

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function mon(iid: string, printing: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing: string): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n, F).map(c => ({ ...c, faceUp: false }));
}
function board(bDeck: number): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', 'por-045', cards('ae', 2, F)), deck: cards('ad', 6, F), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', DEFENDER), deck: cards('bd', bDeck, F), prizes: prizes('bp', 6) }),
    },
  };
}

const attack = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Wreak Havoc' } as never;
const flip = (face: 'heads' | 'tails') => ({ actor: 'system', type: 'flip', face }) as never;

describe('TA-625: Tyrantrum por-045 Wreak Havoc discards once the flips end', () => {
  it('heads, then the pause before the next flip: nothing discarded yet [TA-625]', () => {
    const r = step(board(6), [attack, flip('heads')]);
    expect(r.pending?.legalActions.some(a => (a as { type: string }).type === 'flip')).toBe(true);
    expect(r.state.players.B.deck.length).toBe(6);
    expect(r.state.players.B.discard.length).toBe(0);
  });

  it('heads, heads, tails: the top 2 cards are discarded (then B draws bd2 for its turn) [TA-625]', () => {
    const r = step(board(6), [attack, flip('heads'), flip('heads'), flip('tails')]);
    expect(r.state.players.B.deck.map(c => c.iid)).toEqual(['bd3', 'bd4', 'bd5']);
    expect(r.state.players.B.discard.map(c => c.iid).sort()).toEqual(['bd0', 'bd1']);
    expect(r.state.players.B.active?.damage).toBe(160);
  });

  it('three heads with 3 cards in the deck: all 3 are discarded [TA-625]', () => {
    const r = step(board(3), [attack, flip('heads'), flip('heads'), flip('heads'), flip('tails')]);
    expect(r.state.players.B.deck.length).toBe(0);
    expect(r.state.players.B.discard.map(c => c.iid).sort()).toEqual(['bd0', 'bd1', 'bd2']);
  });

  it('control: tails first discards nothing (B draws bd0 for its turn) [TA-625]', () => {
    const r = step(board(6), [attack, flip('tails')]);
    expect(r.state.players.B.deck.length).toBe(5);
    expect(r.state.players.B.discard.length).toBe(0);
  });
});
