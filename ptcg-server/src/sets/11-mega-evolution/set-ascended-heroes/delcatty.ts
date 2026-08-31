import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import {
  StoreLike, State,
  PlayerType, StateUtils
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';

export class Delcatty extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Skitty';
  public cardType: CardType[] = [C];
  public hp: number = 100;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Cat Kick',
    cost: [C],
    damage: 40,
    text: ''
  }, {
    name: 'Energy Crush',
    cost: [C, C],
    damage: 40,
    damageCalculation: 'x',
    text: 'This attack does 40 damage for each Energy attached to all of your opponent\'s Pokémon.'
  }];

  public regulationMark = 'J';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '166';
  public name: string = 'Delcatty';
  public fullName: string = 'Delcatty ASC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // "40 damage for each Energy attached to all of your OPPONENT's Pokémon." Pre-fix this counted
      // the attacker's own Energy (TA-139 wrong-perspective) — iterate the opponent's Pokémon.
      let energies = 0;
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
        const checkProvidedEnergyEffect = new CheckProvidedEnergyEffect(opponent, cardList);
        store.reduceEffect(state, checkProvidedEnergyEffect);
        checkProvidedEnergyEffect.energyMap.forEach(energy => {
          energies += energy.provides.length;
        });
      });

      effect.damage = energies * 40;
    }

    return state;
  }

}
