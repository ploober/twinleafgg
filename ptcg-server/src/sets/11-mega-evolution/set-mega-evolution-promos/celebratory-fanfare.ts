import { PlayerType, State, StateUtils, StoreLike } from '../../../game';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { HealEffect, UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { IS_STADIUM_EFFECT_BLOCKED } from '../../../game/store/prefabs/stadium-effect';
import { GameError } from '../../../game';
import { GameMessage } from '../../../game';

export class CelebratoryFanfare extends TrainerCard {
  protected _trainerType = TrainerType.STADIUM;
  public set = 'MEP';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '28';
  public name = 'Celebratory Fanfare';
  public fullName = 'Celebration Fanfare MEP';
  public text =
    "Once during each player's turn, that player may heal 10 damage from each of their Pokémon. If a player healed any damage in this way, their turn ends.";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const player = effect.player;

      // TA-589: "If a player healed any damage in this way, their turn ends" — and with nothing to heal the use does
      // nothing, so it is refused (which also withholds the offer, B.41).
      const healable: typeof player.active[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
        if (cardList.damage > 0 && !IS_STADIUM_EFFECT_BLOCKED(store, state, player, cardList, this)) {
          healable.push(cardList);
        }
      });
      if (healable.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_STADIUM);
      }
      let healed = 0;
      for (const cardList of healable) {
        const before = cardList.damage;
        store.reduceEffect(state, new HealEffect(player, cardList, 10));
        healed += Math.max(0, before - cardList.damage);
      }
      if (healed > 0) {
        store.reduceEffect(state, new EndTurnEffect(player));
      }
    }

    return state;
  }
}
