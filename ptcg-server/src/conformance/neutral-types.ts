/**
 * Engine-neutral wire types for the stateless conformance API.
 *
 * These mirror the contract in docs/conformance/conformance-api-design.md (§4, §6, §7).
 * They are deliberately engine-agnostic: the twinleaf adapter translates to/from these,
 * and a second engine implements the same shapes, so a differential harness can diff
 * the two engines' observable projections at single-decision granularity.
 *
 * Convention note for this (twinleaf) engine: the neutral `printing` is the twinleaf
 * `Card.fullName` (e.g. "Lightning Energy SVE"). The design doc's `sv4-54`-style ids are
 * illustrative of "some set-number identity"; the shared cross-engine card database that
 * reconciles the two id spaces is a separate, deferred concern (design §10, §13).
 */

export const SCHEMA_VERSION = '0.1';

export type Actor = 'A' | 'B' | 'system';

/** A player with genuine agency, and the projection key for each side. */
export type NeutralPlayerId = 'A' | 'B';

/**
 * A reference to a specific physical card.
 * `iid` is a stable per-game instance handle (lets an action/shuffle name one copy across
 * zones); `printing` is the card-DB identity used for cross-engine comparison.
 */
export interface CardRef {
  iid: string;
  printing: string;
}

export interface PrizeRef extends CardRef {
  faceUp: boolean;
}

/** The canonical special-condition token set (a set; asleep/paralyzed/confused are exclusive). */
export type ConditionToken = 'poisoned' | 'burned' | 'asleep' | 'paralyzed' | 'confused';

/**
 * Per-Pokemon positional markers that are NOT re-derivable from the board each step.
 * (Continuous, board-derivable modifiers are recomputed, not stored — design §6.3.)
 */
export interface PokemonMarkers {
  /** Turn the CURRENT evolution entered play. */
  playedOnTurn: number;
  /** Turn this Pokemon was promoted to Active; -1 = since setup / never promoted. */
  movedToActiveOnTurn: number;
  /** Damage taken this turn (for counterattack effects). */
  damageTakenThisTurn: number;
  /** Once-per-turn ability labels already fired by this Pokemon. */
  abilitiesUsedThisTurn: string[];
  /** Self-imposed attack lock carried into next turn. */
  cannotAttackNextTurn: boolean;
}

export interface PokemonInPlay {
  /** Evolution stack: [0] = basic (bottom, stable identity), [last] = current top. */
  stack: CardRef[];
  /** Attached energy (basic + special; special-energy effects are card-DB data). */
  energy: CardRef[];
  /** Attached Tool(s) — array for effect exceptions. */
  tools: CardRef[];
  /** HP units (counters x10); always a multiple of 10. */
  damage: number;
  conditions: ConditionToken[];
  /** Present only when raised above the default 10 by an effect. */
  poisonDamagePerTurn?: number;
  markers: PokemonMarkers;
}

/** Rules-observable per-turn / per-game gates (not raw engine bookkeeping). */
export interface PlayerFlags {
  supporterPlayedThisTurn: boolean;
  energyAttachedThisTurn: boolean;
  stadiumPlayedThisTurn: boolean;
  retreatedThisTurn: boolean;
  cardsPlayedThisTurn: number;
  prizesTakenThisTurn: number;
  prizesTakenLastTurn: number;
  /** Once-per-game VSTAR Power. */
  vstarUsed: boolean;
}

export interface PlayerState {
  active: PokemonInPlay | null;
  /** Ordered, max 5; position can be rules-relevant. */
  bench: PokemonInPlay[];
  /** Compared as a multiset. */
  hand: CardRef[];
  /** ORDERED, [0] = top of deck. */
  deck: CardRef[];
  /** Compared as a multiset. */
  discard: CardRef[];
  /** Count matters for Lost-Zone cards. */
  lostZone: CardRef[];
  /** Remaining prizes; taken by position. */
  prizes: PrizeRef[];
  flags: PlayerFlags;
}

export type Phase = 'setup' | 'main' | 'checkup' | 'gameOver';
export type Outcome = 'ongoing' | 'winA' | 'winB' | 'tie';

export interface StadiumRef extends CardRef {
  owner: NeutralPlayerId;
}

/**
 * The full observable state schema. Used both as request `initialState` (always a quiescent
 * boundary) and as the response `state` projection.
 */
export interface NeutralState {
  schemaVersion: string;
  /** Turn counter — drives "this/last turn" and first-turn rules. */
  turn: number;
  activePlayer: NeutralPlayerId;
  /** Who took the game's first turn (first-turn restrictions key on this). */
  firstPlayer: NeutralPlayerId;
  phase: Phase;
  outcome: Outcome;
  stadium: StadiumRef | null;
  players: { A: PlayerState; B: PlayerState };
  /** Deferred: timed effects that can't be re-derived from the board (design §6.3). */
  activeEffects?: unknown[];
}

// ── Actions (design §7) ───────────────────────────────────────────────────

export interface AttachEnergyAction {
  actor: NeutralPlayerId;
  type: 'attachEnergy';
  /** iid of the energy card in hand. */
  card: string;
  /** iid of the target Pokemon-in-play (its stack's bottom/basic iid). */
  target: string;
}

// The full vocabulary is broader (design §7); M0 only implements attachEnergy. Other action
// kinds are typed loosely until their milestone lands.
export interface UnimplementedAction {
  actor: Actor;
  type: string;
  [key: string]: unknown;
}

export type NeutralAction = AttachEnergyAction | UnimplementedAction;

// ── Response envelope (design §4.1) ───────────────────────────────────────

export type ResponseStatus = 'awaitingAction' | 'gameOver' | 'invalidAction';

export interface PendingDecision {
  actor: Actor;
  descriptor: string;
  legalActions: unknown[];
}

export interface StepResponse {
  status: ResponseStatus;
  /** Number of actions consumed from the log. */
  applied: number;
  pending: PendingDecision | null;
  events: unknown[];
  state: NeutralState;
}
