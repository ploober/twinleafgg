import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * TA-439 / #2127 (CF-4 shape) — a retreat cost paid by a multi-unit Energy may still discard MORE.
 *
 * Meganium meg-010 "Wild Growth": each Basic [G] Energy attached to your Pokémon provides [G][G].
 * Meganium's own Retreat Cost is [C][C], so ONE attached Grass basic pays it (2 units, 1 card).
 * Compendium #2127: "you can discard a number of Energy cards EQUAL TO the total Retreat Cost, OR
 * discard until you've fulfilled the requirement … a Retreat Cost of 2 you could discard either 1 or
 * 2" — so after the one sufficient card the player MAY discard a second (up to the cost's card count).
 *
 * Before the fix the conformance decomposer (`choose-energy.ts`) returned `null` the moment the picks
 * legally paid, so twinleaf completed the retreat with no further decision and never advertised the
 * optional extra discard — while rotomancer kept the pending open with the remaining Energy + a stop.
 * The fix, scoped to `CHOOSE_ENERGY_TO_PAY_RETREAT_COST` only, offers the remaining Energy plus the
 * CF-4 explicit stop (END_CHOICE → `confirm{value:false}`) once the cost is legally paid but fewer
 * cards than the cost length have been discarded, and completes at the card-count cap.
 *
 * Mutation guards: (1) revert `next()` to `return null` at sufficiency → test 2 sees the retreat
 * COMPLETE (main menu) with no over-payment pending; (2) drop the `hasDone` guard → the stop in test 3
 * re-offers the same pending forever instead of completing; (3) remove the `picked.length <
 * cost.length` cap → test 4 would keep offering a third discard past the cost count.
 */

const GRASS = 'sve-001';           // Basic Grass Energy — Wild Growth doubles it to [G][G]
const FIRE = 'sve-003';            // Basic Fire Energy — a plain 1-unit over-payment candidate
const CHIKORITA = 'asc-008', BAYLEEF = 'asc-009', MEGANIUM = 'meg-010'; // the Wild Growth stack
const WALL = 'asc-004';            // any Basic — the retreat/switch target and B's Active

function markers(): PokemonMarkers {
  return { playedOnTurn: 1, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function flags(): PlayerFlags {
  return { supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false, retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, prizesTaken: 0, vstarUsed: false };
}
function pip(stack: CardRef[], energy: CardRef[] = []): PokemonInPlay {
  return { stack, energy, tools: [], damage: 0, conditions: [], markers: markers() };
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return { active: null, bench: [], hand: [], deck: [], discard: [], lostZone: [], prizes: [], flags: flags(), ...over };
}
function board(): NeutralState {
  const withZones = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false })),
    deck: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
  });
  // A: Meganium Active carrying its own Wild Growth, one Grass basic (pays the whole [C][C] retreat)
  // plus three more Energy to over-pay with; one Benched Pokémon (the forced switch target).
  const A = player({
    active: pip(
      [{ iid: 'a1s0', printing: CHIKORITA }, { iid: 'a1s1', printing: BAYLEEF }, { iid: 'a1s2', printing: MEGANIUM }],
      [{ iid: 'a1e0', printing: GRASS }, { iid: 'a1e1', printing: GRASS }, { iid: 'a1e2', printing: FIRE }, { iid: 'a1e3', printing: FIRE }],
    ),
    bench: [pip([{ iid: 'ab0', printing: WALL }])],
  });
  const B = player({ active: pip([{ iid: 'b0', printing: WALL }]) });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: withZones(A, 'A'), B: withZones(B, 'B') },
  };
}

const retreat: NeutralAction = { actor: 'A', type: 'retreat', to: 0 } as unknown as NeutralAction;
const discard = (iid: string): NeutralAction => ({ actor: 'A', type: 'discard', target: iid } as unknown as NeutralAction);
const stop: NeutralAction = { actor: 'A', type: 'confirm', value: false } as unknown as NeutralAction;

type Offer = { type: string; target?: string; value?: boolean };
const offers = (r: ReturnType<typeof step>): Offer[] => (r.pending?.legalActions ?? []) as unknown as Offer[];
const types = (r: ReturnType<typeof step>) => offers(r).map(o => o.type).sort();

describe('TA-439 — a retreat paid by a multi-unit Energy still offers the optional extra discard (#2127)', () => {

  it('1. at the retreat cost pending, the cost is not yet paid, so every Energy is offered and NO stop', () => {
    const r = step(board(), [retreat]);
    expect(r.pending!.actor).toBe('A');
    // four discard candidates, no confirm-stop (min not yet satisfied — CF-4)
    expect(types(r)).toEqual(['discard', 'discard', 'discard', 'discard']);
    expect(offers(r).some(o => o.type === 'confirm')).toBe(false);
  });

  it('2. after the one Grass pays the whole [C][C] cost, the remaining Energy + an explicit stop are offered', () => {
    const r = step(board(), [retreat, discard('a1e0')]);
    expect(r.pending!.actor).toBe('A');
    // the three unpicked Energy, plus the CF-4 stop — this is the whole point (reverting the fix
    // completes the retreat here instead).
    expect(types(r)).toEqual(['confirm', 'discard', 'discard', 'discard']);
    const targets = offers(r).filter(o => o.type === 'discard').map(o => o.target).sort();
    expect(targets).toEqual(['a1e1', 'a1e2', 'a1e3']);
    const conf = offers(r).find(o => o.type === 'confirm');
    expect(conf!.value).toBe(false);
  });

  it('3. taking the stop completes the retreat (Meganium benched, only the one Grass discarded)', () => {
    const r = step(board(), [retreat, discard('a1e0'), stop]);
    // retreat resolved: the single Benched Pokémon is now Active, Meganium is on the Bench.
    expect(r.state.players.A.active!.stack.map(c => c.printing)).toEqual([WALL]);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0']);
    // back at A's own turn (no retreat pending re-offered — the hasDone guard).
    expect(offers(r).some(o => o.type === 'endTurn')).toBe(true);
  });

  it('4. taking a second discard reaches the card-count cap and completes (no third discard offered)', () => {
    const r = step(board(), [retreat, discard('a1e0'), discard('a1e1')]);
    expect(r.state.players.A.discard.map(c => c.iid).sort()).toEqual(['a1e0', 'a1e1']);
    expect(offers(r).some(o => o.type === 'endTurn')).toBe(true);
    expect(offers(r).some(o => o.type === 'discard')).toBe(false);
  });
});
