import {
  CardTag,
  CardType,
  PokemonCard,
  Stage,
  PowerType,
  State,
  StateUtils,
  StoreLike,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';

import {IS_ABILITY_BLOCKED, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class MegaHawluchaex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_SV_MEGA, CardTag.POKEMON_ex];
  public cardType: CardType[] = [F];
  public hp: number = 250;
  public weakness = [{ type: P }];
  public resistance = [];
  public retreat = [C];

  public powers = [
    {
      name: 'Tenacious Body',
      powerType: PowerType.ABILITY,
      text: 'If this Pokémon would be Knocked Out by damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining HP becomes 10.',
    },
  ];

  public attacks = [
    {
      name: 'Somersault Dive',
      cost: [F, F, C],
      damage: 120,
      damageCalculation: '+',
      text: 'If a Stadium is in play, this attack does 140 more damage. Then, discard that Stadium.',
    },
  ];

  public regulationMark: string = 'I';

  public set: string = 'ASC';
  public setNumber: string = '116';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Mega Hawlucha ex';
  public fullName: string = 'Mega Hawlucha ex M2a';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-808: the damage reducer waits for this coin before applying damage. A prompt
    // raised here would let the reducer apply lethal damage before its answer arrived.
    if (effect instanceof PutDamageEffect && effect.target.getPokemonCard() === this) {
      const owner = StateUtils.findOwner(state, effect.target);
      if (!IS_ABILITY_BLOCKED(store, state, owner, this)) {
        effect.surviveOnTenHPCoinFlipReason = this.powers[0].name;
      }
    }

    // Somersault Dive attack
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const stadiumCard = StateUtils.getStadiumCard(state);

      if (stadiumCard !== undefined) {
        // Add 140 damage if Stadium is in play
        effect.damage += 140;

        // Discard the Stadium
        const cardList = StateUtils.findCardList(state, stadiumCard);
        const stadiumOwner = StateUtils.findOwner(state, cardList);
        MOVE_CARDS(store, state, cardList, stadiumOwner.discard, { sourceCard: this });
      }
    }

    return state;
  }
}
