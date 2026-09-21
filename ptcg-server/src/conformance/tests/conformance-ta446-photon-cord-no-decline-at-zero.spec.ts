import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-446 — Photon Cord `pbl-028` (an Ability) must NOT offer a decline at zero.
 *
 * Photon Cord: "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your
 * opponent's Pokémon, move up to 2 Basic [L] Energy cards from this Pokémon to 1 of your Benched Pokémon."
 *
 * Compendium #2301 (TPCi Rules Team 2026-02-19) splits the "up to X" floor by effect source: attacks get
 * 0..max, but "For other effects (such as the effects of Trainer cards and Abilities), you can choose any
 * number between 1 and the maximum." Photon Cord is an Ability, prints neither "may" nor "any amount", and
 * is not a search — so with an eligible Energy AND a Benched Pokémon the floor is 1: you must move one.
 *
 * The bug: twinleaf's AttachEnergyPrompt used `min: 0`, so at the KO window with one eligible Energy the
 * menu was [moveEnergy, confirm{value:false}] — the decline is not a legal resolution. Rotomancer offers
 * only [moveEnergy] and is right (RE-165 was filed the other way round first, then withdrawn; N-0221).
 *
 * Fixing this pays twice: the offer converges, and the golden scenario
 * `miraidon-pbl028-photon-cord-energy-lands-on-the-bencher` (goldenEvaluated:false while the menu diverged)
 * becomes a real differential guard for the TA-445 outcome.
 *
 * Mutation guard: restore `min: 0` in miraidon.ts and the first cell fails (the decline reappears).
 */

const MIRAIDON = 'pbl-028';
const BRUTE_BONNET = 'twm-118';
const PECHARUNT = 'asc-062';
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

/** Miraidon Active, 90 damage (Thunder-scarred), one [L] attached, one Benched Pokémon to receive it. */
function miraidon(): PokemonInPlay {
  return { stack: [{ iid: 'a1', printing: MIRAIDON }], energy: [{ iid: 'a1e0', printing: LIGHTNING }], tools: [], damage: 90, conditions: [], markers: markers() };
}
function bruteBonnet(): PokemonInPlay {
  return { stack: [{ iid: 'a2', printing: BRUTE_BONNET }], energy: [], tools: [], damage: 0, conditions: [], markers: markers() };
}
function pecharunt(): PokemonInPlay {
  return { stack: [{ iid: 'b1', printing: PECHARUNT }], energy: [{ iid: 'b1e0', printing: LIGHTNING }], tools: [], damage: 0, conditions: [], markers: markers() };
}

function board(withBench: boolean): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION, turn: 4, activePlayer: 'B', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null,
    players: {
      A: wd(player({ active: miraidon(), bench: withBench ? [bruteBonnet()] : [] }), 'A'),
      B: wd(player({ active: pecharunt() }), 'B'),
    },
  };
}

const attack: NeutralAction = { actor: 'B', type: 'declareAttack', source: 'b1', name: 'Pouncing Trap' };
const move: NeutralAction = { actor: 'A', type: 'moveEnergy', card: 'a1e0', target: 'a2', source: 'a1' } as NeutralAction;

describe('TA-446 Photon Cord pbl-028 floors a non-attack "up to X" at 1 (no decline at zero)', () => {
  it('the KO window offers moveEnergy but NOT confirm{value:false}', () => {
    const r = step(board(true), [attack]);
    const la = r.pending?.legalActions ?? [];
    expect(la.some(a => (a as { type: string }).type === 'moveEnergy')).toBe(true);
    expect(la.some(a => (a as { type: string }).type === 'confirm' && (a as { value?: boolean }).value === false)).toBe(false);
  });

  it('control — moving the one eligible Energy still works (lands on the Benched Pokémon)', () => {
    const r = step(board(true), [attack, move]);
    const benched = r.state.players.A.bench.filter(p => p !== null) as PokemonInPlay[];
    const receiver = benched.find(p => p.stack[p.stack.length - 1].printing === BRUTE_BONNET);
    expect(receiver).toBeDefined();
    expect(receiver!.energy.map(e => e.printing)).toContain(LIGHTNING);
  });

  it('feasibility — with NO Benched Pokémon the KO resolves without forcing an impossible move', () => {
    // The floor is 1 only when a move is possible; with nothing to receive the Energy the window must not
    // deadlock on an unsatisfiable min:1 prompt.
    expect(() => step(board(false), [attack])).not.toThrow();
  });
});
