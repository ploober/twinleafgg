import { Card } from '../../../game/store/card/card';
import { GameMessage } from '../../../game/game-message';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { CardList } from '../../..';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  let cards: Card[] = [];

  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_DECK,
    player.hand,
    {},
    { min: 1, max: 1, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });

  // Nothing to switch, or no top card of the deck to switch with -> no-op (card conservation).
  if (cards.length === 0 || player.deck.cards.length === 0) {
    return;
  }

  // "Switch a card from your hand with the top card of your deck": the former top card of the deck
  // goes to the hand and the chosen hand card becomes the new top of the deck (a conservation-safe
  // swap). The old code stranded the top card in a local list and lost it (re-fuzz x71 conservation).
  const deckTop = new CardList();
  player.deck.moveTo(deckTop, 1);

  const chosen = new CardList();
  player.hand.moveCardTo(cards[0], chosen);
  chosen.moveToTopOfDestination(player.deck);

  deckTop.moveTo(player.hand);
}

export class SwitchingCups extends TrainerCard {

  public trainerType: TrainerType = TrainerType.ITEM;

  public set: string = 'EVS';

  public regulationMark = 'E';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '162';

  public name: string = 'Switching Cups';

  public fullName: string = 'Switching Cups EVS';

  public text: string =
    'Switch a card from your hand with the top card of your deck.';


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      // The Item is removed from hand before this effect runs; played as the last card in hand,
      // there is no other card to switch with the top of the deck, so it resolves as a no-op.
      if (effect.player.hand.cards.length === 0) {
        return state;
      }
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}
