import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-762 (B.125, owner 2026-10-25): Haughty Order dri-150 / dri-219 / svp-218 "Your opponent reveals the top 10 cards of
 * their deck. You may choose an attack from a Pokémon you find there and use it as this attack. Your opponent shuffles
 * the revealed cards back into their deck." The "you may choose" is the options plus confirm {value:false} in the same
 * pending (CF-4), not a separate may first; the ten revealed cards stay out of the deck (transit, B.80) until the
 * shuffle. Twinleaf offered no stop and had already put the ten back before the choice.
 * Mutation guards: drop mayDecline from Haughty Order -> the stop cells red; restore the put-back in the reveal
 * callback -> the transit cells red.
 */

const WATER = 'sve-003';
const FILLER = 'pal-090';    // Gothita: Pound, Eerie Wave
const METAL_MON = 'svi-142'; // Revavroom

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function cards(tag: string, printings: string[]): CardRef[] {
  return printings.map((p, i) => ({ iid: `${tag}${i}`, printing: p }));
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false }));
}
function board(printing = 'dri-150'): NeutralState {
  const deckB = [WATER, WATER, WATER, FILLER, WATER, METAL_MON, WATER, WATER, WATER, WATER, ...Array(8).fill(WATER)];
  const A: PlayerState = { active: mon('a1', printing, [WATER, WATER]), bench: [], hand: [], deck: cards('ad', [WATER, WATER, WATER, WATER]),
    discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', FILLER), bench: [], hand: [], deck: cards('bd', deckB),
    discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 4, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const haughty = act({ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Haughty Order' });
const choose = (target: string, name?: string) => act({ actor: 'A', type: 'choose', target, ...(name ? { name } : {}) });
const stop = act({ actor: 'A', type: 'confirm', value: false });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.target, a.name, a.value].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}
const deckB = (r: ReturnType<typeof step>) => r.state.players.B.deck.length;
const transitB = (r: ReturnType<typeof step>) => ((r.state.players.B as any).transit || []).length;

describe('TA-762 — Haughty Order dri-150: "you may choose an attack": the Pokémon with the stop, the ten held until the shuffle', () => {
  it('the copy choice offers the stop beside the Pokémon [TA-762 dri-150]', () => {
    expect(legal(step(board(), [haughty]))).toEqual(['A:choose:bd3', 'A:choose:bd5', 'A:confirm:false']);
  });
  it('the ten revealed cards are out of the deck at the choice [TA-762 dri-150 transit]', () => {
    const r = step(board(), [haughty]);
    expect(deckB(r)).toBe(8);
    expect(transitB(r)).toBe(10);
  });
  it('the stop: no attack is copied, and the ten go back and are shuffled [TA-762 dri-150 stop]', () => {
    const r = step(board(), [haughty, stop]);
    expect(r.status).toBe('awaitingAction');
    expect((r as any).pending.actor).toBe('system');
    expect(deckB(r)).toBe(18);
    expect(r.state.players.B.active!.damage).toBe(0);
  });
  it('the Pokémon, then its attacks (B.55); the ten still held [TA-762 dri-150 attack]', () => {
    const r = step(board(), [haughty, choose('bd3')]);
    expect(legal(r)).toEqual(['A:choose:bd3:Eerie Wave', 'A:choose:bd3:Pound']);
    expect(transitB(r)).toBe(10);
  });
  it('the copied attack resolves, then the shuffle [TA-762 dri-150 copied]', () => {
    const r = step(board(), [haughty, choose('bd3'), choose('bd3', 'Pound')]);
    expect(r.state.players.B.active!.damage).toBe(10);
    expect((r as any).pending.actor).toBe('system');
    expect(deckB(r)).toBe(18);
  });
  it('the reprint svp-218 offers the same stop [TA-762 svp-218]', () => {
    expect(legal(step(board('svp-218'), [haughty]))).toEqual(['A:choose:bd3', 'A:choose:bd5', 'A:confirm:false']);
  });
});
