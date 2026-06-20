import { Card } from '../game/store/card/card';
import { Player } from '../game/store/state/player';
import { StateLog } from '../game/store/state/state-log';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import { AttackAction, PassTurnAction, RetreatAction as RetreatGameAction } from '../game/store/actions/game-actions';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { ImportedGame, IidContext, importState, projectState, actorIndex } from './state-adapter';
import { mapDelta } from './event-mapper';
import {
  NeutralState, NeutralAction, NeutralEvent, StepResponse, ResponseStatus,
  BenchBasicAction, EvolveAction, AttachEnergyAction, AttachToolAction,
  RetreatAction, DeclareAttackAction, EndTurnAction
} from './neutral-types';

/**
 * M1 driver: action mapper + event mapper for a full no-prompt turn.
 *
 * Maps the prompt-free player actions (bench / evolve / attach energy+tool / retreat / declare a
 * simple attack / end turn) onto twinleaf dispatches, captures the per-dispatch game-log delta as
 * neutral events, and projects the result. The only prompt it auto-acks is the attack-animation
 * WaitPrompt (engine plumbing, not a decision). Prompt decomposition (M2), the system actor (M3),
 * the clean checkup/turn-boundary bracketing (M4), legalActions/pending (M5) and HTTP (M6) are out
 * of scope; M1 boards are KO-free and condition-free so nothing else raises a prompt.
 */

function lookupCard(ctx: IidContext, iid: string, role: string): Card {
  const card = ctx.iidToCard.get(iid);
  if (card === undefined) {
    throw new Error(`[conformance] ${role} iid "${iid}" not found in this game`);
  }
  return card;
}

function handIndexOf(player: Player, card: Card, role: string, actor: string): number {
  const handIndex = player.hand.cards.indexOf(card);
  if (handIndex === -1) {
    throw new Error(`[conformance] ${role} is not in ${actor}'s hand`);
  }
  return handIndex;
}

/** CardTarget for a Pokemon-in-play the acting player owns, identified by any card in its stack. */
function resolveOwnPokemonTarget(player: Player, stackCard: Card): CardTarget {
  if (player.active.cards.includes(stackCard)) {
    return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  }
  for (let i = 0; i < player.bench.length; i++) {
    if (player.bench[i].cards.includes(stackCard)) {
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: i };
    }
  }
  throw new Error('[conformance] target is not a Pokemon in the acting player\'s play area');
}

function firstEmptyBenchIndex(player: Player): number {
  for (let i = 0; i < player.bench.length; i++) {
    if (player.bench[i].cards.length === 0) {
      return i;
    }
  }
  throw new Error('[conformance] no empty bench slot available for benchBasic');
}

// ── per-action dispatchers ────────────────────────────────────────────────

function dispatchBenchBasic(game: ImportedGame, action: BenchBasicAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const card = lookupCard(game.ctx, action.card, 'benchBasic.card');
  const handIndex = handIndexOf(player, card, 'benchBasic.card', action.actor);
  const index = firstEmptyBenchIndex(player);
  game.store.dispatch(new PlayCardAction(player.id, handIndex, {
    player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index
  }));
}

function dispatchEvolve(game: ImportedGame, action: EvolveAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const evoCard = lookupCard(game.ctx, action.card, 'evolve.card');
  const handIndex = handIndexOf(player, evoCard, 'evolve.card', action.actor);
  const targetCard = lookupCard(game.ctx, action.target, 'evolve.target');
  const target = resolveOwnPokemonTarget(player, targetCard);
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchAttachEnergy(game: ImportedGame, action: AttachEnergyAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const energyCard = lookupCard(game.ctx, action.card, 'attachEnergy.card');
  const handIndex = handIndexOf(player, energyCard, 'attachEnergy.card', action.actor);
  const targetCard = lookupCard(game.ctx, action.target, 'attachEnergy.target');
  const target = resolveOwnPokemonTarget(player, targetCard);
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchAttachTool(game: ImportedGame, action: AttachToolAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const toolCard = lookupCard(game.ctx, action.card, 'attachTool.card');
  const handIndex = handIndexOf(player, toolCard, 'attachTool.card', action.actor);
  const targetCard = lookupCard(game.ctx, action.target, 'attachTool.target');
  const target = resolveOwnPokemonTarget(player, targetCard);
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchRetreat(game: ImportedGame, action: RetreatAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  // RetreatAction carries the destination bench index, so no bench ChoosePokemonPrompt fires;
  // M1 boards keep retreat cost 0 or exactly/identically payable so no ChooseEnergyPrompt fires.
  game.store.dispatch(new RetreatGameAction(player.id, action.to));
}

function dispatchDeclareAttack(game: ImportedGame, action: DeclareAttackAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const sourceCard = lookupCard(game.ctx, action.source, 'declareAttack.source');
  if (!player.active.cards.includes(sourceCard)) {
    throw new Error('[conformance] declareAttack.source is not the acting player\'s active Pokemon');
  }
  game.store.dispatch(new AttackAction(player.id, action.name));
  resolveAttackAnimation(game);
}

function dispatchEndTurn(game: ImportedGame, action: EndTurnAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  game.store.dispatch(new PassTurnAction(player.id));
}

/**
 * Drive the attack generator past its animation WaitPrompt(s). Each is engine plumbing, not a
 * decision. It must be resolved with a non-undefined value (`true`): Store.reducePrompt only fires
 * the continuation when results are !== undefined, and Prompt.decode returns the value as-is. After
 * this, the attack has dealt damage and run EndTurnEffect -> the full turn boundary (turn++, active
 * player flip, mandatory draw).
 */
function resolveAttackAnimation(game: ImportedGame): void {
  for (;;) {
    const wait = game.state.prompts.find(p => p.result === undefined && p.type === 'WaitPrompt');
    if (wait === undefined) {
      break;
    }
    game.store.dispatch(new ResolvePromptAction(wait.id, true));
  }
  if (game.handler.isBlocked()) {
    throw new Error('[conformance] attack left a non-animation prompt pending (out of M1 scope)');
  }
}

/**
 * Map and dispatch a single neutral action, returning the game-log delta it produced (the slice of
 * state.logs appended during the dispatch, including any WaitPrompt resolution for attacks).
 */
export function dispatchAction(game: ImportedGame, action: NeutralAction): StateLog[] {
  const before = game.state.logs.length;
  switch (action.type) {
    case 'benchBasic': dispatchBenchBasic(game, action as BenchBasicAction); break;
    case 'evolve': dispatchEvolve(game, action as EvolveAction); break;
    case 'attachEnergy': dispatchAttachEnergy(game, action as AttachEnergyAction); break;
    case 'attachTool': dispatchAttachTool(game, action as AttachToolAction); break;
    case 'retreat': dispatchRetreat(game, action as RetreatAction); break;
    case 'declareAttack': dispatchDeclareAttack(game, action as DeclareAttackAction); break;
    case 'endTurn': dispatchEndTurn(game, action as EndTurnAction); break;
    default:
      throw new Error(`[conformance] action "${action.type}" not implemented`);
  }
  return game.state.logs.slice(before);
}

/**
 * Replay the action log in order, accumulating the neutral events each step produced.
 *
 * Attack auto-end reconciliation (impl §4.3): twinleaf runs the whole turn boundary inside the
 * AttackAction dispatch, so a neutral `endTurn` that follows a `declareAttack` is consumed as an
 * already-applied no-op. The clean forced-endTurn pending + turnEnded/turnStarted bracketing around
 * a real checkup is M4.
 */
export function applyActions(game: ImportedGame, actions: NeutralAction[]): NeutralEvent[] {
  const events: NeutralEvent[] = [];
  let turnAlreadyEnded = false;

  for (const action of actions) {
    if (action.type === 'endTurn' && turnAlreadyEnded) {
      turnAlreadyEnded = false;
      continue;
    }
    if (game.handler.isBlocked()) {
      throw new Error('[conformance] driver reached a pending prompt it cannot answer (needs M2+)');
    }
    events.push(...mapDelta(dispatchAction(game, action)));
    if (action.type === 'declareAttack') {
      turnAlreadyEnded = true;
    }
  }
  return events;
}

/** Project the current twinleaf state of an imported game to the neutral observable schema. */
export function projectGame(game: ImportedGame): NeutralState {
  return projectState(game.state, game.ctx);
}

/**
 * The in-process step entry: import the initial state, replay the actions, project the result.
 * The response-envelope shape matches the wire contract (§4.1); `pending`/`legalActions` (M5) and
 * the HTTP layer (M6) are deferred, so `pending` is null here.
 */
export function step(initial: NeutralState, actions: NeutralAction[]): StepResponse {
  const game = importState(initial);
  const events = applyActions(game, actions);
  const state = projectGame(game);
  const status: ResponseStatus = state.outcome === 'ongoing' ? 'awaitingAction' : 'gameOver';
  return { status, applied: actions.length, pending: null, events, state };
}
