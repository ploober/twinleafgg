import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';

export class MarniesScraggy extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.MARNIES];
  public cardType: CardType[] = [D];
  public hp: number = 70;
  public weakness = [{ type: G }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Crunch',
      cost: [D, D, C],
      damage: 50,
      text: "Discard an Energy from your opponent's Active Pokémon.",
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber = '132';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Marnie's Scraggy";
  public fullName: string = "Marnie's Scraggy DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Crunch. TA-655 / B.89 (1), (4): the attacker chooses the opponent's Energy at Step D, before the damage (recorded as
    // `chosen`); the damage reads it still attached (#77) and it is discarded after the damage, before damage reactions
    // and the Knock Out check.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, undefined, 1, true);
    }
    return state;
  }
}
