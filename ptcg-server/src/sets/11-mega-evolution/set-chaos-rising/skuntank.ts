import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StoreLike, State } from '../../../game';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Skuntank extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Stunky';
  public hp: number = 110;
  public cardType: CardType[] = [D];
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Rear Kick',
      cost: [D],
      damage: 40,
      text: '',
    },
    {
      name: 'Smash Turn',
      cost: [D, D, C],
      damage: 100,
      text: 'Switch this Pokémon with 1 of your Benched Pokémon.',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '54';
  public name: string = 'Skuntank';
  public fullName: string = 'Skuntank M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 1, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }
    return state;
  }
}
