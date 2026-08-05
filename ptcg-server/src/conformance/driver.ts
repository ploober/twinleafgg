import { Card } from '../game/store/card/card';
import { GameError } from '../game/game-error';
import { GameMessage } from '../game/game-message';
import { Player } from '../game/store/state/player';
import { State, GameWinner } from '../game/store/state/state';
import { Prompt } from '../game/store/prompts/prompt';
import { ShowCardsPrompt } from '../game/store/prompts/show-cards-prompt';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import {
  AttackAction, PassTurnAction, RetreatAction as RetreatGameAction,
  UseAbilityAction as UseAbilityGameAction, UseStadiumAction as UseStadiumGameAction
} from '../game/store/actions/game-actions';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { ImportedGame, importState, projectState, actorIndex } from './state-adapter';
import { deriveEvents, TurnCarry } from './events';
import { playerIdToActor } from './iid-targets';
import { classify, decomposerFor, realPicks, WirePick } from './decomposers';
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

/**
 * Activate the in-play Stadium (CF-37). No card/source to resolve — the engine's UseStadiumAction
 * carries only the actor, because there is exactly one shared Stadium slot.
 */
function dispatchUseStadium(game: ImportedGame, action: { actor: NeutralPlayerId }): void {
  const player = game.state.players[actorIndex(action.actor)];
  game.store.dispatch(new UseStadiumGameAction(player.id));
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
    case 'useStadium': dispatchUseStadium(game, action as { actor: NeutralPlayerId }); break;
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

/**
 * TA-205 / SD-14: the IDENTITY fields of a pick — the ones that name *which* candidate was chosen.
 *
 * Membership in the offered menu is decided on these alone, deliberately not on whole-object equality.
 * Two field classes are excluded and each exclusion is load-bearing:
 *
 *  - `owner` / `name` on `choose`/`discard` are ADVISORY annotations, not identity. `owner` in
 *    particular is known-unreliable in different sub-cases on BOTH engines (the CF-26 proposal is to
 *    normalize it out of the compared vocabulary entirely), so matching on it would reject valid logs
 *    over a field we do not even trust.
 *  - `source` on `moveEnergy` is DERIVABLE — `attach-energy`'s own `toPick` accepts the action with it
 *    absent and only cross-checks it when present ("claimedSource !== undefined && ..."). Requiring it
 *    here would reject exactly the looser form that decomposer documents as legal.
 *
 * `shuffle` is absent by design: a deck order is a permutation the system supplies, not a menu pick,
 * and its legality is adjudicated by the prompt.
 */
const PICK_IDENTITY_FIELDS: { [type: string]: string[] } = {
  choose: ['target'],
  placeCounter: ['target'],
  promoteBench: ['target'],
  discard: ['target'],
  pick: ['target'],
  moveEnergy: ['card', 'target'],
  attachEnergy: ['card', 'target'],
  takePrize: ['index'],
  confirm: ['value'],
  selectOption: ['option'],
  flip: ['face'],
};

/**
 * Does the pending actually OFFER this action? (TA-205)
 *
 * The driver previously checked only that the action's TYPE appeared among the offered picks, so an
 * action naming a candidate that was never offered — right verb, wrong target — was accepted into the
 * accumulator. Its illegality then surfaced only when the assembled result failed the prompt's
 * `validate()`, which the caller reports as `engineFault`: an HTTP 500 for what is an INVALID ACTION.
 * Rotomancer refuses it at an explicit gate (`sim:refuseGate`, "no option matches target iid …") and
 * returns `invalidAction`; the contract has a status for this and we were returning the wrong one.
 *
 * Unknown verbs return true — this gate narrows an existing acceptance path and must never be the
 * thing that rejects a pick type it has no identity rule for. Adding a verb to the table is what
 * extends coverage; the default stays permissive so a gap here is a missed catch, never a false reject.
 */
function offersAction(legalActions: LegalAction[], action: NeutralAction): boolean {
  const fields = PICK_IDENTITY_FIELDS[action.type];
  if (fields === undefined) {
    return true;
  }
  const submitted = action as unknown as { [k: string]: unknown };
  return legalActions.some(la => {
    if (la.type !== action.type) {
      return false;
    }
    const offered = la as unknown as { [k: string]: unknown };
    return fields.every(f => offered[f] === undefined || offered[f] === submitted[f]);
  });
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
  // CF-22: the pending template advertises `{type:'shuffle', deck}` (the multiset to reorder); the
  // ANSWER is defined to carry `order` (the new deck order — §5). A client that echoes the offered
  // template verbatim sends `deck` (or omits the order); since the shuffle order is externalized ONLY
  // for cross-engine reproducibility, a caller that does not specify one accepts the deck's current
  // order. Accept either field and fall back to the current order (identity) — never fault on
  // `undefined.map`, which made every post-search-shuffle step 500 and left "assert after a shuffle"
  // undrivable on both engines.
  const orderIids: string[] = action.order
    ?? (action as { deck?: string[] }).deck
    ?? deck.map(c => game.ctx.cardToIid.get(c)).filter((iid): iid is string => iid !== undefined);
  return orderIids.map(iid => {
    const card = game.ctx.iidToCard.get(iid);
    const index = card ? deck.indexOf(card) : -1;
    if (index === -1) {
      throw new Error(`[conformance] shuffle order iid '${iid}' is not in the deck`);
    }
    return index;
  });
}

/**
 * Locate a card among a player's zones → its owner + neutral zone name, or null if it sits in a temp
 * pile detached from every player zone (e.g. a mid-effect look pile). Used to attribute a `reveal`
 * event's `owner`/`from` (CF-18).
 */
function locateCard(state: State, card: Card): { owner: Player; zone: string } | null {
  for (const owner of state.players) {
    if (owner.hand.cards.includes(card)) { return { owner, zone: 'hand' }; }
    if (owner.deck.cards.includes(card)) { return { owner, zone: 'deck' }; }
    if (owner.discard.cards.includes(card)) { return { owner, zone: 'discard' }; }
    if (owner.lostzone.cards.includes(card)) { return { owner, zone: 'lostZone' }; }
    if (owner.active.cards.includes(card)) { return { owner, zone: 'play' }; }
    for (const b of owner.bench) { if (b.cards.includes(card)) { return { owner, zone: 'play' }; } }
    for (const p of owner.prizes) { if (p.cards.includes(card)) { return { owner, zone: 'prizes' }; } }
  }
  return null;
}

/**
 * CF-18 (proposed): a `ShowCardsPrompt` is twinleaf's public-reveal signal ("reveal a Supporter you
 * find there" — Attract Customers; "reveal it" search-tutors; etc). It carries the revealed `cards`
 * and its `playerId` is the AUDIENCE being shown them — NOT the owner (the owner already knows their
 * own card). Today the adapter auto-acks it (REVEAL_ACK_PROMPTS) and emits nothing, so the reveal
 * never reaches the wire. Externalize it as a first-class `reveal{owner, cards, from, to:'all'}`
 * event, captured at show time (before the ack, while the cards are still in their revealed zone).
 * Returns null for an empty show or when no revealed card carries an iid.
 *
 * `to` is 'all': in 2-player PTCG a reveal to the non-owner is observationally public (the owner
 * already sees their own cards), so every ShowCardsPrompt is a public reveal. Audience-scoped shows
 * (`to:<player>`) and private looks (eventless) are the other CF-18 arms — not raised by this prompt.
 */
function buildRevealEvent(game: ImportedGame, prompt: ShowCardsPrompt): NeutralEvent | null {
  const cards = prompt.cards;
  // Owner fallback for a show we cannot locate by card: the prompt's playerId is the AUDIENCE, so the
  // shower is the other player ("your opponent reveals their hand" prompts the attacker).
  const audience = playerIdToActor(game.state, prompt.playerId);
  const fallbackOwner = audience === 'A' ? 'B' : 'A';

  if (cards.length === 0) {
    // TA-153: an EMPTY show is still a reveal. "Your opponent reveals their hand" EXECUTES over an
    // empty hand — the attacker learns it is empty, which is real information (it is why the attack
    // then does 0 damage). Same discriminator as CF-9/TA-126 (the instruction executes even over zero
    // objects), and the cross-engine shape rotomancer emits (`cards: []`; the harness eventKey omits
    // an empty cards list, so both spellings key identically). Suppressing the event is what kept
    // xfz-wht-005 diverging the day the CF-18 gate first fired (RE-73 fold).
    //
    // `from` cannot be located from a card (there is none). Attribute by which of the shower's
    // ordered public-ish zones is empty — today's only empty-show families are whole-zone reveals
    // ("reveals their hand") and empty-window deck reveals (RE-68 family), and an ambiguous board
    // (both empty) reads 'hand' first, matching the dominant family. 'unknown' when neither is empty
    // (an empty show of a non-empty zone would be a card bug worth seeing on the wire, not hiding).
    const shower = game.state.players.find(p => playerIdToActor(game.state, p.id) === fallbackOwner);
    const from = shower === undefined ? 'unknown'
      : shower.hand.cards.length === 0 ? 'hand'
        : shower.deck.cards.length === 0 ? 'deck'
          : 'unknown';
    return { kind: 'reveal', owner: fallbackOwner, cards: [], from, to: 'all' };
  }
  const iids: string[] = [];
  for (const c of cards) {
    const iid = game.ctx.cardToIid.get(c);
    if (iid !== undefined) {
      iids.push(iid);
    }
  }
  if (iids.length === 0) {
    return null;
  }
  const loc = locateCard(game.state, cards[0]);
  // Owner = the located zone's owner; fall back to the non-audience player (see above).
  const owner = loc !== null ? playerIdToActor(game.state, loc.owner.id) : fallbackOwner;
  const from = loc !== null ? loc.zone : 'unknown';
  return { kind: 'reveal', owner, cards: iids, from, to: 'all' };
}

function runLoop(game: ImportedGame, actions: NeutralAction[]): LoopResult {
  const events: NeutralEvent[] = [];
  const cursor = { i: 0 };          // shared with the flip provider below
  let accum: WirePick[] = [];
  // (Removed 2026-07-24, TA-129/CF-12: `turnEndedBy` tracked the actor whose turn was auto-ended by
  // their own declareAttack, so the driver could absorb that player's redundant trailing `endTurn`.
  // CF-12 deprecates that leniency — the action is not offered and must reject. See the dispatch loop.)

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
    let starved: FlipStarvation | undefined;
    try {
      fire();
    } catch (err) {
      if (!(err instanceof FlipStarvation)) { throw err; }
      // A coin flip ran past the log mid-dispatch. If it fired in the attack effect (WAS_ATTACK_USED)
      // Store.reduce restored its clone, so nothing committed and afterState == beforeState. If it
      // fired in an after-attack effect reached through a prompt-resolution continuation (AFTER_ATTACK),
      // Store.reducePrompt does NOT roll back, so the attack's damage stayed committed. Resync and still
      // derive whatever landed so the paused response is consistent with its state; re-throw below so a
      // catch site can pause with a system flip pending (drives AFTER_ATTACK flips without touching cards).
      game.state = game.store.state;
      starved = err;
    }
    const afterState = projectState(game.state, game.ctx);
    events.push(...deriveEvents(beforeState, afterState, game.state.logs.slice(beforeLogs), turnCarry));
    if (starved !== undefined) { throw starved; }
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
    if (err instanceof FlipStarvation) {
      // A coin flip ran past the log — from the attack effect (WAS_ATTACK_USED), OR from an after-attack
      // effect reached through a prompt-resolution continuation (AFTER_ATTACK), which is dispatched by
      // Store.reducePrompt (no rollback) and so can't be caught at the top-level action site. Either way,
      // pause with a system flip pending; the client appends the flip and the whole (stateless) log
      // replays with it in position. This lets an AFTER_ATTACK coin flip be DRIVEN as-is — the card's
      // effect timing is a real-gameplay choice, not something the harness should force us to rewrite.
      // dispatchAndCollect already resynced + captured any committed events (e.g. the attack's damage).
      const flipPending: PendingDecision = {
        actor: 'system', descriptor: 'Coin flip',
        legalActions: [{ type: 'flip', face: 'heads' }, { type: 'flip', face: 'tails' }],
      };
      return { events, pending: toWirePending(flipPending), applied: cursor.i };
    }
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
      // 'Order cards' ("put these cards back in any order", e.g. Fortunate Eye's top-5 peek) is now a
      // real externalized decision — the `orderCardsDecomposer` surfaces it as a `choose`-per-position
      // sequence and re-homes the in-flight temp pile via its `fixupProjection` (TA-81 / §B.6). It is
      // no longer auto-resolved here; it falls through to the standard decomposable path below.
      const kind = classify(prompt);

      if (kind === 'wait') {
        // CF-18: a public reveal (ShowCardsPrompt) is externalized as a `reveal` event, captured
        // BEFORE the ack while the cards still sit in their revealed zone. All other wait prompts
        // (WaitPrompt, Alert, non-cancelable Confirm cards) carry no observable and emit nothing.
        if (prompt.type === 'Show cards') {
          const revealEvent = buildRevealEvent(game, prompt as ShowCardsPrompt);
          if (revealEvent !== null) {
            events.push(revealEvent);
          }
        }
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
        if (prompt.type.startsWith('Shuffle') && !(next !== undefined && next.type === 'shuffle')) {
          // CF-11: a deck of 0 or 1 cards has exactly one possible order — a forced
          // non-decision — so the `system shuffle` pending is NOT surfaced; auto-resolve
          // with the identity order. The `shuffled` event still fires (uniform-emit).
          const player = game.state.players.find(p => p.id === prompt.playerId);
          const deckLen = player ? player.deck.cards.length : 0;
          if (deckLen <= 1) {
            const perm = Array.from({ length: deckLen }, (_, i) => i);
            dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, perm)));
            events.push({ kind: 'shuffled', player: playerIdToActor(game.state, prompt.playerId) });
            continue;
          }
        }
        if (prompt.type.startsWith('Shuffle') && next !== undefined && next.type === 'shuffle') {
          const perm = shuffleOrderToPermutation(game, prompt, next as ShuffleSystemAction);
          if (!prompt.validate(perm, game.state)) {
            const player = game.state.players.find(p => p.id === prompt.playerId);
            throw new Error(`[conformance] shuffle order invalid for prompt '${prompt.type}': `
              + `perm=[${perm.join(',')}] (len=${perm.length}), `
              + `deck len=${player ? player.deck.cards.length : '?'}, playerId=${prompt.playerId}`);
          }
          cursor.i++;
          dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, perm)));
          // No deck-shuffle GameLog exists; emit the significant `shuffled` for the deck's owner here.
          events.push({ kind: 'shuffled', player: playerIdToActor(game.state, prompt.playerId) });
          continue;
        }
        // CF-12 (strict): a further action that isn't THIS system pending's `flip`/`shuffle` is
        // not offered — reject it as `invalidAction`. Only pause (return the pending) when the
        // log has no further action to submit.
        if (cursor.i < actions.length) {
          cursor.i++;
          throw new GameError(GameMessage.ILLEGAL_ACTION);
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
        let result = prompt.decode(wire, game.state);
        if (!prompt.validate(result, game.state)) {
          // A decomposition that assembled an unsatisfiable EMPTY result — a search/selection whose filter
          // matched no card (Love Ball's 'Choose cards', Salvatore's evolve-target 'Choose pokemon') — is a
          // WHIFF, not a fault: resolve as CANCEL (null) when NO real pick was made and the prompt permits
          // cancel (`validate(null)` iff allowCancel; the card's own `selected || []` callback treats it as
          // "found nothing"). A PARTIAL selection that fails validate is a genuinely malformed log → still
          // faults. One driver-level rule covers every ChooseXxx decomposer (choose-cards, choose-pokemon, …).
          if (realPicks(accum).length === 0) {
            // No real pick was possible — a WHIFF. Resolve as CANCEL (null) when the prompt permits it;
            // otherwise a FORCED prompt reached 0 eligible targets (Salvatore's `Choose pokemon` evolve-
            // target when the searched Pokémon can't be placed on any in-play Pokémon). The ENGINE itself
            // whiffs there — its callback tolerates the empty selection (Salvatore: `targets.length === 0
            // -> shuffle+return`), so the game store never crashes. The adapter must not either: dispatch
            // the empty (decoded) result and let the store's own reducer decide — a genuinely unanswerable
            // prompt still faults loudly from the store, but a legitimate whiff resolves cleanly (CF-31,
            // extends the CF-29 cancelable-whiff rule to the forced-0-eligible case). A PARTIAL selection
            // that fails validate (realPicks > 0) is still a malformed log → faults below.
            result = prompt.validate(null, game.state) ? null : result;
          } else {
            throw new Error(`[conformance] decomposed result failed validate for prompt '${prompt.type}'`);
          }
        }
        dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, result)));
        accum = [];
        continue; // the callback may have raised the next prompt
      }
      // sub !== null — more picks are possible for this decision.
      const canStopNow = sub.legalActions.some(a => a.type === 'endChoice');
      const forced = sub.legalActions.filter(a => a.type !== 'endChoice');
      if (forced.length === 0) {
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
      // CF-14: a decision with exactly ONE possible resolution has no decision content, so it is
      // applied ATOMICALLY — no pending is surfaced. Rotomancer already auto-resolves the 1-candidate
      // choose (its inverse 0-candidate gap was RE-27/RE-33); twinleaf's engine over-specifies by
      // surfacing a 1-option pending (Murkrow "Torment" / Klefki "Memory Lock" choose-attack-to-disable
      // when the defender has exactly one attack). This is the single-candidate analog of the CF-11
      // <=1-card shuffle and the zero-candidate auto-complete just above: a lone forced pick that
      // cannot stop short (no endChoice -> not a genuine "up to N" range) is not a choice. GATED on
      // the decomposer's per-prompt `atomicResolvable`: true only when one candidate == one whole-
      // decision resolution AND applying it raises no cascade. A multi-pick aggregate (move-energy/
      // move-damage/put-damage/choose-cards) never implements it (a forced sub-pick is not a forced
      // decision); a copy-an-attack does not either (executing the copy cascades). Feed the sole
      // candidate back through the decomposer's own toPick (round-trips its `next` output) and loop;
      // the next iteration completes the decision and dispatches it, so the effect lands atomically.
      //
      // TA-202 adds `atomicStep`, the STEP-level sibling, for the case `atomicResolvable` structurally
      // cannot express: a multi-pick aggregate whose CURRENT step has one outcome while the aggregate
      // itself stays open. Munkidori twm-095 "Adrena-Brain" with one damaged Pokemon and one opposing
      // Pokemon is the measured case — both the source and the destination pick are forced, and we
      // surfaced two pendings with no decision in them while rotomancer had already applied the
      // transfer. The two hooks share this site and the same `!canStopNow` guard, which is what keeps
      // "pick vs stop" a real decision; they differ only in whether the collapse ENDS the decision
      // (atomicResolvable: the next iteration dispatches) or merely advances it (atomicStep: `next`
      // is re-entered and offers the following step).
      const collapses = forced.length === 1 && !canStopNow && (
        dec.atomicResolvable?.(prompt, game.state) === true
        || dec.atomicStep?.(prompt, accum, game.state) === true
      );
      if (collapses) {
        accum.push(dec.toPick(prompt, { actor: sub.actor, ...forced[0] } as NeutralAction, game.ctx, game.state, accum));
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
        // CF-12 (strict; R1 deprecated): the ONLY way to stop an aggregate is its advertised
        // explicit stop, `confirm {value:false}` — consume that and finalize. Any OTHER action
        // that isn't a pick is not offered at this pending, so reject it as `invalidAction` at
        // its index (matches rotomancer). Previously R1 let any non-pick action implicitly
        // complete the decision; now that the stop is always advertised, that leniency is gone.
        if (canStop && nextAction.type === 'confirm' && (nextAction as { value?: boolean }).value === false) {
          cursor.i++;
          accum.push({ kind: 'done' });
          continue;
        }
        // The rejection path expects the cursor one past the offending action.
        cursor.i++;
        throw new GameError(GameMessage.ILLEGAL_ACTION);
      }
      // TA-205: the verb is offered, but is THIS candidate? An action naming a target the menu never
      // offered is an invalid action, not an engine fault — without the gate below it is accepted here
      // and only caught downstream by validate(), which the caller reports as a 500.
      //
      // ORDER MATTERS. `toPick` runs FIRST and is allowed to throw: several decomposers already reject
      // structurally-incoherent picks with a descriptive Error (`select-option` on a disabled or
      // out-of-range index, `choose-energy` on an iid the prompt never held), and that is the harness's
      // "this log is malformed" channel — distinct from "this action is illegal at a live decision
      // node", which is what `invalidAction` means. Gating before `toPick` collapsed the two and
      // silently downgraded those diagnostics. `toPick` is a pure action→WirePick mapping with no side
      // effects, so running it before the membership test costs nothing.
      const pick = dec.toPick(prompt, nextAction, game.ctx, game.state, accum);
      if (!offersAction(sub.legalActions, nextAction)) {
        cursor.i++;
        throw new GameError(GameMessage.ILLEGAL_ACTION);
      }
      accum.push(pick);
      cursor.i++;
      continue;
    }

    // no open prompt
    // CF-35 (TA-146): once the match is over, nothing further can be APPLIED. Stop here with `applied`
    // frozen at the terminal transition and leave any surplus actions unconsumed — that is precisely what
    // makes a surplus log detectable as `applied < actions.length`, which is the whole reason `applied` is
    // reported separately from `actions.length`. Without this, twinleaf walked `applied` up to the full log
    // length, so the harness reported a divergence point offset by the surplus and a scenario could look
    // like it exercised a tail of actions that never ran (the repro-empty-actions failure mode).
    //
    // It also makes the post-terminal answer UNIFORM. Previously the reply depended on which action
    // happened to follow: `endTurn`/`declareAttack`/`attachEnergy` returned `gameOver` (but over-counted),
    // while `retreat`/`confirm` reached the engine, raised, and came back as `invalidAction` with a
    // fabricated `reasonCode` — a status specified for an action ILLEGAL AT A LIVE DECISION NODE, of which
    // there is none once the match has ended. Three answers for one situation; CF-19 makes the
    // inconsistency itself the defect.
    //
    // Deliberately placed AFTER the open-prompt handling rather than at the top of the loop: prompts still
    // in flight when the outcome turns terminal (a KO cascade's promote, a last-prize take) must still be
    // drained so the projected state is settled. This gates action CONSUMPTION only.
    // Terminality is `state.winner` (a `GameWinner` enum, NONE = -1). There is no `state.outcome` on the
    // internal state — `outcome` is a WIRE field the projector derives from `winner`; reading it here
    // silently yields `undefined`, which compares unequal to every string and fires the guard on the first
    // iteration (applied always 0). Checked against the enum, not the projection.
    if (game.state.winner !== GameWinner.NONE) {
      return { events, pending: null, applied: cursor.i };
    }
    if (cursor.i < actions.length) {
      const action = actions[cursor.i];
      if (action.type === 'flip' || action.type === 'shuffle' || action.type === 'pick') {
        throw new Error(`[conformance] stray system action '${action.type}' with no pending system decision`);
      }
      cursor.i++;
      // TA-129 (CF-12, 2026-07-24): this used to ABSORB the attacker's own trailing `endTurn` as a
      // silent no-op. That was R1-style leniency and CF-12 deprecates it: once the attack auto-ran the
      // turn boundary the attacker is no longer the active player, so their `endTurn` is an action
      // nobody offered and must reject as `invalidAction`. Rotomancer already rejects it
      // (`NOT_YOUR_TURN`); twinleaf silently accepted it, which is the divergence TA-129 records.
      // Now falls through to dispatch so the ENGINE decides — the harness must not paper over it.
      // An in-effect coin flip that runs past the log (a flip-until-tails attack, or an AFTER_ATTACK
      // flip reached via the WaitPrompt continuation) throws FlipStarvation. It is no longer caught
      // here: dispatchAndCollect resyncs + captures committed events and re-throws, and the outer
      // catch turns ANY starvation — top-level dispatch OR prompt-resolution continuation — into a
      // single system flip pause. See the outer catch and dispatchAndCollect above.
      dispatchAndCollect(() => dispatchAction(game, action));
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
  } else if (rejection !== undefined) {
    // An action was rejected while a decomposable prompt with homeless temp cards was still open — e.g.
    // an illegal action submitted mid-reorder (OrderCards) or mid-attach. The rollback state still
    // holds that open prompt, but we are NOT surfacing it, so its fix-up never ran and its temp pile
    // (absent from every zone) would vanish from the projected rejection state. Re-home it here; empty
    // picks = the pre-pick projection, which matches the rolled-back store (picks accumulate adapter-
    // side and are never dispatched until the decision completes).
    const open = game.state.prompts.find(p => p.result === undefined);
    if (open !== undefined && classify(open) === 'decomposable') {
      decomposerFor(open).fixupProjection?.(open, [], game.ctx, game.state, state);
    }
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
