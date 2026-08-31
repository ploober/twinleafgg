import { CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { HEAL_X_DAMAGE_FROM_THIS_POKEMON } from '../../../game/store/prefabs/prefabs';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

export class Petilil extends PokemonCard {
  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.WATER];

  public hp: number = 80;

  public weakness = [{ type: CardType.GRASS }];

  public resistance = [{
    type: CardType.WATER,
    value: -20
  }];

  public retreat = [C, C];

  public attacks = [{
    name: 'Ram',
    cost: [CardType.GRASS],
    damage: 10,
    text: ''
  }, {
    name: 'Absorb',
    cost: [CardType.GRASS, CardType.COLORLESS],
    damage: 10,
    text: 'Heal 10 damage from this Pokémon.'
  }];

  public set: string = 'NVI';
  public setNumber: string = '4';
  public name: string = 'Petilil';
  public fullName: string = 'Petilil NVI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      HEAL_X_DAMAGE_FROM_THIS_POKEMON(effect, store, state, 10);
    }

    return state;
  }
}
