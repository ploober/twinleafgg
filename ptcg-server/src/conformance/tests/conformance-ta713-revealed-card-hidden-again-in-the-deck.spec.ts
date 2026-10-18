import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-713 / B.109 (owner 2026-10-17): a card a reveal made public is hidden information again once it is put into a
 * deck. The leg into the deck is `public` (both players saw it go there, TA-690); its next leg out of the deck, a draw,
 * is `owner` unless an effect reveals it then. Deduction does not count: the only card in the deck is still unknown.
 *
 *  - N's Purrloin jtg-096 Thieving Swipe: "Your opponent reveals their hand, and you choose a card you find there and put
 *    it on the bottom of their deck." With one card in B's hand and an empty deck the pick collapses (CF-14), A's turn
 *    ends and B draws that card, all in the one action. The adapter's reveal memory ran to the end of the action, so the
 *    draw read `public`. Rotomancer (34f26e6fb): `owner`.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const METAL = 'sve-008';
const DARK = 'sve-007';
const PURRLOIN = 'jtg-096';
const LATIAS = 'meg-181'; // Mega Latias ex, 280 HP: survives Thieving Swipe

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
  return cards(tag, n, METAL).map(c => ({ ...c, faceUp: false }));
}
const legs = (events: NeutralEvent[], iid: string) =>
  events.filter((e): e is Moved => e.kind === 'moved' && e.card === iid)
    .map(e => `${e.origin.zone}>${e.destination.zone}${e.destination.position ? ':' + e.destination.position : ''}:${e.visibility}`);

describe('TA-713 / B.109: a revealed card put back into the deck is hidden again', () => {
  const board = (bDeck: CardRef[]): NeutralState => ({
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ active: mon('a1', PURRLOIN, [{ iid: 'ae0', printing: DARK }, { iid: 'ae1', printing: METAL }]),
        deck: cards('ad', 6, METAL), prizes: prizes('ap', 6) }),
      B: player({ active: mon('b1', LATIAS), hand: [{ iid: 'bh0', printing: METAL }], deck: bDeck, prizes: prizes('bp', 6) }),
    },
  });
  const swipe = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Thieving Swipe' } as never;

  it('an empty deck: the card goes under it public, and B draws it back owner [TA-713 jtg-096]', () => {
    const r = step(board([]), [swipe]);
    expect(legs(r.events, 'bh0')).toEqual(['hand>deck:bottom:public', 'deck>hand:owner']);
    expect(r.state.players.B.hand.map(c => c.iid)).toEqual(['bh0']);
  });

  it('control: a deck with cards in it, B draws its top card owner and the revealed card stays at the bottom [TA-713 jtg-096]', () => {
    const r = step(board(cards('bd', 2, METAL)), [swipe]);
    expect(legs(r.events, 'bh0')).toEqual(['hand>deck:bottom:public']);
    expect(legs(r.events, 'bd0')).toEqual(['deck>hand:owner']);
  });
});
