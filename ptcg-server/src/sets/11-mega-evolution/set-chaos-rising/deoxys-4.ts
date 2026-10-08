import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { GameMessage, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { DRAW_CARDS_UNTIL_CARDS_IN_HAND, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { MAY_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Deoxys4 extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [P];
  public hp: number = 100;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [];

  public attacks = [
    {
      name: 'Psyspeed',
      cost: [P],
      damage: 30,
      text: 'You may draw cards until you have 5 cards in your hand.',
    },
  ];

  public regulationMark: string = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '34';
  public name: string = 'Deoxys';
  public fullName: string = 'Deoxys M4 34';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Psyspeed. TA-670 (B.101 (4)): the "you may" is asked at Step D, before the damage; the draw is after it (#649).
    // CF-33: a may that can achieve nothing asks nothing; the condition reads the player's own hand and deck, which the damage
    // does not change.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      if (player.hand.cards.length >= 5 || player.deck.cards.length === 0) {
        return state;
      }
      return MAY_CHOOSE_FIRST(store, state, effect, () => DRAW_CARDS_UNTIL_CARDS_IN_HAND(player, 5), GameMessage.WANT_TO_DRAW_CARDS);
    }
    return state;
  }
}
