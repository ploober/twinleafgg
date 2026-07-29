import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { CardTarget } from '../../game/store/actions/play-card-action';
import { GameMessage } from '../../game/game-message';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget } from '../iid-targets';

/**
 * ChoosePokemonPrompt: one pick = one CardTarget; raw result = CardTarget[]. The post-KO "choose a
 * new Active" variant (`GameMessage.CHOOSE_NEW_ACTIVE_POKEMON`) surfaces as the contract `promoteBench`
 * action; every other use is a generic in-effect `choose`.
 */
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
  atomicResolvable: (prompt) =>
    prompt.options.max === 1 && prompt.message !== GameMessage.CHOOSE_NEW_ACTIVE_POKEMON,

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
    const isPromote = prompt.message === GameMessage.CHOOSE_NEW_ACTIVE_POKEMON;
    const pickedKeys = new Set(rp.map(p => targetKey((p as { target: CardTarget }).target)));
    const candidates = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blocked)
      .filter(t => !pickedKeys.has(targetKey(t)));

    const legalActions: LegalAction[] = candidates.map(t => {
      const target = pokemonTargetToIid(state, player, ctx, t);
      // Contract: a `choose` carries `target` only (the iid is globally unique — owner is
      // redundant, and the action table specs `owner` for `discard` alone).
      return isPromote
        ? { type: 'promoteBench', target }
        : { type: 'choose', target };
    });
    if (rp.length >= min && max > min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
    if (action.type !== 'choose' && action.type !== 'promoteBench') {
      throw new Error(`[conformance] ChoosePokemon expected 'choose'/'promoteBench', got '${action.type}'`);
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
