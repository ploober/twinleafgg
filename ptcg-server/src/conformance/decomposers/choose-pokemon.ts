import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { CardTarget, SlotType } from '../../game/store/actions/play-card-action';
import { GameMessage } from '../../game/game-message';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

/**
 * CF-32: the wire verb names the OPERATION applied to the chosen object, not the prompt class that
 * happens to carry the pick. `ChoosePokemonPrompt` is twinleaf's generic target picker — it is reused
 * for promotions, counter placement, healing, attaching, evolving, … — so the operation has to be read
 * off the prompt, never assumed from its type.
 *
 * Two operations have a typed contract verb, and each has its own signal:
 *
 * - `promoteBench` — a bench→Active promotion. Signalled by the prompt MESSAGE:
 *   `CHOOSE_NEW_ACTIVE_POKEMON` (the post-KO replacement) or `CHOOSE_POKEMON_TO_SWITCH` restricted to
 *   BENCH slots (a gust, a self-switch rider, a switch-out Supporter). CF-15 pins promotion as
 *   `promoteBench` regardless of trigger, so all of these are the same verb. The BENCH-slot guard is
 *   load-bearing: 3 of the 131 `CHOOSE_POKEMON_TO_SWITCH` sites (Ninja Boy, Swoop Teleporter,
 *   Transformation Tome) offer ACTIVE+BENCH because they swap a Pokémon for one from the deck/hand —
 *   nothing is promoted, so those stay a generic `choose`.
 * - `placeCounter` — damage-counter placement, declared by the card via `options.operation`
 *   ('placeCounters'). The message cannot carry this: `CHOOSE_POKEMON_TO_DAMAGE` is used for BOTH
 *   "put N damage counters on it" and "do N damage to it" picks, and only the constructing card knows
 *   which effect it will apply (`PutCountersEffect` vs `PutDamageEffect`). Declaring it on the prompt
 *   moves that existing engine-side distinction earlier, to where the adapter can see it.
 *
 * Everything else is a bare target selection with no typed verb in the vocabulary (heal, attach,
 * evolve, pick-up, and the damage picks), and stays the generic `choose{target}`.
 */
/** The contract verb naming what this prompt's pick does to the Pokémon it picks (CF-32). */
function verbFor(prompt: ChoosePokemonPrompt): 'choose' | 'promoteBench' | 'placeCounter' {
  if (prompt.message === GameMessage.CHOOSE_NEW_ACTIVE_POKEMON) {
    return 'promoteBench';
  }
  if (prompt.message === GameMessage.CHOOSE_POKEMON_TO_SWITCH && prompt.slots.every(s => s === SlotType.BENCH)) {
    return 'promoteBench';
  }
  if (prompt.options.operation === 'placeCounters') {
    return 'placeCounter';
  }
  return 'choose';
}

export const choosePokemonDecomposer: PromptDecomposer<ChoosePokemonPrompt> = {
  type: 'Choose pokemon',

  /**
   * CF-14: a SINGLE-pick target selection (`max === 1`) forced to exactly one candidate has no decision
   * content — the driver resolves it atomically (no 1-option `choose` pending), matching rotomancer.
   * e.g. Potion's CHOOSE_POKEMON_TO_HEAL when only the Active is damaged, or a bench-snipe rider when
   * the target player has exactly one eligible Pokémon. Gated on `max === 1` so a genuine MULTI-pick
   * aggregate is never collapsed on a momentarily-forced sub-pick (the register's rule), and the driver
   * additionally only collapses when the pick cannot stop short (no `endChoice`), so an optional
   * "you may" heal (min:0) still surfaces its decline. The post-KO promote (`promoteBench`) is excluded
   * — it has its own flow and its collapse is handled by the KO/prize machinery.
   */
  /**
   * B.17 (TA-178): the `max === 1` gate above is a test of whether the CURRENT sub-pick is forced, and
   * that is the right test for the case it was written for. It is not the only way a decision can have
   * one resolution. A MULTI-pick whose candidate pool is no larger than its required count is forced for
   * its ENTIRE duration, not momentarily: every valid selection is "all the candidates", in some order
   * that the decision itself does not distinguish.
   *
   * Mega Eelektross ex `asc-061` "Split Bomb" — *"does 60 damage to each of 2 of your opponent's
   * Pokémon"* — built as `min:2, max:2`. Played into an opponent reduced to ONE Pokémon, it asks for two
   * targets where only one exists, and twinleaf surfaced a 1-option `choose` while rotomancer applied
   * the 60 and moved on. Adjudicated in the register as ours: the card grants a choice of *which two*,
   * and where there are not two to choose between, the card grants nothing to choose.
   *
   * This is the same whole-decision test `choose-cards` already uses for CF-8 (`min >= |eligible|`), so
   * the two prompt classes now agree on when a forced discard/target collapses instead of differing by
   * which prompt a card happened to reach for — the TA-176 lesson applied one class over.
   *
   * `min >= 1` is required: a `min:0` "you may" must still surface its decline, and the driver's own
   * `!canStopNow` guard already refuses anything carrying an `endChoice`.
   */
  /**
   * TA-244: `CHOOSE_NEW_ACTIVE_POKEMON` carries TWO different flows, and this gate used to exclude
   * both by name. The exclusion was written for — and remains correct for — the post-KO REPLACEMENT:
   * both engines surface that decision even at one candidate (measured in TA-240's cells, twinleaf
   * `CHOOSE_NEW_ACTIVE_POKEMON` vs rotomancer `promoteBench`, both pending), so collapsing it would
   * manufacture a NEW divergence rather than close one.
   *
   * But twinleaf also builds the attack-rider SELF-SWITCH on this message — Mega Latias ex `meg-181`
   * *Strafe*, *"You may switch this Pokémon with 1 of your Benched Pokémon"* — and there, answered
   * `confirm:true` with one Benched Pokémon, the switch is forced and rotomancer applies it and moves
   * on. That was the single largest residual noise class after the 2026-08-11 batch (all 8 newly
   * reporting seeds in the post-fix re-fuzz).
   *
   * The two flows are told apart by the BOARD, not the message, and the discriminator was measured on
   * both before it was written: at a post-KO replacement the prompting player's Active slot is EMPTY
   * (the KO'd Pokémon is already gone); at a self-switch it is still OCCUPIED by the Pokémon being
   * switched out. Reading the state is also the only option that stays correct if another card
   * reaches for this message — a message-name allowlist would need editing for each one.
   */
  atomicResolvable: (prompt, state) => {
    if (prompt.message === GameMessage.CHOOSE_NEW_ACTIVE_POKEMON) {
      const promptingPlayer = promptPlayer(state, prompt.playerId);
      if (promptingPlayer.active.getPokemonCard() === undefined) {
        return false; // post-KO replacement — stays surfaced, both engines pend it
      }
      // otherwise: a self-switch with the Active still in place; fall through to the ordinary gates
    }
    if (prompt.options.max === 1) {
      return true;
    }
    const { min } = prompt.options;
    if (min < 1) {
      return false;
    }
    const player = promptPlayer(state, prompt.playerId);
    const candidates = enumerateTargets(
      state, player, prompt.playerType, prompt.slots, prompt.options.blocked);
    return candidates.length <= min;
  },

  next(prompt, picks, ctx, state) {
    if (hasDone(picks)) {
      return null;
    }
    const rp = realPicks(picks);
    const { min, max } = prompt.options;
    if (rp.length >= max) {
      return null;
    }

    const player = promptPlayer(state, prompt.playerId);
    const verb = verbFor(prompt);
    const pickedKeys = new Set(rp.map(p => targetKey((p as { target: CardTarget }).target)));
    const candidates = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blocked)
      .filter(t => !pickedKeys.has(targetKey(t)));

    // Contract: these verbs carry `target` only (the iid is globally unique — owner is
    // redundant, and the action table specs `owner` for `discard` alone).
    // CF-70 Phase 2: the declared operation also rides as `op`. `amount` is NOT emitted here — this
    // prompt never carries the printed count (the card applies it after the pick), and a guessed
    // amount would be compared once the other engine emits one. Bare selections emit nothing (`select`
    // is the default).
    const op = prompt.options.operation === 'placeCounters' ? 'placeCounters'
      : prompt.options.operation === 'dealDamage' ? 'dealDamage' : undefined;
    const legalActions: LegalAction[] = candidates.map(t => (
      { type: verb, target: pokemonTargetToIid(state, player, ctx, t), ...(op ? { op } : {}) }
    ));
    if (rp.length >= min && max > min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
    const expected = verbFor(_prompt);
    if (action.type !== expected) {
      throw new Error(`[conformance] ChoosePokemon expected '${expected}', got '${action.type}'`);
    }
    const targetIid = action.target as string;
    const card = ctx.iidToCard.get(targetIid);
    if (card === undefined) {
      throw new Error(`[conformance] choose target iid '${targetIid}' unknown`);
    }
    const player = promptPlayer(state, _prompt.playerId);
    return { kind: 'target', target: resolveAnyPokemonTarget(state, player, card) };
  },

  assemble(_prompt, picks): CardTarget[] {
    return realPicks(picks).map(p => (p as { target: CardTarget }).target);
  },
};
