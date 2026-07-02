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
