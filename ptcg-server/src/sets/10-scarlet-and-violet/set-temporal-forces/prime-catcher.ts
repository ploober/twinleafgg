import { Player, PokemonCardList } from '../../../game';
import { GameMessage } from '../../../game/game-message';
import { PlayerType, SlotType } from '../../../game/store/actions/play-card-action';
import { CardTag, TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect, TrainerTargetEffect } from '../../../game/store/effects/play-card-effects';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { StateUtils } from '../../../game/store/state-utils';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  const benchCount = opponent.bench.reduce((sum, b) => {
    return sum + (b.cards.length > 0 ? 1 : 0);
  }, 0);

  if (benchCount > 0) {

    return store.prompt(state, new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_SWITCH,
      PlayerType.TOP_PLAYER,
      [SlotType.BENCH],
      { allowCancel: false }
    ), targets => {
      if (!targets || targets.length === 0) {
        return;
      }

      // TA-175: announce the target so protection Abilities can refuse it (e.g. Cetitan ex's
      // "Snow Camouflage", #2154). A refused switch-in means the "If you do" consequent below
      // does not happen at all — #1979: "if you don't place any damage counters, you don't
      // shuffle the Energy into your deck."
      const targetCard = new TrainerTargetEffect(player, effect.trainerCard, targets[0]);
      targetCard.target = targets[0];
      store.reduceEffect(state, targetCard);
      if (!targetCard.target) {
        return state;
      }

      opponent.active.clearEffects();
      opponent.switchPokemon(targetCard.target);
      next();

      const hasBench = player.bench.some(b => b.cards.length > 0);

      if (!hasBench) {

        return state;
      }

      let target: PokemonCardList[] = [];
      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_SWITCH,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { allowCancel: false }
      ), results => {
        target = results || [];
        next();

        if (target.length === 0) {
          return state;
        }

        // Discard trainer only when user selected a Pokemon
        player.active.clearEffects();
        player.switchPokemon(target[0]);

        return state;
      });
    });
  }
}

export class PrimeCatcher extends TrainerCard {

  protected _trainerType: TrainerType = TrainerType.ITEM;

  protected _tags = [CardTag.ACE_SPEC];

  public regulationMark = 'H';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '157';

  public set: string = 'TEF';

  public name: string = 'Prime Catcher';

  public fullName: string = 'Prime Catcher TEF';

  public text: string =
    'Switch in 1 of your opponent\'s Benched Pokémon to the Active Spot. If you do, switch your Active Pokémon with 1 of your Benched Pokémon.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    const opponent = StateUtils.getOpponent(state, player);
    if (!opponent.bench.some(b => b.cards.length > 0)) {
      return false;
    }
    return true;
  }


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}
