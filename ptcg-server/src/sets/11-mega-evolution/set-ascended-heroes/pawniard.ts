import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, SWITCH_OUT_OPPONENT_ACTIVE_POKEMON } from '../../../game/store/prefabs/prefabs';

export class Pawniard extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 70;
  public cardType: CardType[] = [M];
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C];

  public attacks = [{
    name: 'Push Down',
    cost: [M],
    damage: 10,
    text: 'Switch out your opponent\'s Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)'
  }];

  public regulationMark = 'I';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '146';
  public name: string = 'Pawniard';
  public fullName: string = 'Pawniard ASC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Push Down
    // TA-754: the switch is the attack's effect, after its damage (rulebook step F), so the damage lands on the
    // Defending Pokémon and then it goes to the Bench.
    if (AFTER_ATTACK(effect, 0, this)) {
      return SWITCH_OUT_OPPONENT_ACTIVE_POKEMON(store, state, effect.player, { allowCancel: false });
    }

    return state;
  }
}
