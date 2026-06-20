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

export interface BenchBasicAction {
  actor: NeutralPlayerId;
  type: 'benchBasic';
  /** iid of the basic Pokemon card in hand. */
  card: string;
}

export interface EvolveAction {
  actor: NeutralPlayerId;
  type: 'evolve';
  /** iid of the evolution card in hand. */
  card: string;
  /** iid of any card in the in-play Pokemon's stack to evolve. */
  target: string;
}

export interface AttachEnergyAction {
  actor: NeutralPlayerId;
  type: 'attachEnergy';
  /** iid of the energy card in hand. */
  card: string;
  /** iid of the target Pokemon-in-play (its stack's bottom/basic iid). */
  target: string;
}

export interface AttachToolAction {
  actor: NeutralPlayerId;
  type: 'attachTool';
  /** iid of the tool card in hand. */
  card: string;
  /** iid of the target Pokemon-in-play. */
  target: string;
}

export interface RetreatAction {
  actor: NeutralPlayerId;
  type: 'retreat';
  /** Destination bench slot index to promote into the active spot. */
  to: number;
}

export interface DeclareAttackAction {
  actor: NeutralPlayerId;
  type: 'declareAttack';
  /** iid of the attacking Pokemon-in-play (the active). */
  source: string;
  /** Attack name. */
  name: string;
}

export interface EndTurnAction {
  actor: NeutralPlayerId;
  type: 'endTurn';
}

// Trainer plays (M5). Each dispatches through twinleaf's PlayCardAction; the card's own effect
// then drives any follow-up prompts (decomposed / system) the same way an attack's do.
export interface PlayItemAction {
  actor: NeutralPlayerId;
  type: 'playItem';
  /** iid of the Item card in hand. */
  card: string;
}

export interface PlaySupporterAction {
  actor: NeutralPlayerId;
  type: 'playSupporter';
  /** iid of the Supporter card in hand. */
  card: string;
}

export interface PlayStadiumAction {
  actor: NeutralPlayerId;
  type: 'playStadium';
  /** iid of the Stadium card in hand. */
  card: string;
}

export interface UseAbilityAction {
  actor: NeutralPlayerId;
  type: 'useAbility';
  /** iid of the Pokemon-in-play whose ability is used (its stack's bottom/basic iid). */
  source: string;
  /** Ability name. */
  name: string;
}

// ── Single-pick actions (consumed by prompt decomposers, design §7) ────────
// These are NOT top-level dispatches; each answers one open single-decision pending. Cards are
// named by iid, which is globally unique in a game, so owner/from/to are conveniences — the adapter
// resolves the slot/owner from the iid.

export interface ChooseAction {
  actor: NeutralPlayerId;
  type: 'choose';
  /** iid of the chosen card (ChooseCardsPrompt) or Pokemon-in-play (ChoosePokemonPrompt). */
  target: string;
  owner?: NeutralPlayerId;
}

export interface PlaceCounterAction {
  actor: NeutralPlayerId;
  type: 'placeCounter';
  /** iid of the Pokemon-in-play to place one damage counter (10 HP) on. */
  target: string;
}

export interface MoveCounterAction {
  actor: NeutralPlayerId;
  type: 'moveCounter';
  /** iid of the source Pokemon-in-play. */
  from: string;
  /** iid of the destination Pokemon-in-play. */
  to: string;
}

export interface DiscardPickAction {
  actor: NeutralPlayerId;
  type: 'discard';
  /** iid of the energy card to discard (resolves its attached Pokemon/owner). */
  target: string;
  owner?: NeutralPlayerId;
}

/** Completes the current variable-count ("up to N") multi-pick decision. */
export interface EndChoiceAction {
  actor: NeutralPlayerId;
  type: 'endChoice';
}

// ── System actions (the `system` actor — design §5) ────────────────────────
// Randomness externalized to the action log: the harness supplies shuffle orders and coin faces.

export interface ShuffleSystemAction {
  actor: 'system';
  type: 'shuffle';
  /** The new deck order as iids ([0] = top of deck). A permutation of the pending's deck multiset. */
  order: string[];
}

export interface FlipSystemAction {
  actor: 'system';
  type: 'flip';
  face: 'heads' | 'tails';
}

// The full vocabulary is broader (design §7); milestones beyond M1 (abilities, prompt-mediated
// trainers, the system actor) are typed loosely until their milestone lands.
export interface UnimplementedAction {
  actor: Actor;
  type: string;
  [key: string]: unknown;
}

export type NeutralAction =
  | BenchBasicAction
  | EvolveAction
  | AttachEnergyAction
  | AttachToolAction
  | RetreatAction
  | DeclareAttackAction
  | EndTurnAction
  | PlayItemAction
  | PlaySupporterAction
  | PlayStadiumAction
  | UseAbilityAction
  | ChooseAction
  | PlaceCounterAction
  | MoveCounterAction
  | DiscardPickAction
  | EndChoiceAction
  | ShuffleSystemAction
  | FlipSystemAction
  | UnimplementedAction;

// ── Events (design §4.1, impl doc §4.8) ───────────────────────────────────
// Resolution trace for one step. Cards are named by display name (twinleaf logs carry no card id),
// so events are not iid-tagged in this first pass. `actor` is the neutral player who acted.

export type NeutralEvent =
  | { kind: 'benchedBasic'; actor: NeutralPlayerId; card: string }
  | { kind: 'evolved'; actor: NeutralPlayerId; card: string; pokemon: string }
  | { kind: 'attachedEnergy'; actor: NeutralPlayerId; card: string; pokemon: string }
  | { kind: 'attachedTool'; actor: NeutralPlayerId; card: string; pokemon: string }
  | { kind: 'drew'; actor: NeutralPlayerId }
  | { kind: 'usedAttack'; actor: NeutralPlayerId; attack: string }
  | { kind: 'dealtDamage'; actor: NeutralPlayerId; damage: number; target: string }
  | { kind: 'placedDamage'; actor: NeutralPlayerId; damage: number; target: string }
  | { kind: 'ko'; target: string }
  | { kind: 'retreated'; actor: NeutralPlayerId; from: string; to: string }
  | { kind: 'turnEnded'; actor: NeutralPlayerId }
  | { kind: 'turnStarted'; turn: number }
  | { kind: 'deckedOut'; actor: NeutralPlayerId }
  | { kind: 'usedAbility'; actor: NeutralPlayerId; ability: string };

// ── Response envelope (design §4.1) ───────────────────────────────────────

export type ResponseStatus = 'awaitingAction' | 'gameOver' | 'invalidAction';

/**
 * The candidate actions valid at the current pending decision (design §8). For a decomposed
 * aggregate prompt these are the single picks the open decision ranges over (Phase-1 legalActions,
 * impl §4.6); for a system pending, the shuffle/flip candidates.
 */
export type LegalAction =
  // Single picks inside a decomposed prompt (M2) and the system seam (M3).
  | { type: 'choose'; target: string; owner?: NeutralPlayerId }
  | { type: 'placeCounter'; target: string }
  | { type: 'moveCounter'; from: string; to: string }
  | { type: 'discard'; target: string; owner?: NeutralPlayerId }
  | { type: 'endChoice' }
  | { type: 'shuffle'; deck: string[] }
  | { type: 'flip'; face: 'heads' | 'tails' }
  // The main-phase top-level menu (M5). These mirror the dispatchable top-level NeutralActions, so
  // each entry is directly executable as the next action.
  | { type: 'benchBasic'; card: string }
  | { type: 'evolve'; card: string; target: string }
  | { type: 'attachEnergy'; card: string; target: string }
  | { type: 'attachTool'; card: string; target: string }
  | { type: 'playItem'; card: string }
  | { type: 'playSupporter'; card: string }
  | { type: 'playStadium'; card: string }
  | { type: 'retreat'; to: number }
  | { type: 'declareAttack'; source: string; name: string }
  | { type: 'useAbility'; source: string; name: string }
  | { type: 'endTurn' };

export interface PendingDecision {
  actor: Actor;
  descriptor: string;
  legalActions: LegalAction[];
}

/**
 * Why an action was rejected (design §4.9, M6). `reasonCode` is the engine-neutral normalized code
 * the conformance harness compares across engines; `message` is the raw engine string (twinleaf's
 * `GameMessage`) kept for diagnostics. `reasonCode` values are defined in rejection-codes.ts.
 */
export interface RejectionInfo {
  reasonCode: string;
  message: string;
}

export interface StepResponse {
  status: ResponseStatus;
  /** Number of actions consumed from the log (those applied before any rejection). */
  applied: number;
  pending: PendingDecision | null;
  events: NeutralEvent[];
  state: NeutralState;
  /** Present only when `status === 'invalidAction'`. */
  rejection?: RejectionInfo;
}
