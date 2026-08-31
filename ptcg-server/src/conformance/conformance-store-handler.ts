import { State } from '../game/store/state/state';
import { Store } from '../game/store/store';
import { StoreHandler } from '../game/store/store-handler';

/**
 * The non-resolving handler — the inverse of the test harness's TestStoreHandler.
 *
 * TestStoreHandler.onStateChange auto-resolves every pending prompt (driving the game to a
 * quiescent point). For the conformance API we must do the opposite: when the engine raises a
 * prompt, we HALT and surface it as a pending decision answered from the action log. So this
 * handler's onStateChange does no auto-resolution at all — it only records that the engine is
 * blocked. The driver inspects `store.state.prompts` to decide what to do next.
 *
 * The Store does not call the Arbiter (the handler does), so by simply not wiring one here,
 * randomness (shuffles, coin flips) stays externalized to the `system` actor (design §5).
 *
 * `flipCoin()` is the `system` actor's inline coin hook (M3): `CoinFlipEffect` (game-effect.ts)
 * consults `handler.flipCoin()` to get a flip result synchronously during reduction, rather than
 * raising a prompt. The driver installs a provider (`setFlipProvider`) that supplies the next
 * scripted face from the action log, so inline coin flips are deterministic and replay-correct.
 */
export class ConformanceStoreHandler implements StoreHandler {

  private store!: Store;
  private flipProvider?: () => boolean | undefined;

  setStore(store: Store): void {
    this.store = store;
  }

  /** Install the source of scripted coin flips (the driver wires this to the action-log cursor). */
  setFlipProvider(provider: () => boolean | undefined): void {
    this.flipProvider = provider;
  }

  /**
   * The next scripted flip, or `undefined` when the log has none aligned (or no provider is
   * installed — e.g. a legal-action probe). `undefined` tells RESOLVE_COIN_FLIP_EFFECT to surface a
   * REAL pausing CoinFlipPrompt instead of resolving inline, so everything already reduced (attack
   * damage, prior riders) COMMITS before the pause — the TA-79/TA-306 observability the raw-prompt
   * cards had and the ~50 upstream COIN_FLIP_PROMPT conversions lost (queue item (a), 2026-08-31).
   */
  tryScriptedFlip(): boolean | undefined {
    return this.flipProvider === undefined ? undefined : this.flipProvider();
  }

  /** Legacy inline hook (BotArbiter-shaped handlers keep this contract); conformance now uses tryScriptedFlip. */
  flipCoin(): boolean {
    if (this.flipProvider === undefined) {
      throw new Error('[conformance] coin flip requested but no flip provider is set');
    }
    const r = this.flipProvider();
    if (r === undefined) {
      throw new Error('[conformance] coin flip requested but the next action is not a flip');
    }
    return r;
  }

  /** True when the engine is blocked on at least one unresolved prompt. */
  isBlocked(): boolean {
    return this.store.state.prompts.some(p => p.result === undefined);
  }

  onStateChange(_state: State): void {
    // Deliberately empty: do NOT auto-resolve prompts. The driver owns the loop and answers
    // pending prompts from the action log (or surfaces them as the next decision).
  }
}
