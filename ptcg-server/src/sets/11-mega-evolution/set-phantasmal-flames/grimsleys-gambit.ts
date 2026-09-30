import { TrainerCard, TrainerType, StoreLike, State, Card, CardList, ChooseCardsPrompt, GameError, GameMessage, ShuffleDeckPrompt, SuperType, CardType, Player } from '../../../game';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';

export class GrimsleysGambit extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '90';
  public regulationMark = 'I';
  public name: string = 'Grimsley\'s Move';
  public fullName: string = 'Grimsley\'s Gambit M2';
  public text: string = 'Look at the top 7 cards of your deck and put a [D] Pokémon you find there onto your Bench. Shuffle the other cards and put them on the bottom of your deck. You can\'t use this card on your first turn.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    if (player.deck.cards.length === 0) {
      return false;
    }
    if (player.bench.filter(b => b.cards.length === 0).length === 0) {
      return false;
    }
    if (state.turn === 1 || state.turn === 2) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      const supporterTurn = player.supporterTurn;

      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }
      // Check if bench has open slots
      const openSlots = player.bench.filter(b => b.cards.length === 0);

      if (openSlots.length === 0) {
        // No open slots, throw error
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      if (state.turn === 1 || state.turn === 2) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      const deckTop = new CardList();
      state = MOVE_CARDS(store, state, player.deck, deckTop, { count: 7 });

      let cards: Card[] = [];
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_PUT_ONTO_BENCH,
        deckTop,
        { superType: SuperType.POKEMON, cardType: [CardType.DARK] },
        { min: 0, max: 1, allowCancel: false }
      ), selectedCards => {
        cards = selectedCards || [];

        cards.forEach((card, index) => {
          state = MOVE_CARDS(store, state, deckTop, openSlots[index], { cards: [card] });
          openSlots[index].pokemonPlayedTurn = state.turn;
        });

        // TA-370: "Shuffle the OTHER cards and put them on the bottom" permutes only the looked-at
        // remainder; the un-looked deck keeps its order. The old code bottomed deckTop
        // SYNCHRONOUSLY after store.prompt, so the order callback hit an emptied list — NO shuffle
        // happened and the bottom cards stayed in the order the player had just seen. The adapter
        // projects a ShuffleDeckPrompt over player.deck, so stage the remainder INTO the deck for
        // the shuffle, then restack the untouched cards on top.
        const rest = new CardList();
        state = MOVE_CARDS(store, state, player.deck, rest, {});
        state = MOVE_CARDS(store, state, deckTop, player.deck, {});
        state = store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
          MOVE_CARDS(store, state, rest, player.deck, { toTop: true });
          MOVE_CARDS(store, state, player.supporter, player.discard, { cards: [effect.trainerCard] });
        });
        return state;
      });
    }
    return state;
  }
}
