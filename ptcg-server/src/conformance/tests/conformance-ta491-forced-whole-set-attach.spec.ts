import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-491 — CF-14 addendum for attach/relocation: an N-of-exactly-N forced move has no decision in any pick, so the
 * whole set is applied at once. Energizer Wheel par-121 with two [D] and one bencher surfaced its first moveEnergy
 * pick while rotomancer applied both.
 *
 * Mutation guard: drop attach-energy's collapseWholeSet and the collapse cell goes red; the control pins that a pool
 * larger than the requirement (three [D], move 2) still surfaces the pick.
 */

const GRASS = 'sve-001';
const DARK = 'sve-007';
const BELLSPROUT = 'asc-004';

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
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string): CardRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(energy: string[], benchCount: number): NeutralState {
  const bench = Array.from({ length: benchCount }, (_, i) => mon(`a${i + 2}`, BELLSPROUT));
  const A: PlayerState = { active: mon('a1', 'par-121', energy), bench, hand: [], deck: deck('a'), discard: [], lostZone: [],
    prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', 'twm-118'), bench: [mon('b2', BELLSPROUT)], hand: [], deck: deck('b'), discard: [],
    lostZone: [], prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const wheel = { actor: 'A', type: 'declareAttack', source: 'a1', name: 'Energizer Wheel' } as unknown as NeutralAction;
function legal(r: ReturnType<typeof step>): string[] {
  return (r.pending?.legalActions || []).map(a => {
    const x = a as { type: string, card?: string, target?: string };
    return [x.type, x.card, x.target].filter(v => v !== undefined).join(':');
  }).sort();
}

describe('TA-491 a forced all-N-of-N move collapses', () => {
  it('two [D] and one Benched Pokemon: no pick is surfaced, both [D] are on the Bench [TA-491 par-121]', () => {
    const r = step(board([DARK, DARK], 1), [wheel]);
    expect(legal(r).some(a => a.startsWith('moveEnergy'))).toBe(false);
    expect(r.state.players.A.bench[0].energy.map(e => e.iid).sort()).toEqual(['a1e0', 'a1e1']);
  });

  it('control: three [D] and one Benched Pokemon still surfaces which two move [TA-491 par-121]', () => {
    // TA-769 / B.120 (amended, owner 2026-10-25), B.116: the one Benched Pokémon is not asked; the three Energy are offered
    // alone (choose {target: card}), not as moveEnergy pairs.
    const r = step(board([DARK, DARK, DARK], 1), [wheel]);
    expect(legal(r).filter(a => a.startsWith('moveEnergy')).length).toBe(0);
    expect(legal(r).filter(a => a.startsWith('choose')).length).toBe(3);
  });
});
