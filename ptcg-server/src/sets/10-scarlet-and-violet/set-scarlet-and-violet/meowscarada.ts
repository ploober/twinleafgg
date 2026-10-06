import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { StoreLike, State } from '../../../game';
import { AFTER_ATTACK } from '../../../game/store/prefabs/prefabs';
import { PUT_ENERGY_FROM_OPPONENTS_ACTIVE_INTO_THEIR_HAND } from '../../../game/store/prefabs/attack-effects';

export class Meowscarada extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Floragato';
  public cardType: CardType[] = [G];
  public hp: number = 160;
  public weakness = [{ type: R }];
  public retreat = [C];

  public attacks = [{
    name: 'Trick Cape',
    cost: [C],
    damage: 40,
    text: 'You may put an Energy attached to your opponent\'s Active Pokémon into their hand.'
  },
  {
    name: 'Flower Blast',
    cost: [G, C],
    damage: 130,
    text: ''
  }];

  public regulationMark: string = 'G';
  public set: string = 'SVI';
  public setNumber: string = '15';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Meowscarada';
  public fullName: string = 'Meowscarada SVI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-645 / B.85 (3)(a): the "you may", the pick and the move to the hand come after the damage (AfterAttackEffect),
    // so the damage reads the Energy attached (#77) and the picked Energy moves at the pick.
    if (AFTER_ATTACK(effect, 0, this)) {
      return PUT_ENERGY_FROM_OPPONENTS_ACTIVE_INTO_THEIR_HAND(store, state, effect);
    }
    return state;
  }
}
