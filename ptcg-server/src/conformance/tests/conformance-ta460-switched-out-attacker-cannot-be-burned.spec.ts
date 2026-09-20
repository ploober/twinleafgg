import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-460 — a damage-response Special Condition must NOT land on an attacker that has already left the
 * Active Spot.
 *
 * CF-74 / §B.53 (FX-0314, 2026-09-18) moved the "when damaged by an attack" window AFTER the attack's own
 * trailing effects (#2172, Advanced Rulebook II E-03). Correct order — but it opened a hole: Strafe
 * ("You may switch this Pokémon with 1 of your Benched Pokémon") now resolves BEFORE Incandescent Body
 * ("the Attacking Pokémon is now Burned"), so when the burn fires the attacker is on the Bench, and
 * twinleaf burned it there. Special Conditions can only exist on an Active Pokémon (rulebook, "Special
 * Conditions": "They can only happen to an Active Pokémon — when a Pokémon goes to the Bench, it recovers
 * from all Special Conditions"; compendium #891: "Benching a Pokemon removes all Special Conditions ...
 * including Poisoned and Burned"). Rotomancer, under the same pinned order, leaves the switched-out
 * Latias unburned. Surfaced by the 2026-09-20 full fuzz as INV|cond-bench (asc-027 / asc-223 / twm-123
 * into meg-181 Strafe, 594 occurrences).
 *
 * Board: A's Numel asc-027 (Incandescent Body) Active; B's Mega Latias ex meg-181 Active with one Energy
 * and exactly one Benched Pokémon (Bellsprout asc-004), so Strafe's switch collapses to the confirm.
 *   - confirm:true  -> Latias switches out; NEITHER of B's Pokémon may carry a Special Condition.
 *   - confirm:false -> Latias stays Active; it IS Burned (the trigger still fires — the control).
 *
 * Mutation guard: revert the drain guard in game-effect.ts and the first spec fails (burned on the bench).
 */

const NUMEL = 'asc-027';
const MEGA_LATIAS = 'meg-181';
const BELLSPROUT = 'asc-004';
const GRASS = 'sve-001';
const WATER = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function wd(ps: PlayerState, tag: string): PlayerState {
  return {
    ...ps,
    prizes: Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    deck: Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })),
  };
}
const numel = (): PokemonInPlay => ({
  stack: [{ iid: 'n0', printing: NUMEL }], energy: [], tools: [], damage: 0, conditions: [], markers: markers(),
});
const latias = (): PokemonInPlay => ({
  stack: [{ iid: 'l0', printing: MEGA_LATIAS }],
  energy: [{ iid: 'le0', printing: GRASS }], tools: [], damage: 0, conditions: [], markers: markers(),
});
const bellsprout = (): PokemonInPlay => ({
  stack: [{ iid: 'b0', printing: BELLSPROUT }], energy: [], tools: [], damage: 0, conditions: [], markers: markers(),
});

function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: wd(player({ active: numel() }), 'A'),
      B: wd(player({ active: latias(), bench: [bellsprout()] }), 'B'),
    },
  };
}

const strafe: NeutralAction = { actor: 'B', type: 'declareAttack', source: 'l0', name: 'Strafe' };
const yes: NeutralAction = { actor: 'B', type: 'confirm', value: true };
const no: NeutralAction = { actor: 'B', type: 'confirm', value: false };
const top = (p: PokemonInPlay | null) => (p ? p.stack[p.stack.length - 1].printing : null);

describe('TA-460 a switched-out attacker cannot be afflicted by a damage-response Special Condition', () => {
  it('Strafe + switch: Incandescent Body fires after the switch and the benched Latias is NOT Burned', () => {
    const r = step(board(), [strafe, yes]);
    expect(r.applied).toBe(2);
    const B = r.state.players.B;
    expect(top(B.active)).toBe(BELLSPROUT);
    const benched = B.bench.filter(p => p !== null) as PokemonInPlay[];
    expect(benched.map(top)).toEqual([MEGA_LATIAS]);
    // The rule under test: nothing on B's side carries a Special Condition once Latias is on the Bench.
    expect(benched[0].conditions).toEqual([]);
    expect((B.active as PokemonInPlay).conditions).toEqual([]);
    // The damage itself still happened (Numel took Strafe's 40).
    expect((r.state.players.A.active as PokemonInPlay).damage).toBe(40);
  });

  it('control — Strafe without the switch: the still-Active Latias IS Burned by Incandescent Body', () => {
    const r = step(board(), [strafe, no]);
    expect(r.applied).toBe(2);
    const B = r.state.players.B;
    expect(top(B.active)).toBe(MEGA_LATIAS);
    expect((B.active as PokemonInPlay).conditions).toEqual(['burned']);
  });
});
