import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';
import { IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class CynthiasRoserade extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = "Cynthia's Roselia";
  protected _tags = [CardTag.CYNTHIAS];
  public cardType: CardType[] = [G];
  public hp: number = 130;
  public weakness = [{ type: R }];
  public retreat = [C];

  public powers = [{
    name: 'Cheer On to Glory',
    powerType: PowerType.ABILITY,
    // TA-194 data: was "Attacks from your Cynthia's Pokemon deal 30 more damage..." -- it DROPPED the
    // "(before applying Weakness and Resistance)" clause. Restored from the unanimous authoritative
    // record. Behaviour was already CORRECT and is unchanged: measured (80+30)x2=220 into Grass-weak
    // Regirock ex asc-107 on BOTH engines, i.e. the +30 already lands before Weakness.
    text: 'Attacks used by your Cynthia\'s Pokémon do 30 more damage to your opponent\'s Active Pokémon (before applying Weakness and Resistance).'
  }];

  public attacks = [
    {
      name: 'Leaf Step',
      cost: [G, C, C],
      damage: 80,
      text: '',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '8';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Cynthia's Roserade";
  public fullName: string = "Cynthia's Roserade DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof DealDamageEffect && StateUtils.isPokemonInPlay(effect.player, this)) {
      const player = effect.player;
      const attackingCard = effect.source.getPokemonCard();

      IS_ABILITY_BLOCKED(store, state, player, this);

      if (attackingCard !== undefined && attackingCard.hasTag(CardTag.CYNTHIAS)) {
        effect.damage += 30;
      }
    }
    return state;
  }
}
