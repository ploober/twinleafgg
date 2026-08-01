import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED } from '../../../game/store/prefabs/attack-effects';
import { PokemonCard, Stage, CardType, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Skorupi extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = D;
  public hp: number = 80;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Poison Jab',
    cost: [D, D],
    damage: 20,
    text: 'Your opponent\'s Active Pokémon is now Poisoned.'
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '51';
  public name: string = 'Skorupi';
  public fullName: string = 'Skorupi M3';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Poison Jab - poison opponent's Active Pokemon
    if (WAS_ATTACK_USED(effect, 0, this)) {
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED(store, state, effect);
    }

    return state;
  }
}
