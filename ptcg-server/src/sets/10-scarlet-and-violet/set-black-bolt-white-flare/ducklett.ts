import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Ducklett extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [W];
  public hp: number = 70;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [{
    name: 'Firefighting',
    cost: [C],
    damage: 0,
    text: 'Discard a [R] Energy from your opponent\'s Active Pokémon.'
  },
  {
    name: 'Wing Attack',
    cost: [C, C],
    damage: 20,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'WHT';
  public name: string = 'Ducklett';
  public fullName: string = 'Ducklett SV11W';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '25';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Firefighting. TA-661 / B.89 (5): "Discard a [R] Energy from your opponent's Active Pokémon." The pick is made first
    // (recorded `chosen` among two or more, B.93; one [R] Energy is applied with no pending, CF-14) and discarded after.
    // It read every Energy on the opponent's side (CheckProvidedEnergyEffect(opponent)); the text names the Active.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, [CardType.FIRE], 1, true);
    }
    return state;
  }
}