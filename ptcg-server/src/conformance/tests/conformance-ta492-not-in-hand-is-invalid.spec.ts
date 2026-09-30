import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, CardRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-492 / CF-52 — a main-menu action naming a real card that is not in the actor's hand is an illegal action:
 * HTTP 200 + invalidAction (INVALID_TARGET, as rotomancer answers), not an adapter fault. handIndexOf threw a plain
 * Error (engineFault / HTTP 500) — the unoffered-card sibling of lookupCard's unknown-iid fix.
 *
 * Mutation guard: restore the plain Error and both cells throw instead of returning invalidAction.
 */

const GRASS = 'sve-001';

function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false } as PlayerFlags;
}
function mon(iid: string, printing: string): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false } };
}
function prizes(tag: string): PrizeRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function deck(tag: string): CardRef[] {
  return Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS }));
}
function board(): NeutralState {
  const A: PlayerState = { active: mon('a1', 'asc-004'), bench: [], hand: [{ iid: 'ah0', printing: GRASS }], deck: deck('a'),
    discard: [{ iid: 'ax0', printing: GRASS }, { iid: 'ax1', printing: 'asc-004' }], lostZone: [], prizes: prizes('a'), flags: flags() };
  const B: PlayerState = { active: mon('b1', 'asc-004'), bench: [], hand: [], deck: deck('b'), discard: [], lostZone: [],
    prizes: prizes('b'), flags: flags() };
  return { schemaVersion: SCHEMA_VERSION, format: 'unlimited', turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const act = (a: object) => a as unknown as NeutralAction;

describe('TA-492 a card not in hand is an invalid action, not a fault', () => {
  it('attachEnergy of a discarded Energy is invalidAction INVALID_TARGET [TA-492 cf-52]', () => {
    const r = step(board(), [act({ actor: 'A', type: 'attachEnergy', card: 'ax0', target: 'a1' })]) as any;
    expect(r.status).toBe('invalidAction');
    expect(r.reasonCode).toBe('INVALID_TARGET');
  });
  it('benchBasic of a discarded Basic is invalidAction [TA-492 cf-52]', () => {
    const r = step(board(), [act({ actor: 'A', type: 'benchBasic', card: 'ax1' })]) as any;
    expect(r.status).toBe('invalidAction');
  });
});
