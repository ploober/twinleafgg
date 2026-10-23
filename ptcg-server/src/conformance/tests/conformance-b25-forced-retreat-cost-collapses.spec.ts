import { step } from '../driver';
import {
  NeutralState, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers, CardRef, SCHEMA_VERSION, NeutralAction,
} from '../neutral-types';

/**
 * B.25 amended 2026-10-23 (owner) — a Retreat Cost that needs EVERY attached card is a forced pick and collapses.
 *
 * Until 2026-10-23 "retreat-cost Energy at exactly the cost" was one of B.25's structural steps and surfaced one
 * `discard` pending per card even when the payment was forced. The owner removed it from the structural set: it is the
 * same player mid-action paying a cost, the shape CF-14's 2026-09-09 addendum already collapses for an attack's forced
 * N-of-N discard. "Forced" is `forcedFullPick`'s test — no proper subset of the attached Energy pays the cost — not
 * "card count = cost" (TA-439's Wild Growth board stays a real choice and keeps its own spec).
 *
 * Mutation guard: drop the `retreatCost` exemption in `forcedFullPick` → tests 1 and 2 see a `discard` pending again.
 * Test 3 is the negative control: two Energy for a cost of 1 is a real choice and must still pend.
 */

const GRASS = 'sve-001', FIRE = 'sve-003';
const BELLSPROUT = 'asc-004';   // Erika's Bellsprout, Retreat Cost 1 — also B's Active and A's Bench target
const GRUBBIN = 'asc-017';      // Grubbin, Retreat Cost 2

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
function board(activePrinting: string, energy: CardRef[]): NeutralState {
  const withZones = (ps: PlayerState, tag: string): PlayerState => ({
    ...ps,
    prizes: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}p${i}`, printing: GRASS, faceUp: false })),
    deck: Array.from({ length: 6 }, (_, i) => ({ iid: `${tag}d${i}`, printing: GRASS })),
  });
  const A = player({ active: pip([{ iid: 'a1s0', printing: activePrinting }], energy), bench: [pip([{ iid: 'ab0', printing: BELLSPROUT }])] });
  const B = player({ active: pip([{ iid: 'b0', printing: BELLSPROUT }]) });
  return {
    schemaVersion: SCHEMA_VERSION, turn: 3, activePlayer: 'A', firstPlayer: 'A',
    phase: 'main', outcome: 'ongoing', stadium: null, players: { A: withZones(A, 'A'), B: withZones(B, 'B') },
  };
}

const retreat: NeutralAction = { actor: 'A', type: 'retreat', to: 0 } as unknown as NeutralAction;
type Offer = { type: string; target?: string };
const offers = (r: ReturnType<typeof step>): Offer[] => (r.pending?.legalActions ?? []) as unknown as Offer[];

describe('B.25 (amended 2026-10-23) — a forced Retreat Cost payment collapses', () => {

  it('1. cost 1, one Energy attached: the retreat completes with no discard pending', () => {
    const r = step(board(BELLSPROUT, [{ iid: 'a1e0', printing: GRASS }]), [retreat]);
    expect(offers(r).some(o => o.type === 'discard')).toBe(false);
    expect(r.state.players.A.active!.stack.map(c => c.iid)).toEqual(['ab0']);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['a1e0']);
    expect(r.state.players.A.flags.retreatedThisTurn).toBe(true);
  });

  it('2. cost 2, exactly two one-unit Energy: both are paid at once, in attachment order', () => {
    const r = step(board(GRUBBIN, [{ iid: 'a1e0', printing: GRASS }, { iid: 'a1e1', printing: FIRE }]), [retreat]);
    expect(offers(r).some(o => o.type === 'discard')).toBe(false);
    expect(r.state.players.A.active!.stack.map(c => c.iid)).toEqual(['ab0']);
    expect(r.state.players.A.discard.map(c => c.iid)).toEqual(['a1e0', 'a1e1']);
  });

  it('3. negative control: cost 1 with two Energy attached is a real choice and still pends', () => {
    const r = step(board(BELLSPROUT, [{ iid: 'a1e0', printing: GRASS }, { iid: 'a1e1', printing: FIRE }]), [retreat]);
    const targets = offers(r).filter(o => o.type === 'discard').map(o => o.target).sort();
    expect(targets).toEqual(['a1e0', 'a1e1']);
  });
});
