import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-782 (B.127, owner 2026-10-25: "always promote"; #2036 "All effects have to finish resolving before the winner is
 * determined"): when BOTH players take their last Prize card in one Knock Out window, every promotion owed is asked —
 * the non-turn player first, then the turn player — before the game is decided. On a board where nothing triggers the
 * result is unchanged (a tie). Twinleaf decided the tie with both Active Spots empty and no promotion.
 * Board: Annihilape ssp-100 Destined Fight Knocks Out both Actives; each player holds one Prize and two Benched.
 * Mutation guard: restore the prize-out short-circuit for both players -> the promotion cells red.
 */

const WATER = 'sve-003';
const FIGHT = 'sve-006';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 5, vstarUsed: false } as PlayerFlags;
}
function mon(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } };
}
function cards(tag: string, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}${i}`, printing: WATER }));
}
function prize(tag: string): PrizeRef[] {
  return [{ iid: `${tag}p0`, printing: WATER, faceUp: false }];
}
function board(): NeutralState {
  const A: PlayerState = {
    active: mon([{ iid: 'a0', printing: 'dri-090' }, { iid: 'a1', printing: 'dri-091' }, { iid: 'a2', printing: 'ssp-100' }],
      [{ iid: 'ae0', printing: FIGHT }, { iid: 'ae1', printing: FIGHT }]),
    bench: [mon([{ iid: 'ab0', printing: 'blk-001' }]), mon([{ iid: 'ac0', printing: 'asc-020' }])],
    hand: [], deck: cards('ad', 4), discard: [], lostZone: [], prizes: prize('a'), flags: flags() };
  const B: PlayerState = {
    active: mon([{ iid: 'b0', printing: 'por-063' }]),
    bench: [mon([{ iid: 'bb0', printing: 'asc-004' }]), mon([{ iid: 'bc0', printing: 'jtg-054' }])],
    hand: [], deck: cards('bd', 4), discard: [], lostZone: [], prizes: prize('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 5, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } } as NeutralState;
}
const act = (a: object) => a as unknown as NeutralAction;
const SCRIPT = [
  act({ actor: 'A', type: 'declareAttack', source: 'a0', name: 'Destined Fight' }),
  act({ actor: 'B', type: 'takePrize', index: 0 }),
  act({ actor: 'A', type: 'takePrize', index: 0 }),
];
const promote = (actor: string, to: string) => act({ actor, type: 'promoteBench', target: to });

function legal(r: ReturnType<typeof step>): string[] {
  const p = (r as any).pending;
  return p ? p.legalActions.map((a: any) => [a.actor, a.type, a.target].filter(x => x !== undefined && x !== null).join(':')).sort() : [];
}

describe('TA-782 — both players take their last Prize in one Knock Out window: the promotions, then the decision', () => {
  it('B promotes first, the game still ongoing [TA-782 ssp-100]', () => {
    const r = step(board(), SCRIPT);
    expect(r.state.outcome).toBe('ongoing');
    expect(legal(r)).toEqual(['B:promoteBench:bb0', 'B:promoteBench:bc0']);
  });
  it('then A promotes [TA-782 ssp-100 second]', () => {
    expect(legal(step(board(), [...SCRIPT, promote('B', 'bb0')]))).toEqual(['A:promoteBench:ab0', 'A:promoteBench:ac0']);
  });
  it('then the game is decided: a tie, both Active Spots filled [TA-782 ssp-100 tie]', () => {
    const r = step(board(), [...SCRIPT, promote('B', 'bc0'), promote('A', 'ab0')]);
    expect(r.state.outcome).toBe('tie');
    expect(r.state.players.A.active!.stack[0].iid).toBe('ab0');
    expect(r.state.players.B.active!.stack[0].iid).toBe('bc0');
  });
});
