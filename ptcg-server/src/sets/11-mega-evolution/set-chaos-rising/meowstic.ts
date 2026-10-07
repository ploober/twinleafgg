import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StoreLike, State } from '../../../game';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Meowstic extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Espurr';
  public hp: number = 100;
  public cardType: CardType[] = [P];
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Tricky Steps',
      cost: [P, C],
      damage: 80,
      text: "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon. ",
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '37';
  public name: string = 'Meowstic';
  public fullName: string = 'Meowstic M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Tricky Steps. TA-655 / B.89 (1), (4): the "you may" (CF-32: a standalone confirm), the Energy and its Benched
    // destination are Step-D choices, asked before the damage (the Energy recorded as `chosen`); the damage reads the
    // Energy still attached and it moves after the damage. No Energy or no Bench: nothing is asked (CF-33).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST(store, state, effect, this);
    }
    return state;
  }
}
