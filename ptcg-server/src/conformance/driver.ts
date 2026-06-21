import { Card } from '../game/store/card/card';
import { Player } from '../game/store/state/player';
import { Prompt } from '../game/store/prompts/prompt';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import {
  AttackAction, PassTurnAction, RetreatAction as RetreatGameAction,
  UseAbilityAction as UseAbilityGameAction
} from '../game/store/actions/game-actions';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { ImportedGame, importState, projectState, actorIndex } from './state-adapter';
import { mapDelta } from './event-mapper';
import { classify, decomposerFor, WirePick } from './decomposers';
import { topLevelMenu } from './legal-actions';
import { mapRejection } from './rejection-codes';
import {
  SCHEMA_VERSION,
  NeutralState, NeutralAction, NeutralEvent, NeutralPlayerId, StepResponse, ResponseStatus,
  PendingDecision, WirePending, WireLegalAction, LegalAction, RejectionInfo,
  BenchBasicAction, EvolveAction, AttachEnergyAction, AttachToolAction,
  RetreatAction, DeclareAttackAction, EndTurnAction, UseAbilityAction,
  ShuffleSystemAction, FlipSystemAction
} from './neutral-types';

/**
 * M2 driver: the prompt-driven replay loop (impl §4.1). Each iteration finds the open prompt and
 * either decomposes it (a player prompt → one single decision per pick, accumulated from the action
 * log, then reassembled + ResolvePromptAction so the card callback fires unchanged), drives an
 * attack-animation WaitPrompt, surfaces a system prompt and stops (the M2/M3 seam), or — with no
 * open prompt — dispatches the next top-level action (M1). `pending` is now populated.
 */

// ── top-level action mapping (M1) ──────────────────────────────────────────

function lookupCard(game: ImportedGame, iid: string, role: string): Card {
  const card = game.ctx.iidToCard.get(iid);
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

function dispatchBenchBasic(game: ImportedGame, action: BenchBasicAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const card = lookupCard(game, action.card, 'benchBasic.card');
  const handIndex = handIndexOf(player, card, 'benchBasic.card', action.actor);
  const index = firstEmptyBenchIndex(player);
  game.store.dispatch(new PlayCardAction(player.id, handIndex, {
    player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index
  }));
}

function dispatchEvolve(game: ImportedGame, action: EvolveAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const evoCard = lookupCard(game, action.card, 'evolve.card');
  const handIndex = handIndexOf(player, evoCard, 'evolve.card', action.actor);
  const target = resolveOwnPokemonTarget(player, lookupCard(game, action.target, 'evolve.target'));
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchAttachEnergy(game: ImportedGame, action: AttachEnergyAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const energyCard = lookupCard(game, action.card, 'attachEnergy.card');
  const handIndex = handIndexOf(player, energyCard, 'attachEnergy.card', action.actor);
  const target = resolveOwnPokemonTarget(player, lookupCard(game, action.target, 'attachEnergy.target'));
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchAttachTool(game: ImportedGame, action: AttachToolAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const toolCard = lookupCard(game, action.card, 'attachTool.card');
  const handIndex = handIndexOf(player, toolCard, 'attachTool.card', action.actor);
  const target = resolveOwnPokemonTarget(player, lookupCard(game, action.target, 'attachTool.target'));
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchRetreat(game: ImportedGame, action: RetreatAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  game.store.dispatch(new RetreatGameAction(player.id, action.to));
}

function dispatchDeclareAttack(game: ImportedGame, action: DeclareAttackAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const sourceCard = lookupCard(game, action.source, 'declareAttack.source');
  if (!player.active.cards.includes(sourceCard)) {
    throw new Error('[conformance] declareAttack.source is not the acting player\'s active Pokemon');
  }
  // The attack parks on a WaitPrompt (and may raise card prompts mid-attack); the loop drives those.
  game.store.dispatch(new AttackAction(player.id, action.name));
}

function dispatchEndTurn(game: ImportedGame, action: EndTurnAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  game.store.dispatch(new PassTurnAction(player.id));
}

/**
 * Play an Item / Supporter / Stadium. twinleaf routes all three through PlayCardAction; the
 * play-card reducer dispatches by the card's trainerType. A placeholder target (own active) is
 * passed for the rare trainer that targets a Pokemon — `findPokemonTarget` swallows a non-resolving
 * target, and non-targeting trainers ignore it; the card's own effect drives any real selection.
 */
function dispatchPlayTrainer(game: ImportedGame, action: { actor: NeutralPlayerId; type: string; card: string }): void {
  const player = game.state.players[actorIndex(action.actor)];
  const card = lookupCard(game, action.card, `${action.type}.card`);
  const handIndex = handIndexOf(player, card, `${action.type}.card`, action.actor);
  const target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

function dispatchUseAbility(game: ImportedGame, action: UseAbilityAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const sourceCard = lookupCard(game, action.source, 'useAbility.source');
  const target = resolveOwnPokemonTarget(player, sourceCard);
  game.store.dispatch(new UseAbilityGameAction(player.id, action.ability, target));
}

/** Dispatch one top-level neutral action, returning the game-log delta it produced. */
function dispatchAction(game: ImportedGame, action: NeutralAction): void {
  switch (action.type) {
    case 'benchBasic': dispatchBenchBasic(game, action as BenchBasicAction); break;
    case 'evolve': dispatchEvolve(game, action as EvolveAction); break;
    case 'attachEnergy': dispatchAttachEnergy(game, action as AttachEnergyAction); break;
    case 'attachTool': dispatchAttachTool(game, action as AttachToolAction); break;
    case 'retreat': dispatchRetreat(game, action as RetreatAction); break;
    case 'declareAttack': dispatchDeclareAttack(game, action as DeclareAttackAction); break;
    case 'endTurn': dispatchEndTurn(game, action as EndTurnAction); break;
    case 'playItem':
    case 'playSupporter':
    case 'playStadium':
      dispatchPlayTrainer(game, action as { actor: NeutralPlayerId; type: string; card: string }); break;
    case 'useAbility': dispatchUseAbility(game, action as UseAbilityAction); break;
    default:
      throw new Error(`[conformance] action "${action.type}" is not a top-level action`);
  }
}

// ── the replay loop ────────────────────────────────────────────────────────

interface LoopResult {
  events: NeutralEvent[];
  pending: WirePending | null;
  applied: number;
  /** Set when a dispatched action was rejected by the engine (M6). */
  rejection?: RejectionInfo;
}

/**
 * Project an internal `PendingDecision` to the contract-shaped `WirePending` (OpenAPI `Pending`):
 * strip the internal `endChoice` terminator (no such contract Action — completion is signalled by
 * the next non-pick action, R1) and stamp each surviving legalAction with the pending's `actor`
 * (contract `Action.actor`, required on every action).
 */
function toWirePending(p: PendingDecision): WirePending {
  return {
    actor: p.actor,
    descriptor: p.descriptor,
    legalActions: p.legalActions
      .filter(a => a.type !== 'endChoice')
      .map(a => ({ actor: p.actor, ...a }) as WireLegalAction),
  };
}

/** A system pending (shuffle / coin flip) surfaced when its action isn't yet in the log. */
function systemPending(game: ImportedGame, prompt: Prompt<any>): PendingDecision {
  const legalActions: LegalAction[] = [];
  if (prompt.type === 'Shuffle deck') {
    const player = game.state.players.find(p => p.id === prompt.playerId);
    const deck = (player ? player.deck.cards : [])
      .map(c => game.ctx.cardToIid.get(c))
      .filter((iid): iid is string => iid !== undefined);
    legalActions.push({ type: 'shuffle', deck });
  } else if (prompt.type === 'Coin flip') {
    legalActions.push({ type: 'flip', face: 'heads' }, { type: 'flip', face: 'tails' });
  }
  return { actor: 'system', descriptor: prompt.type, legalActions };
}

/**
 * Convert a neutral shuffle order (new deck order as iids) into the permutation ShuffleDeckPrompt
 * expects: `perm[i]` = the current deck index of the card that should land at position i, so
 * `deck.applyOrder(perm)` yields the requested order. The order is supplied at shuffle time, which
 * is what makes shuffle-then-draw deterministic (design §5).
 */
function shuffleOrderToPermutation(game: ImportedGame, prompt: Prompt<any>, action: ShuffleSystemAction): number[] {
  const player = game.state.players.find(p => p.id === prompt.playerId);
  if (player === undefined) {
    throw new Error('[conformance] shuffle prompt has no player');
  }
  const deck = player.deck.cards;
  return action.order.map(iid => {
    const card = game.ctx.iidToCard.get(iid);
    const index = card ? deck.indexOf(card) : -1;
    if (index === -1) {
      throw new Error(`[conformance] shuffle order iid '${iid}' is not in the deck`);
    }
    return index;
  });
}

function runLoop(game: ImportedGame, actions: NeutralAction[]): LoopResult {
  const events: NeutralEvent[] = [];
  const cursor = { i: 0 };          // shared with the flip provider below
  let accum: WirePick[] = [];
  let turnAlreadyEnded = false;

  // The system actor's inline coin source: consume the next `flip` action from the same cursor the
  // loop walks, so inline flips (CoinFlipEffect) and the loop stay aligned in log order.
  game.handler.setFlipProvider((): boolean => {
    const next = cursor.i < actions.length ? actions[cursor.i] : undefined;
    if (next === undefined || next.type !== 'flip') {
      throw new Error('[conformance] coin flip needed but the next action is not a flip');
    }
    cursor.i++;
    return (next as FlipSystemAction).face === 'heads';
  });

  const dispatchAndCollect = (fire: () => void): void => {
    const before = game.state.logs.length;
    fire();
    events.push(...mapDelta(game.state.logs.slice(before)));
  };

  // A GameError from any dispatch (top-level action OR a prompt resolution) means the engine rejected
  // the move; the Store rolls its state back, so we report the events applied so far, the actions
  // consumed before the failure, and the normalized rejection. Non-GameError throws are adapter /
  // contract bugs and keep propagating.
  try {
    return loop();
  } catch (err) {
    const rejection = mapRejection(err);
    if (rejection === undefined) {
      throw err;
    }
    // The cursor is advanced past an action before it is dispatched, so on a rejection it points one
    // past the offending action; `applied` is therefore the count of actions applied before it.
    return { events, pending: null, applied: Math.max(0, cursor.i - 1), rejection };
  }

  function loop(): LoopResult {
  for (;;) {
    const prompt = game.state.prompts.find(p => p.result === undefined);

    if (prompt !== undefined) {
      const kind = classify(prompt);

      if (kind === 'wait') {
        dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, true)));
        continue;
      }
      if (kind === 'system') {
        const next = cursor.i < actions.length ? actions[cursor.i] : undefined;
        if (prompt.type === 'Coin flip' && next !== undefined && next.type === 'flip') {
          const heads = (next as FlipSystemAction).face === 'heads';
          cursor.i++;
          dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, heads)));
          continue;
        }
        if (prompt.type.startsWith('Shuffle') && next !== undefined && next.type === 'shuffle') {
          const perm = shuffleOrderToPermutation(game, prompt, next as ShuffleSystemAction);
          if (!prompt.validate(perm, game.state)) {
            throw new Error(`[conformance] shuffle order invalid for prompt '${prompt.type}'`);
          }
          cursor.i++;
          dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, perm)));
          continue;
        }
        return { events, pending: toWirePending(systemPending(game, prompt)), applied: cursor.i };
      }
      if (kind === 'unsupported') {
        throw new Error(`[conformance] prompt '${prompt.type}' has no decomposer (out of scope)`);
      }

      // decomposable player prompt
      const dec = decomposerFor(prompt);
      const sub = dec.next(prompt, accum, game.ctx, game.state);
      if (sub === null) {
        const wire = dec.assemble(prompt, accum);
        const result = prompt.decode(wire, game.state);
        if (!prompt.validate(result, game.state)) {
          throw new Error(`[conformance] decomposed result failed validate for prompt '${prompt.type}'`);
        }
        dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, result)));
        accum = [];
        continue; // the callback may have raised the next prompt
      }
      // sub !== null — more picks are possible for this decision.
      const nextAction = cursor.i < actions.length ? actions[cursor.i] : undefined;
      if (nextAction === undefined) {
        return { events, pending: toWirePending(sub), applied: cursor.i }; // log dry mid-decision
      }
      // R1 (next-action-completes): if the next action is not one of this decision's pick types and
      // the decision permits stopping (its internal `endChoice` marker is present), synthesize the
      // terminator and finalize on the next iteration — without consuming the action.
      const canStop = sub.legalActions.some(a => a.type === 'endChoice');
      const pickTypes = new Set<string>(sub.legalActions.filter(a => a.type !== 'endChoice').map(a => a.type));
      if (!pickTypes.has(nextAction.type) && canStop) {
        accum.push({ kind: 'done' });
        continue;
      }
      accum.push(dec.toPick(prompt, nextAction, game.ctx, game.state));
      cursor.i++;
      continue;
    }

    // no open prompt
    if (cursor.i < actions.length) {
      const action = actions[cursor.i];
      if (action.type === 'flip' || action.type === 'shuffle') {
        throw new Error(`[conformance] stray system action '${action.type}' with no pending system decision`);
      }
      cursor.i++;
      if (action.type === 'endTurn' && turnAlreadyEnded) {
        turnAlreadyEnded = false; // attack already ran the boundary; the explicit endTurn is a no-op
        continue;
      }
      dispatchAndCollect(() => dispatchAction(game, action));
      if (action.type === 'declareAttack') {
        turnAlreadyEnded = true;
      }
      continue;
    }
    // Quiescent: no open prompt and the log is exhausted. In an ongoing main phase, surface the
    // active player's top-level menu (M5); otherwise (gameOver, or a non-main boundary) there is
    // nothing to choose.
    const menu = topLevelMenu(game);
    return { events, pending: menu ? toWirePending(menu) : null, applied: cursor.i };
  }
  }
}

// ── public surface ─────────────────────────────────────────────────────────

/** Replay the action log on an already-imported game, returning events + the open pending + applied. */
export function replay(game: ImportedGame, actions: NeutralAction[]): LoopResult {
  return runLoop(game, actions);
}

/** Replay the action log, returning the neutral events. (Thin wrapper kept for M0/M1 specs.) */
export function applyActions(game: ImportedGame, actions: NeutralAction[]): NeutralEvent[] {
  return runLoop(game, actions).events;
}

/** Project the current twinleaf state of an imported game to the neutral observable schema. */
export function projectGame(game: ImportedGame): NeutralState {
  return projectState(game.state, game.ctx);
}

/**
 * The in-process step entry: import the initial state, replay the actions, project the result.
 * `pending` is the open single decision (decomposer candidates) or a system pending, or null at a
 * quiescent boundary. `legalActions` population is Phase-1 (decomposer/system); the top-level menu
 * is M5.
 */
export function step(initial: NeutralState, actions: NeutralAction[]): StepResponse {
  const game = importState(initial);
  const { events, pending, applied, rejection } = runLoop(game, actions);
  const state = projectGame(game);
  if (rejection !== undefined) {
    // The engine rejected an action; the Store rolled back, so `state` is the pre-action projection.
    // The cursor advances past an action before dispatch, so `applied` is the offending action's index.
    return {
      schemaVersion: SCHEMA_VERSION, status: 'invalidAction', applied, index: applied,
      pending: null, events, state, reasonCode: rejection.reasonCode, nativeReason: rejection.nativeReason,
    };
  }
  const status: ResponseStatus = state.outcome === 'ongoing' ? 'awaitingAction' : 'gameOver';
  return { schemaVersion: SCHEMA_VERSION, status, applied, pending, events, state };
}
