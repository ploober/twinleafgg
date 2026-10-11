import { Card } from '../game/store/card/card';
import { StateLog } from '../game/store/state/state-log';
import { deepClone } from '../utils/utils';
import { GameError } from '../game/game-error';
import { GameMessage } from '../game/game-message';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { CardList } from '../game/store/state/card-list';
import { MoveDamageCountersEffect } from '../game/store/effects/game-effects';
import { ChooseCardsPrompt } from '../game/store/prompts/choose-cards-prompt';
import { isDiscardPick } from './decomposers/choose-cards';
import { liftToTransit, locationOfTag } from './transit-projection';
import { deriveMoved, board as boardOf, visibilityOf, Place } from './moved-events';
import { State, GameWinner } from '../game/store/state/state';
import { SuperType } from '../game/store/card/card-types';
import { setupGame } from '../game/store/reducers/setup-reducer';
import { Prompt } from '../game/store/prompts/prompt';
import { ShowCardsPrompt } from '../game/store/prompts/show-cards-prompt';
import { ShowMulliganPrompt } from '../game/store/prompts/show-mulligan-prompt';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import {
  AttackAction, PassTurnAction, RetreatAction as RetreatGameAction,
  UseAbilityAction as UseAbilityGameAction, UseStadiumAction as UseStadiumGameAction
} from '../game/store/actions/game-actions';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { ImportedGame, importState, projectState, actorIndex, basicIidDisplayNames, allIidNames, pruneResolvingDuplicates } from './state-adapter';
import { atOnceWireSpec } from './at-once';
import { deriveEvents, TurnCarry } from './events';
import { playerIdToActor } from './iid-targets';
import { toPrinting } from './printing';
import { classify, decomposerFor, realPicks, WirePick } from './decomposers';
import { topLevelMenu, handPlayVerbFor } from './legal-actions';
import { mapRejection } from './rejection-codes';
import {
  SCHEMA_VERSION,
  NeutralState, NeutralAction, NeutralEvent, NeutralPlayerId, StepResponse, ResponseStatus,
  PendingDecision, WirePending, WireLegalAction, LegalAction, RejectionInfo,
  BenchBasicAction, EvolveAction, AttachEnergyAction, AttachToolAction,
  RetreatAction, DeclareAttackAction, EndTurnAction, UseAbilityAction,
  ShuffleSystemAction, FlipSystemAction
} from './neutral-types';

type MovedEvent = Extract<NeutralEvent, { kind: 'moved' }>;

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
    // CF-52: "a syntactically valid action whose required verb payload is unresolvable (absent
    // `to`, UNKNOWN IID, bad index) MUST produce HTTP 200 + status invalidAction". An iid that
    // names no card in this game is ALWAYS a caller error — the iid map is built from the caller's
    // own initialState — so it is an illegal action, never an adapter fault. This used to throw a
    // plain Error, which the runner reports as engineFault/HTTP 500 while rotomancer answered 200
    // + invalidAction on the same request. Found 2026-08-20 by a blind-enumerated `por-062` spec
    // naming a bench iid its own board did not contain; TA-291 had fixed the sibling half (an iid
    // that resolves to a card but is not the Pokemon's identifier) and left this one.
    throw new GameError(GameMessage.INVALID_TARGET);
  }
  return card;
}

function handIndexOf(player: Player, card: Card, _role: string, _actor: string): number {
  const handIndex = player.hand.cards.indexOf(card);
  if (handIndex === -1) {
    // TA-492 / CF-52: a real card that is not in the hand (discarded, attached, still in the deck) makes the
    // action illegal — HTTP 200 + invalidAction, as for an unknown iid in lookupCard — never an adapter fault.
    throw new GameError(GameMessage.INVALID_TARGET);
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

/**
 * TA-291 / CF-12 + CF-52: a `source` iid must be the IDENTIFIER of a Pokemon in play, and the
 * settled convention is that the identifier is the BOTTOM Pokemon of the stack — which is exactly
 * what `legal-actions.ts` emits (`ctx.cardToIid.get(list.getPokemons()[0])`). Accepting any card in
 * the stack let a caller name an evolved printing (`a2`) that no menu ever offered and have it
 * silently resolve to the containing slot. The menu and the dispatcher are written in two places;
 * this is the same class as RE-117 / RE-121 / TA-273.
 */
function resolveSourcePokemon(game: ImportedGame, player: Player, iid: string, role: string): PokemonCardList {
  const card = lookupCard(game, iid, role);
  for (const list of [player.active, ...player.bench]) {
    if (list.getPokemons()[0] === card) { return list; }
  }
  // Either not in this player's play area at all, or a stack member that is not the identifier.
  throw new GameError(GameMessage.INVALID_TARGET);
}

function dispatchDeclareAttack(game: ImportedGame, action: DeclareAttackAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  const source = resolveSourcePokemon(game, player, action.source, 'declareAttack.source');
  if (source !== player.active && !source.getPokemons().some(p => p.attacks.some(a => a.useOnBench === true))) {
    // A bench Pokemon may only be named as the attacker when it prints a `useOnBench` attack.
    throw new GameError(GameMessage.INVALID_TARGET);
  }
  // The attack parks on a WaitPrompt (and may raise card prompts mid-attack); the loop drives those.
  game.store.dispatch(new AttackAction(player.id, action.name));
}

function dispatchEndTurn(game: ImportedGame, action: EndTurnAction): void {
  const player = game.state.players[actorIndex(action.actor)];
  // B.86 / TA-647: the turn this `endTurn` ends; a Knock Out pause before the next turn starts is Checkup's.
  game.ctx.endTurnAt = { turn: game.state.turn, activePlayer: game.state.activePlayer, logIndex: game.state.logs.length };
  game.store.dispatch(new PassTurnAction(player.id));
}

/**
 * Play an Item / Supporter / Stadium. twinleaf routes all three through PlayCardAction; the
 * play-card reducer dispatches by the card's trainerType. A placeholder target (own active) is
 * passed for the rare trainer that targets a Pokemon — `findPokemonTarget` swallows a non-resolving
 * target, and non-targeting trainers ignore it; the card's own effect drives any real selection.
 */
function dispatchPlayTrainer(
  game: ImportedGame,
  action: { actor: NeutralPlayerId; type: string; card?: string; cards?: string[] },
): void {
  const player = game.state.players[actorIndex(action.actor)];
  const role = `${action.type}.card`;

  // ── CF-55: which field is legal is decided by the PRINTING, not by the client ──────────────
  //
  // ⚠️ ROW ORDER IS LOAD-BEARING, and the reason is rotomancer's row-4 warning: the duplicate-iid
  // check runs on the RAW IID ARRAY, before anything is resolved to a Card. Resolving first would
  // collapse two iids naming the same physical card into one object and make "a physical card
  // cannot be played twice" unenforceable downstream — the gate would silently accept it.
  if (action.cards !== undefined) {
    if (new Set(action.cards).size !== action.cards.length) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);   // row 4: duplicate iid
    }
    if (action.card !== undefined) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);   // both fields — never legal
    }
    if (action.cards.length === 0) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);
    }
    const cards = action.cards.map(iid => lookupCard(game, iid, `${action.type}.cards`));
    const spec = atOnceWireSpec(cards[0]);
    if (spec === null) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);   // row 1: `cards` on a non-at-once printing
    }
    // "play N <Card> cards" — every named card is the SAME card by name. Matching on name rather
    // than printing is deliberate: two different printings of Custom Catcher are two Custom
    // Catchers.
    if (cards.some(c => c.name !== cards[0].name)) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);
    }
    if (!spec.counts.includes(action.cards.length)) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);   // row 3: the LENGTH is the branch count
    }
    // Every named card must actually be in hand; handIndexOf throws if not.
    const handIndexes = cards.map(c => handIndexOf(player, c, `${action.type}.cards`, action.actor));
    const target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    // The engine's own reducer consumes the companion copies (transformation-tome.ts finds and
    // discards the second itself), so dispatch names the first and lets it. Copies of one name are
    // fungible for every at-once effect in the registry; the wire contract is what needs all N
    // named, so the caller's set is VALIDATED here and then collapsed.
    game.store.dispatch(new PlayCardAction(player.id, handIndexes[0], target));
    return;
  }

  if (action.card === undefined) {
    throw new GameError(GameMessage.ILLEGAL_ACTION);
  }
  const card = lookupCard(game, action.card, role);
  if (atOnceWireSpec(card) !== null) {
    // Row 2: a lone copy sent through the singular field would back-door the count gate, which is
    // the exact play #2366 forbids.
    throw new GameError(GameMessage.ILLEGAL_ACTION);
  }
  const handIndex = handIndexOf(player, card, role, action.actor);
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
  // TA-291: same identity rule as declareAttack — `source` names the Pokemon, i.e. the stack's
  // bottom Pokemon, which is the iid the ability menu emits.
  const source = resolveSourcePokemon(game, player, action.source, 'useAbility.source');
  const target = resolveOwnPokemonTarget(player, source.getPokemons()[0]);
  game.store.dispatch(new UseAbilityGameAction(player.id, action.ability, target));
}

/**
 * TA-273: the hand-play VERB must name the card it is played with. Every hand-play verb dispatches
 * the same `PlayCardAction`, so the ENGINE resolved from the card's own category and the verb the
 * client sent was never read — `benchBasic`, `playSupporter`, `attachTool` and `attachEnergy` all
 * successfully resolved an Ultra Ball. Every engine's MENU offered exactly `playItem` for it; only
 * the executor did not check, which is the "menu and dispatcher written in two places" shape
 * rotomancer named in RE-117 / RE-121.
 *
 * CF-54 pins that the verb SELECTS THE GATES, so a non-load-bearing verb is a contract violation and
 * not merely untidy. It matters at scale rather than at the table: with 2,000 agent-authored specs,
 * agents WILL write the wrong verb, twinleaf would accept where rotomancer refuses, and the harness
 * would report DIVERGED with no rules content in it — manufactured noise landing in the S-7 yield
 * numbers, on a population large enough to swamp real findings.
 *
 * The verb comes from `handPlayVerbFor`, the SAME derivation the menu uses, so the two cannot drift.
 */
function assertHandPlayVerb(game: ImportedGame, action: NeutralAction, role: string): void {
  const iid = (action as { card?: string }).card;
  if (iid === undefined) {
    return; // a CF-55 at-once play names `cards`; its verb is checked per card below
  }
  const card = lookupCard(game, iid, role);
  const expected = handPlayVerbFor(card);
  if (expected !== null && expected !== action.type) {
    throw new GameError(GameMessage.ILLEGAL_ACTION);
  }
}

/** Dispatch one top-level neutral action, returning the game-log delta it produced. */
function dispatchAction(game: ImportedGame, action: NeutralAction): void {
  switch (action.type) {
    case 'benchBasic':
    case 'evolve':
    case 'attachEnergy':
    case 'attachTool':
    case 'playItem':
    case 'playSupporter':
    case 'playStadium':
      assertHandPlayVerb(game, action, `${action.type}.card`);
      break;
    default:
      break;
  }
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
      dispatchPlayTrainer(
        game, action as { actor: NeutralPlayerId; type: string; card?: string; cards?: string[] }); break;
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
  midPrompt?: { prompt: Prompt<any>; picks: WirePick[]; decided?: WirePick[] };
  /**
   * B.80: searches COMPLETED during this step whose chosen cards the engine still holds in the source zone
   * (Burning Charge: the ChooseCardsPrompt over the deck resolves, the card code keeps the two Energy in
   * `player.deck` until the recipient ChoosePokemonPrompt resolves). Physically the player is holding
   * them, so at a later pause of the same step they project in `transit`. The resolved prompt itself is
   * spliced out of `state.prompts` (store.ts), so the selection has to be remembered here.
   */
  completedSearches?: Array<{ cards: Card[]; source: CardList }>;
  /**
   * TA-590: the board the trace has reached when it differs from the engine's (search picks lifted into transit at
   * a pause the replay ran through, still in the deck on the engine side). step()'s closing legs start from it.
   */
  traceBoard?: NeutralState;
  /** TA-701: the revealed cards still lifted when the replay stopped; step() projects them `public` in transit. */
  publicInTransit?: ReadonlySet<string>;
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
 * Does the pending actually OFFER this action? (TA-205)
 *
 * The driver previously checked only that the action's TYPE appeared among the offered picks, so an
 * action naming a candidate that was never offered — right verb, wrong target — was accepted into the
 * accumulator. Its illegality then surfaced only when the assembled result failed the prompt's
 * `validate()`, which the caller reports as `engineFault`: an HTTP 500 for what is an INVALID ACTION.
 * Rotomancer refuses it at an explicit gate (`sim:refuseGate`, "no option matches target iid …") and
 * returns `invalidAction`; the contract has a status for this and we were returning the wrong one.
 *
 * Matching rule: B.95 (TA-662) — every field the offered entry carries, with its value; see NOT_ANSWER_FIELDS.
 */
/** CF-59 label equality: casefold, collapse runs of non-alphanumerics to one space, trim. */
export function normalizeOptionLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * CF-59: a `selectOption` that names its choice by `label` and omits `option` is resolved against the
 * advertised menu here, IN PLACE, before `toPick` and the membership gate see it — so both keep
 * reasoning about `option` (the identity field) and a label-addressed answer is exactly as legal as
 * the index it denotes. An unknown label leaves `option` absent, and the membership gate turns that
 * into `invalidAction` (CF-52's "absent required field"), never a guess.
 */
function resolveSelectOptionLabel(legalActions: LegalAction[], action: NeutralAction): void {
  if (action.type !== 'selectOption') {
    return;
  }
  const a = action as unknown as { option?: unknown; label?: unknown };
  if (a.option !== undefined || typeof a.label !== 'string') {
    return;
  }
  const want = normalizeOptionLabel(a.label);
  for (const la of legalActions) {
    if (la.type === 'selectOption' && la.label !== undefined && normalizeOptionLabel(la.label) === want) {
      a.option = la.option;
      return;
    }
  }
}

/**
 * TA-662 / B.95 (owner 2026-10-07): the fields of an offered entry an answer need not repeat. CF-70's `op` / `amount` /
 * `destination` (a registered gate, contract 0.15.0: only twinleaf's templates carry them, so B.95 left them to the
 * gate work), template-only descriptions (`enterNumber`'s `min` / `max` / `step`, `shuffle`'s `deck`, `playItem`'s
 * `candidates` / `counts`), and `label`, which CF-59 lets an answer give instead of `option` (compared below when both
 * carry it). CF-38's `subject` IS compared: both engines carry it on `resolveNext`.
 */
const NOT_ANSWER_FIELDS = new Set(['actor', 'type', 'op', 'amount', 'destination', 'min', 'max', 'step', 'deck',
  'candidates', 'counts', 'label']);

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
}

function offersAction(legalActions: LegalAction[], action: NeutralAction): boolean {
  if (action.type === 'shuffle') {
    return true;
  }
  const submitted = action as unknown as { [k: string]: unknown };
  return legalActions.some(la => {
    if (la.type !== action.type) {
      return false;
    }
    const offered = la as unknown as { [k: string]: unknown };
    // TA-662 / B.95: every field the offered entry carries, with the same value (it replaced TA-205's per-verb
    // identity table, which let `owner`, `name` and `moveEnergy.source` be omitted or wrong).
    for (const [k, v] of Object.entries(offered)) {
      if (NOT_ANSWER_FIELDS.has(k) || !present(v)) {
        continue;
      }
      if (JSON.stringify(submitted[k]) !== JSON.stringify(v)) {
        return false;
      }
    }
    // B.100: a label that names another option is not this entry.
    if (typeof submitted.label === 'string' && typeof offered.label === 'string'
        && normalizeOptionLabel(submitted.label) !== normalizeOptionLabel(offered.label)) {
      return false;
    }
    return true;
  });
}

/** A system pending (shuffle / coin flip) surfaced when its action isn't yet in the log. */
function systemPending(game: ImportedGame, prompt: Prompt<any>): PendingDecision {
  const legalActions: LegalAction[] = [];
  if (prompt.type === 'Shuffle deck') {
    const player = game.state.players.find(p => p.id === prompt.playerId);
    const cards = player ? player.deck.cards : [];
    // TA-396(c): a bottom-segment shuffle advertises only the segment (rotomancer's shape for
    // "shuffle the other cards and put them on the bottom": `deck` = the looked-at remainder).
    const bottomCount = (prompt as { bottomCount?: number }).bottomCount;
    const segment = bottomCount !== undefined ? cards.slice(Math.max(0, cards.length - bottomCount)) : cards;
    const deck = segment
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
  // ANSWER is defined to carry `order` (the new deck order — §5). CF-22 originally accepted EITHER
  // field and fell back to the deck's current order, on the reasoning that the order is externalized
  // only for reproducibility so a caller who supplies none accepts the current one. That fixed a real
  // 500 (`undefined.map`, which made every post-search-shuffle step fault) but the leniency was the
  // wrong half of the fix.
  //
  // ⚠️ RETIRED 2026-08-21 (TA-302, CF-22 amended). Two reasons, and the first is the load-bearing one:
  //
  // 1. **The order is the ONLY thing that makes a shuffle reproducible across engines.** Silently
  //    accepting "you meant the current order" means one engine shuffles and the other does not, and
  //    the resulting divergence is attributed to the CARD. A leniency that manufactures false card
  //    findings costs more than the convenience it buys.
  // 2. CF-52 (later, and specifically about malformed payloads) pins an unresolvable required verb
  //    payload as `invalidAction`, and rotomancer implemented exactly that for all five malformed
  //    `order` shapes (their RE-127 fix). `deck` in an ANSWER is the caller confusing input with
  //    answer — which is the case CF-52 exists for, not a spelling to accept.
  //
  // No committed scenario or seed relied on the fallback (scanned 2026-08-21): the canonical JSON
  // writer emits `order: []` on every action, and an empty `order` already failed `validate`.
  const orderIids: string[] | undefined = action.order;
  if (orderIids === undefined) {
    return []; // an empty permutation fails `prompt.validate` -> invalidAction at the call site
  }
  // TA-396(c): a bottom-segment shuffle's answer names only the segment; compose it with the identity
  // on the untouched top so the engine receives one whole-deck permutation (its validate accepts both).
  const bottomCount = (prompt as { bottomCount?: number }).bottomCount;
  if (bottomCount !== undefined && orderIids.length === bottomCount && bottomCount < deck.length) {
    const start = deck.length - bottomCount;
    const identity = Array.from({ length: start }, (_, i) => i);
    return [...identity, ...orderIids.map(iid => {
      const card = game.ctx.iidToCard.get(iid);
      const index = card ? deck.indexOf(card) : -1;
      return index < start ? -1 : index;   // a non-segment iid is a malformed payload -> validate rejects
    })];
  }
  return orderIids.map(iid => {
    const card = game.ctx.iidToCard.get(iid);
    const index = card ? deck.indexOf(card) : -1;
    if (index === -1) {
      // Not a fault: an iid the deck does not hold is a malformed client payload, and CF-52 answers
      // it with `invalidAction`. Returning an out-of-range index makes `validate` reject it on the
      // same path as every other bad `order` shape, so there is ONE rejection route, not two.
      return -1;
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
    // B.81: zone labels are the contract's `Location.zone` vocabulary (`discardPile`, `active` | `bench`).
    if (owner.hand.cards.includes(card)) { return { owner, zone: 'hand' }; }
    if (owner.deck.cards.includes(card)) { return { owner, zone: 'deck' }; }
    if (owner.discard.cards.includes(card)) { return { owner, zone: 'discardPile' }; }
    if (owner.lostzone.cards.includes(card)) { return { owner, zone: 'lostZone' }; }
    if (owner.active.cards.includes(card)) { return { owner, zone: 'active' }; }
    for (const b of owner.bench) { if (b.cards.includes(card)) { return { owner, zone: 'bench' }; } }
    for (const p of owner.prizes) { if (p.cards.includes(card)) { return { owner, zone: 'prizes' }; } }
  }
  return null;
}

/**
 * TA-373: `reveal.from` is the SOURCE zone (§B.34), not where the card sits when the ShowCardsPrompt
 * fires. A search-then-reveal ("search your deck … reveal it, put it in your hand") has already moved
 * the card to the hand by prompt time, so `locateCard` reads `hand`. Snapshot every card's zone at the
 * START of each top-level action (before the search relocates anything) and read `from` off that. Card
 * identity is stable, so the snapshot is a durable record of the pre-action zones. Zone labels match
 * `locateCard`.
 */
function snapshotCardZones(state: State): Map<Card, string> {
  const m = new Map<Card, string>();
  for (const owner of state.players) {
    for (const c of owner.hand.cards) { m.set(c, 'hand'); }
    for (const c of owner.deck.cards) { m.set(c, 'deck'); }
    for (const c of owner.discard.cards) { m.set(c, 'discardPile'); }   // B.81 vocabulary
    for (const c of owner.lostzone.cards) { m.set(c, 'lostZone'); }
    for (const c of owner.active.cards) { m.set(c, 'active'); }
    for (const b of owner.bench) { for (const c of b.cards) { m.set(c, 'bench'); } }
    for (const p of owner.prizes) { for (const c of p.cards) { m.set(c, 'prizes'); } }
  }
  return m;
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
/** TA-665: whether `list` is one of the player's zones (a pile that is none of them is a lifted, closure-local pile). */
function isZoneOf(p: Player, list: CardList): boolean {
  return list === p.deck || list === p.hand || list === p.discard || list === p.lostzone || list === p.active
    || p.bench.includes(list as PokemonCardList) || p.prizes.includes(list) || list === p.stadium;
}

/** B.97: zones whose cards every player already sees (snapshotCardZones labels). */
const PUBLIC_ZONES = new Set(['discardPile', 'lostZone', 'active', 'bench']);

function buildRevealEvent(game: ImportedGame, prompt: ShowCardsPrompt, sourceZones: Map<Card, string>): NeutralEvent | null {
  const cards = prompt.cards;
  // Owner fallback for a show we cannot locate by card: the prompt's playerId is the AUDIENCE, so the
  // shower is the other player ("your opponent reveals their hand" prompts the attacker).
  const audience = playerIdToActor(game.state, prompt.playerId);
  const fallbackOwner = audience === 'A' ? 'B' : 'A';

  if (cards.length === 0) {
    // B.97 (TA-663, supersedes TA-153's empty reveal): a reveal is emitted only when hidden cards become visible. An
    // empty show makes nothing visible (a zone's size is public), so it is no event: Haughty Order dri-150 against an
    // empty deck, "your opponent reveals their hand" over an empty hand.
    return null;
  }
  // B.97 (TA-663): a card that was already public at the start of the action (in play, the discard pile, the Lost
  // Zone) is never revealed: Sonar and Night Stretcher show their discard-pile pick to the opponent, which tells the
  // opponent nothing the board did not.
  const hidden = cards.filter(c => !PUBLIC_ZONES.has(sourceZones.get(c) ?? ''));
  const iids: string[] = [];
  for (const c of hidden) {
    const iid = game.ctx.cardToIid.get(c);
    if (iid !== undefined) {
      iids.push(iid);
    }
  }
  if (iids.length === 0) {
    return null;
  }
  const loc = locateCard(game.state, hidden[0]);
  // Owner = the located zone's owner; fall back to the non-audience player (see above).
  const owner = loc !== null ? playerIdToActor(game.state, loc.owner.id) : fallbackOwner;
  // TA-373 / §B.34: `from` is the SOURCE zone — where the card was at the START of this action, before
  // any search relocated it — not `loc.zone` (its post-move zone at prompt time). Fall back to the
  // located zone for a card that entered play mid-action (absent from the snapshot).
  // B.80 / B.34 amended: a card absent from EVERY settled zone at the start of the action was LIFTED (on
  // the table, in a pile) — it was in `transit`, so that is its `from` (Tyme's face-down Pokémon revealed
  // during the opponent's guess). The located zone is the fallback only for a card the game did not know.
  const from = sourceZones.get(hidden[0])
    ?? (game.ctx.cardToIid.has(hidden[0]) ? 'transit' : (loc !== null ? loc.zone : 'unknown'));
  return { kind: 'reveal', owner, cards: iids, from, to: 'all' };
}

/**
 * B.81 (TA-591): the players whose WHOLE deck has an open shuffle (no `bottomCount`, zone deck). A card that landed
 * in such a deck in the dispatch just run is shuffled in (`position: any`), whatever end the engine put it at.
 *
 * B.87 / TA-648 (owner pin): so is a card that landed in a deck the same effect is now SEARCHING — an open decision
 * over that very deck (the prompt's pile is the player's deck list itself, not a looked-at copy). A search of a deck
 * is followed by that deck's shuffle, so where the card lies cannot matter to play: Perrin twm-160 ("put them into
 * your deck. If you do, search your deck ... Then, shuffle your deck") pauses at the search with the cards in.
 */
function shuffledInDecks(state: State): Set<NeutralPlayerId> {
  const out = new Set<NeutralPlayerId>();
  for (const p of state.prompts) {
    if (p.result !== undefined) { continue; }
    const pile = (p as unknown as { cards?: unknown }).cards;
    const searched = state.players.findIndex(pl => pl.deck === pile);
    if (searched >= 0) { out.add(searched === 0 ? 'A' : 'B'); continue; }
    if (!p.type.startsWith('Shuffle')) { continue; }
    const q = p as unknown as { bottomCount?: number; zone?: string };
    if ((q.bottomCount ?? 0) > 0 || (q.zone ?? 'deck') !== 'deck') { continue; }
    const i = state.players.findIndex(pl => pl.id === p.playerId);
    if (i >= 0) { out.add(i === 0 ? 'A' : 'B'); }
    // TA-657 (B.87 / B.90): a shuffle the same effect still owes (EACH_PLAYER_SHUFFLE_HAND_INTO_DECK, one at a time).
    for (const id of (p as unknown as { alsoShuffles?: number[] }).alsoShuffles ?? []) {
      const j = state.players.findIndex(pl => pl.id === id);
      if (j >= 0) { out.add(j === 0 ? 'A' : 'B'); }
    }
  }
  return out;
}

/**
 * B.82 / CF-93: the `chosen` event for a card IN PLAY an attack chose before its damage: its owner, its place on the
 * stack (the card stays there until the effect moves it after the damage), visibility `public` (a card in play).
 * TA-674 (B.102): or a card in a discard pile (public), origin `discardPile`. Undefined for a card in a hidden zone
 * (the hand, the deck): never `chosen` (B.82 (2), B.101 (1)).
 */
function chosenEvent(game: ImportedGame, card: Card): NeutralEvent | undefined {
  const iid = game.ctx.cardToIid.get(card);
  if (iid === undefined) { return undefined; }
  const players = game.store.state.players;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.discard.cards.includes(card)) {
      return { kind: 'chosen', owner: i === 0 ? 'A' : 'B', card: iid, origin: { zone: 'discardPile' }, visibility: 'public' };
    }
    const lists: Array<[PokemonCardList, 'active' | 'bench']> = [[p.active, 'active'], ...p.bench.map(b => [b, 'bench'] as [PokemonCardList, 'bench'])];
    for (const [list, section] of lists) {
      // TA-654 / B.89 (5): a Pokémon Tool sits in the bearer's `tools`, not its `cards` (Cleaning Up's chosen Tools).
      if (!list.cards.includes(card) && !list.tools.includes(card)) { continue; }
      const basic = game.ctx.cardToIid.get(list.getPokemons()[0]);
      if (basic === undefined) { return undefined; }
      const role = card.superType === SuperType.ENERGY ? 'energy' : card.superType === SuperType.TRAINER ? 'tool' : 'pokemon';
      return { kind: 'chosen', owner: i === 0 ? 'A' : 'B', card: iid, origin: { zone: section, pokemon: basic, role }, visibility: 'public' };
    }
  }
  return undefined;
}

function runLoop(game: ImportedGame, actions: NeutralAction[]): LoopResult {
  const events: NeutralEvent[] = [];
  const cursor = { i: 0 };          // shared with the flip provider below
  let accum: WirePick[] = [];
  // TA-660 / B.93: picks the adapter applied with no pending (CF-14 collapses): not decisions, so never `chosen`.
  const forcedPicks = new WeakSet<object>();
  const completedSearches: Array<{ cards: Card[]; source: CardList }> = [];
  // (Removed 2026-07-24, TA-129/CF-12: `turnEndedBy` tracked the actor whose turn was auto-ended by
  // their own declareAttack, so the driver could absorb that player's redundant trailing `endTurn`.
  // CF-12 deprecates that leniency — the action is not offered and must reject. See the dispatch loop.)

  // The system actor's inline coin source: consume the next `flip` action from the same cursor the
  // loop walks, so inline flips (CoinFlipEffect) and the loop stay aligned in log order.
  // When the next action is NOT a flip, return undefined: RESOLVE_COIN_FLIP_EFFECT then surfaces a
  // REAL pausing CoinFlipPrompt (damage-first, TA-79/TA-306-correct) which this loop answers like any
  // raw-prompt card's. The FlipStarvation throw/rollback pause below is retained only as a backstop
  // for any handler shape that still throws — the provider itself no longer starves (2026-08-31).
  game.handler.setFlipProvider((): boolean | undefined => {
    const next = cursor.i < actions.length ? actions[cursor.i] : undefined;
    if (next === undefined || next.type !== 'flip') {
      return undefined;
    }
    cursor.i++;
    return (next as FlipSystemAction).face === 'heads';
  });

  // Cross-batch turn-boundary memory for the deferred `turnEnded` (TA-2/TA-8) — one per replay.
  const turnCarry: TurnCarry = {};

  // B.81: the cards a `reveal` named since the last CLIENT action — their next leg is `public`.
  // TA-690: the memory used to end at every dispatch, but the loop's own dispatches (a show's ack, a CF-14 collapse, a
  // forced shuffle) are no pause: a hand revealed by Thieving Swipe and put under the deck by the collapsed one-card
  // pick moves `public`, while the same pick made at a surfaced pending is a new action and moves `owner` (rotomancer
  // on both, 2026-10-11). The memory is cleared when a dispatch starts after the cursor moved (below).
  const revealedSince = new Set<string>();
  let cursorAtLastDispatch = -1;
  // TA-701 (contract TransitCard.visibility; the TA-605 class): the cards a show has made public that are still LIFTED.
  // A revealed card the player goes on holding (Crispin's two Energy at the attach pick) is `public` in transit, and so
  // is the leg that finally places it; the pile projection's default (`owner`, a look) is wrong for it. Every board this
  // replay projects goes through `seen`; a card the engine's own board no longer holds in transit leaves the set after
  // the dispatch that placed it.
  const publicInTransit = new Set<string>();
  const seen = (board: NeutralState): NeutralState => {
    if (publicInTransit.size === 0) { return board; }
    for (const who of ['A', 'B'] as const) {
      for (const t of board.players[who].transit ?? []) {
        if (publicInTransit.has(t.iid)) { t.visibility = 'public'; }
      }
    }
    return board;
  };
  // B.87 / TA-643: deck legs of a dispatch that ended at an auto-acknowledged wait (see dispatchAndCollect).
  let deckLegsAtWait: MovedEvent[] = [];

  // TA-590 (B.80 §5 / §8, B.81 §6): a search pick is lifted into transit AT THE PICK. step() projects that at a pause
  // (the decomposer's fix-up) and closes the trace with its leg, but a replay that ran on past the pause skipped the
  // leg: the completed search read deck -> hand and its reveal read the engine's deck, where the card stays until the
  // prompt resolves (and, for a generator card such as Earthen Vessel, until its show is acknowledged). `held` is
  // every deck-search pick made at a pause the replay ran through: the trace's board shows it in transit (`overlay`)
  // until the engine takes it out of the deck. Its lift leg is emitted at the pause, every dispatch's legs are
  // derived between overlaid boards, and the reveal names it `from: transit`. Nothing changes for a search completed
  // by the action that made its only pick: it never pauses, and both engines read deck -> hand, from: deck.
  const held = new Map<Card, { iid: string; source: CardList; legs: NeutralEvent[] }>();
  const isDeckSearch = (prompt: Prompt<any>): prompt is ChooseCardsPrompt => prompt instanceof ChooseCardsPrompt
    && !isDiscardPick(prompt) && prompt.options.isSecret !== true && prompt.cards.zoneTag === 'deck';
  const overlay = (board: NeutralState): NeutralState => {
    for (const [card, h] of held) {
      if (h.source.cards.includes(card)) { liftToTransit(board, h.iid, { visibility: 'owner', origin: { zone: 'deck' } }); }
    }
    return board;
  };
  const traceProject = (): NeutralState => overlay(seen(projectState(game.store.state, game.ctx)));
  const liftPausedSearchPicks = (prompt: Prompt<any>, picks: WirePick[]): void => {
    if (!isDeckSearch(prompt)) { return; }
    const fresh: Card[] = [];
    for (const p of realPicks(picks) as Array<{ index: number }>) {
      const card = prompt.cards.cards[p.index];
      const iid = card === undefined ? undefined : game.ctx.cardToIid.get(card);
      if (card === undefined || iid === undefined || held.has(card)) { continue; }
      // The source is the player's own deck (a prompt over a copied pile tagged `deck` would never lose the card).
      const deck = game.store.state.players.map(pl => pl.deck).find(d => d.cards.includes(card));
      if (deck === undefined) { continue; }
      fresh.push(card);
      held.set(card, { iid, source: deck, legs: [] });
    }
    if (fresh.length === 0) { return; }
    const before = seen(projectState(game.store.state, game.ctx));
    for (const card of held.keys()) {
      if (!fresh.includes(card)) { const h = held.get(card)!; if (h.source.cards.includes(card)) { liftToTransit(before, h.iid, { visibility: 'owner', origin: { zone: 'deck' } }); } }
    }
    const legs = deriveMoved(before, traceProject());
    events.push(...legs);
    for (const leg of legs) {
      const card = game.ctx.iidToCard.get((leg as { card: string }).card);
      const h = card === undefined ? undefined : held.get(card);
      if (h !== undefined) { h.legs.push(leg); }
    }
  };
  // B.34 as amended by B.80: a held pick was in transit at the start of the action.
  const snapshotZones = (): Map<Card, string> => {
    const m = snapshotCardZones(game.state);
    for (const [card, h] of held) { if (h.source.cards.includes(card)) { m.set(card, 'transit'); } }
    return m;
  };

  // TA-593: every positional take from a player's own deck into that player's own hand is a draw. Live identity
  // only (a probe's cloned lists never match), cleared when the loop ends; a dispatch that throws drops its draws.
  const drawOps: Array<{ player: NeutralPlayerId; count: number }> = [];
  const liftedOffDeck = new Map<Card, Player>();
  CardList.topTake = (from: CardList, to: CardList, count: number): void => {
    const players = game.store.state.players;
    for (let i = 0; i < players.length; i++) {
      if (players[i].deck === from && players[i].hand === to) {
        drawOps.push({ player: i === 0 ? 'A' : 'B', count });
        return;
      }
      // TA-665 (B.80 / B.81): a take off the top of a deck into a pile that is no zone of the game lifts those cards
      // (Destructo-Press tef-062 reveals the top 5, discards the Future cards and shuffles the rest back, all inside one
      // dispatch). Remember them: one that is back in the same deck when the dispatch ends made a round trip the board
      // diff cannot see.
      if (players[i].deck === from && !players.some(p => isZoneOf(p, to))) {
        for (const c of to.cards.slice(-count)) { liftedOffDeck.set(c, players[i]); }
        return;
      }
    }
  };

  // TA-698 (B.81): every put of cards into a settled deck this dispatch, with its end (CardList.deckPut). Live identity
  // only; cleared per dispatch. A card out of that deck again when the dispatch ends made a stop the board diff cannot see.
  const deckPuts = new Map<Card, { player: Player; end: 'top' | 'bottom' }>();
  CardList.deckPut = (deck: CardList, cards: Card[], end: 'top' | 'bottom'): void => {
    const p = game.store.state.players.find(pl => pl.deck === deck);
    if (p === undefined) { return; }
    for (const c of cards) { deckPuts.set(c, { player: p, end }); }
  };

  // TA-664 (#1995, #2257): a counter moved off a Pokemon is not healed, even when its placement is prevented and it
  // vanishes (Adrena-Brain under Battle Cage). Live identity only (a probe's clone constructs the effect too).
  let countersMoved = false;
  MoveDamageCountersEffect.observed = (who: unknown): void => {
    if (game.store.state.players.some(p => p === who)) { countersMoved = true; }
  };

  // B.81: a switch is an ordering point. The engine calls CardList.legCut once an Active / Bench swap completes;
  // the legs up to that board are derived then, and the dispatch's board diff runs on from it. Live identity only.
  let segment: { start: NeutralState; legs: NeutralEvent[] } | undefined;
  // TA-704 / B.81: the deck end the engine's placement declared for a card (CardList.deckEnd), for a leg into an
  // empty deck, where the board alone cannot say top from bottom.
  const declaredEnd = (iid: string): 'top' | 'bottom' | undefined => {
    const card = game.ctx.iidToCard.get(iid);
    return card === undefined ? undefined : CardList.deckEnd.get(card);
  };
  CardList.legCut = (who: unknown): void => {
    if (segment === undefined || !game.store.state.players.some(p => p === who)) { return; }
    const now = traceProject();
    segment.legs.push(...deriveMoved(segment.start, now, revealedSince, shuffledInDecks(game.store.state), declaredEnd));
    segment.start = now;
  };

  const dispatchAndCollect = (fire: () => void): void => {
    // TA-690 / B.81: a client action was consumed since the last dispatch (a top-level action, an answered pick, a
    // flip, a shuffle): the reveal memory ends there, not at the loop's own dispatches.
    if (cursor.i !== cursorAtLastDispatch) {
      revealedSince.clear();
      cursorAtLastDispatch = cursor.i;
    }
    const beforeLogs = game.state.logs.length;
    const beforeDraws = drawOps.length;
    liftedOffDeck.clear();
    deckPuts.clear();
    // TA-698: the cards physically in each deck now (a bottom segment under an open shuffle projects in transit).
    const inDeckAtStart = new Map<Card, Player>();
    for (const p of game.state.players) { for (const c of p.deck.cards) { inDeckAtStart.set(c, p); } }
    const beforeState = seen(projectState(game.state, game.ctx));
    // TA-590: the legs run between the trace's boards (held search picks in transit); every other derivation reads
    // the engine's own.
    const movedBefore = held.size > 0 ? traceProject() : beforeState;
    segment = { start: movedBefore, legs: [] };
    // TA-252: display names captured from the PRE-dispatch state — the KO'd are only in `before`.
    const beforeNames = basicIidDisplayNames(game.state, game.ctx);
    let starved: FlipStarvation | undefined;
    let cut: { start: NeutralState; legs: NeutralEvent[] } | undefined;
    // TA-576: a prompt answer the resolving card refuses (a GameError from its continuation) is a rejected action,
    // and a rejection reports the board before it. Store.reduce restores its own snapshot for a top-level action;
    // Store.reducePrompt cannot (the continuation has run and is consumed when the card throws, so what it moved
    // first stays moved: Custom Catcher lot-171 discarded its second copy, then refused). Snapshot before an
    // answer and restore it on that throw. The replay ends at a rejection, so the restored store is only projected.
    // A FlipStarvation is not a rejection and keeps what committed (see below).
    const answerBackup: State | undefined = game.store.state.prompts.some(p => p.result === undefined)
      ? deepClone(game.store.state, [Card, StateLog]) : undefined;
    try {
      fire();
    } catch (err) {
      if (!(err instanceof FlipStarvation)) {
        if (answerBackup !== undefined && err instanceof GameError) {
          game.store.state = answerBackup;
          game.state = answerBackup;
        }
        throw err;
      }
      // A coin flip ran past the log mid-dispatch. If it fired in the attack effect (WAS_ATTACK_USED)
      // Store.reduce restored its clone, so nothing committed and afterState == beforeState. If it
      // fired in an after-attack effect reached through a prompt-resolution continuation (AFTER_ATTACK),
      // Store.reducePrompt does NOT roll back, so the attack's damage stayed committed. Resync and still
      // derive whatever landed so the paused response is consistent with its state; re-throw below so a
      // catch site can pause with a system flip pending (drives AFTER_ATTACK flips without touching cards).
      game.state = game.store.state;
      starved = err;
    } finally {
      cut = segment;
      segment = undefined;
    }
    // TA-701: a revealed card the engine's board has placed (out of transit) is no longer held in public view.
    if (publicInTransit.size > 0) {
      const raw = projectState(game.state, game.ctx);
      const lifted = new Set<string>();
      for (const who of ['A', 'B'] as const) { for (const t of raw.players[who].transit ?? []) { lifted.add(t.iid); } }
      for (const iid of publicInTransit) { if (!lifted.has(iid)) { publicInTransit.delete(iid); } }
    }
    const afterState = seen(projectState(game.state, game.ctx));
    const movedAfter = held.size > 0 ? overlay(seen(projectState(game.state, game.ctx))) : afterState;
    // All-card iid -> name (energy/tool/evolution names for the observed-tier state-diff derivations).
    // CF-60 forbids minting, so this is stable; built per dispatch for simplicity, it is a cheap copy.
    const allNames = allIidNames(game.ctx);
    const draws = drawOps.splice(beforeDraws);
    events.push(...deriveEvents(beforeState, afterState, game.state.logs.slice(beforeLogs), turnCarry, beforeNames, allNames,
      draws, countersMoved));
    countersMoved = false;
    // B.81 / CF-92: one `moved` per card whose place changed in this dispatch (moved-events.ts).
    // TA-591: a card shown by a ShowCardsPrompt still open at the end of this dispatch was revealed by it — the
    // engine raises the show and moves the card in one callback (SEARCH_DECK_FOR_CARDS_TO_HAND: "reveal it, and put
    // it into your hand"), so its leg is `public` though the reveal event is captured at the ack, one dispatch later.
    for (const p of game.state.prompts) {
      if (p.result === undefined && p.type === 'Show cards') {
        for (const c of (p as ShowCardsPrompt).cards) {
          const iid = game.ctx.cardToIid.get(c);
          if (iid !== undefined) { revealedSince.add(iid); publicInTransit.add(iid); }
        }
      }
    }
    // A starved dispatch may have rolled back past its cuts: then the single before/after diff is the trace.
    const shuffledIn = shuffledInDecks(game.state);
    const legs = starved === undefined && cut !== undefined && cut.legs.length > 0
      ? [...cut.legs, ...deriveMoved(cut.start, movedAfter, revealedSince, shuffledIn, declaredEnd)]
      : deriveMoved(movedBefore, movedAfter, revealedSince, shuffledIn, declaredEnd);
    // TA-698 (B.81: one `moved` per physical pluck-and-place). A card that was in a deck — put there this dispatch
    // (deckPuts: Up-Tempo's cost card to the bottom) or physically there at the start while projected in transit (a
    // hand pile under its shuffle: Grand Wing) — and is out of it when the dispatch ends made a stop in the deck the
    // board diff cannot see: it read as no move (hand -> hand) or as transit -> hand. Its leg is split at the deck, at
    // the end it went to; a card the diff already saw leave the deck, or that is still in one, is left alone. So is a
    // card that ends the dispatch still LIFTED (projected in transit / resolving): the wire has not placed it yet, and
    // the engine's own parking of it in the deck meanwhile is staging, not a put (Iono's lockstep, B.74 / TA-556: A's
    // shuffled block is parked under the deck and lifted out again until B's hand is shuffled).
    if (starved === undefined && (deckPuts.size > 0 || inDeckAtStart.size > 0)) {
      const bBefore = boardOf(movedBefore);
      const bAfter = boardOf(movedAfter);
      const through = new Map<Card, { player: Player; end?: 'top' | 'bottom' }>();
      for (const [c, p] of inDeckAtStart) { through.set(c, { player: p }); }
      for (const [c, put] of deckPuts) { through.set(c, { player: put.player, end: put.end }); }
      for (const [card, t] of through) {
        if (t.player.deck.cards.includes(card)) { continue; }
        const iid = game.ctx.cardToIid.get(card);
        if (iid === undefined) { continue; }
        const from = bBefore.at.get(iid);
        const to = bAfter.at.get(iid);
        if (from === undefined || to === undefined || from.loc.zone === 'deck' || to.loc.zone === 'deck'
          || to.loc.zone === 'transit' || to.loc.zone === 'resolving') { continue; }
        const end = t.end ?? bBefore.transitDeckEnd.get(iid);
        if (end === undefined) { continue; }
        const owner = playerIdToActor(game.state, t.player.id);
        const stop: Place = { owner, loc: { zone: 'deck' } };
        const into: MovedEvent = { kind: 'moved', owner, card: iid, origin: { ...from.loc },
          destination: { zone: 'deck', position: shuffledIn.has(owner) ? 'any' : end },
          visibility: visibilityOf(from, stop, iid, bBefore, bAfter, revealedSince) };
        const outOf: MovedEvent = { kind: 'moved', owner, card: iid, origin: { zone: 'deck' }, destination: { ...to.loc },
          visibility: visibilityOf(stop, to, iid, bBefore, bAfter, revealedSince) };
        const at = legs.findIndex(l => l.kind === 'moved' && l.card === iid);
        if (at >= 0) { legs.splice(at, 1, into, outOf); } else { legs.push(into, outOf); }
      }
    }
    events.push(...legs);
    // TA-665: a card lifted off its deck and back in that deck by the end of the dispatch went deck -> transit -> deck.
    const returned = new Map<Player, Card[]>();
    for (const [card, p] of liftedOffDeck) {
      const iid = game.ctx.cardToIid.get(card);
      if (iid === undefined || !p.deck.cards.includes(card) || legs.some(l => (l as { card?: string }).card === iid)) { continue; }
      returned.set(p, [...(returned.get(p) ?? []), card]);
    }
    liftedOffDeck.clear();
    for (const [p, back] of returned) {
      const owner = playerIdToActor(game.state, p.id);
      const n = back.length;
      for (const card of back) {
        const iid = game.ctx.cardToIid.get(card)!;
        const at = p.deck.cards.indexOf(card);
        const position = shuffledIn.has(owner) ? 'any' : at < n ? 'top' : at >= p.deck.cards.length - n ? 'bottom' : 'any';
        const visibility = revealedSince.has(iid) ? 'public' : 'owner';
        events.push(
          { kind: 'moved', owner, card: iid, origin: { zone: 'deck' }, destination: { zone: 'transit' }, visibility } as NeutralEvent,
          { kind: 'moved', owner, card: iid, origin: { zone: 'transit' }, destination: { zone: 'deck', position }, visibility } as NeutralEvent);
      }
    }
    // B.87 / TA-643: a deck leg held over a non-decision wait (below) whose deck the effect now shuffles or searches was
    // shuffled in. Drasna ssp-173 puts the hand into the deck, parks on the hand-to-deck animation wait, and raises the
    // shuffle only when that wait is acknowledged — the next dispatch.
    for (const leg of deckLegsAtWait) {
      if (shuffledIn.has(leg.owner)) { (leg.destination as { position?: string }).position = 'any'; }
    }
    // A wait the loop acknowledges by itself is no decision and no pause: the effect runs on through it. The deck legs
    // of a dispatch that ends at one are held until the next dispatch ends somewhere else.
    const open = game.state.prompts.find(p => p.result === undefined);
    deckLegsAtWait = open !== undefined && starved === undefined && classify(open) === 'wait'
      ? [...deckLegsAtWait, ...legs].filter((e): e is MovedEvent => e.kind === 'moved' && e.destination.zone === 'deck'
        && e.destination.position !== 'any')
      : [];
    // TA-590: a held pick the engine has taken out of the deck is placed; the trace has its leg.
    for (const [card, h] of held) { if (!h.source.cards.includes(card)) { held.delete(card); } }
    if (starved !== undefined) { throw starved; }
  };

  // A GameError from any dispatch (top-level action OR a prompt resolution) means the engine rejected
  // the move; the Store rolls a top-level action back and dispatchAndCollect restores a prompt answer (TA-576), so we report the events applied so far, the actions
  // consumed before the failure, and the normalized rejection. Non-GameError throws are adapter /
  // contract bugs and keep propagating.
  try {
    const done = loop();
    if (held.size > 0) { done.traceBoard = traceProject(); }
    done.publicInTransit = publicInTransit;
    return done;
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
      return { events, pending: toWirePending(flipPending), applied: cursor.i, traceBoard: held.size > 0 ? traceProject() : undefined,
        publicInTransit };
    }
    const rejection = mapRejection(err);
    if (rejection === undefined) {
      throw err;
    }
    // TA-590: a rejection reports the board before the open decision's picks (step() re-projects the open prompt with
    // none) and a held pick still in the deck there: its lift leg leaves the trace with it.
    const drop = new Set<NeutralEvent>();
    for (const [card, h] of held) { if (h.source.cards.includes(card)) { h.legs.forEach(l => drop.add(l)); } }
    for (let i = events.length - 1; i >= 0 && drop.size > 0; i--) { if (drop.has(events[i])) { events.splice(i, 1); } }
    held.clear();
    // The cursor is advanced past an action before it is dispatched, so on a rejection it points one
    // past the offending action; `applied` is therefore the count of actions applied before it.
    return { events, pending: null, applied: Math.max(0, cursor.i - 1), rejection };
  } finally {
    CardList.topTake = undefined;   // TA-593: the draw listener lives only as long as this replay
    CardList.legCut = undefined;
    CardList.deckPut = undefined;   // TA-698
    MoveDamageCountersEffect.observed = undefined;
  }

  function loop(): LoopResult {
  // TA-373: source-zone snapshot for `reveal.from`, refreshed at each top-level action (below) so a
  // search-then-reveal reports the card's pre-search zone, not where it landed.
  let actionStartZones = snapshotCardZones(game.state);
  // TA-591: the cards a `reveal` already named in this top-level action. A card shows the same cards once to EACH
  // player (Haughty Order dri-150: one ShowCardsPrompt per audience); in a 2-player game that is ONE public reveal,
  // and the second show (cards now in a temp list) read the wrong owner.
  let revealedThisAction = new Set<string>();
  for (;;) {
    // TA-669 (B.80): a completed search holds its pick in transit only while the card has stayed in the searched zone.
    // One that left it (Sonar's discard-pile pick went to the hand) and came back (played, then discarded) is settled.
    for (let i = completedSearches.length - 1; i >= 0; i--) {
      const search = completedSearches[i];
      search.cards = search.cards.filter(c => search.source.cards.includes(c));
      if (search.cards.length === 0) { completedSearches.splice(i, 1); }
    }
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
          const revealEvent = buildRevealEvent(game, prompt as ShowCardsPrompt, actionStartZones);
          // A repeat is the same cards FROM THE SAME ZONE: Perrin twm-160 reveals a card from the hand, shuffles it in,
          // searches it back and reveals it again from the deck — two reveals.
          const shown = revealEvent === null ? [] : (revealEvent as { cards: string[] }).cards;
          const from = revealEvent === null ? '' : String((revealEvent as { from: unknown }).from);
          const repeat = shown.length > 0 && shown.every(c => revealedThisAction.has(`${from}|${c}`));
          if (revealEvent !== null && !repeat) {
            shown.forEach(c => revealedThisAction.add(`${from}|${c}`));
            events.push(revealEvent);
          }
          // TA-605: a repeat is no new event, but the cards are still being shown: a card that moves at this ack
          // (Haughty Order puts the ten back at the second audience's) is identifiable by both players. Every shown card
          // counts, including the public ones B.97 leaves out of the event.
          for (const c of (prompt as ShowCardsPrompt).cards) {
            const iid = game.ctx.cardToIid.get(c);
            // TA-701: a shown card still held after the ack is public in transit until it is placed.
            if (iid !== undefined) { revealedSince.add(iid); publicInTransit.add(iid); }
          }
        }
        // CF-84: the engine shows each player's mulligan hands in a pair of prompts (the owner's own view,
        // SETUP_PLAYER_NO_BASIC, and the opponent's). Emit one `mulliganRevealed` per hand, from the owner's
        // view only, so a mulligan is counted once.
        if (prompt.type === 'Show mulligan' && (prompt as ShowMulliganPrompt).message === GameMessage.SETUP_PLAYER_NO_BASIC) {
          const owner = playerIdToActor(game.state, prompt.playerId);
          for (const hand of (prompt as ShowMulliganPrompt).hands) {
            const iids = hand.map(c => game.ctx.cardToIid.get(c)).filter((x): x is string => x !== undefined).sort();
            events.push({ kind: 'mulliganRevealed', player: owner, hand: iids });
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
        if (prompt.type.startsWith('Shuffle')) {
          // CF-11: a deck of 0 or 1 cards has exactly one possible order — a forced
          // non-decision — so the `system shuffle` pending is NOT surfaced; auto-resolve
          // with the identity order. The `shuffled` event still fires (uniform-emit).
          //
          // TA-375: this MUST fire before consuming a client `shuffle` action, not only when there
          // is none. Judge/Iono raise a shuffle for BOTH players; on a deck-0 seed one player's deck
          // holds ≤1 card (forced) and the other holds the real deck. The forced prompt is never
          // surfaced, so the client's single `shuffle` order is destined for the REAL prompt — but
          // the old `&& !(next is shuffle)` guard let the forced prompt swallow it, applying the
          // other player's order to a 1-card deck and rejecting a valid permutation (an
          // un-satisfiable pending that wedged the game — the fuzz CONTRACT class, tr-bench-por-076).
          // A ≤1-card shuffle has only the identity order, so auto-resolving it and NOT consuming the
          // action is always correct.
          const player = game.state.players.find(p => p.id === prompt.playerId);
          const deckLen = player ? player.deck.cards.length : 0;
          // A bottom-SEGMENT shuffle permutes only the segment (TA-396c): a 1-card segment under a stocked deck is the
          // same non-decision (Grand Wing on a 1-card hand). The identity is still a whole-deck permutation.
          const segmentBottom = (prompt as { bottomCount?: number }).bottomCount;
          const permuted = segmentBottom !== undefined ? Math.min(segmentBottom, deckLen) : deckLen;
          if (permuted <= 1) {
            const perm = Array.from({ length: deckLen }, (_, i) => i);
            // Push BEFORE the dispatch: resolving this prompt can run the game on past the turn
            // boundary, and dispatchAndCollect appends everything that derives from it. Pushing
            // after would place `shuffled` behind the `draw` it causally precedes, which is a
            // `shuffled ≺ draw` violation the engine never committed. See the sibling site below.
            // B.66 / TA-462: zone-qualified — declared by the card on ShuffleDeckPrompt (defaults to 'deck').
          events.push({ kind: 'shuffled', player: playerIdToActor(game.state, prompt.playerId),
            zone: (prompt as unknown as { zone: 'deck' | 'hand' | 'prizes' }).zone });
            dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, perm)));
            continue;
          }
        }
        if (prompt.type.startsWith('Shuffle') && next !== undefined && next.type === 'shuffle') {
          const perm = shuffleOrderToPermutation(game, prompt, next as ShuffleSystemAction);
          if (!prompt.validate(perm, game.state)) {
            // TA-302 / CF-52: `order` is a CLIENT payload, and an order that is absent, empty, short,
            // names an iid the deck does not hold, or repeats one, is an action the pending never
            // advertised — `invalidAction`, not an `engineFault`. This threw a bare Error until
            // 2026-08-21, which the HTTP layer reported as a 500; rotomancer answers `invalidAction`
            // on all five malformed shapes (their RE-127 fix) and 200 on a valid permutation.
            cursor.i++;
            throw new GameError(GameMessage.ILLEGAL_ACTION);
          }
          cursor.i++;
          // No deck-shuffle GameLog exists; emit the significant `shuffled` for the deck's owner
          // here — BEFORE the dispatch. Resolving a shuffle that is the last checkup prompt lets
          // the engine run straight on into the next turn, so dispatchAndCollect derives
          // `turnEnded`/`turnStarted`/`draw` from that one dispatch. Pushing afterwards put
          // `shuffled` last and reported `draw ≺ shuffled` for a deck the engine had in fact
          // already shuffled — a false `order` divergence (ssp-162 Amulet of Hope). The shuffle
          // causally precedes everything the dispatch triggers, so it belongs before it.
          // B.66 / TA-462: zone-qualified — declared by the card on ShuffleDeckPrompt (defaults to 'deck').
          events.push({ kind: 'shuffled', player: playerIdToActor(game.state, prompt.playerId),
            zone: (prompt as unknown as { zone: 'deck' | 'hand' | 'prizes' }).zone });
          dispatchAndCollect(() => game.store.dispatch(new ResolvePromptAction(prompt.id, perm)));
          continue;
        }
        // CF-12 (strict): a further action that isn't THIS system pending's `flip`/`shuffle` is
        // not offered — reject it as `invalidAction`. Only pause (return the pending) when the
        // log has no further action to submit.
        if (cursor.i < actions.length) {
          cursor.i++;
          throw new GameError(GameMessage.ILLEGAL_ACTION);
        }
        return { events, pending: toWirePending(systemPending(game, prompt)), applied: cursor.i, completedSearches };
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
        // TA-443: refresh the reveal source-zone snapshot to the zone each card sits in NOW, just
        // before this decomposed prompt resolves and its callback fires. TA-373's line-1026 snapshot
        // is taken at the START of a top-level action; a reveal caused by a LATER `choose`/`confirm`
        // (e.g. Perrin: reveal a Pokemon hand->deck in action 1, then search it back in action 2)
        // would otherwise read the stale pre-action zone (`hand`) instead of its current one (`deck`).
        // The cards have not moved yet at this point (the dispatch below is what runs the card code),
        // so this still reports the SOURCE zone a within-resolution search relocates from (TA-373 intact).
        actionStartZones = snapshotZones();
        // B.80: remember a completed SEARCH (a non-discard, non-secret ChooseCards over a settled deck or
        // discard pile) so a later pause in this step can project its still-in-zone selections in transit.
        if (prompt instanceof ChooseCardsPrompt && Array.isArray(result) && result.length > 0
            && !isDiscardPick(prompt) && prompt.options.isSecret !== true
            && (prompt.cards.zoneTag === 'deck' || prompt.cards.zoneTag === 'discard')) {
          completedSearches.push({ cards: result as Card[], source: prompt.cards });
        }
        // B.82 / CF-93: the picks of an attack's pre-damage Energy choice (the engine marked it deferredMove) are
        // chosen, not moved: record them while they are still on the stack; their legs come after the damage.
        if ((prompt as { deferredMove?: boolean }).deferredMove) {
          // TA-660 / B.93: `chosen` records a decision; a pick applied with no pending (CF-14) is none.
          const decided = accum.filter(p => !forcedPicks.has(p as object));
          for (const c of dec.pickedCards?.(prompt, decided, game.ctx, game.state) ?? []) {
            const e = chosenEvent(game, c);
            if (e !== undefined) { events.push(e); }
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
        const pick = dec.toPick(prompt, { actor: sub.actor, ...forced[0] } as NeutralAction, game.ctx, game.state, accum);
        forcedPicks.add(pick as object);
        accum.push(pick);
        continue;
      }
      // CF-14 addendum (2026-09-09): N-of-exactly-N — every remaining candidate is forced, so the whole
      // set is applied at once (TA-286 Metallic Hammer's 3-of-3 discard; TA-401). Same `!canStopNow`
      // guard; the decomposer decides from its own min/max whether the remaining picks equal the pool.
      if (forced.length > 1 && !canStopNow && dec.collapseWholeSet?.(prompt, accum, game.state, forced.length) === true) {
        for (const f of forced) {
          const pick = dec.toPick(prompt, { actor: sub.actor, ...f } as NeutralAction, game.ctx, game.state, accum);
          forcedPicks.add(pick as object);
          accum.push(pick);
        }
        continue;
      }
      const nextAction = cursor.i < actions.length ? actions[cursor.i] : undefined;
      if (nextAction === undefined) {
        // Log dry mid-decision: carry the open prompt + picks so the projection can apply the
        // decomposer's take-immediately fix-up (CF-1).
        return { events, pending: toWirePending(sub), applied: cursor.i, midPrompt: { prompt, picks: accum, decided: accum.filter(p => !forcedPicks.has(p as object)) }, completedSearches };
      }
      // TA-590: a pause the replay runs through: the search's picks so far are in transit here.
      liftPausedSearchPicks(prompt, accum);
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
      // ORDER MATTERS. `toPick` runs FIRST and is allowed to throw: several decomposers reject
      // structurally-incoherent picks with a descriptive Error (`select-option` on a disabled or
      // out-of-range index, `choose-energy` on an iid the prompt never held), and that is the harness's
      // "this log is malformed" channel — distinct from "this action is illegal at a live decision
      // node", which is what `invalidAction` means. `toPick` is a pure action→WirePick mapping with no
      // side effects, so running it before the membership test costs nothing.
      //
      // TA-302: but that distinction was drawn in the WRONG place, and CF-52 had already settled it.
      // An action missing a required field is not in the advertised menu, so `invalidAction` is its
      // answer whatever `toPick` thinks of it — CF-52 names *"absent `to`, unknown iid, bad index"*
      // explicitly, and TA-294 already converted the unknown-iid half. Measured 2026-08-21 across an
      // 11-cell (verb, required-field) census: twinleaf answered 4, rotomancer 11. Six of the seven
      // misses were this throw reaching the HTTP layer as a 500 `engineFault`.
      //
      // So the membership test now decides which channel a `toPick` throw belongs to, rather than
      // being unreachable behind it. NOT OFFERED → `invalidAction`, whatever the decomposer's
      // complaint was. OFFERED and still unmappable → RETHROW: the menu advertised something the
      // adapter cannot turn into a pick, which is our bug and must stay loud (an adapter-only fault is
      // a harness gap, the line rotomancer holds in their note ninety-seven §3 and we agreed with).
      resolveSelectOptionLabel(sub.legalActions, nextAction);
      let pick;
      try {
        pick = dec.toPick(prompt, nextAction, game.ctx, game.state, accum);
      } catch (e) {
        if (!offersAction(sub.legalActions, nextAction)) {
          cursor.i++;
          throw new GameError(GameMessage.ILLEGAL_ACTION);
        }
        throw e;
      }
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
      // TA-373: snapshot pre-action card zones so a reveal fired inside this action's effect reports
      // each card's SOURCE zone, not the zone a mid-effect search moved it into.
      actionStartZones = snapshotZones();
      revealedThisAction = new Set<string>();
      // CF-65 sub-shape 3: a new top-level action closes whatever attack was in flight; a `declareAttack`
      // opens one (see `InFlightAttack`). Resolution failures are the dispatch's to report, not this note's.
      game.inFlightAttack = undefined;
      if (action.type === 'declareAttack') {
        const da = action as DeclareAttackAction;
        try {
          const player = game.state.players[actorIndex(da.actor)];
          const card = resolveSourcePokemon(game, player, da.source, 'declareAttack.source').getPokemonCard();
          if (card !== undefined) {
            game.inFlightAttack = {
              playerIndex: actorIndex(da.actor), name: da.name, sourceCard: card,
              turn: game.state.turn, eventsBefore: events.length,
            };
          }
        } catch { /* an unresolvable source: dispatchDeclareAttack rejects it below */ }
      }
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
/**
 * CF-84: a pre-deal import starts the ENGINE'S OWN setup — the exported `setupGame` generator, driven
 * exactly as sudden death re-enters it (check-effect.ts). Its first prompt is the who-goes-first coin flip
 * (or, when a WhoBeginsEffect claims the first turn, the opening shuffles); every later setup decision
 * surfaces through runLoop's ordinary prompt handling, so the setup walk is replayed statelessly like any
 * other log.
 */
function startSetup(game: ImportedGame): void {
  const generator: IterableIterator<State> = setupGame(() => generator.next(), game.store, game.state);
  generator.next();
}

export function step(initial: NeutralState, actions: NeutralAction[]): StepResponse {
  const game = importState(initial);
  if (initial.phase === 'setup') {
    startSetup(game); // validated as the pre-deal state by handlers.ts
  }
  const { events, pending, applied, rejection, midPrompt, completedSearches, traceBoard, publicInTransit } = runLoop(game, actions);
  if (rejection !== undefined && applied < actions.length && game.state.prompts.some(p => p.result === undefined)) {
    // TA-639: refused at a pause. `applied` names the prefix the response stands on, so its board and trace are that
    // prefix's response: the open decision's fix-ups (CF-1 / B.80: picks already made read as applied) and the
    // pause's own events and moved legs (TA-622, B.81), which the rolled-back store below cannot rebuild (its picks
    // live adapter-side). The prefix replays without the refused action, so it pauses where this one was refused.
    const prefix = step(initial, actions.slice(0, applied));
    if (prefix.status !== 'invalidAction') {
      return {
        schemaVersion: SCHEMA_VERSION, status: 'invalidAction', applied, index: applied,
        pending: null, events: prefix.events, state: prefix.state,
        reasonCode: rejection.reasonCode, nativeReason: rejection.nativeReason,
      };
    }
  }
  // B.81: the board as the engine holds it, before the fix-ups below re-home picks already made; the legs between
  // this and the fixed-up board are the pause's own `moved` events (appended after the dispatch legs).
  const raw = projectGame(game);
  const state = projectGame(game);
  if (midPrompt !== undefined) {
    // Mid-decomposition pause: apply the decomposer's take-immediately projection fix-up (CF-1) so
    // picks already made read as applied (e.g. a picked prize is in the hand, not the pile).
    const dec = decomposerFor(midPrompt.prompt);
    dec.fixupProjection?.(midPrompt.prompt, midPrompt.picks, game.ctx, game.state, state);
    // TA-622: the rules events of what the fix-up placed (a counter at a pause is a `damaged`); not on a rejection,
    // whose board is the rolled-back one.
    if (rejection === undefined) {
      events.push(...(dec.pauseEvents?.(midPrompt.prompt, midPrompt.picks, game.ctx, game.state, state) ?? []));
    }
    // B.82 / CF-93: picks 1..k of an attack's pre-damage choice stay where they are and are recorded as `chosen`.
    if ((midPrompt.prompt as { deferredMove?: boolean }).deferredMove && rejection === undefined) {
      // TA-660 / B.93: only the picks the player made (not the CF-14 collapses) are `chosen`.
      for (const c of dec.pickedCards?.(midPrompt.prompt, midPrompt.decided ?? midPrompt.picks, game.ctx, game.state) ?? []) {
        const e = chosenEvent(game, c);
        if (e !== undefined) { events.push(e); }
      }
    }
  }
  if (pending !== null && completedSearches !== undefined) {
    // B.80: a search completed earlier in this step whose chosen cards the engine still keeps in the
    // source zone while a LATER decision of the same effect is open (Burning Charge's recipient pick):
    // the player is holding those cards, so they project in transit, `origin` = that zone, `visibility:
    // owner` (the text's reveal, where it has one, has not fired at this pause or the card has moved).
    // Not at a `system` shuffle that names the card: then it is being shuffled in, i.e. in the deck.
    const first = pending.legalActions[0] as { type?: string; deck?: string[] } | undefined;
    const shuffling = new Set<string>(pending.actor === 'system' && first?.type === 'shuffle' ? (first.deck ?? []) : []);
    for (const search of completedSearches) {
      const origin = locationOfTag(search.source.zoneTag);
      for (const card of search.cards) {
        if (!search.source.cards.includes(card)) { continue; }
        const iid = game.ctx.cardToIid.get(card);
        if (iid === undefined || shuffling.has(iid)) { continue; }
        liftToTransit(state, iid, origin === undefined ? { visibility: 'owner' } : { visibility: 'owner', origin });
      }
    }
  }
  if (midPrompt === undefined && rejection !== undefined) {
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
  // I1 guard: a fixupProjection above may have re-homed a look-pile card (projected into `resolving`)
  // into a settled zone, leaving it in both. Drop the resolving copy — the settled zone wins. Runs
  // after every fixup so the wire state never duplicates an iid. (G-44 look-pile projection.)
  pruneResolvingDuplicates(state);
  // TA-701: a revealed card still lifted at this pause is public in transit (Crispin's two Energy at the attach pick);
  // the pile projection and the fix-ups above default a held card to `owner`. Applied to the fixed-up board only — a
  // visibility is no place, so the closing legs below are unaffected except in what they say of a lifted revealed card.
  if (publicInTransit !== undefined && publicInTransit.size > 0) {
    for (const who of ['A', 'B'] as const) {
      for (const t of state.players[who].transit ?? []) {
        if (publicInTransit.has(t.iid)) { t.visibility = 'public'; }
      }
    }
  }
  // B.81 / CF-92: the fix-ups above are physical moves the engine has not made yet (a pick lifted into transit, a
  // cost discard already in the pile): their legs close the trace so the harness's replay (initialState + legs)
  // lands on this board. A rejection's state is the rolled-back board and emits none.
  if (rejection === undefined) {
    events.push(...deriveMoved(traceBoard ?? raw, state));
  }
  // CF-65 sub-shape 3 (2026-09-11): while an attack is in flight and the response pauses inside it, project
  // the DECLARED attack (with its declaration turn) as the attacker's last attack — the engine's record is
  // written only after resolution (TA-399), so it still names the previous attack at every rider pick,
  // confirm, coin flip and shuffle raised by the attack. Gated on this replay having emitted `attackUsed`
  // for that player since the declaration: an attack still ahead of its Confusion/Smokescreen check has
  // not been used, and rotomancer records nothing there either. A completed attack is unaffected (the
  // engine's record already equals this), and so is a rejected one (no pending).
  const inFlight = game.inFlightAttack;
  if (pending !== null && inFlight !== undefined) {
    const actor: NeutralPlayerId = inFlight.playerIndex === 0 ? 'A' : 'B';
    const used = events.slice(inFlight.eventsBefore)
      .some(e => e.kind === 'attackUsed' && (e as { player?: string }).player === actor);
    if (used) {
      state.playerLastAttack = {
        ...(state.playerLastAttack ?? {}),
        [actor]: { source: toPrinting(inFlight.sourceCard), name: inFlight.name, turn: inFlight.turn },
      };
    }
  }
  if (rejection !== undefined) {
    // The engine rejected an action; the Store rolled back (a top-level action) or the loop restored its snapshot
    // (a prompt answer, TA-576), so `state` is the pre-action projection.
    // The cursor advances past an action before dispatch, so `applied` is the offending action's index.
    return {
      schemaVersion: SCHEMA_VERSION, status: 'invalidAction', applied, index: applied,
      pending: null, events, state, reasonCode: rejection.reasonCode, nativeReason: rejection.nativeReason,
    };
  }
  const status: ResponseStatus = state.outcome === 'ongoing' ? 'awaitingAction' : 'gameOver';
  return { schemaVersion: SCHEMA_VERSION, status, applied, pending, events, state };
}
