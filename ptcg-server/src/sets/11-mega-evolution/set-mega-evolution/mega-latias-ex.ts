import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, Card } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class MegaLatiasex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_SV_MEGA];
  public hp: number = 280;
  public cardType: CardType[] = [N];
  public retreat = [C];

  public attacks = [
    {
      name: 'Strafe',
      cost: [C],
      damage: 40,
      text: 'You may switch this Pokémon with 1 of your Benched Pokémon.',
    },
    {
      name: 'Illusory Impulse',
      cost: [R, P, C],
      damage: 300,
      text: 'Discard all Energy from this Pokémon.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'MEG';
  public setNumber: string = '100';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Mega Latias ex';
  public fullName: string = 'Mega Latias ex M1S';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-672 (B.101 (3)): the "you may" and the new Active are chosen at Step D, before the damage; the switch is after
    // it (#352). TA-200: with no Benched Pokemon nothing is asked (the prefab's occupancy test, CF-14).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, { may: true });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // TA-613 (B.76, #2031): no card is chosen, so the discard is applied after the damage.
      effect.afterDamageMoves.push(() => {
        const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
        state = store.reduceEffect(state, checkProvidedEnergy);

        const cards: Card[] = checkProvidedEnergy.energyMap.map((e) => e.card);
        const discardEnergy = new DiscardCardsEffect(effect, cards);
        discardEnergy.target = player.active;
        store.reduceEffect(state, discardEnergy);
      });
    }

    return state;
  }
}
