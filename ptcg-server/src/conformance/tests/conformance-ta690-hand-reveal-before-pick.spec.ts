import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-690 / B.97: "Your opponent reveals their hand" emits a `reveal` of the whole hand before the pick (the TA-667
 * mechanism, fixed on Luxray ex only). The card files raised the ChooseCardsPrompt over the opponent's hand with no
 * ShowCardsPrompt, so the adapter had nothing to turn into a reveal, and the picked card's leg read `owner`.
 *
 *  - N's Purrloin jtg-096 Thieving Swipe: "Your opponent reveals their hand, and you choose a card you find there and put
 *    it on the bottom of their deck."
 *  - Mega Absol ex meg-086 / meg-161 / meg-180 Claw of Darkness: "Your opponent reveals their hand, and you discard a card
 *    you find there."
 *
 * Rotomancer (:8099 17fa5070a, 2026-10-11): `damaged`, `reveal B from hand`, then the pick; a pick collapsed into the
 * attack's dispatch (one card in hand, CF-14) moves `hand > deck:bottom` `public`; a pick made in a later action moves
 * `owner` on both engines (the reveal's visibility memory is per dispatch, B.81).
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const METAL = 'sve-008';
const DARK = 'sve-007';
const PURRLOIN = 'jtg-096';
const ABSOL = 'meg-086';
const ABSOL_161 = 'meg-161';
const ABSOL_180 = 'meg-180';
const LATIAS = 'meg-181'; // Mega Latias ex, 280 HP: survives Claw of Darkness's 200

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
function base(a: Partial<PlayerState>, b: Partial<PlayerState>): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A', phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({ deck: cards('ad', 6, METAL), prizes: prizes('ap', 6), ...a }),
      B: player({ deck: cards('bd', 6, METAL), prizes: prizes('bp', 6), ...b }),
    },
  };
}
const reveals = (events: NeutralEvent[]) => events.filter(e => e.kind === 'reveal');
const moved = (events: NeutralEvent[]) => events.filter((e): e is Moved => e.kind === 'moved');
const legs = (events: NeutralEvent[], iid: string) =>
  moved(events).filter(e => e.card === iid).map(e => `${e.origin.zone}>${e.destination.zone}${e.destination.position ? ':' + e.destination.position : ''}:${e.visibility}`);
const kinds = (events: NeutralEvent[]) => events.map(e => e.kind);
const bHand = cards('bh', 2, METAL);

describe('TA-690 / B.97: Thieving Swipe (N\'s Purrloin jtg-096) reveals the opponent\'s hand before the pick', () => {
  const board = (hand: CardRef[]) => base(
    { active: mon('a1', PURRLOIN, [{ iid: 'ae0', printing: DARK }, { iid: 'ae1', printing: METAL }]) },
    { active: mon('b1', LATIAS), hand });
  const swipe = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Thieving Swipe' } as never;

  it('two cards in hand: the damage lands, then both cards are revealed before the pick [TA-690 jtg-096]', () => {
    const r = step(board(bHand), [swipe]);
    expect(r.pending?.actor).toBe('A');
    expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0', 'bh1'], from: 'hand', to: 'all' } as NeutralEvent]);
    expect(kinds(r.events).indexOf('damaged')).toBeLessThan(kinds(r.events).indexOf('reveal'));
    expect(r.state.players.B.hand.map(c => c.iid)).toEqual(['bh0', 'bh1']);
  });

  it('two cards in hand, then the pick: the chosen card goes to the bottom of the deck [TA-690 jtg-096]', () => {
    const r = step(board(bHand), [swipe, { actor: 'A', type: 'choose', target: 'bh1' } as never]);
    expect(reveals(r.events).map(e => (e as { cards: string[] }).cards)).toEqual([['bh0', 'bh1']]);
    const deck = r.state.players.B.deck.map(c => c.iid);
    expect(deck[deck.length - 1]).toBe('bh1');
    expect(legs(r.events, 'bh1')).toEqual(['hand>deck:bottom:owner']);
  });

  it('an EMPTY deck: the chosen card still goes to the bottom, and the leg says bottom, not top [TA-706 jtg-096]', () => {
    // TA-706: the MOVE_CARDS carried no toBottom, so the leg derivation had no declared end and the whole-deck-landed
    // rule read the lone card as deck:top; rotomancer says bottom (the TA-704 shape).
    const b = board(bHand); b.players.B.deck = [];
    const r = step(b, [swipe, { actor: 'A', type: 'choose', target: 'bh1' } as never]);
    // The attack ends A's turn and B draws the lone card straight back: the two legs stay (B.81).
    expect(legs(r.events, 'bh1')).toEqual(['hand>deck:bottom:owner', 'deck>hand:owner']);
    expect(r.state.players.B.hand.map(c => c.iid)).toContain('bh1');
  });

  it('one card in hand: revealed, then put on the bottom with no pick (CF-14); the leg is public [TA-690 jtg-096]', () => {
    const r = step(board([bHand[0]]), [swipe]);
    expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0'], from: 'hand', to: 'all' } as NeutralEvent]);
    const deck = r.state.players.B.deck.map(c => c.iid);
    expect(deck[deck.length - 1]).toBe('bh0');
    expect(legs(r.events, 'bh0')).toEqual(['hand>deck:bottom:public']);
  });

  it('control: an empty hand reveals nothing [TA-690 jtg-096]', () => {
    const r = step(board([]), [swipe]);
    expect(reveals(r.events)).toEqual([]);
    expect(r.state.players.B.active?.damage).toBe(30);
  });
});

describe('TA-690 / B.97: Claw of Darkness (Mega Absol ex meg-086 / meg-161 / meg-180) reveals the opponent\'s hand before the discard', () => {
  const board = (printing: string, hand: CardRef[]) => base(
    { active: mon('a1', printing, [{ iid: 'ae0', printing: DARK }, { iid: 'ae1', printing: DARK }, { iid: 'ae2', printing: METAL }]) },
    { active: mon('b1', LATIAS), hand });
  const claw = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Claw of Darkness' } as never;

  it('two cards in hand: the damage lands, then both cards are revealed before the pick [TA-690 meg-086]', () => {
    const r = step(board(ABSOL, bHand), [claw]);
    expect(r.pending?.actor).toBe('A');
    expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0', 'bh1'], from: 'hand', to: 'all' } as NeutralEvent]);
    expect(kinds(r.events).indexOf('damaged')).toBeLessThan(kinds(r.events).indexOf('reveal'));
    expect(r.state.players.B.active?.damage).toBe(200);
  });

  it('one card in hand: revealed, then discarded with no pick (CF-14) [TA-690 meg-086]', () => {
    const r = step(board(ABSOL, [bHand[0]]), [claw]);
    expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0'], from: 'hand', to: 'all' } as NeutralEvent]);
    expect(r.state.players.B.discard.map(c => c.iid)).toEqual(['bh0']);
    expect(legs(r.events, 'bh0')).toEqual(['hand>discardPile:public']);
  });

  it('control: an empty hand reveals nothing [TA-690 meg-086]', () => {
    expect(reveals(step(board(ABSOL, []), [claw]).events)).toEqual([]);
  });

  for (const printing of [ABSOL_161, ABSOL_180]) {
    it(`the reprint ${printing} reveals the hand the same way [TA-690 ${printing}]`, () => {
      const r = step(board(printing, bHand), [claw]);
      expect(r.pending?.actor).toBe('A');
      expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0', 'bh1'], from: 'hand', to: 'all' } as NeutralEvent]);
    });
  }
});
