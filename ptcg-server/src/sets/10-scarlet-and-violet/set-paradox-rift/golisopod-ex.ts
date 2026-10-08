import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  Card,
  ChooseEnergyPrompt,
  GameMessage,
  State,
  StoreLike,
  SuperType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Golisopodex extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Wimpod';
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [W];
  public hp: number = 270;
  public weakness = [{ type: L }];
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Aqua Blade',
      cost: [C, C],
      damage: 70,
      text: '',
    },
    {
      name: 'Swing and Skedaddle',
      cost: [W, C, C],
      damage: 170,
      text: 'Discard an Energy from this Pokémon. If you do, switch it with 1 of your Benched Pokémon.',
    },
  ];

  public set: string = 'PAR';
  public regulationMark = 'G';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '50';
  public name: string = 'Golisopod ex';
  public fullName: string = 'Golisopod ex PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Swing and Skedaddle
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      if (!player.active.energies.cards.some((c) => c.superType === SuperType.ENERGY)) {
        return state;
      }

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      state = store.prompt(
        state,
        new ChooseEnergyPrompt(
          player.id,
          GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
          checkProvidedEnergy.energyMap,
          [CardType.COLORLESS],
          { allowCancel: false },
        ),
        (energy) => {
          const cards: Card[] = (energy || []).map((e) => e.card);
          const discardEnergy = new DiscardCardsEffect(effect, cards);
          discardEnergy.target = player.active;
          store.reduceEffect(state, discardEnergy);
          // TA-672 (B.101 (3)): "If you do, switch it": the new Active is chosen at Step D too, right after the Energy;
          // the switch is after the damage, after the discard (#352).
          if (cards.length > 0) {
            SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, { message: GameMessage.CHOOSE_POKEMON_TO_SWITCH });
          }
        },
      );
    }

    return state;
  }
}
