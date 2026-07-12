import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DealDamageEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';

export class Electivireex extends PokemonCard {
  public tags = [CardTag.POKEMON_ex];
  public regulationMark = 'I';
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Electabuzz';
  public cardType: CardType = L;
  public hp: number = 280;
  public weakness = [{ type: F }];
  public retreat = [C, C, C, C];

  public attacks = [
    {
      name: 'Dual Bolt',
      cost: [L, C],
      damage: 0,
      text: 'This attack does 50 damage to 2 of your opponent\'s Pokémon. (Don\'t apply Weakness and Resistance for Benched Pokémon.)'
    },
    {
      name: 'High-Voltage Press',
      cost: [L, L, C],
      damage: 180,
      damageCalculation: '+',
      text: 'If this Pokémon has at least 2 extra Energy attached (in addition to this attack\'s cost), this attack does 100 more damage.'
    },
  ];

  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '69';
  public name: string = 'Electivire ex';
  public fullName: string = 'Electivire ex DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Dual Bolt — "50 damage to 2 of your opponent's Pokémon." The Active is a legal target; do as
    // much as you can when the opponent has fewer than 2 Pokémon. Weakness/Resistance apply to the
    // Active (DealDamageEffect) but NOT to Benched targets (PutDamageEffect).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const count = Math.min(2, opponent.getPokemonInPlay().length);
      if (count === 0) {
        return state;
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        { min: count, max: count, allowCancel: false }
      ), selected => {
        (selected || []).forEach(target => {
          if (target === opponent.active) {
            const damageEffect = new DealDamageEffect(effect, 50);
            damageEffect.target = target;
            store.reduceEffect(state, damageEffect);
          } else {
            const damageEffect = new PutDamageEffect(effect, 50);
            damageEffect.target = target;
            store.reduceEffect(state, damageEffect);
          }
        });
      });
    }

    // High Voltage Press
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      const extraEffectCost: CardType[] = [L, L, C, C, C];
      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      store.reduceEffect(state, checkProvidedEnergy);
      const meetsExtraEffectCost = StateUtils.checkEnoughEnergy(checkProvidedEnergy.energyMap, extraEffectCost);

      if (meetsExtraEffectCost) { effect.damage += 100; }
    }

    return state;
  }
}