import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardTag, Stage, CardType } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import {
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class MegaZeraoraex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_SV_MEGA, CardTag.POKEMON_ex];
  public hp: number = 270;
  public cardType: CardType[] = [L];
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Thunderous Fist',
      cost: [L],
      damage: 60,
      damageCalculation: 'x',
      text: 'This attack does 60 damage for each [L] Energy attached to this Pokémon.',
    },
    {
      name: 'Zepto Turn',
      cost: [L, L, L],
      damage: 150,
      text: 'Switch this Pokémon with 1 of your Benched Pokémon.',
    },
  ];

  public set: string = 'PBL';
  public setNumber: string = '27';
  public regulationMark: string = 'J';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Mega Zeraora ex';
  public fullName: string = 'Mega Zeraora ex M5';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const check = new CheckProvidedEnergyEffect(player);
      store.reduceEffect(state, check);
      let n = 0;
      check.energyMap.forEach((em) => {
        n += em.provides.filter(
          (t) => t === CardType.LIGHTNING || t === CardType.ANY,
        ).length;
      });
      effect.damage = 60 * n;
    }
    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 1, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }
    return state;
  }
}
