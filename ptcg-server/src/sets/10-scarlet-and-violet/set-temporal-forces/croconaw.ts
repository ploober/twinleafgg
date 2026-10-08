import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Croconaw extends PokemonCard {

  public stage: Stage = Stage.STAGE_1;

  public evolvesFrom = 'Totodile';

  public cardType: CardType[] = [W];

  public hp: number = 90;

  public weakness = [{ type: L }];

  public retreat = [C, C];

  public attacks = [{
    name: 'Reverse Thrust',
    cost: [W],
    damage: 30,
    text: 'Switch this Pokémon with 1 of your Benched Pokémon.'
  }];

  public set: string = 'TEF';

  public regulationMark = 'H';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '40';

  public name: string = 'Croconaw';

  public fullName: string = 'Croconaw TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }
    return state;
  }
}
