import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * Okidogi asc-122 Settle the Score [F][F][C] 80+: "This attack does 60 more damage for each Prize card your opponent took
 * during their last turn." Compendium #1184 (Teammates): a KO from Poison "takes place in between turns", so it is not
 * "during your opponent's last turn". So a Prize the opponent took during OUR turn, or at Pokémon Checkup, is not one they
 * took during their last turn. The ordinary path (they KO'd our Active with an attack during their turn) counts.
 * The defender is Kingambit asc-148 (Metal, 170 HP, no Fighting Resistance), so the damage event reads 80 or 140.
 */

const GRASS = 'sve-001', FIGHTING = 'sve-006';
const OKIDOGI = 'asc-122', MINCCINO = 'cri-072', BELLSPROUT = 'asc-004', KINGAMBIT = 'asc-148', GOTHITA = 'pal-090';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string, damage = 0, energy: string[] = []): PokemonInPlay {
  return {
    stack: [{ iid, printing }], energy: energy.map((e, i) => ({ iid: `${iid}e${i}`, printing: e })), tools: [], damage, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function side(tag: string, active: PokemonInPlay, bench: PokemonInPlay[]): PlayerState {
  return { active, bench, hand: [], deck: Array.from({ length: 8 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
    discard: [], lostZone: [], prizes: prizes(tag), flags: flags() };
}
function board(turn: number, activePlayer: 'A' | 'B', A: PlayerState, B: PlayerState): NeutralState {
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn, activePlayer, firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;
const okidogi = () => mon('a2', OKIDOGI, 0, [FIGHTING, FIGHTING, FIGHTING]);
const settle = act({ actor: 'A', type: 'declareAttack', source: 'a2', name: 'Settle the Score' });
const prize = (actor: 'A' | 'B') => act({ actor, type: 'takePrize', index: 0 });
const promote = act({ actor: 'A', type: 'promoteBench', target: 'a2' });
const settleDamage = (r: ReturnType<typeof step>) => {
  const ev = ((r.events ?? []) as unknown as { kind: string; target?: string; hp?: number }[])
    .filter(e => e.kind === 'damaged' && e.target === 'b1');
  return ev.length ? ev[ev.length - 1].hp : undefined;
};

describe('Okidogi Settle the Score: only Prizes the opponent took during their own last turn', () => {
  it('B KOs A\'s Active with an attack on B\'s turn: counted, 140 [TA-792 asc-122 on-turn]', () => {
    const b = board(4, 'B', side('a', mon('a1', BELLSPROUT, 50), [okidogi()]), side('b', mon('b1', GOTHITA, 0, [GRASS]), [mon('b2', KINGAMBIT)]));
    const pre = [act({ actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pound' }), prize('B'), promote];
    const r0 = step(b, pre);
    expect(r0.state.players.B.flags.prizesTakenLastTurn).toBe(1);
    const r = step(b, [...pre, settle]);
    expect(settleDamage(r)).toBe(110); // Gothita resists Fighting: 140 - 30
  });
  it('B took its Prize during A\'s turn (Minccino\'s recoil KO): not counted, 80 [TA-792 asc-122 off-turn]', () => {
    const b = board(3, 'A', side('a', mon('a1', MINCCINO, 60, [GRASS]), [okidogi()]), side('b', mon('b1', KINGAMBIT), []));
    const pre = [act({ actor: 'A', type: 'declareAttack', source: 'a1', name: 'Take Down' }), prize('B'), promote,
      act({ actor: 'B', type: 'endTurn' })];
    const r0 = step(b, pre);
    expect(r0.state.turn).toBe(5);
    expect(r0.state.players.B.flags.prizesTakenLastTurn).toBe(0);
    expect(settleDamage(step(b, [...pre, settle]))).toBe(80);
  });
  it('B took its Prize at Pokémon Checkup (A\'s Active Poisoned out): not counted, 80 [TA-792 asc-122 checkup]', () => {
    const a1 = mon('a1', BELLSPROUT, 50);
    a1.conditions = ['poisoned'] as PokemonInPlay['conditions'];
    const b = board(4, 'B', side('a', a1, [okidogi()]), side('b', mon('b1', KINGAMBIT), []));
    const pre = [act({ actor: 'B', type: 'endTurn' }), prize('B'), promote];
    const r0 = step(b, pre);
    expect(r0.state.turn).toBe(5);
    expect(r0.state.players.B.flags.prizesTakenLastTurn).toBe(0);
    expect(settleDamage(step(b, [...pre, settle]))).toBe(80);
  });
});
