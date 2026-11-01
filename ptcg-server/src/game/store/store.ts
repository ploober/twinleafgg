import { Action } from './actions/action';
import { AbortGameAction } from './actions/abort-game-action';
import { AppendLogAction } from './actions/append-log-action';
import { ConcedeAction } from './actions/concede-action';
import { Card } from './card/card';
import { AfterDamageEffect } from './effects/attack-effects';
import { Player } from './state/player';
import { PowerType } from './card/pokemon-types';
import { SuperType, TrainerType } from './card/card-types';
import { TrainerCard } from './card/trainer-card';
import { ChangeAvatarAction } from './actions/change-avatar-action';
import { Effect } from './effects/effect';
import { AttachEnergyEffect, PlayPokemonEffect, TrainerEffect } from './effects/play-card-effects';
import { CheckAttackCostEffect, CheckEffects, CheckPokemonPowersEffect, CheckRetreatCostEffect } from './effects/check-effects';
import { KnockOutEffect, MovedFromActiveToBenchEffect, MovedToActiveEffect, PowerEffect, SpecialEnergyEffect } from './effects/game-effects';
import {
  CLEAR_ABILITY_LOCK_ACTIVATION,
  STAMP_ABILITY_LOCK_ACTIVATION,
  APPLY_ATTACK_EFFECT_ABILITY_LOCKS,
} from './prefabs/ability-lock';
import { resolveCopyAttackSessions } from './prefabs/copy-attack-delegation';
import { effectWasBlocked, logAppliedEffect, logPreventedEffect, logResolvedPrompt, stampEffectBlocker } from './prefabs/auto-log';
import { filterTrainerPromptResult, ResolvingTrainerSource } from './prefabs/trainer-target';
import { GameError } from '../game-error';
import { GameMessage, GameLog } from '../game-message';
import { Prompt } from './prompts/prompt';
import { ReorderHandAction, ReorderBenchAction } from './actions/reorder-actions';
import { ResolvePromptAction } from './actions/resolve-prompt-action';
import { State, GamePhase } from './state/state';
import { StateLog, StateLogParam } from './state/state-log';
import { StoreHandler } from './store-handler';
import { StoreLike } from './store-like';
import { generateId } from '../../utils/utils';
import { legacyStateSnapshots, conformanceLegacyStateSnapshots, graphStateSnapshots, SnapshotSite, StateSnapshotBackend } from './state-snapshot';
import { canSkipReactionProbe, ReactionFilterMode, recordReactionFilterSkipped, recordReactionFilterVerified } from './reaction-filter';
import { ResolveNextPrompt, ResolveNextCandidate } from './prompts/resolve-next-prompt';
import { CardList } from './state/card-list';
import { attackReducer } from './effect-reducers/attack-effect';
import { playCardReducer } from './reducers/play-card-reducer';
import { playEnergyReducer } from './effect-reducers/play-energy-effect';
import { playPokemonReducer } from './effect-reducers/play-pokemon-effect';
import { playPokemonFromDeckReducer } from './effect-reducers/play-pokemon-from-deck-effect';
import { playPokemonFromDiscardReducer } from './effect-reducers/play-pokemon-from-discard-effect';
import { playTrainerReducer } from './effect-reducers/play-trainer-effect';
import { playerTurnReducer } from './reducers/player-turn-reducer';
import { gamePhaseReducer } from './effect-reducers/game-phase-effect';
import { gameReducer } from './effect-reducers/game-effect';
import { checkState, checkStateReducer } from './effect-reducers/check-effect';
import { playerStateReducer } from './reducers/player-state-reducer';
import { retreatReducer } from './effect-reducers/retreat-effect';
import { setupPhaseReducer } from './reducers/setup-reducer';
import { abortGameReducer } from './reducers/abort-game-reducer';
import { concedeReducer } from './reducers/concede-reducer';
import { sandboxReducer } from './reducers/sandbox-reducer';
import { SandboxModifyPlayerAction } from './actions/sandbox-modify-player-action';
import { SandboxModifyGameStateAction } from './actions/sandbox-modify-game-state-action';
import { SandboxModifyCardAction } from './actions/sandbox-modify-card-action';
import { SandboxModifyPokemonAction } from './actions/sandbox-modify-pokemon-action';

// Keep these imports lazy to preserve the existing circular-dependency boundaries. Cache the
// module objects, not their selected functions/results: exports and per-format overrides are
// still read on every call, without resolving the module path in the effect hot loop.
let playabilityPrefabs: typeof import('./prefabs/prefabs') | undefined;
let pokemonCardModule: typeof import('./card/pokemon-card') | undefined;
let cardEffectOverrides: typeof import('./card/card-effect-overrides') | undefined;

interface PromptItem {
  ids: number[],
  then: (results: any) => void;
}

// Cached once — building an Intl.DateTimeFormat (which is what `Date.toLocaleTimeString(locale, opts)`
// does on EVERY call) costs ~64us; reusing one formatter is ~3us for byte-identical output. log() runs
// per game action, so this was ~20% of the conformance step() CPU (profiled 2026-07-09).
const LOG_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit'
});

interface ComparedPair {
  right: object;
  depth: number;
  next: ComparedPair | undefined;
}
type ComparedPairs = Map<object, ComparedPair>;

/**
 * Did running a handler change the board?
 *
 * A structural walk rather than a field whitelist, because a whitelist is a classification we would
 * have to maintain per card family and get wrong quietly. `Card` and `StateLog` instances are
 * compared by IDENTITY: `deepClone` shares them (they are immutable definitions and append-only log
 * entries), so a card moving zones shows up as a different member of a CardList's `cards` array —
 * which is the change we want to see — while the card object itself is the same reference on both
 * sides and must not be walked.
 *
 * Cycles and shared subgraphs use a depth-aware pair map; the existing depth cap is retained.
 * A pair first reached near that cap is revisited if a later path has more depth budget.
 * Non-null functions are ignored; missing and undefined values compare equally.
 */
export function boardDiffers(a: any, b: any, seen: ComparedPairs = new Map(), depth = 0): boolean {
  if (a === b) { return false; }
  if (depth > 24) { return false; }
  if (a === null || b === null || a === undefined || b === undefined) { return a !== b; }
  if (typeof a === 'function' || typeof b === 'function') { return false; }
  if (typeof a !== 'object' || typeof b !== 'object') { return a !== b; }
  if (a instanceof Card || b instanceof Card) { return a !== b; }
  if (a instanceof StateLog || b instanceof StateLog) { return a !== b; }
  const array = Array.isArray(a);
  if (array !== Array.isArray(b)) { return true; }
  if (array && a.length !== b.length) { return true; }
  const first = seen.get(a);
  let pair = first;
  while (pair !== undefined && pair.right !== b) { pair = pair.next; }
  if (pair !== undefined) {
    if (pair.depth <= depth) { return false; }
    pair.depth = depth;
  } else {
    // Most left objects have a single partner. A short chain handles multiple partners without
    // allocating a nested Map and hash table for every object in the board.
    seen.set(a, { right: b, depth, next: first });
  }
  if (array) {
    return (a as any[]).some((item, i) => boardDiffers(item, b[i], seen, depth + 1));
  }
  for (const key of Object.keys(a)) {
    if (boardDiffers(a[key], b[key], seen, depth + 1)) { return true; }
  }
  for (const key of Object.keys(b)) {
    if (!Object.prototype.hasOwnProperty.call(a, key)
      && boardDiffers(a[key], b[key], seen, depth + 1)) { return true; }
  }
  return false;
}


/**
 * One candidate of a simultaneous batch: the card whose handler runs, the effect it runs against, and —
 * for an event-instantiated reaction — the SUBJECT the event named (CF-38 `subject`). The after-damage
 * batch shares one effect across its actors; the KO batch gives each actor its own victim's effect.
 */
interface SimultaneousActor {
  card: Card;
  effect: Effect;
  subject?: Card;
}

/**
 * CF-38 KO window: does a probe's result differ in anything the WIRE projects — zone contents, damage,
 * Special Conditions, Tools, the Stadium — as opposed to engine-private markers and flags? Unlike
 * `boardDiffers` (which counts any change, and is right for the 14 after-damage responders), this is the
 * actor test for the KO window, where ~131 handlers exist and many only STAMP A MARKER ("if any of your
 * Pokémon were Knocked Out during your opponent's last turn"). Counting those as actors would raise
 * ordering decisions with no rules content — boundary (a) in reverse. Card objects are shared between a
 * state and its probe clone (`deepClone` ignores `Card`), so zone contents compare by reference.
 */
export function wireVisibleBoardDiffers(a: State, b: State): boolean {
  const same = (p: Card[], q: Card[]) => p.length === q.length && p.every((c, i) => c === q[i]);
  if (a.players.length !== b.players.length) { return true; }
  for (let i = 0; i < a.players.length; i++) {
    const x = a.players[i], y = b.players[i];
    const zones: Array<[CardList, CardList]> = [[x.hand, y.hand], [x.deck, y.deck], [x.discard, y.discard], [x.lostzone, y.lostzone], [x.stadium, y.stadium]];
    if (zones.some(([za, zb]) => !same(za.cards, zb.cards))) { return true; }
    if (x.prizes.length !== y.prizes.length || x.prizes.some((pz, j) => !same(pz.cards, y.prizes[j].cards))) { return true; }
    const sa = [x.active, ...x.bench], sb = [y.active, ...y.bench];
    if (sa.length !== sb.length) { return true; }
    for (let j = 0; j < sa.length; j++) {
      if (!same(sa[j].cards, sb[j].cards) || !same(sa[j].tools, sb[j].tools) || sa[j].damage !== sb[j].damage
        || sa[j].specialConditions.slice().sort().join() !== sb[j].specialConditions.slice().sort().join()) {
        return true;
      }
    }
  }
  return false;
}

const CHECK_EFFECT_TYPES: ReadonlySet<string> = new Set<string>(Object.values(CheckEffects));

/** Every Card reachable from `root`, with its own scalar fields as they are now; the returned function puts them back. */
function snapshotCardScalars(root: unknown, inventory?: ReadonlyArray<Card>): () => void {
  const seen = new Set<unknown>();
  const saved: Array<[Card, Record<string, unknown>]> = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) { return; }
    seen.add(v);
    if (v instanceof Card) {
      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(v)) {
        const x = (v as unknown as Record<string, unknown>)[k];
        if (x === null || x === undefined || (typeof x !== 'object' && typeof x !== 'function')) { fields[k] = x; }
      }
      saved.push([v, fields]);
      return;
    }
    // Avoid allocating an [entry, value] tuple for every field on every probe.
    for (const k of Object.keys(v as object)) {
      if (k !== 'logs') { walk((v as Record<string, unknown>)[k]); }
    }
  };
  if (inventory === undefined) { walk(root); } else { inventory.forEach(walk); }
  return () => { for (const [card, fields] of saved) { Object.assign(card, fields); } };
}

export class Store implements StoreLike {

  //private effectHistory: Effect[] = [];

  private currentState: State = new State();
  private probeInventory?: { state: State; cards: ReadonlyArray<Card> };
  public get state(): State { return this.currentState; }
  public set state(value: State) { this.probeInventory = undefined; this.currentState = value; }
  private promptItems: PromptItem[] = [];
  private waitItems: (() => void)[] = [];
  private logId: number = 0;
  // Flag to prevent nested playability calculations
  private calculatingPlayability: boolean = false;
  /** Set only while the played trainer card's own effect (or its prompt callbacks) runs. */
  private resolvingTrainer: ResolvingTrainerSource | undefined;
  /** Prompt ids created by the resolving trainer. Not serialized. */
  private trainerPromptSources = new Map<number, ResolvingTrainerSource>();

  private readonly snapshots: StateSnapshotBackend;
  private static readonly reactionProbeReducer = Store.prototype.callReduceEffect;
  private readonly reactionFilter: ReactionFilterMode;
  constructor(private handler: StoreHandler, options: { snapshotBackend?: StateSnapshotBackend; reactionFilter?: ReactionFilterMode } = {}) {
    this.snapshots = options.snapshotBackend ?? legacyStateSnapshots;
    this.reactionFilter = options.reactionFilter ?? 'off';
  }

  public snapshot(state: State = this.state, site: SnapshotSite = 'rollback'): State {
    return this.snapshots.capture(state, undefined, site).state;
  }

  /** Internal replay diagnostics: no callbacks may cross a checkpoint boundary. */
  public replayBoundaryReason(): string | undefined {
    if (this.promptItems.length > 0) { return 'prompt-continuation'; }
    if (this.waitItems.length > 0) { return 'wait-continuation'; }
    if (this.calculatingPlayability || this.probing || this.probeInventory !== undefined) { return 'active-probe'; }
    if (this.playing.length > 0) { return 'playing-continuation'; }
    if (this.resolvingTrainer !== undefined || this.trainerPromptSources.size > 0) { return 'trainer-continuation'; }
    return undefined;
  }

  public captureReplayBookkeeping(): { logId: number } | undefined {
    const known = new Set(['handler', 'currentState', 'probeInventory', 'promptItems', 'waitItems', 'logId',
      'calculatingPlayability', 'resolvingTrainer', 'trainerPromptSources', 'snapshots', 'probing',
      'probeRaisedPrompt', 'probeDispatched', 'playing', 'reactionFilter']);
    if (Object.keys(this).some(key => !known.has(key))) { return undefined; }
    return this.replayBoundaryReason() === undefined ? { logId: this.logId } : undefined;
  }

  public restoreReplayBookkeeping(value: { logId: number }): void {
    if (this.replayBoundaryReason() !== undefined || !Number.isSafeInteger(value.logId) || value.logId < 0) {
      throw new Error('Invalid quiescent replay bookkeeping');
    }
    this.logId = value.logId;
  }

  /** Internal menu workflow: consume only before any preparation or structural mutation. */
  public setProbeSnapshot(source: State, inventorySafe: boolean = false): void {
    const captured = this.snapshots.capture(source, undefined, 'menu');
    this.state = captured.state;
    if (inventorySafe && captured.cards) { this.probeInventory = { state: this.state, cards: captured.cards }; }
  }

  public dispatch(action: Action, clientRoleId?: number): State {
    this.probeInventory = undefined;
    return this.dispatchWithRollback(action, clientRoleId, true);
  }

  /**
   * Dispatch on an isolated probe board whose state is discarded on ANY throw. The caller must
   * clone the real board first and must never reuse a failed probe. Only this dispatch omits its
   * rollback snapshot; handlers calling ordinary dispatch still get their own rollback protection.
   */
  public dispatchProbe(action: Action): State {
    // TA-730: the clone shares the Card instances with the real board (deepClone skips Card), so a card that arms a
    // field on itself when an attack is used (Comfey jtg-068 Fade Out, Finizen obf-060 Valiant Evolution) kept it
    // armed after a menu probe, and its next real attack ran the probed one's effect. Restore the scalars.
    const inventory = this.probeInventory;
    this.probeInventory = undefined;
    const restore = snapshotCardScalars(this.state, inventory?.state === this.state ? inventory.cards : undefined);
    try {
      return this.dispatchWithRollback(action, undefined, false);
    } finally {
      restore();
    }
  }

  private dispatchWithRollback(action: Action, clientRoleId: number | undefined, rollback: boolean): State {
    let state = this.state;

    // Handle sandbox actions
    if (action instanceof SandboxModifyPlayerAction
      || action instanceof SandboxModifyGameStateAction
      || action instanceof SandboxModifyCardAction
      || action instanceof SandboxModifyPokemonAction) {
      if (clientRoleId === undefined) {
        throw new GameError(GameMessage.ILLEGAL_ACTION);
      }
      state = sandboxReducer(this, state, action, clientRoleId);
      this.handler.onStateChange(state);
      return state;
    }

    if (action instanceof AbortGameAction) {
      state = abortGameReducer(this, state, action);
      this.handler.onStateChange(state);
      return state;
    }

    if (action instanceof ConcedeAction) {
      state = concedeReducer(this, state, action);
      this.handler.onStateChange(state);
      return state;
    }

    if (action instanceof ReorderHandAction
      || action instanceof ReorderBenchAction
      || action instanceof ChangeAvatarAction) {
      state = playerStateReducer(this, state, action);
      this.handler.onStateChange(state);
      return state;
    }

    if (action instanceof ResolvePromptAction) {
      try {
        state = this.reducePrompt(state, action);
      } catch (storeError) {
        this.handler.onStateChange(state);
        throw storeError;
      }
      if (this.promptItems.length === 0) {
        state = checkState(this, state);
      }
      this.handler.onStateChange(state);
      return state;
    }

    if (action instanceof AppendLogAction) {
      this.log(state, action.message, action.params, action.id);
      this.handler.onStateChange(state);
      return state;
    }

    if (state.prompts.some(p => p.result === undefined)) {
      throw new GameError(GameMessage.ACTION_IN_PROGRESS);
    }

    state = this.reduce(state, action, rollback);

    return state;
  }

  /**
   * Set while a candidate handler is being PROBED on a throwaway clone (see `resolveSimultaneous`).
   * `prompt()` reads it and refuses to enqueue, which is both the "this handler would act" signal
   * and the guard that stops a probe from running the handler's CONTINUATION — the callback is where
   * `dri-125` Team Rocket's Koffing shuffles and where every real mutation lives.
   */
  private probing = false;
  private probeRaisedPrompt = false;
  /**
   * TA-612: set while probing when the handler dispatched an effect of its own that is not a read-only check
   * (Check* effects) or a lock test (`IS_ABILITY_BLOCKED` dispatches a PowerEffect, `IS_SPECIAL_ENERGY_BLOCKED` a
   * SpecialEnergyEffect). A trigger that
   * resolves to no board change still ACTED (Magearna's Auto Heal on an undamaged Pokémon dispatches its heal), and
   * its order against the batch's other triggers can matter.
   */
  private probeDispatched = false;
  /** TA-737: see `StoreLike.pokemonBeingPlayed`. A stack, because a handler may play another Pokémon. */
  private playing: PlayPokemonEffect[] = [];

  public reduceEffect(state: State, effect: Effect): State {
    if (this.probing && !(effect instanceof PowerEffect) && !(effect instanceof SpecialEnergyEffect)
      && !CHECK_EFFECT_TYPES.has((effect as { type?: string }).type ?? '')) {
      this.probeDispatched = true;
    }
    // Track Active ability-lock activation order before card handlers run.
    if (effect instanceof MovedToActiveEffect) {
      STAMP_ABILITY_LOCK_ACTIVATION(state, effect.player.active, effect.pokemonCard);
    } else if (effect instanceof MovedFromActiveToBenchEffect) {
      CLEAR_ABILITY_LOCK_ACTIVATION(state, effect.pokemonCard);
    }

    APPLY_ATTACK_EFFECT_ABILITY_LOCKS(state, effect);

    if (effect instanceof PlayPokemonEffect) {
      this.playing.push(effect);
      try {
        state = this.propagateEffect(state, effect);
      } finally {
        this.playing.pop();
      }
    } else {
      state = this.propagateEffect(state, effect);
    }
    if (!this.calculatingPlayability) {
      logPreventedEffect(this, state, effect);
    }
    state = resolveCopyAttackSessions(this, state, effect);

    const gs = state.gameSettings;
    if (gs?.sandboxMode) {
      if (effect instanceof CheckAttackCostEffect && gs.sandboxAttacksCostNoEnergy) {
        effect.cost = [];
      }
      if (effect instanceof CheckRetreatCostEffect && gs.sandboxRetreatCostsNoEnergy) {
        effect.cost = [];
      }
    }

    if (effect.preventDefault === true) {
      return state;
    }

    state = gamePhaseReducer(this, state, effect);
    state = playEnergyReducer(this, state, effect);
    state = playPokemonReducer(this, state, effect);
    state = playPokemonFromDeckReducer(this, state, effect);
    state = playPokemonFromDiscardReducer(this, state, effect);
    state = playTrainerReducer(this, state, effect);
    state = retreatReducer(this, state, effect);
    state = gameReducer(this, state, effect);
    state = attackReducer(this, state, effect);
    state = checkStateReducer(this, state, effect);
    if (!this.calculatingPlayability) {
      logAppliedEffect(this, state, effect);
    }

    // Calculate playability after all effects are processed
    // The calculatingPlayability flag prevents nested calls during playability checks
    state = this.calculatePlayability(state);

    return state;
  }

  compareEffects(effect1: Effect, effect2: Effect): boolean {
    if (effect1.type !== effect2.type) {
      return false;
    }

    const effect1CardId = (<any>effect1)?.card?.id;
    const effect2CardId = (<any>effect2)?.card?.id;

    const effect1CardPlayerId = (<any>effect1)?.player?.id;
    const effect2CardPlayerId = (<any>effect2)?.player?.id;

    return effect1CardId === effect2CardId &&
      effect1CardPlayerId === effect2CardPlayerId;
  }

  public prompt(state: State, prompts: Prompt<any>[] | Prompt<any>, then: (results: any) => void): State {
    // A PROBE never enqueues and never runs the continuation. Raising a prompt is the clearest
    // possible "this handler would act", and returning here keeps the probe from reaching the side
    // effects that live in `then` — the search, the shuffle, the discard.
    if (this.probing) {
      this.probeRaisedPrompt = true;
      return state;
    }

    if (!(prompts instanceof Array)) {
      prompts = [prompts];
    }

    for (let i = 0; i < prompts.length; i++) {
      const id = generateId(state.prompts);
      prompts[i].id = id;

      // Route answers to promptController while keeping board perspective on the
      // original owner (Hand Control / forced opponent card play).
      const controllerId = state.promptControllerId;
      if (controllerId !== undefined && controllerId !== prompts[i].playerId) {
        if (prompts[i].perspectivePlayerId === undefined) {
          prompts[i].perspectivePlayerId = prompts[i].playerId;
        }
        prompts[i].playerId = controllerId;
      }

      // B.82: an Energy choice the attacker is asked before the attack's damage chooses cards that move after it
      // (the DiscardCardsEffect reducer / MOVE_CARDS queues the move); the adapter leaves its picks attached as `chosen`.
      // TA-680: keyed on the prompt type alone. It was keyed on three messages too, and Spiral Shot pal-052 asks with
      // CHOOSE_CARD_TO_HAND, so its Energy went to the hand at the pick, before the damage.
      const pre = state.preDamageAttack as { player?: { id: number } } | undefined;
      const p = prompts[i] as Prompt<any> & { deferredMove?: boolean; message?: unknown };
      if (pre?.player !== undefined && p.playerId === pre.player.id
          && (p.type === 'Choose energy' || p.type === 'Discard energy')) {
        p.deferredMove = true;
      }
      // TA-686: a 'Choose cards' prompt asked of the attacker over the Energy of one of its own Pokémon in play
      // (ChooseCardsPrompt(player, ..., player.active, { superType: ENERGY }) — Screw Knuckle por-041) is the same
      // Step-D choice and was never marked, so MOVE_CARDS ran the move at the pick, before the damage. Only for an
      // attack that does damage (B.82's scope): a no-damage attack's text runs its moves in text order inside the
      // callback (Evil Incineration dri-031 discards its Energy, then the opponent's Active), which a deferral would invert.
      if (pre?.player !== undefined && p.playerId === pre.player.id && p.type === 'Choose cards'
          && (pre as { damage?: number }).damage !== undefined && (pre as { damage?: number }).damage! > 0) {
        const attacker = pre.player as Player;
        const from = (p as unknown as { cards?: CardList }).cards;
        const filter = (p as unknown as { filter?: { superType?: SuperType } }).filter;
        if (from !== undefined && filter?.superType === SuperType.ENERGY
          && (from === attacker.active || attacker.bench.some(b => b === from))) {
          p.deferredMove = true;
        }
      }
      // TA-674 / TA-675 (B.102, B.105, B.89 (1)): an Energy attach the attacker chooses before the damage from its own
      // discard pile (Iron Roar, Motivate) or off its own Pokemon (Genome Spiral) is a Step-D choice; MOVE_CARDS
      // queues the attach until after the damage. Not the hand or the deck (B.106, B.101 (1): part of the effect).
      if (pre?.player !== undefined && p.playerId === pre.player.id && p.type === 'Attach energy') {
        const attacker = pre.player as Player;
        const from = (p as unknown as { cardList?: CardList }).cardList;
        if (from !== undefined && (from === attacker.discard || from === attacker.active
          || attacker.bench.some(b => b === from))) {
          p.deferredMove = true;
        }
      }

      // TA-710 (B.89 (5), B.102): a 'Choose cards' prompt asked of the attacker over its own discard pile (King's Order
      // sfa-012, Recovery Net twm-019) is a Step-D choice too: each pick is `chosen` and stays in the discard pile until
      // the effect moves it. Damage or none: a no-damage attack still makes its Step-D choices first. Only the adapter
      // reads the mark here; MOVE_CARDS still moves these cards in the callback, after the last pick.
      if (pre?.player !== undefined && p.playerId === pre.player.id && p.type === 'Choose cards'
          && (p as unknown as { cards?: CardList }).cards === (pre.player as Player).discard) {
        p.deferredMove = true;
      }

      // TA-715 (B.110): an attack's TAKE of one of the attacker's own Prize cards (Onyx pre-060) is a Step-D choice: the
      // named Prize is `chosen`. Not Crescent Purge's face-up pick (a different message; nothing moves, so no chosen).
      if (pre?.player !== undefined && p.playerId === pre.player.id && p.type === 'Choose prize'
          && p.message === GameMessage.CHOOSE_PRIZE_CARD
          && (p as unknown as { options?: { useOpponentPrizes?: boolean } }).options?.useOpponentPrizes !== true) {
        p.deferredMove = true;
      }

      state.prompts.push(prompts[i]);
      this.stampTrainerPrompt(prompts[i]);
    }

    const promptItem: PromptItem = {
      ids: prompts.map(prompt => prompt.id),
      then: then
    };

    this.promptItems.push(promptItem);
    return state;
  }

  public waitPrompt(state: State, callback: () => void): State {
    this.waitItems.push(callback);
    return state;
  }

  public log(state: State, message: GameLog, params?: StateLogParam, client?: number): void {
    const timestamp = LOG_TIME_FORMAT.format(new Date());

    const log = new StateLog(message, params, client);
    log.params = { ...params, timestamp };
    log.id = ++this.logId;
    state.logs.push(log);
  }

  private reducePrompt(state: State, action: ResolvePromptAction): State {
    // Resolve prompts actions
    const prompt = state.prompts.find(item => item.id === action.id);
    const promptItem = this.promptItems.find(item => item.ids.indexOf(action.id) !== -1);

    if (prompt === undefined || promptItem === undefined) {
      return state;
    }

    if (prompt.result !== undefined) {
      throw new GameError(GameMessage.PROMPT_ALREADY_RESOLVED);
    }

    try {
      prompt.result = action.result;

      if (action.log !== undefined) {
        this.log(state, action.log.message, action.log.params, action.log.client);
      }

      const pending = promptItem.ids.map(id => {
        const p = state.prompts.find(item => item.id === id);
        return p === undefined ? undefined : p.result;
      });

      if (pending.every(result => result !== undefined)) {
        this.applyTrainerTargetFilters(state, promptItem.ids);
        if (!this.calculatingPlayability) {
          for (const id of promptItem.ids) {
            const resolved = state.prompts.find(item => item.id === id);
            if (resolved) {
              logResolvedPrompt(this, state, resolved);
            }
          }
        }
        const results = promptItem.ids.map(id => {
          const p = state.prompts.find(item => item.id === id);
          return p === undefined ? undefined : p.result;
        });
        const source = this.takeTrainerPromptSource(promptItem.ids);
        const previous = this.resolvingTrainer;
        if (source) {
          this.resolvingTrainer = source;
        }
        const prevChosen = state.inChosenCallback;
        state.inChosenCallback = promptItem.ids.some(id =>
          (state.prompts.find(item => item.id === id) as { deferredMove?: boolean } | undefined)?.deferredMove === true);
        try {
          const itemIndex = this.promptItems.indexOf(promptItem);
          promptItem.then(results.length === 1 ? results[0] : results);
          this.promptItems.splice(itemIndex, 1);
        } finally {
          this.resolvingTrainer = previous;
          state.inChosenCallback = prevChosen;
        }
      }

      this.resolveWaitItems();
    } catch (storeError) {
      this.dropTrainerPromptSources(promptItem.ids);
      for (const id of promptItem.ids) {
        const promptIndex = state.prompts.findIndex(item => item.id === id);
        if (promptIndex !== -1) {
          state.prompts.splice(promptIndex, 1);
        }
      }
      const itemIndex = this.promptItems.indexOf(promptItem);
      if (itemIndex !== -1) {
        this.promptItems.splice(itemIndex, 1);
      }
      throw storeError;
    }

    return state;
  }

  private resolveWaitItems(): void {
    while (this.promptItems.length === 0 && this.waitItems.length > 0) {
      const waitItem = this.waitItems.pop();
      if (waitItem !== undefined) {
        waitItem();
      }
    }
  }

  public hasPrompts(): boolean {
    return this.promptItems.length > 0;
  }

  /**
   * TA-440. True while `probe()` is running a handler on a throwaway clone. A prefab that reaches
   * OUTSIDE the cloned state for a resource — the conformance driver's scripted-flip cursor, an
   * arbiter's random draw — must consult this and decline, because the clone is thrown away but the
   * consumption is not: the probe would eat the flip the real dispatch then needs.
   */
  public isProbing(): boolean {
    return this.probing;
  }

  public pokemonBeingPlayed(): PlayPokemonEffect | undefined {
    return this.playing[this.playing.length - 1];
  }

  public cleanup(): void {
    this.promptItems = [];
    this.waitItems = [];
    this.logId = 0;
    this.state = new State();
  }

  private reduce(state: State, action: Action, rollback: boolean): State {
    // Rollback snapshot for an illegal action. StateLog entries are append-only and never mutated
    // after creation, so they're shared (not deep-cloned) — the backup's `logs` array keeps the
    // pre-action entries and drops any appended during a rolled-back action, without paying to clone
    // the (unbounded, per-turn-growing) log history on every action.
    const stateBackup: State | undefined = rollback ? this.snapshot(state, 'rollback') : undefined;
    this.promptItems.length = 0;

    try {
      state = setupPhaseReducer(this, state, action);
      state = playCardReducer(this, state, action);
      state = playerTurnReducer(this, state, action);

      this.resolveWaitItems();
      if (this.promptItems.length === 0) {
        state = checkState(this, state);
      }

      // Calculate playability before state change
      state = this.calculatePlayability(state);
    } catch (storeError) {
      // Illegal action
      if (stateBackup !== undefined) { this.state = stateBackup; }
      this.promptItems.length = 0;
      throw storeError;
    }

    this.handler.onStateChange(state);
    return state;
  }

  private calculatePlayability(state: State): State {
    // Prevent nested calls - if we're already calculating playability, skip
    if (this.calculatingPlayability) {
      return state;
    }

    // Skip playability calculation during setup and other non-play phases
    // Only calculate starting from Turn 1 (skip Turn 0 which is setup)
    if (state.phase !== GamePhase.PLAYER_TURN || state.turn < 1) {
      // Clear playability for all players when not in player turn or during setup
      for (const player of state.players) {
        player.playableCardIds = [];
        player.playableHandAbilityCardIds = [];
      }
      return state;
    }

    // Skip if players aren't set up yet
    if (!state.players || state.players.length === 0) {
      return state;
    }

    // Set flag to prevent nested calls
    this.calculatingPlayability = true;

    // Track prompts before playability check to clean up any created during checks
    const promptItemsBefore = this.promptItems.length;
    const waitItemsBefore = this.waitItems.length;

    try {
      const { CAN_PLAY_CARD, CAN_USE_FROM_HAND_TO_BENCH_POWER } = playabilityPrefabs ?? (playabilityPrefabs = require('./prefabs/prefabs'));
      const { PokemonCard } = pokemonCardModule ?? (pokemonCardModule = require('./card/pokemon-card'));

      for (const player of state.players) {
        // Clear previous playability
        player.playableCardIds = [];
        player.playableHandAbilityCardIds = [];

        // Only calculate for the active player
        if (state.players[state.activePlayer]?.id !== player.id) {
          continue;
        }

        // Check each card in hand
        for (const card of player.hand.cards) {
          try {
            // Skip cards without valid IDs (shouldn't happen, but safety check)
            if (card.id === undefined || card.id === -1) {
              continue;
            }

            if (CAN_PLAY_CARD(this, state, player, card)) {
              player.playableCardIds.push(card.id);
            }
            if (
              card instanceof PokemonCard &&
              CAN_USE_FROM_HAND_TO_BENCH_POWER(this, state, player, card)
            ) {
              player.playableHandAbilityCardIds.push(card.id);
            }
          } catch (error) {
            // If check fails, card is not playable - silently continue
          }
        }
      }
    } catch (error) {
      // If playability calculation fails entirely, just clear all and continue
      // This prevents setup from breaking
      for (const player of state.players) {
        player.playableCardIds = [];
        player.playableHandAbilityCardIds = [];
      }
    } finally {
      // Clean up any prompts or wait items that were created during playability checks
      // These are fake prompts from testing card playability and should not interfere with real game prompts
      if (this.promptItems.length > promptItemsBefore) {
        const removed = this.promptItems.splice(promptItemsBefore, this.promptItems.length - promptItemsBefore);
        for (const item of removed) {
          this.dropTrainerPromptSources(item.ids);
        }
      }
      if (this.waitItems.length > waitItemsBefore) {
        this.waitItems.splice(waitItemsBefore, this.waitItems.length - waitItemsBefore);
      }
      // Always clear the flag, even if an error occurred
      this.calculatingPlayability = false;
    }

    return state;
  }

  private propagateEffect(state: State, effect: Effect): State {
    const cards: Card[] = [];
    for (const player of state.players) {
      player.stadium.cards.forEach(c => cards.push(c));
      player.supporter.cards.forEach(c => cards.push(c));
      player.active.cards.forEach(c => cards.push(c));
      player.active.tools.forEach(t => cards.push(t));
      for (const bench of player.bench) {
        bench.cards.forEach(c => cards.push(c));
        bench.tools.forEach(t => cards.push(t));
      }
      for (const prize of player.prizes) {
        prize.cards.forEach(c => cards.push(c));
      }
      player.hand.cards.forEach(c => cards.push(c));
      player.deck.cards.forEach(c => cards.push(c));
      player.discard.cards.forEach(c => cards.push(c));
    }
    const playPokemonTargetTools = effect instanceof PlayPokemonEffect
      ? effect.target.tools.slice()
      : [];

    playPokemonTargetTools.forEach(t => {
      state = this.callReduceEffect(t, this, state, effect);
    });

    // Ability locks live on Trainers/Stadiums.
    // PowerEffect: run lockers first so they throw before ability owners mutate state.
    // CheckPokemonPowersEffect: run stadiums last so filters apply after tools / BREAK /
    // LV.X handlers contribute powers (otherwise Path to the Peak etc. get undone).
    if (effect instanceof PowerEffect) {
      const rank = (c: Card) => {
        if (c.superType === SuperType.TRAINER) return 0;
        if (c.superType === SuperType.ENERGY) return 1;
        return 2;
      };
      cards.sort((a, b) => rank(a) - rank(b));
    } else if (effect instanceof CheckPokemonPowersEffect) {
      const rank = (c: Card) => {
        if (c.superType === SuperType.POKEMON) return 0;
        if (c.superType === SuperType.ENERGY) return 1;
        if (c instanceof TrainerCard && c.trainerType === TrainerType.STADIUM) return 3;
        if (c.superType === SuperType.TRAINER) return 2;
        return 2;
      };
      cards.sort((a, b) => rank(a) - rank(b));
    } else {
      cards.sort((a, b) => a.superType - b.superType);
    }
    const batchable = cards.filter(c => !playPokemonTargetTools.includes(c));

    // TA-292 / CF-38 / §B.40 — the `superType` sort above IS the order simultaneous effects resolve
    // in, and it is arbitrary with respect to the rules. Where two of them compete for one resource
    // it silently picks a winner for the player. `resolveSimultaneous` returns the untouched forEach
    // whenever fewer than two candidates would act, so every board that is not a real batch keeps
    // byte-identical behaviour.
    if (effect instanceof AfterDamageEffect) {
      return this.resolveSimultaneous(state, effect, batchable);
    }

    // TA-612 / B.52: the Energy-attach window is a simultaneous batch too (Magearna jtg-107 Auto Heal + Gengar ex
    // tef-104 Gnawing Curse on one attach).
    if (effect instanceof AttachEnergyEffect) {
      return this.resolveAttachWindow(state, effect, batchable);
    }

    // CF-38 KO window: a reactor already resolved by the sweep-level batch (`resolveKnockOutReactions`)
    // must not fire a second time when this victim's KnockOutEffect is dispatched for real.
    const alreadyResolved = effect instanceof KnockOutEffect ? effect.resolvedReactors : [];
    batchable.forEach(c => {
      if (alreadyResolved.includes(c)) {
        return;
      }
      state = this.callReduceEffect(c, this, state, effect);
    });
    return state;
  }

  /**
   * Run a simultaneous batch, asking the owner for the order when there is a real choice.
   *
   * SCOPE, deliberately narrow: `AfterDamageEffect` only. That is the family §B.40 adjudicates and
   * the one TA-292's board sits in. `resolveNext` as a contract also covers Checkup, KO cascades and
   * end-of-turn; those are NOT batched here, and widening is a separate decision with its own
   * measurement rather than a free consequence of this one.
   */
  private resolveSimultaneous(state: State, effect: Effect, cards: Card[]): State {
    // Probe only cards IN PLAY. `propagateEffect`'s list also carries hand, deck, discard and
    // prizes — probing all of them would mean ~120 full state clones per damage event, and no
    // after-damage rider can fire from those zones anyway. A card the probe never looks at simply
    // stays on the legacy path (it lands in `nonActors` and runs after the batch), so narrowing the
    // probe can cost a missing prompt but never a missing effect.
    const inPlay = new Set<Card>();
    for (const player of state.players) {
      for (const slot of [player.active, ...player.bench]) {
        slot.cards.forEach(c => inPlay.add(c));
        slot.tools.forEach(t => inPlay.add(t));
      }
    }
    const probeable = cards.filter(c => inPlay.has(c));
    if (probeable.length < 2) {
      cards.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
      return state;
    }
    const actors = probeable.filter(c => this.probeWouldAct(c, state, effect));

    // Fewer than two effects in the batch: there is no order to choose, so behave exactly as before.
    // Note this runs the FULL list, not just the probed actors — a handler that declines to act is a
    // no-op anyway, and re-running the list keeps this path identical to the old forEach even if the
    // probe's judgement is wrong. A probe that under-reports costs a missing prompt, never a missing
    // effect.
    if (actors.length < 2) {
      cards.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
      return state;
    }

    // The decider is the OWNER of the triggers (#1874). When the batch spans BOTH players the
    // deciding rule is a split-trigger tie-break we have not adjudicated (#146's window), so rather
    // than guess we fall through to the legacy order — a wrong prompt is worse than a known gap,
    // because a prompt asserts that the answer is settled.
    const owners = actors.map(c => this.ownerOfEffect(state, c));
    if (owners.some(o => o === undefined || o !== owners[0])) {
      cards.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
      return state;
    }

    const nonActors = cards.filter(c => !actors.includes(c));
    // CF-75: the AfterDamage batch shares one effect (one damaged Pokemon), so every reaction is ABOUT
    // that Pokemon — carry it as `subject` (openapi v0.7.3 REQUIRES `subject` on every resolveNext
    // candidate), exactly as the KO window sets it per victim. Without it the wire candidates are
    // subject-less and rotomancer rejects the replayed order-pick (invalidAction).
    const subject = (effect as AfterDamageEffect).target.getPokemons()[0];
    state = this.askResolveNext(state, actors.map(card => ({ card, effect, subject })), owners[0] as Player);
    // Handlers the probe judged inert still get their turn, after the batch. They are no-ops by
    // construction; running them preserves the old path's guarantee that every card sees the effect.
    nonActors.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
    return state;
  }

  /**
   * TA-612: the triggers raised by ONE Energy attach are one simultaneous batch, and B.52 (owner 2026-09-17) gives the
   * order to the CURRENT player: "During a turn, the current player can choose the order of multiple triggered effects
   * when ... an energy is attached." B.49: two triggers from two Pokémon are two members, so two actors make a
   * resolveNext; one or none keeps the old forEach. Mixed owners are one batch (B.52 lifts the same-owner gate, as in
   * the KO window). The actor test is `wireVisibleBoardDiffers` (a marker is not an ordered effect), and every
   * candidate's `subject` is the Pokémon the Energy goes to (CF-75).
   *
   * ⚠️ A handler that THROWS on the attach refuses it (an attach lock). The batch runs its non-actors after the
   * picks, so a refusal there would come after triggers had already applied. Any probe that throws therefore keeps
   * the legacy order, which throws exactly as it did before. A nested call inside a probe keeps the legacy order too.
   */
  private resolveAttachWindow(state: State, effect: AttachEnergyEffect, cards: Card[]): State {
    const legacy = (): State => {
      cards.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
      return state;
    };
    if (this.probing) {
      return legacy();
    }
    const inPlay = new Set<Card>();
    for (const player of state.players) {
      for (const slot of [player.active, ...player.bench]) {
        slot.cards.forEach(c => inPlay.add(c));
        slot.tools.forEach(t => inPlay.add(t));
      }
    }
    // The attached Energy itself is a candidate: its "when you attach this card from your hand" effect (Rich Energy
    // ssp-191 draws 4) is one of the window's triggers, and while this effect is being reduced the card is still in hand.
    const probeable = cards.filter(c => inPlay.has(c) || c === effect.energyCard);
    if (probeable.length < 2) {
      return legacy();
    }
    const actors: Card[] = [];
    for (const card of probeable) {
      const probe = this.probe(card, state, effect);
      if (probe === null) {
        return legacy();
      }
      if (probe.raised || probe.dispatched || wireVisibleBoardDiffers(state, probe.after)) {
        actors.push(card);
      }
    }
    if (actors.length < 2) {
      return legacy();
    }
    const subject = effect.target.getPokemons()[0];
    const nonActors = cards.filter(c => !actors.includes(c));
    state = this.askResolveNext(state, actors.map(card => ({ card, effect, subject })), state.players[state.activePlayer]);
    nonActors.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
    return state;
  }

  /**
   * CF-38 KO WINDOW (reopened on rotomancer's N-0209, 2026-09-16). Every Pokémon Knocked Out in one
   * checkState sweep is Knocked Out at the same time, so their REACTIONS are one simultaneous batch —
   * across victims — and one source may react once PER victim: `dri-055` Diver's Catch ("… put all Basic
   * [W] Energy attached to THAT Pokémon into your hand") fires twice when a spread attack Knocks Out two
   * of its Water Pokémon. A candidate is therefore a (reactor, victim) pair, and the wire names the
   * victim as `subject` (openapi v0.7.2) — the only field on which the two firings differ.
   *
   * Same discipline as `resolveSimultaneous`: fewer than two actors, or actors spanning both players
   * (#146's un-adjudicated split-trigger window), fall through untouched and the sweep's per-victim
   * dispatch behaves exactly as before. With a real batch, each actor is stamped on its victim's effect
   * so `propagateEffect` skips it when that effect is dispatched for real — the core KO (discard, prize
   * accounting) still runs there, AFTER the reactions. That ordering is what lets an "instead of the
   * discard pile" clause act on the Pokémon while it is still in play.
   *
   * The actor test is `wireVisibleBoardDiffers`, not `boardDiffers`: the KO window has ~131 handlers and
   * many only stamp a marker; a marker is not an effect the player orders.
   */
  public resolveKnockOutReactions(state: State, effects: KnockOutEffect[],
    collectNew?: (state: State) => KnockOutEffect[]): State {
    if (effects.length === 0) {
      return state;
    }
    const actors = this.knockOutActors(state, effects);
    if (actors.length === 0) {
      return state;
    }
    // TA-441 (#2089 "All effects have to be resolved before resolving KO's"). A SINGLE reactor has no
    // order to choose, but it still has to act BEFORE the victim leaves play: run it here, in the
    // window, rather than leaving it to the sweep's per-victim dispatch. There the handler's prompt is
    // merely ENQUEUED (`Store.prompt` returns immediately) and the core KO — discard of the Pokemon and
    // everything attached — runs synchronously right after it, so the decision was answered with the
    // victim already in the discard pile and an empty Active Spot. Stamping the reactor below makes
    // `propagateEffect` skip it on that dispatch, so it fires exactly once. No prompt is raised for a
    // lone actor (`askResolveNext` calls the handler directly at length 1), so this adds a decision to
    // no board — it only moves one that already existed to the correct side of the discard.
    // B.52 (the February 2026 official rule, vendored): at a Knock Out DURING A TURN the CURRENT player
    // orders the batch; at Pokémon Checkup (BETWEEN_TURNS) the player whose turn is NEXT orders it —
    // regardless of who OWNS the reactions. This supersedes FX-0303's owner-decides (B.40's decider
    // half) for the KO window, and lifts the same-owner gate: a mixed-owner KO batch is one decider's
    // to order. The owner rule stays on the AfterDamage batch (`resolveSimultaneous`, #1874); the
    // next-player rule (#2302) is the Checkup branch below. "Whose turn is next" is `1 - activePlayer`
    // (see `turnNextOrder` in check-effect): an attack ends the turn, so the KO's own turn is over.
    const koWindowDecider = state.phase === GamePhase.BETWEEN_TURNS
      ? state.players[1 - state.activePlayer]
      : state.players[state.activePlayer];
    for (const a of actors) {
      (a.effect as KnockOutEffect).resolvedReactors.push(a.card);
    }
    // TA-444 (B.51, MERGE): a Pokémon a reaction Knocks Out while the set is still being ordered joins it — its
    // reactions are added to the candidates before the next pick (the sweep records its Knock Out, so its discard and
    // Prize come with the group's).
    const merge = collectNew === undefined ? undefined : (s: State): SimultaneousActor[] => {
      const joined = this.knockOutActors(s, collectNew(s));
      for (const a of joined) {
        (a.effect as KnockOutEffect).resolvedReactors.push(a.card);
      }
      return joined;
    };
    return this.askResolveNext(state, actors, koWindowDecider, merge);
  }

  /** The cards in play whose reaction to one of these Knock Outs would do something (the wire-visible probe). */
  private knockOutActors(state: State, effects: KnockOutEffect[]): SimultaneousActor[] {
    const inPlay: Card[] = [];
    for (const player of state.players) {
      for (const slot of [player.active, ...player.bench]) {
        slot.cards.forEach(c => inPlay.push(c));
        slot.tools.forEach(t => inPlay.push(t));
      }
    }
    const actors: SimultaneousActor[] = [];
    for (const effect of effects) {
      const subject = effect.target.getPokemons()[0];
      for (const card of inPlay) {
        const probe = this.probe(card, state, effect);
        if (probe !== null && (probe.raised || wireVisibleBoardDiffers(state, probe.after))) {
          actors.push({ card, effect, subject });
        }
      }
    }
    return actors;
  }

  /** One pending per pick, re-asked with the remainder (CF-38: not a single permutation). */
  private askResolveNext(state: State, remaining: SimultaneousActor[], owner: Player,
    merge?: (state: State) => SimultaneousActor[]): State {
    if (merge !== undefined) {
      remaining = [...remaining, ...merge(state)];
    }
    if (remaining.length === 0) {
      return state;
    }
    if (remaining.length === 1) {
      return this.callReduceEffect(remaining[0].card, this, state, remaining[0].effect);
    }
    const candidates: ResolveNextCandidate[] = remaining.map(a => ({
      card: a.card,
      ability: this.abilityNameOf(a.card),
      subject: a.subject,
    }));
    return this.prompt(state, new ResolveNextPrompt(owner.id, candidates), choice => {
      const index = (typeof choice === 'number' && choice >= 0 && choice < remaining.length) ? choice : 0;
      const picked = remaining[index];
      const rest = remaining.filter((_, i) => i !== index);
      state = this.runThenContinue(state, picked, rest, owner, merge);
    });
  }

  /**
   * Resolve ONE picked candidate, and only then move on to the rest.
   *
   * 🚨 THE ORDER A HANDLER IS INVOKED IN IS NOT THE ORDER ITS EFFECT APPLIES IN, and the first
   * version of `askResolveNext` conflated them. `prompt()` ENQUEUES and returns (see its own body),
   * so a handler whose work lives in a prompt callback — `dri-125` Smog Signals behind its
   * confirmation, `por-017` Shell Spikes, `twm-150` Handheld Fan — has done NOTHING by the time
   * control comes back. Running the next candidate immediately then let a SYNCHRONOUS handler —
   * `twm-158` Lucky Helmet's `deck.moveTo(hand, 2)` — apply its effect first no matter what the
   * player picked. Driven: on `dri-125` + `twm-158` both branches reached a byte-identical board,
   * so the decision was offered and then ignored.
   *
   * ⚠️ **TA-292's own two guards could not see this**, and the reason is worth keeping: its pair is
   * prompt × prompt, where enqueue order IS resolution order and the pick happens to work. The
   * broken shape is prompt × SYNCHRONOUS, and in pool that is the common one — 10 of the 14
   * in-pool after-damage responders apply inline. A fix verified only on the shape that works is
   * [[fix-and-test-sharing-an-axis]].
   *
   * `waitPrompt` is the sequencing primitive already in the store: `resolveWaitItems` drains it only
   * once `promptItems` is EMPTY, i.e. after the picked effect's whole prompt chain (confirm →
   * choose → shuffle) has been answered. So the remainder resumes when the pick has really finished,
   * not when its first prompt has been posted.
   */
  private runThenContinue(
    state: State, picked: SimultaneousActor, rest: SimultaneousActor[], owner: Player,
    merge?: (state: State) => SimultaneousActor[],
  ): State {
    const promptsBefore = this.promptItems.length;
    state = this.callReduceEffect(picked.card, this, state, picked.effect);
    if (this.promptItems.length > promptsBefore) {
      return this.waitPrompt(state, () => {
        state = this.askResolveNext(state, rest, owner, merge);
      });
    }
    return this.askResolveNext(state, rest, owner, merge);
  }

  /**
   * Would this handler DO anything on this effect?
   *
   * Runs it against a throwaway clone and asks two questions: did it raise a prompt, and did it
   * change the board. Neither alone is enough — `twm-150` Handheld Fan prompts and `twm-158` Lucky
   * Helmet does not (it calls `deck.moveTo(hand, 2)` outright), and a batch that missed the second
   * would leave the deck-competing pairs unordered.
   *
   * 🚨 THE STATE AND THE EFFECT MUST BE CLONED TOGETHER. Handlers test identity —
   * `effect.target.getPokemonCard() === this`, `player.active !== effect.target` — so cloning the
   * state while the effect still points into the ORIGINAL graph makes every one of those tests fail
   * and the probe reports a unanimous "nobody acts", which reads exactly like a clean board and
   * silently disables the feature. Sharing one `refMap` across both clones is what keeps the
   * references pointing at the same objects.
   */
  private probeWouldAct(card: Card, state: State, effect: Effect): boolean {
    const probe = this.probe(card, state, effect);
    return probe !== null && (probe.raised || boardDiffers(state, probe.after));
  }

  /**
   * Run one handler against a throwaway clone and report whether it raised a prompt and what board it
   * left — the two actor signals. `null` when the handler threw (declining). Split out of
   * `probeWouldAct` so the KO window can apply a narrower diff to `after` (see `wireVisibleBoardDiffers`).
   */
  private probe(card: Card, state: State, effect: Effect): { raised: boolean; dispatched: boolean; after: State } | null {
    const auditedNoOp = this.reactionFilter !== 'off'
      && (this.snapshots === legacyStateSnapshots || this.snapshots === conformanceLegacyStateSnapshots || this.snapshots === graphStateSnapshots)
      && Object.getPrototypeOf(this) === Store.prototype
      && !Object.prototype.hasOwnProperty.call(this, 'callReduceEffect')
      && Object.getOwnPropertyDescriptor(Store.prototype, 'callReduceEffect')?.value === Store.reactionProbeReducer
      && canSkipReactionProbe(card, effect);
    if (auditedNoOp && this.reactionFilter === 'on') {
      recordReactionFilterSkipped();
      return { raised: false, dispatched: false, after: state };
    }
    // 🚨 IDENTITY THAT LIVES ON A CARD MUST SURVIVE THE CLONE, AND `Card` IN THE IGNORE LIST IS NOT
    // ENOUGH TO GIVE IT THAT. `deepClone` treats a `Card` as opaque and never walks into it, so
    // `this.attacks[0]` is the SAME object on both sides -- but the identical Attack reached through
    // `effect.attack` is a plain object on the effect, so it gets cloned, and every handler gating on
    // `effect.attack === this.attacks[N]` reports "I would not act". `tef-040` Croconaw's Reverse
    // Thrust is the live in-pool carrier: it switches its own bearer after damage, and the probe
    // could not see it. That is a SILENT UNDER-REPORT -- the card acts for real, the batch it belongs
    // to loses an actor, and an ordering decision that should be surfaced is resolved by list order
    // instead. `Attack` is an INTERFACE, so it cannot join `Card` in the ignore list; seeding the
    // shared refMap with an identity entry is the equivalent that works for a structural type.
    //
    // Sharing the object rather than cloning it is the same contract the `Card` entry already sets:
    // printed data on a card is shared with the probe. Checked before relying on it -- the five card
    // files that write to `effect.attack.*` all do so in `CheckAttackCost`/attack-declaration
    // branches, none of which a probe of an `AfterDamageEffect` can enter.
    const attackOfEffect = (effect as unknown as { attack?: object }).attack;
    const captured = this.snapshots.capture(state, effect, 'reaction', attackOfEffect ? [attackOfEffect] : []);
    const probeState = captured.state;
    const probeEffect = captured.effect;
    // No third clone for the before-image: `state` IS it. `probeState` was cloned FROM `state` and
    // only the clone is mutated, so comparing the run result against the original graph is the same
    // comparison for a third of the allocation. `Card` instances are shared across both graphs
    // (deepClone ignores them), so the identity test inside `boardDiffers` still holds.

    const promptItemsBefore = this.promptItems.length;
    const logIdBefore = this.logId;
    // SAVE AND RESTORE, never assign false. A probed handler can dispatch damage that raises another
    // `AfterDamageEffect` — a counter-placing rider that knocks the attacker out is the live shape —
    // which re-enters `resolveSimultaneous` and probes again. A nested probe that cleared the flag on
    // the way out would hand control back to its CALLER with `probing` false, and the outer probe
    // would then enqueue prompts and run continuations for real, on a state it is about to throw
    // away. Restoring the previous value makes the nesting harmless instead of load-bearing.
    const wasProbing = this.probing;
    const outerRaised = this.probeRaisedPrompt;
    const outerDispatched = this.probeDispatched;
    this.probing = true;
    this.probeRaisedPrompt = false;
    this.probeDispatched = false;
    let after: State;
    let raised: boolean;
    let dispatched: boolean;
    try {
      after = this.callReduceEffect(card, this, probeState, probeEffect);
    } catch {
      // A handler that throws is doing what several of them do to decline (the `ToolEffect` stub in
      // `handy-fan.ts` is caught by the CARD, but a lock can throw past it). Not acting.
      if (auditedNoOp && this.reactionFilter === 'verify') {
        recordReactionFilterVerified(false);
        throw new Error('Reaction filter verification failed: audited no-op declined');
      }
      return null;
    } finally {
      raised = this.probeRaisedPrompt;
      dispatched = this.probeDispatched;
      this.probing = wasProbing;
      this.probeRaisedPrompt = outerRaised;
      this.probeDispatched = outerDispatched;
      this.promptItems.length = promptItemsBefore;
      this.logId = logIdBefore;
    }
    if (auditedNoOp && this.reactionFilter === 'verify') {
      const matches = !raised && !dispatched && !boardDiffers(state, after) && !wireVisibleBoardDiffers(state, after);
      recordReactionFilterVerified(matches);
      if (!matches) { throw new Error('Reaction filter verification failed: audited no-op changed observable behavior'); }
    }
    return { raised, dispatched, after };
  }

  /** The player who owns the card an effect comes from — a Tool's owner is the Pokemon's owner. */
  private ownerOfEffect(state: State, card: Card): Player | undefined {
    for (const player of state.players) {
      const slots = [player.active, ...player.bench];
      for (const slot of slots) {
        if (slot.cards.includes(card) || slot.tools.includes(card)) {
          return player;
        }
      }
    }
    return undefined;
  }

  /**
   * The Ability's name when the card's effect is a named Ability, else undefined — CF-38's
   * `abilityEffect` / `cardTextEffect` split, decided by whether the card HAS an Ability rather than
   * by its superType. The six Antique Fossils are Trainers carrying a real Ability, so a superType
   * test would file them under the wrong kind.
   */
  private abilityNameOf(card: Card): string | undefined {
    const powers = (card as any).powers as Array<{ name: string; powerType: number }> | undefined;
    if (!powers || powers.length === 0) {
      return undefined;
    }
    const ability = powers.find(pw => pw.powerType === PowerType.ABILITY) || powers[0];
    return ability ? ability.name : undefined;
  }

  // Utility function to call reduceEffect with override support
  private callReduceEffect(card: Card, store: StoreLike, state: State, effect: Effect): State {
    const resolvingThisTrainer = !this.calculatingPlayability
      && effect instanceof TrainerEffect
      && effect.trainerCard === card;
    const previous = this.resolvingTrainer;
    if (resolvingThisTrainer && effect instanceof TrainerEffect) {
      this.resolvingTrainer = { player: effect.player, trainerCard: effect.trainerCard };
    }

    const alreadyBlocked = effectWasBlocked(effect);

    try {
      // Only try override for TrainerCard (for now)
      if ((card as any).trainerType !== undefined) {
        // Import here to avoid circular dependency at module level
        const { getOverriddenReduceEffect } = cardEffectOverrides ?? (cardEffectOverrides = require('./card/card-effect-overrides'));
        const format = (store as any)?.handler?.gameSettings?.format ?? 0;
        const override = getOverriddenReduceEffect(card, format);
        if (override) {
          return override(store, state, effect);
        }
      }
      return card.reduceEffect(store, state, effect);
    } finally {
      stampEffectBlocker(effect, card, alreadyBlocked);
      if (resolvingThisTrainer) {
        this.resolvingTrainer = previous;
      }
    }
  }

  private stampTrainerPrompt(prompt: Prompt<any>): void {
    if (this.calculatingPlayability || this.resolvingTrainer === undefined) {
      return;
    }
    this.trainerPromptSources.set(prompt.id, this.resolvingTrainer);
    prompt.sourceCard = this.resolvingTrainer.trainerCard;
  }

  private applyTrainerTargetFilters(state: State, promptIds: number[]): void {
    for (const id of promptIds) {
      const prompt = state.prompts.find(item => item.id === id);
      const source = this.trainerPromptSources.get(id);
      if (prompt === undefined || source === undefined) {
        continue;
      }
      filterTrainerPromptResult(this, state, prompt, source);
    }
  }

  private takeTrainerPromptSource(promptIds: number[]): ResolvingTrainerSource | undefined {
    let source: ResolvingTrainerSource | undefined;
    for (const id of promptIds) {
      const stamped = this.trainerPromptSources.get(id);
      if (stamped) {
        source = stamped;
      }
      this.trainerPromptSources.delete(id);
    }
    return source;
  }

  private dropTrainerPromptSources(promptIds: number[]): void {
    for (const id of promptIds) {
      this.trainerPromptSources.delete(id);
    }
  }
}
