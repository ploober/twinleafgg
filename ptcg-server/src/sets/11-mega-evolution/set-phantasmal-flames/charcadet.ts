import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';

import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { ChooseCardsPrompt, GameMessage, ShuffleDeckPrompt } from '../../../game';
import { MOVE_CARDS, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Charcadet extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [R];
  public hp: number = 70;
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Gather Strength',
    cost: [R],
    damage: 0,
    text: 'Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  },
  {
    name: 'Chop',
    cost: [R],
    damage: 10,
    text: '',
  }];

  public set: string = 'PFL';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '19';
  public name: string = 'Charcadet';
  public fullName: string = 'Charcadet M2';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-131: declarable with an empty deck (rulebook p.20). The search whiffs and the trailing
      // shuffle ("Then, shuffle your deck") still fires (CF-9/TA-126).
      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { min: 0, max: 2, allowCancel: false }
      ), cards => {
        cards = cards || [];
        if (cards.length > 0) {
          MOVE_CARDS(store, state, player.deck, player.hand, { cards, sourceCard: this });
        }
      });

      return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
        player.deck.applyOrder(order);
      });
    }

    return state;
  }
}
