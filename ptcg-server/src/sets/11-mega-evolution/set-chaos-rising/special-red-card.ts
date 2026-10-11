import { TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { StateUtils, StoreLike, State, Player, GameError, GameMessage, ShuffleDeckPrompt } from '../../../game';
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
        // order could ever be supplied (TA-305/TA-370 shape). Externalize it through a ShuffleDeckPrompt
        // that advertises exactly those cards, and only THEN draw.
        // TA-697 / B.80 (TA-598's Grand Wing shape): the hand goes UNDER the untouched deck and only that bottom
        // segment is shuffled (`bottomCount`), so the pause projects the hand in transit {hand -> deck bottom} and
        // the deck as it is. The old staging (the deck into a temp list, the hand into the emptied deck) put the
        // whole deck in transit and the hand on deck:top, and the draws then read transit -> hand.
        const n = cardsInHand;
        opponent.hand.moveTo(opponent.deck);
        // TA-462 / B.66: the pile is the HAND (a hand-to-bottom), not the deck — declare it so the
        // adapter's `shuffled` carries zone:'hand' and the deck-randomised property is not asserted.
        return store.prompt(state, new ShuffleDeckPrompt(opponent.id, { zone: 'hand', bottomCount: n }), order => {
          const deck = opponent.deck.cards;
          const start = deck.length - n;
          // Segment-relative answer (the adapter advertises the segment); a whole-deck answer keeps the segment's order.
          const segment = order.length === n ? order.map(i => start + i) : order.filter(i => i >= start);
          if (segment.length === n && new Set(segment).size === n && segment.every(i => i >= start && i < deck.length)) {
            opponent.deck.cards = [...deck.slice(0, start), ...segment.map(i => deck[i])];
          }
          DRAW_CARDS(store, state, opponent, Math.min(3, opponent.deck.cards.length));
        });
      }
    }
    return state;
  }
}
