import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { GameMessage } from '../../../game/game-message';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';

import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { Card, ShuffleDeckPrompt, StateUtils } from '../../../game';
import {WAS_ATTACK_USED, MOVE_CARDS, SHUFFLE_DECK, SHOW_CARDS_TO_PLAYER } from '../../../game/store/prefabs/prefabs';

export class Eevee extends PokemonCard {

  public regulationMark = 'G';

  public stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.COLORLESS];

  public hp = 70;

  public weakness = [{ type: CardType.FIGHTING }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Colorful Friends',
      cost: [CardType.COLORLESS],
      damage: 0,
      text: 'Search your deck for up to 3 Pokémon of different types, reveal them, and put them into your hand. Then, shuffle your deck.'
    },
    {
      name: 'Skip',
      cost: [CardType.COLORLESS],
      damage: 10,
      text: ''
    }
  ];

  public set: string = 'MEW';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '133';
  public name: string = 'Eevee';
  public fullName: string = 'Eevee MEW';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-250 / B.33 (#361): an attack is used on an empty deck; the search whiffs and "Then, shuffle your deck"
      // is still owed. This threw CANNOT_PLAY_THIS_CARD, the Trainer answer (#840).
      if (player.deck.cards.length === 0) {
        return SHUFFLE_DECK(store, state, player);
      }

      let cards: Card[] = [];
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { superType: SuperType.POKEMON } as any,
        { min: 0, max: 3, allowCancel: true, differentTypes: true }
      ), selected => {
        cards = selected || [];

        // TA-758 (TA-691's shape): "reveal them": the picks are shown to the opponent before they go to the hand.
        SHOW_CARDS_TO_PLAYER(store, state, StateUtils.getOpponent(state, player), cards);

        cards.forEach((card, index) => {
          MOVE_CARDS(store, state, player.deck, player.hand, { cards: [card], sourceCard: this });
        });
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }
    return state;
  }
}