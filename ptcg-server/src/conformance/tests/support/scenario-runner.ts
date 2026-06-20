import {
  SCHEMA_VERSION, NeutralState, NeutralAction, PlayerState, PokemonInPlay, PokemonMarkers, PlayerFlags
} from '../../neutral-types';
import { importState } from '../../state-adapter';
import { replay, projectGame } from '../../driver';
import {
  setupGame, SetupGameResult, SetupGameConfig, PlayerConfig, PokemonSlotConfig
} from '../../../sets/tests/test-helpers';
import {
  useAttack, useAbility, retreat, endTurn, playCardFromHand, collectAllCardIds
} from '../../../sets/tests/card-test-helpers';
import { PlayerType, SlotType, CardTarget } from '../../../game/store/actions/play-card-action';
import { snapshotRawState } from './raw-snapshot';
import { canonicalize, projectNative } from './canonical-neutral';
import { assertInvariants, withNoRandomness } from './invariants';

/**
 * Tier 2 — native-vs-adapter equivalence (testing design doc §5): the centerpiece fidelity oracle.
 *
 * A scenario is authored ONCE as a `BoardSpec` + `ScenarioStep[]`, then materialized two ways — the
 * conformance adapter (`importState`→`replay`) and the engine's own canonical headless driver
 * (`setupGame` + `card-test-helpers`). `runScenario` asserts the two paths agree, isolating
 * adapter-fidelity bugs (both sides are twinleaf).
 *
 * The `BoardSpec` is restricted to the **intersection** both builders can express identically (see
 * the design doc's table): per-slot card/energy/damage/tools, hand/deck/discard piles, a prize COUNT
 * (materialized as N× 'Water Energy SVE' face-down, matching the native `DEFAULT_FILLER`), and the
 * turn. Special conditions, an in-play stadium, and custom flags/markers are NOT presettable natively,
 * so scenarios induce them through *actions* instead — never via the board.
 */

// ── scenario vocabulary ──

export interface SlotSpec {
  card: string;
  energy?: string[];
  damage?: number;
  tools?: string[];
}

export interface SideSpec {
  active: SlotSpec;
  bench?: SlotSpec[];
  hand?: string[];
  deck?: string[];
  discard?: string[];
  prizeCount?: number;
}

export interface BoardSpec {
  turn: number;
  players: { A: SideSpec; B: SideSpec };
}

export type ScenarioStep =
  | { kind: 'attack'; name: string }
  | { kind: 'attachEnergy'; hand: number; target: 'active' | number }
  | { kind: 'evolve'; hand: number; target: 'active' | number }
  | { kind: 'benchBasic'; hand: number }
  | { kind: 'playStadium'; hand: number }
  | { kind: 'playItem'; hand: number }
  | { kind: 'playSupporter'; hand: number }
  | { kind: 'useAbility'; source: 'active' | number; name: string }
  | { kind: 'retreat'; to: number }
  | { kind: 'flip'; face: 'heads' }   // heads only — native is ALL_HEADS
  | { kind: 'endTurn' };

export interface Scenario {
  name: string;
  board: BoardSpec;
  steps: ScenarioStep[];
}

// Native `DEFAULT_FILLER`; the adapter fills prizes with the same printing so the raw boards match.
const PRIZE_FILLER = 'Water Energy SVE';

// ── iid scheme (shared by the neutral materializer and the step translator) ──
// Cards get stable, position-derived iids so a `ScenarioStep` (which references cards by hand index /
// slot) can reconstruct the exact iid the materializer assigned.

function slotIid(side: 'A' | 'B', target: 'active' | number): string {
  const where = target === 'active' ? 'act' : `b${target}`;
  return `${side}-${where}-s0`; // the basic (stack[0]) is the slot's targeting identity
}
const handIid = (side: 'A' | 'B', index: number): string => `${side}-h${index}`;

// ── neutral materializer ──

function defaultMarkers(): PokemonMarkers {
  // playedOnTurn 0 = "in play since before this game's tracked turns" → matches native's default and
  // keeps basics evolvable when the board uses turn >= 2.
  return { playedOnTurn: 0, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function defaultFlags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}

function buildPip(side: 'A' | 'B', where: string, spec: SlotSpec): PokemonInPlay {
  return {
    stack: [{ iid: `${side}-${where}-s0`, printing: spec.card }],
    energy: (spec.energy ?? []).map((p, i) => ({ iid: `${side}-${where}-e${i}`, printing: p })),
    tools: (spec.tools ?? []).map((p, i) => ({ iid: `${side}-${where}-t${i}`, printing: p })),
    damage: spec.damage ?? 0,
    conditions: [],
    markers: defaultMarkers(),
  };
}

function buildSide(side: 'A' | 'B', spec: SideSpec): PlayerState {
  const prizeCount = spec.prizeCount ?? 1;
  return {
    active: buildPip(side, 'act', spec.active),
    bench: (spec.bench ?? []).map((b, i) => buildPip(side, `b${i}`, b)),
    hand: (spec.hand ?? []).map((p, i) => ({ iid: handIid(side, i), printing: p })),
    deck: (spec.deck ?? []).map((p, i) => ({ iid: `${side}-d${i}`, printing: p })),
    discard: (spec.discard ?? []).map((p, i) => ({ iid: `${side}-disc${i}`, printing: p })),
    lostZone: [],
    prizes: Array.from({ length: prizeCount }, (_, i) => ({ iid: `${side}-pz${i}`, printing: PRIZE_FILLER, faceUp: false })),
    flags: defaultFlags(),
  };
}

export function materializeNeutral(board: BoardSpec): NeutralState {
  return {
    schemaVersion: SCHEMA_VERSION,
    turn: board.turn,
    activePlayer: 'A',
    firstPlayer: 'A',
    phase: 'main',
    outcome: 'ongoing',
    stadium: null,
    players: { A: buildSide('A', board.players.A), B: buildSide('B', board.players.B) },
  };
}

// ── native (setupGame) materializer ──

function nativeSlot(spec: SlotSpec): PokemonSlotConfig {
  return { card: spec.card, energy: spec.energy, damage: spec.damage, tools: spec.tools };
}
function nativeSide(spec: SideSpec): PlayerConfig {
  return {
    active: nativeSlot(spec.active),
    bench: (spec.bench ?? []).map(nativeSlot),
    hand: spec.hand,
    deck: spec.deck,
    discard: spec.discard,
    prizeCount: spec.prizeCount ?? 1,
  };
}
export function materializeNativeConfig(board: BoardSpec): SetupGameConfig {
  return { turn: board.turn, player1: nativeSide(board.players.A), player2: nativeSide(board.players.B) };
}

// ── step translation: adapter (NeutralAction[]) and native (driver calls) ──

export function stepToNeutralActions(steps: ScenarioStep[]): NeutralAction[] {
  const actions: NeutralAction[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case 'attack': actions.push({ actor: 'A', type: 'declareAttack', source: slotIid('A', 'active'), name: step.name }); break;
      case 'attachEnergy': actions.push({ actor: 'A', type: 'attachEnergy', card: handIid('A', step.hand), target: slotIid('A', step.target) }); break;
      case 'evolve': actions.push({ actor: 'A', type: 'evolve', card: handIid('A', step.hand), target: slotIid('A', step.target) }); break;
      case 'benchBasic': actions.push({ actor: 'A', type: 'benchBasic', card: handIid('A', step.hand) }); break;
      case 'playStadium': actions.push({ actor: 'A', type: 'playStadium', card: handIid('A', step.hand) }); break;
      case 'playItem': actions.push({ actor: 'A', type: 'playItem', card: handIid('A', step.hand) }); break;
      case 'playSupporter': actions.push({ actor: 'A', type: 'playSupporter', card: handIid('A', step.hand) }); break;
      case 'useAbility': actions.push({ actor: 'A', type: 'useAbility', source: slotIid('A', step.source), name: step.name }); break;
      case 'retreat': actions.push({ actor: 'A', type: 'retreat', to: step.to }); break;
      case 'flip': actions.push({ actor: 'system', type: 'flip', face: step.face }); break;
      case 'endTurn': actions.push({ actor: 'A', type: 'endTurn' }); break;
    }
  }
  return actions;
}

function handCardName(board: BoardSpec, index: number): string {
  const name = (board.players.A.hand ?? [])[index];
  if (name === undefined) { throw new Error(`[scenario] A.hand[${index}] is undefined`); }
  return name;
}
function nativeTarget(target: 'active' | number): CardTarget {
  return target === 'active'
    ? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
    : { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: target };
}

/** Drive the same steps through the engine's native headless helpers (player A === index 0). */
export function driveNative(game: SetupGameResult, steps: ScenarioStep[], board: BoardSpec): void {
  for (const step of steps) {
    switch (step.kind) {
      case 'attack': useAttack(game.store, game.state, 0, step.name); break;
      case 'endTurn': endTurn(game.store, game.state); break;
      case 'useAbility': useAbility(game.store, game.state, 0, step.name); break;
      case 'retreat': retreat(game.store, game.state, 0, step.to); break;
      case 'attachEnergy':
      case 'evolve':
        playCardFromHand(game.store, game.state, 0, handCardName(board, step.hand), nativeTarget(step.target));
        break;
      case 'benchBasic': {
        // first empty bench slot — matches the adapter's BenchBasicAction placement for an empty bench
        const benchIndex = game.state.players[0].bench.findIndex(b => b.getPokemonCard() === undefined);
        playCardFromHand(game.store, game.state, 0, handCardName(board, step.hand),
          { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: benchIndex });
        break;
      }
      case 'playStadium':
      case 'playItem':
      case 'playSupporter':
        playCardFromHand(game.store, game.state, 0, handCardName(board, step.hand)); // engine routes by card type
        break;
      case 'flip': break; // native inline flips resolve to heads on their own (ALL_HEADS)
    }
  }
}

// ── the runner ──

/**
 * Materialize a scenario both ways and assert agreement:
 *   1. Import fidelity  — deep raw-state snapshots of the freshly-built boards are identical.
 *   2. Replay fidelity  — after driving the steps, the canonicalized neutral projections are identical.
 * Both post-action states additionally satisfy the physical invariants (Step A). Driving runs under
 * `withNoRandomness`, enforcing that neither path reaches `Math.random` on the in-scope path.
 */
export function runScenario(scenario: Scenario): void {
  const neutral = materializeNeutral(scenario.board);
  const config = materializeNativeConfig(scenario.board);

  const adapterGame = importState(neutral);
  const nativeGame = setupGame(config);

  // 1. Import fidelity (pre-action) — adapter actual vs native oracle.
  expect(snapshotRawState(adapterGame.state)).toEqual(snapshotRawState(nativeGame.state));

  const adapterIdsBefore = collectAllCardIds(adapterGame.state);
  const nativeIdsBefore = collectAllCardIds(nativeGame.state);
  const actions = stepToNeutralActions(scenario.steps);

  withNoRandomness(() => {
    replay(adapterGame, actions);
    driveNative(nativeGame, scenario.steps, scenario.board);
  });

  assertInvariants(adapterGame.state, { idsBefore: adapterIdsBefore });
  assertInvariants(nativeGame.state, { idsBefore: nativeIdsBefore });

  // 2. Replay fidelity (post-action) — adapter actual vs native oracle.
  expect(canonicalize(projectGame(adapterGame))).toEqual(canonicalize(projectNative(nativeGame.state)));
}
