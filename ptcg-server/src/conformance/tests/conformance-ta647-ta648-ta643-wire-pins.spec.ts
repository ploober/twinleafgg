import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * Two owner pins on the wire (contract conventions, 2026-10-06).
 *
 * TA-647 (B.86): a pending raised during Pokémon Checkup, including the Knock Out pause, reports `phase: checkup`.
 * Twinleaf runs the Knock Out check of an `endTurn` inside the EndTurnEffect, while the engine phase is still
 * PLAYER_TURN, so its Prize pick and the promotion read `main`. A Knock Out by an attack is checked before the turn
 * ends ("after attacking and checking for a KO but before Pokemon Checkup", #1869) and stays `main`.
 *
 * TA-648 / TA-643 (B.87): a card an effect puts into the deck that the same effect then shuffles is recorded at
 * `destination: {zone: deck, position: any}`. Perrin twm-160 puts the cards in, then searches (a deck search is
 * followed by its shuffle); Drasna ssp-173 puts the hand in, then parks on a non-decision animation wait before the
 * shuffle. Twinleaf recorded both as `top`.
 *
 * Mutation guards: drop the endTurn-window check in state-adapter's phase projection and the TA-647 checkup cells red;
 * drop the open-deck-search owners from `shuffledInDecks` and the Perrin cells red; drop the wait deferral in
 * dispatchAndCollect and the Drasna cells red.
 */

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;

const BLACK_KYUREM_EX = 'ssp-048';
const LUXURIOUS_CAPE = 'par-166';
const BELLSPROUT = 'asc-004';
const EEVEE = 'pre-074';
const PERRIN = 'twm-160';
const DRASNA = 'ssp-173';
const GRASS = 'sve-001';
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
function basic(iid: string, printing = BELLSPROUT, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function cards(tag: string, n: number, printing = GRASS): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing }));
}
function prizes(tag: string, n: number): PrizeRef[] {
  return cards(tag, n).map(c => ({ ...c, faceUp: false }));
}
function game(a: PlayerState, b: PlayerState, turn = 3): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: a, B: b }, format: 'unlimited',
  } as NeutralState;
}
function moved(events: NeutralEvent[]): Moved[] {
  return events.filter((e): e is Moved => e.kind === 'moved');
}
function deckLegs(events: NeutralEvent[], owner: 'A' | 'B'): Array<[string, string, string | undefined]> {
  return moved(events).filter(e => e.owner === owner && e.destination.zone === 'deck')
    .map(e => [e.card, e.origin.zone, e.destination.position] as [string, string, string | undefined])
    .sort((x, y) => x[0].localeCompare(y[0]));
}
const END_TURN = { actor: 'A', type: 'endTurn' } as never;

describe('[TA-647] B.86: a pending raised by a Knock Out during Pokémon Checkup reports phase checkup', () => {
  // Black Kyurem ex (230 HP, a Rule Box) holds Luxurious Cape at 230 damage: the Cape adds nothing, so A's endTurn
  // Knocks it Out at the check. B takes a Prize, then A promotes its bencher.
  const kyurem = () => game(
    player({
      active: { stack: [{ iid: 'a1', printing: BLACK_KYUREM_EX }], energy: [{ iid: 'a1e0', printing: FIRE }],
        tools: [{ iid: 'a1t0', printing: LUXURIOUS_CAPE }], damage: 230, conditions: [], markers: markers() },
      bench: [basic('ab1')], deck: cards('ad', 4), prizes: prizes('ap', 3),
    }),
    player({ active: basic('b1'), deck: cards('bd', 4), prizes: prizes('bp', 3) }), 5);

  it('[TA-647] the Prize pick after an endTurn Knock Out reports checkup (rotomancer: checkup; twinleaf was main)', () => {
    const res = step(kyurem(), [END_TURN]);
    expect(res.events.some(e => e.kind === 'ko')).toBe(true);
    expect(res.pending?.actor).toBe('B');
    expect(res.state.turn).toBe(5);
    expect(res.state.activePlayer).toBe('A');
    expect(res.state.phase).toBe('checkup');
  });

  // A Pokémon ex: two Prizes, taken one at a time.
  const TAKE = { actor: 'B', type: 'takePrize', index: 0 } as never;

  it('[TA-647] the second Prize pick and the promotion after it still report checkup', () => {
    const mid = step(kyurem(), [END_TURN, TAKE]);
    expect(mid.pending?.actor).toBe('B');
    expect(mid.state.phase).toBe('checkup');
    const res = step(kyurem(), [END_TURN, TAKE, TAKE]);
    expect(res.pending?.actor).toBe('A');
    expect(res.state.turn).toBe(5);
    expect(res.state.phase).toBe('checkup');
  });

  it('[TA-647] control: once the promotion is made the next turn starts, and reports main', () => {
    const res = step(kyurem(), [END_TURN, TAKE, TAKE, { actor: 'A', type: 'promoteBench', target: 'ab1' } as never]);
    expect(res.state.turn).toBe(6);
    expect(res.state.activePlayer).toBe('B');
    expect(res.state.phase).toBe('main');
  });

  it('[TA-647] control: a Poison Knock Out at Checkup reports checkup at its Prize pick', () => {
    const g = game(
      player({ active: { ...basic('a1'), damage: 50, conditions: ['poisoned'] } as PokemonInPlay, bench: [basic('ab1')],
        deck: cards('ad', 4), prizes: prizes('ap', 3) }),
      player({ active: basic('b1'), deck: cards('bd', 4), prizes: prizes('bp', 3) }), 5);
    const res = step(g, [END_TURN]);
    expect(res.events.some(e => e.kind === 'ko')).toBe(true);
    expect(res.pending).not.toBeNull();
    expect(res.state.turn).toBe(5);
    expect(res.state.phase).toBe('checkup');
  });

  it('[TA-647] control: a Knock Out by an attack pauses in the turn and reports main', () => {
    const g = game(
      player({
        active: { stack: [{ iid: 'a1s0', printing: EEVEE }], energy: [{ iid: 'ae0', printing: FIRE }, { iid: 'ae1', printing: FIRE }],
          tools: [], damage: 0, conditions: [], markers: markers() },
        bench: [basic('ab1')], deck: cards('ad', 6, FIRE), prizes: prizes('ap', 2),
      }),
      player({ active: { ...basic('b1'), damage: 50 }, bench: [basic('bb1')], deck: cards('bd', 6), prizes: prizes('bp', 3) }));
    const res = step(g, [{ actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Reckless Charge' } as never]);
    expect(res.events.some(e => e.kind === 'ko')).toBe(true);
    expect(res.pending).not.toBeNull();
    expect(res.state.turn).toBe(3);
    expect(res.state.phase).toBe('main');
  });
});

describe('[TA-648] B.87: Perrin twm-160 puts the revealed Pokémon into the deck it then searches and shuffles: position any', () => {
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'ah0' } as never;
  const perrin = (deck: CardRef[]) => game(
    player({ active: basic('a1'), hand: [{ iid: 'ah0', printing: PERRIN }, { iid: 'ah1', printing: BELLSPROUT }], deck, prizes: prizes('ap', 3) }),
    player({ active: basic('b1'), deck: cards('bd', 4), prizes: prizes('bp', 3) }));

  it('[TA-648] empty deck (the rf5-02 shape): the hand -> deck leg is position any, at the deck-search pause', () => {
    const res = step(perrin([]), [PLAY]);
    expect(deckLegs(res.events, 'A')).toEqual([['ah1', 'hand', 'any']]);
  });

  it('[TA-648] stocked deck: the hand -> deck leg is position any, whatever end the engine put it at', () => {
    const res = step(perrin(cards('ad', 3)), [PLAY]);
    expect(deckLegs(res.events, 'A')).toEqual([['ah1', 'hand', 'any']]);
  });
});

describe('[TA-643] B.87: Drasna ssp-173 shuffles the hand into the deck: position any', () => {
  const PLAY = { actor: 'A', type: 'playSupporter', card: 'ah0' } as never;
  const drasna = (deck: CardRef[]) => game(
    player({ active: basic('a1'), hand: [{ iid: 'ah0', printing: DRASNA }, ...cards('ah', 5, GRASS).slice(1)], deck, prizes: prizes('ap', 3) }),
    player({ active: basic('b1'), deck: cards('bd', 4), prizes: prizes('bp', 3) }));

  it('[TA-643] empty deck (the ta308 row): the four hand -> deck legs are position any', () => {
    const res = step(drasna([]), [PLAY]);
    expect(res.pending?.actor).toBe('system');
    expect(deckLegs(res.events, 'A')).toEqual([['ah1', 'hand', 'any'], ['ah2', 'hand', 'any'], ['ah3', 'hand', 'any'], ['ah4', 'hand', 'any']]);
  });

  it('[TA-643] stocked deck: the hand -> deck legs are position any', () => {
    const res = step(drasna(cards('ad', 3)), [PLAY]);
    expect(deckLegs(res.events, 'A').map(l => l[2])).toEqual(['any', 'any', 'any', 'any']);
  });
});
