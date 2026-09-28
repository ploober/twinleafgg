import { State } from '../../../game/store/state/state';
import { projectState } from '../../state-adapter';
import {
  NeutralState, PlayerState, PokemonInPlay, CardRef, PrizeRef, NeutralPlayerId
} from '../../neutral-types';
import { synthCtx } from './raw-snapshot';

/**
 * Tier 2 — replay-fidelity support (testing design doc §5).
 *
 * After driving the same scenario through both the adapter and the engine's native driver, the two
 * raw states legitimately differ in incidental internals (the two paths enter the engine at slightly
 * different points — `useAttack` vs `declareAttack`→`AttackAction` — leaving different transient
 * markers/logs/lastAttack; design §9). What must agree is the *conformance-observable* projection. So
 * we compare canonicalized neutral projections.
 *
 * `projectNative` reuses the REAL `projectState` (with a synthetic ctx) so projection is applied
 * identically to both sides — projection bugs cancel, isolating **dispatch** fidelity (projection
 * correctness is Tier 1's job). `canonicalize` strips iids, which differ by construction: card
 * *printing* + structure is the engine-neutral identity. Ordered zones keep order; unordered zones
 * (hand/discard/lostZone — neutral contract compares them as multisets) are sorted by printing.
 */

/** Project a native (non-conformance) state through the real projection, via a synthetic iid ctx. */
export function projectNative(state: State): NeutralState {
  return projectState(state, synthCtx(state));
}

// ── canonical (iid-free) neutral shapes ──

interface CanonSlot {
  stack: string[];
  energy: string[];
  tools: string[];
  damage: number;
  conditions: string[];
  markers: PokemonInPlay['markers'];
  poisonDamagePerTurn?: number;
}

interface CanonPlayer {
  active: CanonSlot | null;
  bench: CanonSlot[];
  hand: string[];     // multiset: sorted by printing
  deck: string[];     // ordered
  discard: string[];  // multiset: sorted by printing
  lostZone: string[]; // multiset: sorted by printing
  prizes: Array<{ printing: string; faceUp: boolean }>; // ordered
  flags: PlayerState['flags'];
}

export interface CanonicalNeutral {
  turn: number;
  activePlayer: NeutralPlayerId;
  firstPlayer: NeutralPlayerId | null; // CF-84: null during setup before the goFirst decision
  phase: string;
  outcome: string;
  stadium: { printing: string; owner: NeutralPlayerId } | null;
  players: { A: CanonPlayer; B: CanonPlayer };
}

const printing = (c: CardRef): string => c.printing;
const sortedPrintings = (cards: CardRef[]): string[] => cards.map(printing).sort();

function canonSlot(pip: PokemonInPlay): CanonSlot {
  const slot: CanonSlot = {
    stack: pip.stack.map(printing),          // ordered basic -> top
    energy: pip.energy.map(printing),        // ordered
    tools: pip.tools.map(printing).sort(),   // order between tools is not semantic
    damage: pip.damage,
    conditions: pip.conditions.slice().sort(),
    markers: pip.markers,
  };
  if (pip.poisonDamagePerTurn !== undefined) {
    slot.poisonDamagePerTurn = pip.poisonDamagePerTurn;
  }
  return slot;
}

function canonPlayer(ps: PlayerState): CanonPlayer {
  return {
    active: ps.active ? canonSlot(ps.active) : null,
    bench: ps.bench.map(canonSlot),
    hand: sortedPrintings(ps.hand),
    deck: ps.deck.map(printing),
    discard: sortedPrintings(ps.discard),
    lostZone: sortedPrintings(ps.lostZone),
    prizes: ps.prizes.map((p: PrizeRef) => ({ printing: p.printing, faceUp: p.faceUp })),
    flags: ps.flags,
  };
}

export function canonicalize(ns: NeutralState): CanonicalNeutral {
  return {
    turn: ns.turn,
    activePlayer: ns.activePlayer,
    firstPlayer: ns.firstPlayer,
    phase: ns.phase,
    outcome: ns.outcome,
    stadium: ns.stadium ? { printing: ns.stadium.printing, owner: ns.stadium.owner } : null,
    players: { A: canonPlayer(ns.players.A), B: canonPlayer(ns.players.B) },
  };
}
