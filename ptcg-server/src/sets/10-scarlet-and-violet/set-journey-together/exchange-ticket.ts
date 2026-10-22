import {
  Card,
  GameError,
  GameMessage,
  Player,
  State,
  StoreLike,
  TrainerCard,
  TrainerType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class RedeemableTicket extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.ITEM;

  public regulationMark = 'I';

  public set: string = 'JTG';

  public name: string = 'Redeemable Ticket';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '156';

  public fullName: string = 'Redeemable Ticket JTG';

  public text: string =
    'Count your Prize cards and shuffle them face down, then put them at the bottom of your deck. If you do, add that many cards from the top of your deck to your Prize cards.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.getPrizeLeft() === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const prizes = player.prizes.filter((p) => p.cards.length > 0);
      const prizeCount = prizes.reduce((sum, p) => sum + p.cards.length, 0);

      if (prizeCount === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // Move the trainer card to discard
      MOVE_CARDS(store, state, player.hand, player.discard, {
        cards: [effect.trainerCard],
        sourceCard: this,
      });

      // Collect all prize cards
      const allPrizeCards: Card[] = [];
      prizes.forEach((p) => allPrizeCards.push(...p.cards));

      // Shuffle the prize cards
      this.shuffleArray(allPrizeCards);

      // Move prize cards to the bottom of the deck. The engine's deck is top-at-index-0
      // (CardList.moveTo draws with `splice(0, count)`), so the BOTTOM is the END of the array:
      // append with push (NOT unshift, which would put them on top). (TA-328)
      allPrizeCards.forEach(card => {
        player.deck.cards.push(card);
      });

      // Clear the prize cards
      prizes.forEach((p) => (p.cards = []));

      // Draw cards from the top of the deck to the prize cards. The TOP is index 0, so take with
      // shift (NOT pop, which would draw from the bottom). (TA-328)
      for (let i = 0; i < prizeCount; i++) {
        const card = player.deck.cards.shift();
        if (card) {
          const prize = player.prizes.find((p) => p.cards.length === 0);
          if (prize) {
            prize.cards.push(card);
          } else {
            player.deck.cards.unshift(card);
          }
        }
      }

      // Set the new prize cards to be face down
      player.prizes.forEach((p) => (p.isSecret = true));
      MOVE_CARDS(store, state, player.supporter, player.discard, {
        cards: [this],
        sourceCard: this,
      });
      return state;
    }

    return state;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}