import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { HEAL_X_DAMAGE_FROM_THIS_POKEMON } from '../../../game/store/prefabs/attack-effects';
import { HAS_EXTRA_ENERGY_BEYOND_ATTACK_COST, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Tangrowth extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Tangela';
  public hp: number = 150;
  public cardType: CardType[] = [G];
  public weakness = [{ type: R }];
  public retreat = [C, C, C, C];

  public attacks = [{
    name: 'Absorb',
    cost: [G, C],
    damage: 30,
    text: 'Heal 30 damage from this Pokémon.'
  },
  {
    name: 'Pumped-Up Whip',
    cost: [G, G, C, C],
    damage: 120,
    damageCalculation: '+',
    text: 'If this Pokémon has at least 2 extra Energy attached (in addition to this attack\'s cost), this attack does 140 more damage.'
  }];

  public regulationMark = 'I';
  public set: string = 'MEG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '7';
  public name: string = 'Tangrowth';
  public fullName: string = 'Tangrowth MEG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Absorb
    if (WAS_ATTACK_USED(effect, 0, this)) {
      HEAL_X_DAMAGE_FROM_THIS_POKEMON(30, effect, store, state);
    }

    // Pumped-Up Whip
    if (WAS_ATTACK_USED(effect, 1, this)) {
      // TA-523: the extra Energy is counted beyond THIS attack's cost (GGCC), and the bonus is the printed 140.
      if (HAS_EXTRA_ENERGY_BEYOND_ATTACK_COST(store, state, effect.player, this.attacks[1], 2)) {
        effect.damage += 140;
      }
    }

    return state;
  }
}
