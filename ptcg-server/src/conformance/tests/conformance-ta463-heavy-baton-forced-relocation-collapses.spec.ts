import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-463 — a FORCED single in-play Energy relocation collapses (CF-14): Heavy Baton on a KO with ONE bencher.
 *
 * Heavy Baton `tef-151` (Tool): when the Pokémon this is attached to is Knocked Out by damage from an
 * opponent's attack, move all Basic Energy from it to 1 of your Benched Pokémon. With exactly one Basic
 * Energy and exactly one Benched Pokémon the relocation has ONE possible resolution — no decision content
 * (CF-14, the decomposer's own TA-124/TA-239 rationale) — so the driver applies it atomically and the KO
 * cascade continues to the opponent's Prize take. Rotomancer does exactly that.
 *
 * The regression: FX-0331 (2026-09-21) excluded EVERY in-play relocation from the attach-energy
 * decomposer's forced-step collapse to make Photon Cord pbl-028 agree with rotomancer, which SURFACES that
 * forced move (rotomancer's own CF-14 non-conformance, the RE-60 shape — filed separately). That bought
 * agreement on Photon Cord at the price of correctness on Heavy Baton: the lone pick was surfaced as a
 * 1-option `moveEnergy` pending with the KO unresolved, the only FAIL of the 2026-09-28 scenario suite
 * (`heavy-baton-1992-single-energy-actually-lands-on-the-bencher`). Correctness, not agreement.
 *
 * Board = that scenario's: A's bearer por-039 at 90 damage with one [F] and Heavy Baton, Brute Bonnet
 * benched; B's Pecharunt uses Pouncing Trap (30) for the KO. Assertions are the EFFECT and the cascade, never
 * a surfaced pending (cf14-assert-effect-not-pending).
 *
 * Mutation guard: re-add the in-play-relocation exclusion to attach-energy.ts atomicStep and all three
 * cells fail (the lone pick is surfaced again).
 */

const BEARER = 'por-039';
const HEAVY_BATON = 'tef-151';
const BRUTE_BONNET = 'twm-118';
const PECHARUNT = 'asc-062';
const FIGHTING = 'sve-006';
const LIGHTNING = 'sve-004';
const WATER = 'sve-003';

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function wd(ps: PlayerState, tag: string): PlayerState {
  return {
    ...ps,
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: WATER, faceUp: false })),
    deck: Array.from({ length: 4 }, (_, i) => ({ iid: `${tag}d${i}`, printing: WATER })) as CardRef[],
  };
}
function bearer(): PokemonInPlay {
  return { stack: [{ iid: 'a1', printing: BEARER }], energy: [{ iid: 'a1e0', printing: FIGHTING }], tools: [{ iid: 'a1t0', printing: HEAVY_BATON }], damage: 90, conditions: [], markers: markers() };
}
function bruteBonnet(): PokemonInPlay {
  return { stack: [{ iid: 'a2', printing: BRUTE_BONNET }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function pecharunt(): PokemonInPlay {
  return { stack: [{ iid: 'b1', printing: PECHARUNT }], energy: [{ iid: 'b1e0', printing: LIGHTNING }], tools: [], damage: 0, conditions: [], markers: markers() };
}
function board(): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: wd(player({ active: bearer(), bench: [bruteBonnet()] }), 'A'),
      B: wd(player({ active: pecharunt() }), 'B'),
    },
  };
}
const attack: NeutralAction = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pouncing Trap' };

function inPlay(r: ReturnType<typeof step>): PokemonInPlay[] {
  return [r.state.players.A.active, ...r.state.players.A.bench].filter(p => p !== null) as PokemonInPlay[];
}

describe('TA-463 Heavy Baton: a forced single relocation on the KO is applied atomically (CF-14), not surfaced', () => {
  it('no 1-option moveEnergy pending after the KO-ing attack', () => {
    const r = step(board(), [attack]);
    const la = r.pending?.legalActions ?? [];
    expect(la.some(a => (a as { type: string }).type === 'moveEnergy')).toBe(false);
  });

  it('the effect happened: the [F] Energy is on Brute Bonnet', () => {
    const r = step(board(), [attack]);
    const receiver = inPlay(r).find(p => p.stack[p.stack.length - 1].printing === BRUTE_BONNET);
    expect(receiver).toBeDefined();
    expect(receiver!.energy.map(e => e.printing)).toContain(FIGHTING);
  });

  it('the KO cascade proceeded: the pending is B taking a Prize', () => {
    const r = step(board(), [attack]);
    expect(r.pending?.actor).toBe('B');
    expect((r.pending?.legalActions ?? []).some(a => (a as { type: string }).type === 'takePrize')).toBe(true);
  });
});
