import { step } from '../driver';
import {
  NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-701 (contract TransitCard.visibility; B.80; the TA-605 class): Crispin pre-105 — "Search your deck for up to 2 Basic
 * Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Pokémon.
 * Then, shuffle your deck."
 *
 * After "reveal them" both players have seen the two Energy; while they are still being held (the attach pick is open)
 * their transit entries are `public`. The adapter projected the lifted pile `owner` (a look-pile default) and ignored
 * the reveal it had itself emitted, so A.transit read ad5 owner / ad6 owner after a `reveal ... to all` — and its own
 * legs disagreed with each other (ad5 owner, ad6 public). A card revealed to all is public until it is placed (TA-605:
 * "both players saw them, so the legs are public"). Board = fz-tr-bench-pre-105 (results/fuzz-20261010-full/corpus).
 */

const CRISPIN = 'pre-105';
const BELLSPROUT = 'asc-004';
const E = ['sve-001', 'sve-002', 'sve-003', 'sve-004', 'sve-005'];

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function basic(iid: string, energy: CardRef[] = []): PokemonInPlay {
  return { stack: [{ iid, printing: BELLSPROUT }], energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: E[0], faceUp: false }));
}
function deck(tag: string, start: number): CardRef[] {
  const printings = [...E, ...E, BELLSPROUT, BELLSPROUT, BELLSPROUT, 'por-083', 'por-083'];
  return printings.map((printing, i) => ({ iid: `${tag}${start + i}`, printing }));
}

function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: player({
        active: basic('a1', [{ iid: 'ae20', printing: E[2] }]), bench: [basic('ab1'), basic('ab2')],
        hand: [{ iid: 'ah4', printing: CRISPIN }, { iid: 'ah1', printing: E[0] }, { iid: 'ah2', printing: E[4] }, { iid: 'ah3', printing: BELLSPROUT }],
        deck: deck('ad', 5), prizes: prizes('ap', 6),
      }),
      B: player({
        active: basic('b1', [{ iid: 'be19', printing: E[2] }]), bench: [basic('bb1'), basic('bb2')],
        hand: [{ iid: 'bh1', printing: E[0] }, { iid: 'bh2', printing: E[4] }, { iid: 'bh3', printing: BELLSPROUT }],
        deck: deck('bd', 4), prizes: prizes('bp', 6),
      }),
    },
  };
}

const PLAY = { actor: 'A', type: 'playSupporter', card: 'ah4' } as unknown as NeutralAction;
const PICK = (iid: string) => ({ actor: 'A', type: 'choose', target: iid } as unknown as NeutralAction);
const ATTACH = { actor: 'A', type: 'attachEnergy', card: 'ad5', target: 'a1' } as unknown as NeutralAction;

describe('TA-701 Crispin pre-105: the revealed Energy are public in transit after the reveal to all', () => {
  it('after both picks: one reveal {A, [ad5, ad6], from transit, to all}; both are in A.transit, origin deck, visibility PUBLIC [TA-701 pre-105]', () => {
    const res = step(board(), [PLAY, PICK('ad5'), PICK('ad6')]);
    expect(res.status).toBe('awaitingAction');
    const reveals = res.events.filter(e => e.kind === 'reveal') as Array<{ owner: string; cards: string[]; from: string; to: string }>;
    expect(reveals.map(r => ({ owner: r.owner, cards: [...r.cards].sort(), from: r.from, to: r.to })))
      .toEqual([{ owner: 'A', cards: ['ad5', 'ad6'], from: 'transit', to: 'all' }]);
    const A = res.state.players.A;
    expect(A.deck.map(c => c.iid)).not.toContain('ad5');
    expect(A.deck.map(c => c.iid)).not.toContain('ad6');
    expect((A.transit ?? []).map(t => ({ iid: t.iid, origin: t.origin, visibility: t.visibility })).sort((x, y) => x.iid.localeCompare(y.iid)))
      .withContext('a card revealed to all is public while it is held').toEqual([
        { iid: 'ad5', origin: { zone: 'deck' }, visibility: 'public' },
        { iid: 'ad6', origin: { zone: 'deck' }, visibility: 'public' }]);
    // The attach pick is open over the two (TA-436 not regressed: both are offered, on each of the three Pokémon).
    const menu = (res.pending?.legalActions ?? []) as Array<{ type: string; card?: string }>;
    expect(menu.every(a => a.type === 'attachEnergy')).toBe(true);
    expect(new Set(menu.map(a => a.card))).toEqual(new Set(['ad5', 'ad6']));
    expect(menu.length).toBe(6);
  });

  it('control: at the FIRST pick, before the reveal, the lifted Energy is owner-visible [TA-701 pre-105]', () => {
    const res = step(board(), [PLAY, PICK('ad5')]);
    expect((res.state.players.A.transit ?? []).map(t => ({ iid: t.iid, visibility: t.visibility })))
      .toEqual([{ iid: 'ad5', visibility: 'owner' }]);
    expect(res.events.some(e => e.kind === 'reveal')).toBe(false);
  });

  it('after the attach: ad5 on a1, ad6 in the hand, nothing in transit; the shuffle pends [TA-701 pre-105]', () => {
    const res = step(board(), [PLAY, PICK('ad5'), PICK('ad6'), ATTACH]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending?.actor).toBe('system');
    const A = res.state.players.A;
    expect(A.active?.energy.map(c => c.iid)).toEqual(['ae20', 'ad5']);
    expect(A.hand.map(c => c.iid)).toContain('ad6');
    expect(A.transit ?? []).toEqual([]);
    const placed = res.events.filter(e => e.kind === 'moved' && ['ad5', 'ad6'].includes((e as { card: string }).card)
      && (e as { origin: { zone: string } }).origin.zone === 'transit') as Array<{ card: string; visibility: string }>;
    expect(placed.map(l => `${l.card}:${l.visibility}`).sort()).withContext('placing a revealed card is public').toEqual(['ad5:public', 'ad6:public']);
  });
});
