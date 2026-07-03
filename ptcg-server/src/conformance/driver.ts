import { Card } from '../game/store/card/card';
import { GameError } from '../game/game-error';
import { GameMessage } from '../game/game-message';
import { Player } from '../game/store/state/player';
import { Prompt } from '../game/store/prompts/prompt';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import {
  AttackAction, PassTurnAction, RetreatAction as RetreatGameAction,
  UseAbilityAction as UseAbilityGameAction
} from '../game/store/actions/game-actions';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { ImportedGame, importState, projectState, actorIndex } from './state-adapter';
import { deriveEvents, TurnCarry } from './events';
import { playerIdToActor } from './iid-targets';
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
  // The wire `to` indexes the PROJECTED bench (occupied slots only, in order) — native slot
  // numbers are engine-private and drift from the projection once a promote/KO leaves a hole.
  const occupied = player.bench
    .map((b, i) => ({ b, i }))
    .filter(x => x.b.cards.length > 0);
  const slot = occupied[action.to];
  if (slot === undefined) {
    // No such occupied bench position: an illegal MOVE (clean invalidAction), not an adapter fault.
    throw new GameError(GameMessage.CANNOT_RETREAT);
  }
  game.store.dispatch(new RetreatGameAction(player.id, slot.i));
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
      // A pending-only action type (takePrize, promoteBench, choose, …) arriving with no
      // matching pending open is an ILLEGAL move by the client, not an engine fault — reject
      // cleanly as invalidAction instead of a 500 (same family as the TA-5 post-terminal 500).
      throw new GameError(GameMessage.ILLEGAL_ACTION);
  }
}

// ── the replay loop ────────────────────────────────────────────────────────

/**
 * Thrown by the inline flip provider when an in-effect coin flip (CoinFlipEffect, e.g. a
 * flip-until-tails attack) needs a result the action log doesn't have yet. `Store.reduce` deep-clones
 * before reducing and restores the clone on ANY throw, so the dispatch that hit this unwinds cleanly;
 * the loop catches it and pauses with a system flip pending instead of faulting (TA-12).
 */
class FlipStarvation extends Error {
  constructor() {
    super('[conformance] coin flip needed but the next action is not a flip');
    this.name = 'FlipStarvation';
  }
}

interface LoopResult {
  events: NeutralEvent[];
  pending: WirePending | null;
  applied: number;
  /** Set when a dispatched action was rejected by the engine (M6). */
  rejection?: RejectionInfo;
  /** Set when the log ran dry MID-decomposition: the open prompt + the picks made so far. Lets the
   *  projection apply the decomposer's take-immediately fix-up (CF-1). */
  midPrompt?: { prompt: Prompt<any>; picks: WirePick[] };
}

/**
 * Project an internal `PendingDecision` to the contract-shaped `WirePending` (OpenAPI `Pending`):
 * stamp each legalAction with the pending's `actor` (contract `Action.actor`, required on every
 * action). The internal `endChoice` terminator is surfaced as the CF-4 explicit stop —
 * `confirm {value:false}` = "stop at the current count" — so a client playing only offered actions
 * (the fuzzer, an interactive frontend) can decline the rest of a min<max aggregate. Completion by
 * the next non-pick action (R1) remains valid for replay logs.
 */
function toWirePending(p: PendingDecision): WirePending {
  return {
    actor: p.actor,
    descriptor: p.descriptor,
    legalActions: p.legalActions
      .map(a => a.type === 'endChoice'
        ? ({ actor: p.actor, type: 'confirm', value: false } as WireLegalAction)
        : ({ actor: p.actor, ...a } as WireLegalAction)),
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
  // The actor whose turn was auto-ended by their own declareAttack (or null). Used to absorb only
  // that player's *own* redundant trailing endTurn — never the opponent's legitimate pass on the
  // turn the attack handed them (which must advance the turn, matching the real rules).
  let turnEndedBy: NeutralPlayerId | null = null;

  // The system actor's inline coin source: consume the next `flip` action from the same cursor the
  // loop walks, so inline flips (CoinFlipEffect) and the loop stay aligned in log order.
  game.handler.setFlipProvider((): boolean => {
    const next = cursor.i < actions.length ? actions[cursor.i] : undefined;
    if (next === undefined || next.type !== 'flip') {
      throw new FlipStarvation();
    }
    cursor.i++;
    return (next as FlipSystemAction).face === 'heads';
  });

  // Cross-batch turn-boundary memory for the deferred `turnEnded` (TA-2/TA-8) — one per replay.
  const turnCarry: TurnCarry = {};

  const dispatchAndCollect = (fire: () => void): void => {
    const beforeLogs = game.state.logs.length;
    const beforeState = projectState(game.state, game.ctx);
    fire();
    const afterState = projectState(game.state, game.ctx);
    events.push(...deriveEvents(beforeState, afterState, game.state.logs.slice(beforeLogs), turnCarry));
  };

  // A GameError from any dispatch (top-level action OR a prompt resolution) means the engine rejected
  // the move; the Store rolls its state back, so we report the events applied so far, the actions
  // consumed before the failure, and the normalized rejection. Non-GameError throws are adapter /
  // contract bugs and keep propagating.
  try {
    return loop();
  } catch (err) {
    // Store.reduce restores a pre-dispatch CLONE on a throw, so store.state and the driver's
    // game.state alias diverge (game.state keeps any partial mutations). Resync before projecting.
    game.state = game.store.state;
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
            const player = game.state.players.find(p => p.id === prompt.playerId);
            throw new Error(`[conformance] shuffle order invalid for prompt '${prompt.type}': `
              + `order len=${(next as ShuffleSystemAction).order.length}, perm=[${perm.join(',')}], `
              + `deck len=${player ? player.deck.cards.length : '?'}, playerId=${prompt.playerId}`);
          }
          cursor.i++;
          dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, perm)));
          // No deck-shuffle GameLog exists; emit the significant `shuffled` for the deck's owner here.
          events.push({ kind: 'shuffled', player: playerIdToActor(game.state, prompt.playerId) });
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
      const canStopNow = sub.legalActions.some(a => a.type === 'endChoice');
      if (sub.legalActions.filter(a => a.type !== 'endChoice').length === 0) {
        // Zero real candidates (e.g. "put a Trainer from your discard into your hand" with an empty
        // discard): there is no decision content, so pausing would surface an unanswerable empty
        // pending (TA-6). Auto-complete if the decision permits stopping; otherwise it is an engine
        // prompt that can never be answered — fault loudly.
        if (!canStopNow) {
          throw new Error(`[conformance] prompt '${prompt.type}' decomposed to zero options and cannot stop`);
        }
        accum.push({ kind: 'done' });
        continue;
      }
      const nextAction = cursor.i < actions.length ? actions[cursor.i] : undefined;
      if (nextAction === undefined) {
        // Log dry mid-decision: carry the open prompt + picks so the projection can apply the
        // decomposer's take-immediately fix-up (CF-1).
        return { events, pending: toWirePending(sub), applied: cursor.i, midPrompt: { prompt, picks: accum } };
      }
      // R1 (next-action-completes): if the next action is not one of this decision's pick types and
      // the decision permits stopping (its internal `endChoice` marker is present), synthesize the
      // terminator and finalize on the next iteration — without consuming the action.
      const canStop = sub.legalActions.some(a => a.type === 'endChoice');
      const pickTypes = new Set<string>(sub.legalActions.filter(a => a.type !== 'endChoice').map(a => a.type));
      if (!pickTypes.has(nextAction.type)) {
        if (canStop) {
          // CF-4 explicit stop: `confirm {value:false}` at an aggregate decision is the advertised
          // terminator — CONSUME it and finalize. (Only when `confirm` is not itself a pick type;
          // a real confirm decision handles its own confirms above.)
          if (nextAction.type === 'confirm' && (nextAction as { value?: boolean }).value === false) {
            cursor.i++;
          }
          // Otherwise R1: the next non-pick action completes the decision without being consumed.
          accum.push({ kind: 'done' });
          continue;
        }
        // Not a continuation and the decision cannot stop: an illegal MOVE (the pending's
        // legalActions don't offer it) — reject cleanly (invalidAction), don't fault the adapter.
        // The rejection path expects the cursor one past the offending action.
        cursor.i++;
        throw new GameError(GameMessage.ILLEGAL_ACTION);
      }
      accum.push(dec.toPick(prompt, nextAction, game.ctx, game.state, accum));
      cursor.i++;
      continue;
    }

    // no open prompt
    if (cursor.i < actions.length) {
      const action = actions[cursor.i];
      if (action.type === 'flip' || action.type === 'shuffle' || action.type === 'pick') {
        throw new Error(`[conformance] stray system action '${action.type}' with no pending system decision`);
      }
      cursor.i++;
      if (action.type === 'endTurn' && turnEndedBy === action.actor) {
        // The attacker's own redundant endTurn after their attack auto-ran the boundary: no-op it.
        // The opponent's endTurn (a different actor) is a real pass and falls through to dispatch.
        turnEndedBy = null;
        continue;
      }
      try {
        dispatchAndCollect(() => dispatchAction(game, action));
      } catch (err) {
        if (err instanceof FlipStarvation) {
          // An in-effect coin flip (e.g. a flip-until-tails attack) ran past the log. Store.reduce
          // restored its pre-dispatch clone, so resync the driver's alias and pause with a system
          // flip pending (TA-12). `applied` counts everything consumed, including flips the
          // rolled-back attempt used — on resume the same dispatch replays and re-consumes them.
          // Only THIS site may pause: a starvation inside a prompt-resolution callback has no
          // rollback, so it keeps propagating as a loud adapter fault rather than a wrong pause.
          game.state = game.store.state;
          const flipPending: PendingDecision = {
            actor: 'system', descriptor: 'Coin flip',
            legalActions: [{ type: 'flip', face: 'heads' }, { type: 'flip', face: 'tails' }],
          };
          return { events, pending: toWirePending(flipPending), applied: cursor.i };
        }
        throw err;
      }
      // Only an attack auto-ends a turn; any other dispatched action clears the "just attacked" state,
      // so the absorption window is exactly attack → (effect prompts) → that attacker's endTurn.
      turnEndedBy = action.type === 'declareAttack' && (action.actor === 'A' || action.actor === 'B')
        ? action.actor : null;
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
  const { events, pending, applied, rejection, midPrompt } = runLoop(game, actions);
  const state = projectGame(game);
  if (midPrompt !== undefined) {
    // Mid-decomposition pause: apply the decomposer's take-immediately projection fix-up (CF-1) so
    // picks already made read as applied (e.g. a picked prize is in the hand, not the pile).
    const dec = decomposerFor(midPrompt.prompt);
    dec.fixupProjection?.(midPrompt.prompt, midPrompt.picks, game.ctx, game.state, state);
  }
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
