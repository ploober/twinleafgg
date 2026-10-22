import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { CardList, ChooseCardsPrompt, GameMessage, Player, ShowCardsPrompt, ShuffleDeckPrompt, StateUtils } from '../../../game';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class DuskBall extends TrainerCard {

  protected _trainerType: TrainerType = TrainerType.ITEM;
  public regulationMark = 'H';
  public set: string = 'SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '175';
  public name: string = 'Dusk Ball';
  public fullName: string = 'Dusk Ball SSP';

  public text: string =
    'Look at the bottom 7 cards of your deck. You may reveal a Pokémon you find there and put it into your hand. Shuffle the other cards back into your deck.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof TrainerEffect && effect.trainerCard === this) {

      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const temp = new CardList();

      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      const deckSize = player.deck.cards.length;
      const numCardsToMove = Math.min(7, deckSize);
      const startIndex = deckSize - numCardsToMove;

      // CF-61: move through the CardList API (not a raw splice) so the pile is stamped deck-sourced and
      // the conformance projection can show the window at the top of `deck` during the pause.
      player.deck.moveCardsTo(player.deck.cards.slice(startIndex, startIndex + numCardsToMove), temp);

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        temp,
        { superType: SuperType.POKEMON },
        { allowCancel: false, min: 0, max: 1 }
      ), chosenCards => {

        if (chosenCards.length <= 0) {
          // No Pokemon chosen, shuffle all back
          // TA-378: no self-discard here either — the shuffle below is still owed; the generic cleanup
          // discards the Item after it (#919). (The per-card loop moved the whole pile each pass.)
          MOVE_CARDS(store, state, temp, player.deck, { sourceCard: this });
        }

        if (chosenCards.length > 0) {
          // Move chosen Pokemon to hand
          const pokemon = chosenCards[0];
          MOVE_CARDS(store, state, temp, player.hand, { cards: [pokemon], sourceCard: this });
          MOVE_CARDS(store, state, temp, player.deck, { sourceCard: this });
          // TA-378: self-discard removed — the generic finalizeTrainerCleanup discards after the last prompt.

          if (chosenCards.length > 0) {
            state = store.prompt(state, new ShowCardsPrompt(
              opponent.id,
              GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
              chosenCards), () => state);
          }
        }
        // TA-378: no self-discard here — the Item is still resolving (its shuffle is owed). The generic
        // finalizeTrainerCleanup discards it once no prompt is open, i.e. after the shuffle (#919).
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }
    return state;
  }
}