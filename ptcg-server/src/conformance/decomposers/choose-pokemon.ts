import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { PlayerType, CardTarget } from '../../game/store/actions/play-card-action';
import { StateUtils } from '../../game/store/state-utils';
import { LegalAction } from '../neutral-types';
import { PromptDecomposer, realPicks, hasDone, buildPending, END_CHOICE, enumerateTargets, targetKey } from './decomposer';
import { promptPlayer, pokemonTargetToIid, resolveAnyPokemonTarget, playerIdToActor } from '../iid-targets';

/** ChoosePokemonPrompt: one pick = one CardTarget; raw result = CardTarget[]. */
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
    const opponent = StateUtils.getOpponent(state, player);
    const pickedKeys = new Set(rp.map(p => targetKey((p as { target: CardTarget }).target)));
    const candidates = enumerateTargets(state, player, prompt.playerType, prompt.slots, prompt.options.blocked)
      .filter(t => !pickedKeys.has(targetKey(t)));

    const legalActions: LegalAction[] = candidates.map(t => ({
      type: 'choose',
      target: pokemonTargetToIid(state, player, ctx, t),
      owner: playerIdToActor(state, t.player === PlayerType.BOTTOM_PLAYER ? player.id : opponent.id),
    }));
    if (rp.length >= min && max > min) {
      legalActions.push(END_CHOICE);
    }
    if (legalActions.length === 0) {
      return null;
    }
    return buildPending(prompt, state, legalActions);
  },

  toPick(_prompt, action, ctx, state) {
    if (action.type === 'endChoice') {
      return { kind: 'done' };
    }
    if (action.type !== 'choose') {
      throw new Error(`[conformance] ChoosePokemon expected 'choose', got '${action.type}'`);
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
