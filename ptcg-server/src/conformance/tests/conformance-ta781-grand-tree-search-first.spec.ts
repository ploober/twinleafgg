import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-781 (B.128, owner 2026-10-25): Grand Tree scr-136 "that player may search their deck for a Stage 1 Pokémon that
 * evolves from 1 of their Basic Pokémon and put it onto that Pokémon to evolve it." The search comes first and may find
 * nothing; the Pokémon to evolve is asked after the card is found, and only when more than one of the player's Pokémon
 * can take it. Twinleaf asked the Basic first, then searched for its Stage 1.
 * Mutation guard: restore the ChoosePokemonPrompt-first script -> every cell red.
 */

const WATER = 'sve-003';
const FILLER = 'pal-090';     // Gothita (no Stage 1 in the deck)
const SPRIG = 'svi-013';      // Sprigatito (Basic)
const FLORA = 'svi-014';      // Floragato (Stage 1, from Sprigatito)
const MEOW = 'svi-015';       // Meowscarada (Stage 2, from Floragato)

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
function board(bench: string[], deck: string[]): NeutralState {
  const A: PlayerState = { active: mon('a1', SPRIG), bench: bench.map((p, i) => mon(`ab${i + 1}`, p)), hand: [],
    deck: cards('ad', deck), discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', FILLER), bench: [], hand: [], deck: cards('bd', [WATER, WATER, WATER, WATER]),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: { iid: 'stad', printing: 'scr-136', owner: 'A' } as any, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const use = act({ actor: 'A', type: 'useStadium' });
const choose = (target: string) => act({ actor: 'A', type: 'choose', target });
const stop = act({ actor: 'A', type: 'confirm', value: false });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.target, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
const top = (r: ReturnType<typeof step>, slot: 'active' | number) => {
  const A = r.state.players.A;
  const s = slot === 'active' ? A.active! : A.bench[slot];
  return s.stack[s.stack.length - 1].printing;
};
const DECK = [FLORA, WATER, MEOW, WATER, WATER, WATER];

describe('TA-781 — Grand Tree scr-136: the Stage 1 search first, then the Pokémon only when several can take it', () => {
  it('the first pending is the deck search: the Stage 1 and the stop [TA-781 scr-136]', () => {
    expect(legal(step(board([SPRIG], DECK), [use]))).toEqual(['A:choose:ad0', 'A:confirm:false']);
  });
  it('the Stage 1 found, two Sprigatito: which one evolves [TA-781 scr-136 pokemon]', () => {
    expect(legal(step(board([SPRIG], DECK), [use, choose('ad0')]))).toEqual(['A:choose:a1', 'A:choose:ab1']);
  });
  it('one Sprigatito: not asked; it evolves, then the Stage 2 search [TA-781 scr-136 one]', () => {
    const r = step(board([FILLER], DECK), [use, choose('ad0')]);
    expect(top(r, 'active')).toBe(FLORA);
    expect(legal(r)).toEqual(['A:choose:ad2', 'A:confirm:false']);
  });
  it('the search finds nothing: nothing evolves, the deck is shuffled [TA-781 scr-136 none]', () => {
    const r = step(board([SPRIG], DECK), [use, stop]);
    expect(top(r, 'active')).toBe(SPRIG);
    expect(top(r, 0)).toBe(SPRIG);
    expect((r as any).pending.actor).toBe('system');
  });
  it('the Pokémon chosen evolves to Stage 1 and then Stage 2 [TA-781 scr-136 both]', () => {
    const r = step(board([SPRIG], DECK), [use, choose('ad0'), choose('ab1'), choose('ad2')]);
    expect(top(r, 0)).toBe(MEOW);
    expect(top(r, 'active')).toBe(SPRIG);
  });
});
