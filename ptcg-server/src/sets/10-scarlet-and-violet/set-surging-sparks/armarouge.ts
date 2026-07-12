import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, EnergyCard, StateUtils, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DiscardCardsEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';

export class Armarouge extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Charcadet';
  public cardType: CardType = R;
  public hp: number = 140;
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Combustion',
      cost: [C, C],
      damage: 50,
      text: ''
    },
    {
      name: 'Crimson Blaster',
      cost: [R, R, C],
      damage: 0,
      text: 'Discard all [R] Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent\'s Benched Pokémon. (Don\'t apply Weakness and Resistance for Benched Pokémon.)'
    },
  ];

  public set: string = 'SSP';
  public regulationMark: string = 'H';
  public setNumber: string = '34';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Armarouge';
  public fullName: string = 'Armarouge SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // "180 damage to 1 of your opponent's Benched Pokémon" targets the Bench only. With no Benched
      // Pokémon the attack does nothing (compendium #2050) — no discard, no damage. (Previously an
      // any-target prefab hit the lone Active for 180 → 360 via Weakness, an illegitimate KO.)
      const benched = opponent.bench.filter(b => b.cards.length > 0);
      if (benched.length === 0) {
        return state;
      }

      const fireEnergy = player.active.cards.filter(card =>
        card instanceof EnergyCard && card.name === 'Fire Energy'
      );
      const discardEnergy = new DiscardCardsEffect(effect, fireEnergy);
      discardEnergy.target = player.active;
      store.reduceEffect(state, discardEnergy);

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { allowCancel: false }
      ), selected => {
        const target = selected[0];
        // Benched damage: no Weakness/Resistance.
        const damageEffect = new PutDamageEffect(effect, 180);
        damageEffect.target = target;
        store.reduceEffect(state, damageEffect);
      });
    }

    return state;
  }

}
