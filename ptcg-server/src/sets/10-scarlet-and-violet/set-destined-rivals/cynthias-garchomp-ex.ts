import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, Card, GameMessage } from '../../../game';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';

import { DRAW_CARDS_UNTIL_YOU_HAVE_X_CARDS_IN_HAND, MAY_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class CynthiasGarchompex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = "Cynthia's Gabite";
  protected _tags = [CardTag.CYNTHIAS, CardTag.POKEMON_ex];
  public cardType: CardType[] = [F];
  public hp: number = 330;
  public weakness = [{ type: G }];
  public retreat = [];

  public attacks = [
    {
      name: 'Corkscrew Dive',
      cost: [F],
      damage: 100,
      text: 'You may draw cards until you have 6 cards in your hand.',
    },
    {
      name: 'Draconic Buster',
      cost: [F, F],
      damage: 260,
      text: 'Discard all Energy from this Pokémon.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '104';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Cynthia's Garchomp ex";
  public fullName: string = "Cynthia's Garchomp ex DRI";
  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Corkscrew Dive. TA-670 (B.101 (4)): the "you may" is asked at Step D, before the damage; the draw is after it
    // (#649). It had been keyed on AFTER_ATTACK (TA-128). CF-33: a may that can achieve nothing asks nothing; the condition reads the player's own hand and deck, which the damage
    // does not change.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      if (player.hand.cards.length >= 6 || player.deck.cards.length === 0) {
        return state;
      }
      return MAY_CHOOSE_FIRST(store, state, effect, () => {
        DRAW_CARDS_UNTIL_YOU_HAVE_X_CARDS_IN_HAND(6, effect, state);
      }, GameMessage.WANT_TO_DRAW_UNTIL_6);
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // TA-613 (B.76, #2031): no card is chosen, so the discard is applied after the damage.
      effect.afterDamageMoves.push(() => {
        const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
        state = store.reduceEffect(state, checkProvidedEnergy);

        const cards: Card[] = checkProvidedEnergy.energyMap.map((e) => e.card);
        const discardEnergy = new DiscardCardsEffect(effect, cards);
        discardEnergy.target = player.active;
        store.reduceEffect(state, discardEnergy);
      });
    }

    return state;
  }
}
