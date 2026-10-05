import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DISCARD_X_ENERGY_FROM_THIS_POKEMON } from '../../../game/store/prefabs/costs';

export class Monferno extends PokemonCard {

  public stage: Stage = Stage.STAGE_1;

  public evolvesFrom: string = 'Chimchar';

  public regulationMark: string = 'H';

  public cardType: CardType[] = [CardType.FIRE];

  public hp: number = 90;

  public weakness = [{ type: CardType.WATER }];

  public retreat = [CardType.COLORLESS];

  public attacks = [{
    name: 'Chop',
    cost: [CardType.FIRE, CardType.COLORLESS],
    damage: 40,
    text: ''
  },
  {
    name: 'Heat Blow',
    cost: [CardType.FIRE, CardType.FIRE, CardType.COLORLESS],
    damage: 80,
    text: 'Discard an Energy from this Pokémon.'
  }
  ];

  public set: string = 'TWM';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '32';

  public name: string = 'Monferno';

  public fullName: string = 'Monferno TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Heat Blow (index 1) — "Discard an Energy from this Pokémon." Chop (index 0) is a vanilla 40
    // with no rider; the discard was wrongly wired to index 0.
    if (WAS_ATTACK_USED(effect, 1, this)) {
      // B.82 (#1834, #2002): the choice is made before the damage; the chosen Energy moves after it (afterDamageMoves).
      DISCARD_X_ENERGY_FROM_THIS_POKEMON(store, state, effect, 1);
    }
    return state;
  }
}