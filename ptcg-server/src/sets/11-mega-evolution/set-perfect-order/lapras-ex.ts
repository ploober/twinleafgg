import { PokemonCard, Stage, CardTag, CardType, StoreLike, State, PlayerType } from '../../../game';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import {
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Laprasex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [W];
  public hp: number = 210;
  public weakness = [{ type: L }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Hydro Turn',
      cost: [W],
      damage: 30,
      damageCalculation: 'x',
      text: 'This attack does 30 damage for each [W] Energy attached to this Pokémon. Switch this Pokémon with 1 of your Benched Pokémon.',
    },
    {
      name: 'Surf',
      cost: [W, W, W],
      damage: 140,
      text: '',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '22';
  public name: string = 'Lapras ex';
  public fullName: string = 'Lapras ex POR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (cardList.getPokemonCard() === this) {
          const checkProvidedEnergy = new CheckProvidedEnergyEffect(player, cardList);
          store.reduceEffect(state, checkProvidedEnergy);

          const waterEnergyCount = checkProvidedEnergy.energyMap.reduce(
            (sum, em) =>
              sum + em.provides.filter((t) => t === CardType.WATER || t === CardType.ANY).length,
            0,
          );

          effect.damage = waterEnergyCount * 30;
        }
      });
      // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }

    return state;
  }
}
