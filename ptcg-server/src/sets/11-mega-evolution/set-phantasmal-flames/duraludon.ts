import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Duraludon extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 130;
  public cardType: CardType[] = [M];
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Hyper Beam',
    cost: [M, M, M],
    damage: 70,
    text: 'Discard an Energy from your opponent\'s Active Pokémon.'
  }];

  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '74';
  public name: string = 'Duraludon';
  public fullName: string = 'Duraludon PFL';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Hyper Beam. TA-655 / B.89 (1), (4): the attacker chooses the opponent's Energy at Step D, before the damage (recorded as
    // `chosen`); the damage reads it still attached (#77) and it is discarded after the damage, before damage reactions
    // and the Knock Out check.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, undefined, 1, true);
    }

    return state;
  }
}
