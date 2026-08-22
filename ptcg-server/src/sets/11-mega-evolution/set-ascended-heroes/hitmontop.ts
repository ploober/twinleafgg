import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MOVE_CARDS, WAS_ATTACK_USED, SHUFFLE_THEN_DRAW } from '../../../game/store/prefabs/prefabs';

export class Hitmontop extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 100;
  public cardType: CardType = F;
  public weakness = [{ type: P }];
  public retreat = [C];

  public attacks = [{
    name: 'Spin and Draw',
    cost: [C],
    damage: 0,
    text: 'Shuffle your hand into your deck. Then, draw 6 cards.'
  },
  {
    name: 'Low Kick',
    cost: [F, C],
    damage: 50,
    text: ''
  }];

  public regulationMark = 'J';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '102';
  public name: string = 'Hitmontop';
  public fullName: string = 'Hitmontop ASC';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Spin and Draw
    if (WAS_ATTACK_USED(effect, 0, this)) {
      MOVE_CARDS(store, state, effect.player.hand, effect.player.deck);
      // TA-304: the draw must run INSIDE the shuffle's continuation. `SHUFFLE_DECK` then
      // `DRAW_CARDS` reads as ordered and is not -- `store.prompt` enqueues and returns, so the draw
      // came off the UNSHUFFLED deck and handed the player the pre-attack top 6.
      return SHUFFLE_THEN_DRAW(store, state, effect.player, 6);
    }

    return state;
  }
}
