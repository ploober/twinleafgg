import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';
import { CardTag } from '../../../game/store/card/card-types';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Turtonator extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [CardType.DRAGON];
  public hp: number = 120;
  public weakness = [];
  public resistance = [];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Fully Singe',
      cost: [CardType.FIRE],
      damage: 0,
      text: 'Discard an Energy from your opponent\'s Active Pokémon ex.'
    },
    {
      name: 'Steaming Stomp',
      cost: [CardType.FIGHTING, CardType.COLORLESS, CardType.COLORLESS],
      damage: 100,
      text: ''
    }
  ];

  public set: string = 'SSP';
  public regulationMark: string = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '137'; // Assign correct number if known
  public name: string = 'Turtonator';
  public fullName: string = 'Turtonator SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const opponentActive = opponent.active;
      const activeCard = opponentActive.getPokemonCard();
      // Only target Pokémon ex.
      // TA-233: this read `activeCard.cardTag`, the DEPRECATED tag field ("Use Card.tags instead",
      // pokemon-card.ts) which defaults to [] — so the gate was false for every modern card and the
      // attack's printed effect could never happen on any board.
      if (!activeCard || !activeCard.hasTag(CardTag.POKEMON_ex)) {
        return state;
      }
      // TA-661 / B.89 (5): a no-damage attack still makes its Step-D choice first (recorded `chosen` when there are two or
      // more Energy, B.93), then discards it.
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, undefined, 1, true);
    }
    return state;
  }
}
