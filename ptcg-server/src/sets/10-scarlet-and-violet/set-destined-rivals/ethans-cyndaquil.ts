import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { WAS_ATTACK_USED, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS } from '../../../game/store/prefabs/prefabs';
import { Effect } from '../../../game/store/effects/effect';
import { DISCARD_X_ENERGY_FROM_THIS_POKEMON } from '../../../game/store/prefabs/costs';


export class EthansCyndaquil extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public tags = [CardTag.ETHANS];
  public cardType: CardType = R;
  public hp: number = 70;
  public weakness = [{ type: W }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Ember',
      cost: [R],
      damage: 30,
      text: 'Discard an Energy from this Pokémon.',
    }
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '32';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Ethan\'s Cyndaquil';
  public fullName: string = 'Ethan\'s Cyndaquil DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      // Rulebook step F / compendium #543/#649: apply damage before the discard rider.
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);
      DISCARD_X_ENERGY_FROM_THIS_POKEMON(store, state, effect, 1);
    }
    return state;
  }

}