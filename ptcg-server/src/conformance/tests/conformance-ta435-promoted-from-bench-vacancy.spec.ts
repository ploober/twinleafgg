import { deriveEvents } from '../events';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION,
} from '../neutral-types';

/**
 * TA-435 — `promotedFromBench` is a FORCED KO-replacement promote (CF-36), i.e. the Active spot was
 * VACANT and a Benched Pokemon filled it. The engine's forced-promotion path (`applyPromotion`) only
 * runs from a `CHOOSE_NEW_ACTIVE_POKEMON` prompt and requires an empty Active, so it always shows as
 * empty->filled; a switch/retreat (`switchPokemon`) swaps active<->bench and is always
 * occupied->occupied. The old state-diff heuristic misfired on switch-then-KO (the attack switches the
 * defender to the Bench then KOs it there), emitting a phantom `promotedFromBench` rotomancer did not.
 *
 * These drive `deriveEvents` directly on crafted before/after states. Mutation guard: revert to the
 * "Active iid changed AND old Active no longer in play" heuristic and test 2 reds (the phantom returns).
 */

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(iid: string, printing = 'sve-003'): PokemonInPlay {
  return { stack: [{ iid, printing }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function state(A: PlayerState, B: PlayerState): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 6, activePlayer: 'A', firstPlayer: 'B',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A, B },
  };
}
const promotes = (evs: ReturnType<typeof deriveEvents>) =>
  evs.filter(e => (e as { kind: string }).kind === 'promotedFromBench') as unknown as Array<{ pokemon: string }>;

describe('TA-435 promotedFromBench is the vacancy->filled transition, not a switch', () => {

  it('1. a forced promotion (Active empty -> Benched Pokemon fills it) emits promotedFromBench', () => {
    const before = state(player(), player({ active: null, bench: [pip('b_new')] }));
    const after = state(player(), player({ active: pip('b_new'), bench: [] }));
    const evs = promotes(deriveEvents(before, after, []));
    expect(evs.length).toBe(1);
    expect(evs[0]).toEqual({ kind: 'promotedFromBench', pokemon: 'b_new' } as never);   // B.134: no player
  });

  it('2. switch-then-KO (Active occupied -> occupied; the switched-out Active is KO\'d off the Bench) emits NOTHING', () => {
    // before: B active = old, bench = the switched-in candidate. after: the switch put `new` active,
    // `old` was pushed to the Bench and KO'd there -> now in the discard. Active never went vacant.
    const before = state(player(), player({ active: pip('b_old'), bench: [pip('b_new')] }));
    const after = state(player(), player({ active: pip('b_new'), bench: [], discard: [{ iid: 'b_old', printing: 'sve-003' } as CardRef] }));
    expect(promotes(deriveEvents(before, after, [])).length).toBe(0);
  });

  it('3. a voluntary switch/retreat (occupied -> occupied, old Active back on the Bench) emits NOTHING', () => {
    const before = state(player(), player({ active: pip('b_old'), bench: [pip('b_new')] }));
    const after = state(player(), player({ active: pip('b_new'), bench: [pip('b_old')] }));
    expect(promotes(deriveEvents(before, after, [])).length).toBe(0);
  });
});
