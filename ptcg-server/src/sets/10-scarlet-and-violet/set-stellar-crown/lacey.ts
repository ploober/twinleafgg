import { GameError, GameMessage, Player, StateUtils } from '../../../game';
import { TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { SHUFFLE_HAND_INTO_DECK_THEN_DRAW } from '../../../game/store/prefabs/prefabs';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

export class Lacey extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'SCR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '139';

  public regulationMark = 'H';

  public name: string = 'Lacey';

  public fullName: string = 'Lacey SCR';

  public text: string =
    'Shuffle your hand into your deck. Then, draw 4 cards. If your opponent has 3 or fewer Prize cards remaining, draw 8 cards instead.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    // TA-349 / B.41 addendum 2026-09-01 (the SELF-side cycle cell): with an EMPTY deck and every other
    // card in hand ≤ the draw count, the shuffled-in hand is drawn straight back — hand, deck and
    // discard end where they started, Lacey herself being the cost. That is a play for no effect
    // (#255/#1124/#1188; #1042 Hugh), both operands are the player's own, so withhold. A stocked deck,
    // or more fuel than the draw, changes the hand and stays offered. rotomancer gates on exactly this
    // arithmetic (measured live 2026-09-01).
    const opponent = StateUtils.getOpponent(state, player);
    const drawCount = opponent.getPrizeLeft() > 3 ? 4 : 8;
    if (player.deck.cards.length === 0 && player.hand.cards.length - 1 <= drawCount) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      if (player.supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      const opponent = StateUtils.getOpponent(state, player);
      const cardsToDraw = opponent.getPrizeLeft() > 3 ? 4 : 8;
      return SHUFFLE_HAND_INTO_DECK_THEN_DRAW(store, state, player, {
        excludeCard: this,
        drawCount: cardsToDraw,
      });
    }

    return state;
  }
}
