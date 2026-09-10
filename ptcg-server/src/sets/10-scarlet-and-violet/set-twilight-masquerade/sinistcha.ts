import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, EnergyType } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PlayerType, GameMessage, SlotType, DiscardEnergyPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Sinistcha extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Poltchageist';
  public cardType: CardType[] = [CardType.GRASS];
  public hp: number = 70;
  public weakness = [{ type: CardType.FIRE }];
  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Cursed Drop',
      cost: [CardType.GRASS],
      damage: 0,
      text: 'Put 4 damage counters on your opponent\'s Pokémon in any way you like.'
    },
    {
      name: 'Spill the Tea',
      cost: [CardType.GRASS],
      damage: 70,
      damageCalculation: 'x',
      text: 'Discard up to 3 [G] Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.'
    },
  ];

  public set: string = 'TWM';
  public name: string = 'Sinistcha';
  public fullName: string = 'Sinistcha TWM';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '22';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Cursed Drop
    if (WAS_ATTACK_USED(effect, 0, this)) {
      PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE(4, store, state, effect);
    }

    // Spill the Tea
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      let totalGrassEnergy = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        const grassCount = cardList.cards.filter(card =>
          card.superType === SuperType.ENERGY && card.name === 'Grass Energy'
        ).length;
        totalGrassEnergy += grassCount;
      });

      return store.prompt(state, new DiscardEnergyPrompt(
        player.id,
        GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],// Card source is target Pokemon
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Grass Energy' },
        { min: 0, max: Math.min(totalGrassEnergy, 3), allowCancel: false }
      ), transfers => {
        // TA-392: "70 damage for each card you discarded in this way" — the multiplier was assigned
        // INSIDE the transfer loop, so with zero cards chosen the printed base 70 was never zeroed and
        // the attack dealt 70 for nothing (rotomancer: 0). Count first, then move.
        const discarded = transfers || [];
        for (const transfer of discarded) {
          const source = StateUtils.getTarget(state, player, transfer.from);
          source.moveCardTo(transfer.card, player.discard);
        }
        effect.damage = discarded.length * 70;
        return state;
      });
    }

    return state;
  }

}