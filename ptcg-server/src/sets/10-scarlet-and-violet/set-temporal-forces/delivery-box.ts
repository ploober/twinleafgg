import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import {
  Card,
  ChooseCardsPrompt,
  GameMessage,
  Player,
  ShowCardsPrompt,
  ShuffleDeckPrompt,
  StateUtils,
} from '../../../game';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class DeliveryBox extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.ITEM;

  public regulationMark = 'H';

  public set: string = 'TEF';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '143';

  public name: string = 'Boxed Order';

  public fullName: string = 'Boxed Order TEF';

  public text: string =
    'Search your deck for up to 2 Item cards, reveal them, and put them into your hand. Then, shuffle your deck. Your turn ends.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      let cards: Card[] = [];
      store.prompt(
        state,
        new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { superType: SuperType.TRAINER, trainerType: TrainerType.ITEM },
        { min: 0, max: 2, allowCancel: false }
      ), selected => {
        cards = selected || [];

        const shuffleDeck = () => store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });

        // TA-265 / §B.34: the reveal is printed BEFORE the cards enter the hand, and the adapter
        // reads the revealed card's zone at show time. Moving first reported `from: 'hand'` for
        // cards disclosed out of the deck, so the move now runs inside the show's continuation.
        const takeIntoHand = () => {
          MOVE_CARDS(store, state, player.deck, player.hand, { cards: cards, sourceCard: this });
        };

        if (cards.length > 0) {
          return store.prompt(state, new ShowCardsPrompt(
            opponent.id,
            GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
            cards
          ), () => { takeIntoHand(); shuffleDeck(); });
        }
        takeIntoHand();
        shuffleDeck();
      });
      const endTurnEffect = new EndTurnEffect(player);
      store.reduceEffect(state, endTurnEffect);
      return state;
    }
    return state;
  }
}