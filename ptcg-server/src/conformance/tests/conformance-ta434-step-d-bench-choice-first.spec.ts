import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-434 — an attack that "also does N damage to 1 of your opponent's Benched Pokémon" makes a Step-D
 * choice ("you would make that choice now"), which must be pended BEFORE the base damage and the
 * self-Energy discard. Blaziken dri-042 Inferno Kick Flurry (120 to the Active; discard 2; 120 to a
 * Benched Pokémon). Before the fix twinleaf applied the 120 base damage and pended the Energy discard
 * first, so the Bench choice came last with the Active already at 120; rotomancer pends the Bench choice
 * first with the Active at 0. Mutation guard: restore the old order (base damage + discard before the
 * Bench prompt) and the first pending is the discard with a `damaged` event already emitted.
 */

const BLAZIKEN = 'Blaziken DRI';
const FIRE = 'Fire Energy SVE';
const RALTS = 'Ralts SIT';

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
  return { ...ps, prizes: Array.from({ length: 3 }, (_, i) => ({ iid: `${tag}p${i}`, printing: RALTS, faceUp: false })), deck: Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: FIRE })) };
}
const ralts = (iid: string): PokemonInPlay => ({ stack: [{ iid, printing: RALTS }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() });
const blaziken = (): PokemonInPlay => ({
  stack: [{ iid: 'a0', printing: BLAZIKEN }],
  energy: [0, 1, 2].map(i => ({ iid: `ae${i}`, printing: FIRE })), tools: [], damage: 0, conditions: [], markers: markers(),
});

function board(): NeutralState {
  // A's Active Blaziken attacks; B's Active plus TWO Bench Pokémon (so the Bench choice is a real pick).
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: wd(player({ active: blaziken() }), 'A'),
      B: wd(player({ active: ralts('b0'), bench: [ralts('bb0'), ralts('bb1')] }), 'B'),
    },
  };
}
const attack: NeutralAction = { actor: 'A', type: 'declareAttack', source: 'a0', name: 'Inferno Kick Flurry' };
const evKinds = (r: ReturnType<typeof step>) => (r.events ?? []).map((e: { kind: string }) => e.kind);

describe('TA-434 the Bench-target choice is pended first (Step D)', () => {
  it('the first pending is the Bench choice, with the Active undamaged and no damaged event yet', () => {
    const r = step(board(), [attack]);
    expect(r.pending?.descriptor).toContain('CHOOSE_POKEMON_TO_DAMAGE');
    // The choice offers the two Bench Pokémon.
    const targets = (r.pending?.legalActions ?? []).filter((a: { type: string }) => a.type === 'choose');
    expect(targets.length).toBe(2);
    // No damage has been applied yet: the Active base damage and the `damaged` event come AFTER the choice.
    expect(r.state.players.B.active!.damage).toBe(0);
    expect(evKinds(r)).not.toContain('damaged');
  });
});
