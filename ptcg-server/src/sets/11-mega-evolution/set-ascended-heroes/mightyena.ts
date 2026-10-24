import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, SWITCH_OUT_OPPONENT_ACTIVE_POKEMON } from '../../../game/store/prefabs/prefabs';

export class Mightyena extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Poochyena';
  public hp: number = 120;
  public cardType: CardType[] = [D];
  public weakness = [{ type: G }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Kick Away',
    cost: [D, C],
    damage: 50,
    text: 'Switch out your opponent\'s Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)'
  },
{
    name: 'Sharp Fang',
    cost: [D, D, C],
    damage: 130,
    text: ''
  }];

  public regulationMark = 'H';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '129';
  public name: string = 'Mightyena';
  public fullName: string = 'Mightyena ASC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Kick Away
    // TA-754: the switch is the attack's effect, after its damage (rulebook step F), so the damage lands on the
    // Defending Pokémon and then it goes to the Bench.
    if (AFTER_ATTACK(effect, 0, this)) {
      return SWITCH_OUT_OPPONENT_ACTIVE_POKEMON(store, state, effect.player, { allowCancel: false });
    }

    return state;
  }
}
