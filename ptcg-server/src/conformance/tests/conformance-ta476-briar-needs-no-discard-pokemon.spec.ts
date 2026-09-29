import { step } from '../driver';
import { NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PrizeRef, SCHEMA_VERSION } from '../neutral-types';

/**
 * TA-476 — Briar scr-132: "You can use this card only if your opponent has exactly 2 Prize cards remaining."
 * That is the whole play condition. twinleaf's `canPlay` also demanded a Pokemon in the player's discard pile
 * (not printed), so Briar was dead in hand on an empty discard while rotomancer played it.
 *
 * Mutation guard: restore the discard test in briar.ts and the empty-discard cell goes red. The 3-Prize
 * control pins that the printed condition still refuses.
 */

const BRIAR = 'scr-132';
const MUNKIDORI = 'twm-095';
const GRASS = 'sve-001';

function flags(prizesTaken: number): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false,
    cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false, prizesTaken } as PlayerFlags;
}
function mon(iid: string): PokemonInPlay {
  return {
    stack: [{ iid, printing: MUNKIDORI }], energy: [], tools: [], damage: 0, conditions: [],
    markers: { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false },
  };
}
function prizes(tag: string, n: number): PrizeRef[] {
  return Array.from({ length: n }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false }));
}
function board(opponentPrizes: number): NeutralState {
  const A: PlayerState = { active: mon('a0'), bench: [], hand: [{ iid: 'ah0', printing: BRIAR }],
    deck: [{ iid: 'ad0', printing: GRASS }], discard: [], lostZone: [], prizes: prizes('a', 6), flags: flags(0) };
  const B: PlayerState = { active: mon('b0'), bench: [], hand: [], deck: [{ iid: 'bd0', printing: GRASS }], discard: [],
    lostZone: [], prizes: prizes('b', opponentPrizes), flags: flags(6 - opponentPrizes) };
  return { schemaVersion: SCHEMA_VERSION, format: 'standard', turn: 5, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B } };
}
const briar = { actor: 'A', type: 'playSupporter', card: 'ah0' } as unknown as NeutralAction;

describe('TA-476 Briar needs no Pokemon in the discard pile', () => {
  it('opponent at exactly 2 Prizes, empty discard: Briar is played [TA-476 scr-132]', () => {
    const r = step(board(2), [briar]);
    expect(r.status).toBe('awaitingAction');
    expect(r.state.players.A.flags.supporterPlayedThisTurn).toBe(true);
    expect(r.state.players.A.hand).toEqual([]);
  });

  it('opponent at 3 Prizes: the printed condition still refuses (control) [TA-476 scr-132]', () => {
    const r = step(board(3), [briar]);
    expect(r.status).toBe('invalidAction');
  });
});
