import { step } from '../driver';
import {
  NeutralState, NeutralAction, NeutralEvent, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, PrizeRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-702 (B.80): Grimsley's Move pfl-090 — "Look at the top 7 cards of your deck and put a [D] Pokémon you find there
 * onto your Bench. Shuffle the other cards and put them on the bottom of your deck."
 *
 * B.80: "shuffling the whole face-down deck is not transit; shuffling any sub-pile is." The sub-pile being shuffled is
 * the looked-at seven: at the shuffle pause they are in transit {origin deck, destination {deck, bottom}, visibility
 * owner} and the untouched deck projects as it is. The card staged the shuffle the TA-370 way (the untouched deck into
 * a temp list, the seven into the emptied deck), so the wire showed the WHOLE deck in transit and the seven as the deck —
 * the inverse of B.80, TA-598's shape (Grand Wing, fixed on por-009 only). Board = fz-tr-bench-pfl-090
 * (results/fuzz-20261010-full/corpus): no [D] Pokémon among the seven, so the pick collapses and the shuffle pends.
 */

const GRIMSLEY = 'pfl-090';
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
/** The reproducer's 15-card deck: ten Basic Energy (two of each type), three Bellsprout, two por-083. */
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
        hand: [{ iid: 'ah4', printing: GRIMSLEY }, { iid: 'ah1', printing: E[0] }, { iid: 'ah2', printing: E[4] }, { iid: 'ah3', printing: BELLSPROUT }],
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

const SEVEN = ['ad5', 'ad6', 'ad7', 'ad8', 'ad9', 'ad10', 'ad11'];
const REST = ['ad12', 'ad13', 'ad14', 'ad15', 'ad16', 'ad17', 'ad18', 'ad19'];
const PLAY = { actor: 'A', type: 'playSupporter', card: 'ah4' } as unknown as NeutralAction;
const REVERSED = { actor: 'system', type: 'shuffle', order: [...SEVEN].reverse() } as unknown as NeutralAction;

type Moved = Extract<NeutralEvent, { kind: 'moved' }>;
function legs(events: NeutralEvent[], iid: string): string[] {
  return events.filter((e): e is Moved => e.kind === 'moved' && (e as Moved).card === iid)
    .map(e => `${e.origin.zone}>${e.destination.zone}${e.destination.position ? ':' + e.destination.position : ''}:${e.visibility}`);
}

describe('TA-702 Grimsley\'s Move pfl-090: the looked-at seven are the transit at the shuffle pause, the deck stays in place (B.80)', () => {
  it('at the pause: the shuffle is over the seven, A.deck = the untouched eight, A.transit = the seven {deck -> deck bottom, owner} [TA-702 pfl-090]', () => {
    const res = step(board(), [PLAY]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending?.actor).toBe('system');
    const shuffle = res.pending?.legalActions[0] as { type: string; deck?: string[] } | undefined;
    expect(shuffle?.type).toBe('shuffle');
    expect([...(shuffle?.deck ?? [])].sort()).toEqual([...SEVEN].sort());
    const A = res.state.players.A;
    expect(A.deck.map(c => c.iid)).withContext('the untouched deck projects as it is').toEqual(REST);
    expect((A.transit ?? []).map(t => ({ iid: t.iid, origin: t.origin, destination: t.destination, visibility: t.visibility })))
      .withContext('the sub-pile being shuffled is the transit').toEqual(SEVEN.map(iid =>
        ({ iid, origin: { zone: 'deck' }, destination: { zone: 'deck', position: 'bottom' }, visibility: 'owner' })));
    expect((A.resolving ?? []).map(c => c.iid)).toEqual(['ah4']);
    // B.81: the pause's legs are the seven's lift; the untouched eight never move.
    for (const s of SEVEN) { expect(legs(res.events, s)).withContext(s).toEqual(['deck>transit:owner']); }
    for (const r of REST) { expect(legs(res.events, r)).withContext(r).toEqual([]); }
  });

  it('after a reversed order: the eight on top, the seven at the bottom in the submitted order (TA-370 / RE-147 not regressed) [TA-702 pfl-090]', () => {
    const res = step(board(), [PLAY, REVERSED]);
    expect(res.status).toBe('awaitingAction');
    expect(res.pending?.actor).toBe('A');
    const A = res.state.players.A;
    expect(A.deck.map(c => c.iid)).toEqual([...REST, ...[...SEVEN].reverse()]);
    expect(A.transit ?? []).toEqual([]);
    expect(A.discard.map(c => c.iid)).toContain('ah4');
    expect(res.events.some(e => e.kind === 'shuffled' && (e as { player?: string; zone?: string }).player === 'A')).toBe(true);
    for (const s of SEVEN) { expect(legs(res.events, s)).withContext(s).toEqual(['deck>transit:owner', 'transit>deck:bottom:owner']); }
    for (const r of REST) { expect(legs(res.events, r)).withContext(r).toEqual([]); }
  });
});
