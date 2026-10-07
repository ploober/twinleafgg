import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';

export class Shieldon extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Antique Armor Fossil';
  public cardType: CardType[] = [M];
  public hp: number = 100;
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Smithereen Smash',
      cost: [M, C],
      damage: 50,
      text: "Discard an Energy from your opponent's Active Pokémon.",
    },
  ];

  public set: string = 'PBL';
  public setNumber: string = '61';
  public regulationMark: string = 'J';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Shieldon';
  public fullName: string = 'Shieldon M5';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Ref: set-ancient-origins/registeel.ts (Forbidden Iron Hammer)
    // Smithereen Smash. TA-655 / B.89 (1), (4): the attacker chooses the opponent's Energy at Step D, before the damage (recorded as
    // `chosen`); the damage reads it still attached (#77) and it is discarded after the damage, before damage reactions
    // and the Knock Out check.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, undefined, 1, true);
    }
    return state;
  }
}
