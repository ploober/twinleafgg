import { PlayerType, State, StateUtils, StoreLike } from '../../../game';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { HealEffect, UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { IS_STADIUM_EFFECT_BLOCKED } from '../../../game/store/prefabs/stadium-effect';

export class CelebrationFanfare extends TrainerCard {
  public trainerType = TrainerType.STADIUM;
  // TA-256: this card is canonically mep-028 "Celebratory Fanfare" (Mega Evolution Promos), not
  // svp-174 — that printing id belongs to Eevee ex, which rotomancer implements. The mislabel put a
  // Stadium and a Pokemon behind the same id, so every svp-174 differential cell was vacuous by
  // construction. fullName is the immutable identity key and stays as-is; set/number/name are data.
  public set = 'MEP';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '28';
  public name = 'Celebratory Fanfare';
  public fullName = 'Celebration Fanfare SVP';
  public text = 'Once during each player\'s turn, that player may heal 10 damage from each of their Pokémon. If they do, that player\'s turn ends.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const player = effect.player;

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
        if (IS_STADIUM_EFFECT_BLOCKED(store, state, player, cardList, this)) {
          return;
        }
        store.reduceEffect(state, new HealEffect(player, cardList, 10));
      });

      store.reduceEffect(state, new EndTurnEffect(player));
    }

    return state;
  }
}
