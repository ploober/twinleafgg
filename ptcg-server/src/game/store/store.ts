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
import { PlayPokemonEffect } from './effects/play-card-effects';
import { CheckAttackCostEffect, CheckPokemonPowersEffect, CheckRetreatCostEffect } from './effects/check-effects';
import { MovedFromActiveToBenchEffect, MovedToActiveEffect, PowerEffect } from './effects/game-effects';
import {
  CLEAR_ABILITY_LOCK_ACTIVATION,
  STAMP_ABILITY_LOCK_ACTIVATION,
} from './prefabs/ability-lock';
import { GameError } from '../game-error';
import { GameMessage, GameLog } from '../game-message';
import { Prompt } from './prompts/prompt';
import { ReorderHandAction, ReorderBenchAction } from './actions/reorder-actions';
import { ResolvePromptAction } from './actions/resolve-prompt-action';
import { State, GamePhase } from './state/state';
import { StateLog, StateLogParam } from './state/state-log';
import { StoreHandler } from './store-handler';
import { StoreLike } from './store-like';
import { generateId, deepClone } from '../../utils/utils';
import { ResolveNextPrompt, ResolveNextCandidate } from './prompts/resolve-next-prompt';
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
 * Cycles terminate on the `seen` pair-set. Functions and undefined-vs-missing are treated as equal,
 * since neither is board state.
 */
function boardDiffers(a: any, b: any, seen: Set<string> = new Set(), depth = 0): boolean {
  if (a === b) { return false; }
  if (depth > 24) { return false; }
  if (a === null || b === null || a === undefined || b === undefined) { return a !== b; }
  if (typeof a === 'function' || typeof b === 'function') { return false; }
  if (typeof a !== 'object' || typeof b !== 'object') { return a !== b; }
  // Shared-by-reference classes: identity is the whole comparison (see the note above).
  if (a instanceof Card || b instanceof Card) { return a !== b; }
  if (a instanceof StateLog || b instanceof StateLog) { return a !== b; }
  if (Array.isArray(a) !== Array.isArray(b)) { return true; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { return true; }
    return a.some((item, i) => boardDiffers(item, b[i], seen, depth + 1));
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (boardDiffers(a[key], b[key], seen, depth + 1)) { return true; }
  }
  return false;
}


export class Store implements StoreLike {

  //private effectHistory: Effect[] = [];

  public state: State = new State();
  private promptItems: PromptItem[] = [];
  private waitItems: (() => void)[] = [];
  private logId: number = 0;
  // Flag to prevent nested playability calculations
  private calculatingPlayability: boolean = false;

  constructor(private handler: StoreHandler) { }

  public dispatch(action: Action, clientRoleId?: number): State {
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

    state = this.reduce(state, action);

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

  public reduceEffect(state: State, effect: Effect): State {
    // Track Active ability-lock activation order before card handlers run.
    if (effect instanceof MovedToActiveEffect) {
      STAMP_ABILITY_LOCK_ACTIVATION(state, effect.player.active, effect.pokemonCard);
    } else if (effect instanceof MovedFromActiveToBenchEffect) {
      CLEAR_ABILITY_LOCK_ACTIVATION(state, effect.pokemonCard);
    }

    state = this.propagateEffect(state, effect);

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
      state.prompts.push(prompts[i]);
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

      const results = promptItem.ids.map(id => {
        const p = state.prompts.find(item => item.id === id);
        return p === undefined ? undefined : p.result;
      });

      if (action.log !== undefined) {
        this.log(state, action.log.message, action.log.params, action.log.client);
      }

      if (results.every(result => result !== undefined)) {
        const itemIndex = this.promptItems.indexOf(promptItem);
        promptItem.then(results.length === 1 ? results[0] : results);
        this.promptItems.splice(itemIndex, 1);
      }

      this.resolveWaitItems();
    } catch (storeError) {
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

  public cleanup(): void {
    this.promptItems = [];
    this.waitItems = [];
    this.logId = 0;
    this.state = new State();
  }

  private reduce(state: State, action: Action): State {
    // Rollback snapshot for an illegal action. StateLog entries are append-only and never mutated
    // after creation, so they're shared (not deep-cloned) — the backup's `logs` array keeps the
    // pre-action entries and drops any appended during a rolled-back action, without paying to clone
    // the (unbounded, per-turn-growing) log history on every action.
    const stateBackup = deepClone(state, [Card, StateLog]);
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
      this.state = stateBackup;
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
      const { CAN_PLAY_CARD, CAN_USE_FROM_HAND_TO_BENCH_POWER } = require('./prefabs/prefabs');
      const { PokemonCard } = require('./card/pokemon-card');

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
        this.promptItems.splice(promptItemsBefore, this.promptItems.length - promptItemsBefore);
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

    batchable.forEach(c => {
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
    state = this.askResolveNext(state, effect, actors, owners[0] as Player);
    // Handlers the probe judged inert still get their turn, after the batch. They are no-ops by
    // construction; running them preserves the old path's guarantee that every card sees the effect.
    nonActors.forEach(c => { state = this.callReduceEffect(c, this, state, effect); });
    return state;
  }

  /** One pending per pick, re-asked with the remainder (CF-38: not a single permutation). */
  private askResolveNext(state: State, effect: Effect, remaining: Card[], owner: Player): State {
    if (remaining.length === 0) {
      return state;
    }
    if (remaining.length === 1) {
      return this.callReduceEffect(remaining[0], this, state, effect);
    }
    const candidates: ResolveNextCandidate[] = remaining.map(c => ({
      card: c,
      ability: this.abilityNameOf(c),
    }));
    return this.prompt(state, new ResolveNextPrompt(owner.id, candidates), choice => {
      const index = (typeof choice === 'number' && choice >= 0 && choice < remaining.length) ? choice : 0;
      const picked = remaining[index];
      const rest = remaining.filter((_, i) => i !== index);
      state = this.runThenContinue(state, effect, picked, rest, owner);
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
    state: State, effect: Effect, picked: Card, rest: Card[], owner: Player,
  ): State {
    const promptsBefore = this.promptItems.length;
    state = this.callReduceEffect(picked, this, state, effect);
    if (this.promptItems.length > promptsBefore) {
      return this.waitPrompt(state, () => {
        state = this.askResolveNext(state, effect, rest, owner);
      });
    }
    return this.askResolveNext(state, effect, rest, owner);
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
    const refMap = new Map<object, object>();
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
    if (attackOfEffect) {
      refMap.set(attackOfEffect, attackOfEffect);
    }
    const probeState: State = deepClone(state, [Card, StateLog], refMap);
    const probeEffect: Effect = deepClone(effect, [Card, StateLog], refMap);
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
    this.probing = true;
    this.probeRaisedPrompt = false;
    let after: State;
    let raised: boolean;
    try {
      after = this.callReduceEffect(card, this, probeState, probeEffect);
    } catch {
      // A handler that throws is doing what several of them do to decline (the `ToolEffect` stub in
      // `handy-fan.ts` is caught by the CARD, but a lock can throw past it). Not acting.
      return false;
    } finally {
      raised = this.probeRaisedPrompt;
      this.probing = wasProbing;
      this.probeRaisedPrompt = outerRaised;
      this.promptItems.length = promptItemsBefore;
      this.logId = logIdBefore;
    }
    return raised || boardDiffers(state, after);
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
    // Only try override for TrainerCard (for now)
    if ((card as any).trainerType !== undefined) {
      // Import here to avoid circular dependency at module level
      const { getOverriddenReduceEffect } = require('./card/card-effect-overrides');
      const format = (store as any)?.handler?.gameSettings?.format ?? 0;
      const override = getOverriddenReduceEffect(card, format);
      if (override) {
        return override(store, state, effect);
      }
    }
    return card.reduceEffect(store, state, effect);
  }
}