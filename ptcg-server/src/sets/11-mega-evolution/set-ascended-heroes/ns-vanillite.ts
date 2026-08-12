import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH, WAS_ATTACK_USED, ATTACK_SEARCH_WHIFFS } from '../../../game/store/prefabs/prefabs';

export class NsVanillite extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public tags = [CardTag.NS];
  public cardType: CardType = W;
  public hp: number = 60;
  public weakness = [{ type: M }];
  public retreat = [C];

  public attacks = [{
    name: 'Call for Family',
    cost: [C],
    damage: 0,
    text: 'Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.'
  },
  {
    name: 'Icy Snow',
    cost: [W, C],
    damage: 20,
    text: ''
  }];

  public regulationMark = 'I';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '49';
  public name: string = 'N\'s Vanillite';
  public fullName: string = 'N\'s Vanillite M2a';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      // SD-20: an empty deck WHIFFS the search; the attack still happens (#361 Call for Family,
      // #2018 Breezy Gift). The shared prefab's BLOCK_IF_DECK_EMPTY is the Trainer answer.
      if (ATTACK_SEARCH_WHIFFS(effect.player)) { return state; }
      return SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH(
        store, state, effect.player, { stage: Stage.BASIC }, { min: 0, max: 2 }
      );
    }
    return state;
  }
}

