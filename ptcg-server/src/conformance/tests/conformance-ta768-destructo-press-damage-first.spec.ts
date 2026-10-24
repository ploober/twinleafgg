import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-768 (B.119, owner 2026-10-23; rulebook step F) — Destructo-Press tef-062 (Iron Thorns): "Reveal the top 5 cards of
 * your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and
 * shuffle the other cards back into your deck." The reveal and the count come first, the damage next, then the
 * discard and the shuffle; until then the revealed cards are in transit (B.80). The script discarded and put the rest
 * back inside the reveal, so both happened before the damage and the shuffle pended ahead of it.
 * Mutation guard: move the discard back into the reveal callback -> the order cell sees the discard before `damaged`.
 */

const LIGHTNING = 'sve-004', WATER = 'sve-003', FUTURE = 'tef-061', FILLER = 'asc-004';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(tag: string, over: Partial<PlayerState>): PlayerState {
  return {
    active: null, bench: [], hand: [], discard: [], lostZone: [],
    deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    flags: flags(), ...over,
  };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
type La = { type: string; target?: string; actor?: string };
const offered = (r: ReturnType<typeof step>): La[] => (r.pending?.legalActions ?? []) as unknown as La[];

type Ev = { kind: string; card?: string; target?: string; hp?: number; origin?: { zone: string }; destination?: { zone: string } };

describe('TA-768 — Destructo-Press tef-062 does its damage before the discard and the shuffle', () => {
  const board = () => state(
    player('a', {
      active: pip([{ iid: 'a1s0', printing: 'tef-062' }], [{ iid: 'a1e0', printing: LIGHTNING }, { iid: 'a1e1', printing: WATER }]),
      deck: [{ iid: 'f1', printing: FUTURE }, { iid: 'w1', printing: WATER }, { iid: 'f2', printing: FUTURE },
        { iid: 'w2', printing: WATER }, { iid: 'w3', printing: WATER }, { iid: 'w4', printing: WATER }, { iid: 'w5', printing: WATER }],
    }),
    player('b', { active: pip([{ iid: 'b1s0', printing: FILLER }]), bench: [pip([{ iid: 'bb1s0', printing: FILLER }])] }),
  );
  const declare = { actor: 'A', type: 'declareAttack', source: 'a1s0', name: 'Destructo-Press' } as unknown as NeutralAction;

  it('the damage (140) comes before the two Future cards reach the discard pile [TA-768 tef-062]', () => {
    // Drive through the shuffle (wherever it pends) so the whole attack is in one trace.
    const first = step(board(), [declare]);
    const legal = offered(first).find(a => a.type === 'shuffle') as unknown as { deck: string[] } | undefined;
    const shuffle = legal === undefined ? undefined : { actor: 'system', type: 'shuffle', order: legal.deck } as unknown as NeutralAction;
    const r = shuffle === undefined ? first : step(board(), [declare, shuffle]);
    expect(r.status).not.toBe('invalidAction');
    const ev = r.events as unknown as Ev[];
    const dmg = ev.findIndex(e => e.kind === 'damaged' && e.target === 'b1s0');
    const disc = ev.findIndex(e => e.kind === 'moved' && e.destination?.zone === 'discardPile' && (e.card === 'f1' || e.card === 'f2'));
    const back = ev.findIndex(e => e.kind === 'moved' && e.destination?.zone === 'deck' && e.card === 'w1');
    expect(dmg).toBeGreaterThanOrEqual(0);
    expect(ev[dmg]?.hp).toBe(140);
    expect(disc).toBeGreaterThan(dmg);
    expect(back).toBeGreaterThan(dmg);
  });
  it('after the attack: the Future cards are discarded, the rest back in the deck, and the deck is shuffled [TA-768 tef-062 after]', () => {
    const r = step(board(), [declare]);
    const A = r.state.players.A;
    expect(A.discard.map(c => c.iid).sort()).toEqual(['f1', 'f2']);
    expect(A.deck.map(c => c.iid).sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    const shuffled = (r.events ?? []).some(e => (e as { kind: string }).kind === 'shuffled') || offered(r).some(a => a.type === 'shuffle');
    expect(shuffled).toBe(true);
  });
});
