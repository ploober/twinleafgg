import { Effect } from '../../../game/store/effects/effect';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { Player, ShuffleDeckPrompt, StateUtils } from '../../../game';

export class Caretaker extends TrainerCard {

  public regulationMark = 'H';

  public trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'TWM';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '144';

  public name: string = 'Caretaker';

  public fullName: string = 'Caretaker TWM';

  public text: string =
    'Draw 2 cards. Then, if Community Center is in play, shuffle this Caretaker back into your deck.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    if (player.deck.cards.length === 0) {
      return false;
    }
    return true;
  }


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      const supporterTurn = player.supporterTurn;

      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      player.hand.moveCardTo(effect.trainerCard, player.supporter);
      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      player.deck.moveTo(player.hand, 2);

      const stadiumCard = StateUtils.getStadiumCard(state);
      if (stadiumCard !== undefined && stadiumCard.name === 'Community Center') {
        // "shuffle this Caretaker back into your deck" — the card MANDATES a deck shuffle, so put
        // Caretaker back and then shuffle (was a bare moveTo that left the deck order intact — the
        // card's shuffle never fired; TA-329/F-030). Mirrors the ShuffleDeckPrompt pattern every
        // sibling "shuffle X into your deck" card uses (Unfair Stamp, Spikemuth Gym).
        player.supporter.moveTo(player.deck);
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
          return state;
        });
      } else {
        player.supporter.moveTo(player.discard);
      }

      return state;
    }
    return state;
  }
}
