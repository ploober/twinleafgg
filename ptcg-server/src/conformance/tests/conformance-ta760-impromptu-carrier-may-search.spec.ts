import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-760 (B.131, owner 2026-10-25): Impromptu Carrier twm-132 "When you play this Pokémon from your hand onto your Bench
 * during your turn, you may search your deck for a Pokémon Tool card and attach it to this Pokémon. Then, shuffle your
 * deck." A "you may search" of a hidden zone is a confirm asked first. false: no search, no look, no shuffle. true: the
 * search (its pick may end with the stop, a failed search, #903), then the owed shuffle. Twinleaf asked nothing: it went
 * straight to the deck pick and shuffled either way.
 * Mutation guard: drop the ConfirmPrompt -> every cell red.
 */

const WATER = 'sve-003';
const FILLER = 'pal-090';
const TOOL = 'tef-159'; // Rescue Board

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((p, i) => ({ iid: `${tag}${i}`, printing: p }));
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false }));
}
function board(deck: string[]): NeutralState {
  const A: PlayerState = { active: mon('a1', FILLER), bench: [], hand: cards('ah', ['twm-132']), deck: cards('ad', deck),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', FILLER), bench: [], hand: [], deck: cards('bd', [WATER, WATER, WATER, WATER]),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const bench = act({ actor: 'A', type: 'benchBasic', card: 'ah0' });
const yes = act({ actor: 'A', type: 'confirm', value: true });
const no = act({ actor: 'A', type: 'confirm', value: false });
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
const shuffled = (r: ReturnType<typeof step>) => r.events.filter(e => (e.kind as string) === 'shuffled').length;
const systemPending = (r: ReturnType<typeof step>) => (r as any).pending?.actor === 'system';
const NO_TOOL = [WATER, WATER, WATER, WATER, WATER, WATER];
const A_TOOL = [TOOL, WATER, WATER, WATER, WATER, WATER];

describe('TA-760 — Impromptu Carrier twm-132: the may first, then the search, then the shuffle', () => {
  it('benching it asks the may (confirm true / false) [TA-760 twm-132]', () => {
    expect(legal(step(board(A_TOOL), [bench]))).toEqual(['A:confirm:false', 'A:confirm:true']);
  });
  it('the may with no Tool in the deck is still asked [TA-760 twm-132 no tool]', () => {
    expect(legal(step(board(NO_TOOL), [bench]))).toEqual(['A:confirm:false', 'A:confirm:true']);
  });
  it('declining: no search and no shuffle [TA-760 twm-132 declined]', () => {
    const r = step(board(A_TOOL), [bench, no]);
    expect(systemPending(r)).toBe(false);
    expect(shuffled(r)).toBe(0);
    expect(r.state.players.A.bench[0].tools).toEqual([]);
  });
  it('yes: the deck pick (the stop is a failed search) [TA-760 twm-132 search]', () => {
    expect(legal(step(board(A_TOOL), [bench, yes]))).toEqual(['A:choose:ad0', 'A:confirm:false']);
  });
  it('yes, the Tool: attached, then the shuffle [TA-760 twm-132 attach]', () => {
    const r = step(board(A_TOOL), [bench, yes, choose('ad0')]);
    expect(r.state.players.A.bench[0].tools.map(t => t.iid)).toEqual(['ad0']);
    expect(systemPending(r)).toBe(true);
  });
  it('yes, then the stop: nothing attached, the deck is still shuffled [TA-760 twm-132 failed]', () => {
    const r = step(board(A_TOOL), [bench, yes, no]);
    expect(r.state.players.A.bench[0].tools).toEqual([]);
    expect(systemPending(r)).toBe(true);
  });
});
