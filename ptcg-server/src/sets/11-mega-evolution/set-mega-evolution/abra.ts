import { State, StoreLike } from '../../../game';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Abra extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [P];
  public hp: number = 50;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [{
    name: 'Teleportation Attack',
    cost: [P],
    damage: 10,
    text: 'Switch this Pokémon with 1 of your Benched Pokémon.'
  }];

  public set: string = 'MEG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '54';
  public name: string = 'Abra';
  public fullName: string = 'Abra M1S';
  public regulationMark = 'I';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }

    return state;
  }
} 