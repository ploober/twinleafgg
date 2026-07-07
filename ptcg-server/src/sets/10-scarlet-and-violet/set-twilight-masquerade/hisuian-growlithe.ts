import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class HisuianGrowlithe extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = F;
  public hp: number = 80;
  public weakness = [{ type: G }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Blazing Destruction',
      cost: [],
      damage: 0,
      text: 'Discard a Stadium in play.'
    },
    {
      name: 'Take Down',
      cost: [F, C],
      damage: 40,
      text: 'This Pokémon also does 10 damage to itself.'
    }
  ];

  public set: string = 'TWM';
  public name: string = 'Hisuian Growlithe';
  public fullName: string = 'Hisuian Growlithe TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '99';
  public regulationMark = 'H';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      // "Discard a Stadium in play." With no Stadium there is nothing to discard, but the attack is
      // still legal to use — it just does nothing (compendium #361: an attack is usable even when
      // its effect can't be carried out). Do not reject it.
      const stadiumCard = StateUtils.getStadiumCard(state);
      if (stadiumCard) {
        const cardList = StateUtils.findCardList(state, stadiumCard);
        const player = StateUtils.findOwner(state, cardList);
        cardList.moveTo(player.discard);
      }
      return state;
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const dealDamage = new DealDamageEffect(effect, 10);
      dealDamage.target = player.active;
      return store.reduceEffect(state, dealDamage);
    }
    return state;
  }
}