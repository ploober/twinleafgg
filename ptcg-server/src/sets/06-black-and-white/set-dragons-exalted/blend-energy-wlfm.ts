import { CardType, EnergyType } from '../../../game/store/card/card-types';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { Effect } from '../../../game/store/effects/effect';
import { EnergyEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

export class BlendEnergyWLFM extends EnergyCard {

  public provides: CardType[] = [CardType.COLORLESS];

  public energyType = EnergyType.SPECIAL;

  public set: string = 'DRX';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '118';

  public name = 'Blend Energy WLFM';

  public fullName = 'Blend Energy WLFM DRX';

  public text = 'This card provides [C] Energy. When attached to a Pokemon, this card provides [W], [L], [F], or [M] but only 1 Energy at a time.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof CheckProvidedEnergyEffect && effect.source.cards.includes(this)) {
      try {
        const energyEffect = new EnergyEffect(effect.player, this);
        store.reduceEffect(state, energyEffect);
      } catch {
        return state;
      }

      // ONE unit of Energy that can be any of blendedEnergies ("only 1 Energy at a time"): push a single
      // COLORLESS placeholder, NOT one unit per type. StateUtils.checkEnoughEnergy reads the flexible
      // types from `blendedEnergies`; flattening [W,L,F,M] here counted one Blend as four Energy.
      effect.energyMap.push({
        card: this,
        provides: [CardType.WATER, CardType.LIGHTNING, CardType.FIGHTING, CardType.METAL]
      });
    }

    return state;
  }
}
