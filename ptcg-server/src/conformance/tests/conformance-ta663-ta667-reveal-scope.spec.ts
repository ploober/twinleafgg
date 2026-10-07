import { step } from '../driver';
import {
  NeutralState, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * B.97 (owner 2026-10-07): a `reveal` is emitted only when cards in a hidden zone become visible; never for cards that
 * are already public; a card that becomes public by moving is recorded by its `moved` leg alone.
 *
 *  - TA-663: Psych Out (Gothitelle pal-092) "Discard a random card from your opponent's hand." showed the discarded card
 *    as a reveal; the discard itself makes it public.
 *  - TA-667: Piercing Gaze (Luxray ex twm-068) "Your opponent reveals their hand. Discard a card you find there." showed
 *    nothing; the whole hand is revealed before the pick.
 */

const METAL = 'sve-008';
const PSYCHIC = 'sve-005';
const LIGHTNING = 'sve-004';

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
const bHand = cards('bh', 2, METAL);

describe('TA-663 / B.97: Psych Out discards a random card with no reveal', () => {
  it('the discarded card moves to the discard pile and no reveal is emitted [TA-663]', () => {
    const board = base(
      { active: mon('a1', 'pal-092', cards('ae', 2, PSYCHIC)) },
      { active: mon('b1', 'mew-003'), hand: [bHand[0]] });
    const r = step(board, [{ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Psych Out' } as never]);
    expect(r.state.players.B.discard.map(c => c.iid)).toContain('bh0');
    expect(reveals(r.events)).toEqual([]);
  });
});

describe('TA-667 / B.97: Piercing Gaze reveals the opponent\'s hand', () => {
  const board = (hand: CardRef[]) => base(
    { active: mon('a1', 'twm-068', cards('ae', 3, LIGHTNING)) },
    { active: mon('b1', 'mew-003'), hand });
  const gaze = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Piercing Gaze' } as never;

  it('two cards in hand: both are revealed before the pick [TA-667]', () => {
    const r = step(board(bHand), [gaze]);
    expect(r.pending?.actor).toBe('A');
    expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0', 'bh1'], from: 'hand', to: 'all' } as NeutralEvent]);
  });

  it('one card in hand: revealed, then discarded with no pick (CF-14) [TA-667]', () => {
    const r = step(board([bHand[0]]), [gaze]);
    expect(reveals(r.events)).toEqual([{ kind: 'reveal', owner: 'B', cards: ['bh0'], from: 'hand', to: 'all' } as NeutralEvent]);
    expect(r.state.players.B.discard.map(c => c.iid)).toContain('bh0');
  });

  it('control: an empty hand reveals nothing [TA-667]', () => {
    expect(reveals(step(board([]), [gaze]).events)).toEqual([]);
  });
});
