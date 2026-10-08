import { CardTag, CardType, Stage } from '../../../game/store/card/card-types';
import {
  PokemonCard,
  State,
  StateUtils,
  StoreLike,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Flygonex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;

  public evolvesFrom = 'Vibrava';

  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];

  public regulationMark = 'H';

  public cardType: CardType[] = [CardType.FIGHTING];

  public hp: number = 310;

  public weakness = [{ type: CardType.GRASS }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Reversing Storm',
      cost: [CardType.FIGHTING],
      damage: 130,
      text: 'You may switch this Pokémon with a Pokémon on your Bench.',
    },
    {
      name: 'Sonic Peridot',
      cost: [CardType.WATER, CardType.FIGHTING, CardType.METAL],
      damage: 0,
      text: "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness or Resistance for this damage.)",
    },
  ];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '106';

  public name: string = 'Flygon ex';

  public fullName: string = 'Flygon ex SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Reversing Storm. TA-672 (B.101 (3)): the "you may" and the new Active are chosen at Step D, before the damage;
    // the switch is after it (#352). It had waited for the end of the turn, past the Knock Out check.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, { may: true });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const targetTags = [
        CardTag.POKEMON_V,
        CardTag.POKEMON_VSTAR,
        CardTag.POKEMON_VMAX,
        CardTag.POKEMON_ex,
      ];

      const damageTargets = [opponent.active, ...opponent.bench].filter((pokemon) => {
        const card = pokemon.getPokemonCard();
        return card && targetTags.some((tag) => card.hasTag(tag));
      });

      damageTargets.forEach((target) => {
        const damageEffect = new PutDamageEffect(effect, 100);
        damageEffect.target = target;
        effect.ignoreWeakness = true;
        effect.ignoreResistance = true;
        store.reduceEffect(state, damageEffect);
      });

      return state;
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.cards.includes(this) &&
      effect.target.getPokemonCard() === this
    ) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Target is not Active
      if (effect.target === player.active || effect.target === opponent.active) {
        return state;
      }

      effect.preventDefault = true;
    }
    return state;
  }
}
