import { GameError, GameMessage, PlayerType, State, StateUtils, StoreLike } from '../../../game';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { HealEffect, UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { IS_STADIUM_EFFECT_BLOCKED } from '../../../game/store/prefabs/stadium-effect';

export class CommunityCenter extends TrainerCard {
  protected _trainerType = TrainerType.STADIUM;
  public set = 'TWM';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '146';
  public name = 'Community Center';
  public fullName = 'Community Center TWM';
  public text =
    "Once during each player's turn, if that player has already played a Supporter from their hand, they may heal 10 damage from each of their Pokémon.";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const player = effect.player;

      if (player.supporterTurn === 0) {
        throw new GameError(GameMessage.CANNOT_USE_STADIUM);
      }

      // TA-791 (B.31, Advanced Rulebook I.B-04): a Stadium can't be used if its actions would not change the game
      // state, so with none of the player's Pokémon damaged the use is refused (and not offered), as for
      // Celebratory Fanfare (TA-589).
      const healable: typeof player.active[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        if (cardList.damage > 0 && !IS_STADIUM_EFFECT_BLOCKED(store, state, player, cardList, this)) {
          healable.push(cardList);
        }
      });
      if (healable.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_STADIUM);
      }

      for (const cardList of healable) {
        store.reduceEffect(state, new HealEffect(player, cardList, 10));
      }
    }

    return state;
  }
}
