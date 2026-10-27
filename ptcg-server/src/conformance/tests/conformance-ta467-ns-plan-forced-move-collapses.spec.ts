import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, CardRef, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-467 / CF-14 — N's Plan blk-083, "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon".
 * #2301 floors a Supporter's "up to 2" at 1, so with exactly ONE Basic Energy on the Bench and one Active the
 * move has one resolution and must be APPLIED, not surfaced as a 1-option moveEnergy pending (rotomancer
 * applies it since its RE-174 fix). With TWO Energy the which-Energy pick is a real decision and still
 * surfaces. The move-energy decomposer collapsed only `max === 1`; it lacked attach-energy's step-level
 * `atomicStep` gate (TA-400 / TA-463).
 *
 * Mutation guard: drop `atomicStep` from move-energy.ts and the forced cell goes red. The two-Energy control
 * pins that a real choice still surfaces (the driver consults `atomicStep` only at a single candidate).
 */

const RALTS = 'asc-004';
const NS_PLAN = 'blk-083';
const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function mon(iid: string, energy: CardRef[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing: RALTS }], energy, tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function deck(tag: string): CardRef[] {
  return Array.from({ length: 10 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function board(benchEnergy: number): NeutralState {
  const energy = Array.from({ length: benchEnergy }, (_, i) => ({ iid: `be${i}`, printing: GRASS }));
  const A: PlayerState = { active: mon('a0'), bench: [mon('ab1', energy)], hand: [{ iid: 'np', printing: NS_PLAN }],
    deck: deck('a'), discard: [], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b0'), bench: [], hand: [], deck: deck('b'), discard: [], lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'standard', turn: 3, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const play = { actor: 'A', type: 'playSupporter', card: 'np' } as unknown as NeutralAction;
// TA-786 / SR-6: N's Plan's one destination is the Active, so an Energy pick is offered as choose {target: Energy,
// recipient}; the moveEnergy triple only while two or more destinations are legal. Either is a move pick.
const hasMove = (r: ReturnType<typeof step>) => (r.pending?.legalActions ?? []).some(a => a.type === 'moveEnergy'
  || (a.type === 'choose' && (a as { recipient?: string }).recipient !== undefined));

describe('TA-467 N\'s Plan forced single move collapses (CF-14)', () => {
  it('one Energy on one bencher: the move is applied, no moveEnergy pending [TA-467 blk-083]', () => {
    const r = step(board(1), [play]);
    expect(r.status).toBe('awaitingAction');
    expect(hasMove(r)).toBe(false);
    expect(r.state.players.A.active!.energy.map(c => c.iid)).toEqual(['be0']);
    expect(r.state.players.A.bench[0].energy).toEqual([]);
    expect(r.state.players.A.discard.map(c => c.iid)).toContain('np');
  });

  it('two Energy: the which-Energy pick is a real decision and still surfaces (control)', () => {
    const r = step(board(2), [play]);
    expect(hasMove(r)).toBe(true);
    expect(r.state.players.A.active!.energy).toEqual([]);
  });
});
