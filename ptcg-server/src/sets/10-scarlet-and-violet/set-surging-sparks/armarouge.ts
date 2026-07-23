import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, EnergyCard, StateUtils, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType, PokemonCardList } from '../../../game';
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

      // Compendium #2050 (SSP FAQ, TPCi 2024-11-07): the Fire-Energy discard is UNCONDITIONAL — you
      // discard all Fire Energy even when the opponent has no Benched Pokémon. Only the 180 bench
      // damage is contingent on a Bench target, and it never redirects to the Active.
      //
      // CF-10 (=> TA-39 Thunder Raid): the "180 to a Benched Pokémon" is a Step-D choice and resolves
      // BEFORE the attack's other effects — so make the bench choice FIRST, then discard + place the
      // damage. The final board is identical; this only corrects the decision ORDER (twinleaf
      // previously discarded the Fire Energy before surfacing the choice).
      const discardThenDamage = (target?: PokemonCardList): State => {
        const fireEnergy = player.active.cards.filter(card =>
          card instanceof EnergyCard && card.name === 'Fire Energy'
        );
        const discardEnergy = new DiscardCardsEffect(effect, fireEnergy);
        discardEnergy.target = player.active;
        store.reduceEffect(state, discardEnergy);
        if (target !== undefined) {
          // Benched damage: no Weakness/Resistance.
          const damageEffect = new PutDamageEffect(effect, 180);
          damageEffect.target = target;
          store.reduceEffect(state, damageEffect);
        }
        return state;
      };

      const benched = opponent.bench.filter(b => b.cards.length > 0);
      if (benched.length === 0) {
        return discardThenDamage();
      }

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.BENCH],
        { allowCancel: false }
      ), selected => {
        return discardThenDamage(selected[0]);
      });
    }

    return state;
  }

}
