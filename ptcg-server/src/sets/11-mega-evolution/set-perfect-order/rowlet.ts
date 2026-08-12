import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED, SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_INTO_HAND, ATTACK_SEARCH_WHIFFS } from '../../../game/store/prefabs/prefabs';

export class Rowlet extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = G;
  public hp: number = 80;
  public weakness = [{ type: R }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Find a Friend',
    cost: [G],
    damage: 0,
    text: 'Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.'
  },
  {
    name: 'Tackle',
    cost: [C, C, C],
    damage: 30,
    text: ''
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '10';
  public name: string = 'Rowlet';
  public fullName: string = 'Rowlet M3';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      // SD-20: an empty deck WHIFFS the search; the attack still happens (#361 Call for Family,
      // #2018 Breezy Gift). The shared prefab's BLOCK_IF_DECK_EMPTY is the Trainer answer.
      if (ATTACK_SEARCH_WHIFFS(effect.player)) { return state; }
      SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_INTO_HAND(store, state, effect.player, {}, { min: 0, max: 1 });
    }
    return state;
  }
}
