import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { WAS_ATTACK_USED, MULTIPLE_COIN_FLIPS_PROMPT } from '../../../game/store/prefabs/prefabs';
import { MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Toedscruel extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public cardType: CardType[] = [G];
  public hp: number = 120;
  public weakness = [{ type: R }];
  public retreat = [C, C];
  public evolvesFrom = 'Toedscool';

  public attacks = [{
    name: 'Eerie Tentacles',
    cost: [G],
    damage: 30,
    text: ' You may move an Energy from your opponent\'s Active Pokémon to 1 of their Benched Pokémon.'
  }, {
    name: 'Triple Smash',
    cost: [G, C, C],
    damage: 80,
    damageCalculation: 'x',
    text: ' Flip 3 coins. This attack does 80 damage for each heads. '
  }];

  public set: string = 'SVI';

  public regulationMark = 'G';

  public cardImage: string = 'assets/cardback.png';
  public fullName: string = 'Toedscruel SVI';
  public name: string = 'Toedscruel';
  public setNumber: string = '26';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Eerie Tentacles. TA-655 / TA-652 / B.89 (1), (4): the "you may" is a standalone confirm (CF-32: a count-1 may has
    // no inherent zero; it was folded into the move menu as a decline), then the Energy and its Benched destination, all
    // Step-D choices asked before the damage (the Energy recorded as `chosen`); the damage reads the Energy still attached
    // and it moves after the damage. No Energy or no Bench: nothing is asked (CF-33).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST(store, state, effect, this);
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      state = MULTIPLE_COIN_FLIPS_PROMPT(store, state, player, 3, results => {
        let heads: number = 0;
        results.forEach(r => { heads += r ? 1 : 0; });
        effect.damage = 80 * heads;
      });
      return state;
    }

    return state;
  }

}