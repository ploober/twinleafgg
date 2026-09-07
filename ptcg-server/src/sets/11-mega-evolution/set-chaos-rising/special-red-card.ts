import { TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { StateUtils, StoreLike, State, Player } from '../../../game';
import { GameError, GameMessage } from '../../../game';
import { CardList } from '../../../game/store/state/card-list';
import { ShuffleDeckPrompt } from '../../../game';
import { DRAW_CARDS } from '../../../game/store/prefabs/prefabs';

export class SpecialRedCard extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '82';
  public name: string = 'Special Red Card';
  public fullName: string = 'Special Red Card M4';
  public text: string =
    'You can use this card only if your opponent has 3 or fewer Prize cards remaining.\n\n' +
    'Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 3 cards.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    const opponent = StateUtils.getOpponent(state, player);
    const prizeCount = opponent.prizes.filter(p => p.cards.length > 0).length;
    if (prizeCount > 3) {
      return false;
    }
    // TA-326: withhold when the opponent's hand is EMPTY — the whole effect ("shuffle their hand
    // onto the bottom of their deck; IF they put any cards down this way, they draw 3") then does
    // nothing, and a Trainer cannot be played for no effect (compendium #2365 rules this exact card;
    // #2306 Grand Wing is the same conditional-draw shape; the modern line, B.41/B.36). Opponent hand
    // SIZE is public, so a zero is provably a no-op. rotomancer withholds here.
    if (opponent.hand.cards.length === 0) {
      return false;
    }
    return true;
  }


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const prizeCount = opponent.prizes.filter((p) => p.cards.length > 0).length;
      if (prizeCount > 3) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }
      const cardsInHand = opponent.hand.cards.length;
      if (cardsInHand > 0) {
        // TA-379: "shuffles their hand and puts it on the bottom" — the old code bottomed the hand IN
        // HAND ORDER and drew at once: no shuffle happened, the bottom order was known, and no external
        // order could ever be supplied (TA-305/TA-370 shape). Externalize it the TA-370 way: stage the
        // hand INTO the (emptied) deck so the adapter's ShuffleDeckPrompt advertises exactly those cards,
        // restack the untouched deck on top inside the callback, and only THEN draw.
        const rest = new CardList();
        opponent.deck.moveTo(rest);
        opponent.hand.moveTo(opponent.deck);
        return store.prompt(state, new ShuffleDeckPrompt(opponent.id), order => {
          opponent.deck.applyOrder(order);
          rest.moveToTopOfDestination(opponent.deck);
          DRAW_CARDS(store, state, opponent, Math.min(3, opponent.deck.cards.length));
        });
      }
    }
    return state;
  }
}
