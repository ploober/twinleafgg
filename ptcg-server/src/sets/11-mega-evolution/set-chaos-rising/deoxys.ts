import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { PlayerType, SlotType, StoreLike, State, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { ATTACH_ENERGY_PROMPT, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { EnergyCard } from '../../../game/store/card/energy-card';

export class Deoxys extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [P];
  public hp: number = 110;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Genome Charge',
      cost: [C],
      damage: 0,
      text: 'Search your deck for up to 2 Basic [P] Energy cards and attach them to this Pokémon. Then, shuffle your deck.',
    },
    {
      name: 'Psychic',
      cost: [P, P, C],
      damage: 80,
      damageCalculation: '+',
      text: "This attack does 20 more damage for each Energy attached to your opponent's Active Pokémon.",
    },
  ];

  public regulationMark: string = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '31';
  public name: string = 'Deoxys';
  public fullName: string = 'Deoxys M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Attack 1: Genome Charge
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      const blocked: number[] = [];
      player.deck.cards.forEach((c, index) => {
        if (
          !(c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(P))
        ) {
          blocked.push(index);
        }
      });

      // TA-819: the attacking Pokemon is the sole recipient; place each Energy at its pick.
      return ATTACH_ENERGY_PROMPT(
        store, state, player, PlayerType.BOTTOM_PLAYER, SlotType.DECK, [SlotType.ACTIVE],
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { min: 0, max: 2, allowCancel: false, blocked },
      );
    }

    // Attack 2: Psychic
    // Ref: set-burning-shadows/shiinotic.ts (CheckProvidedEnergyEffect on opponent)
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const checkEnergy = new CheckProvidedEnergyEffect(opponent, opponent.active);
      store.reduceEffect(state, checkEnergy);

      const energyCount = checkEnergy.energyMap.reduce((sum, em) => sum + StateUtils.getProvidesUnitCount(em.provides), 0);
      effect.damage += 20 * energyCount;
    }

    return state;
  }
}
