import { Effect } from '../../../game/store/effects/effect';
import { State } from '../../../game/store/state/state';
import { StateUtils } from '../../../game/store/state-utils';
import { StoreLike } from '../../../game/store/store-like';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { Card, GameError, GameMessage, Player } from '../../../game';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { DRAW_CARDS } from '../../../game/store/prefabs/prefabs';
import { MoveCardsEffect } from '../../../game/store/effects/game-effects';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';

export class Iono extends TrainerCard {
  public regulationMark = 'G';
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'PAL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '185';
  public name: string = 'Iono';
  public fullName: string = 'Iono PAL';

  public text: string =
    'Each player shuffles their hand and puts it on the bottom of their deck. ' +
    'If either player put any cards on the bottom of their deck in this way, ' +
    'each player draws a card for each of their remaining Prize cards.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }

    const opponent = StateUtils.getOpponent(state, player);
    const otherCardsInHand = player.hand.cards.filter(c => c !== this).length;

    if (otherCardsInHand === 0 && player.deck.cards.length === 0) {
      return false;
    }

    if (otherCardsInHand === 0 && opponent.hand.cards.length === 0) {
      return false;
    }

    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (player.supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      const playerCards = player.hand.cards.filter(c => c !== this);
      const opponentCards = [...opponent.hand.cards];

      if (playerCards.length === 0 && player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      if (playerCards.length === 0 && opponentCards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // TA-608: each hand was shuffled with an inline PRNG, so no shuffle was ever offered and the bottom order
      // could not be supplied. TA-556 / B.74: the steps run in LOCKSTEP — both hands go under their decks, then each
      // hand block is shuffled (ShuffleDeckPrompt {zone: hand, bottomCount}, the Grand Wing TA-458 / TA-591 shape),
      // then each player draws. A put blocked by an effect (Milotic) puts nothing.
      const putUnder = (who: Player, cards: Card[]): number => {
        if (cards.length === 0) { return 0; }
        const move = new MoveCardsEffect(who.hand, who.deck, { cards, sourceCard: this });
        state = store.reduceEffect(state, move);
        return move.preventDefault ? 0 : cards.length;
      };
      const nPlayer = putUnder(player, playerCards);
      const nOpponent = putUnder(opponent, opponentCards);

      const draw = (): void => {
        if (nPlayer + nOpponent === 0) { return; }
        DRAW_CARDS(store, state, player, player.getPrizeLeft());
        DRAW_CARDS(store, state, opponent, opponent.getPrizeLeft());
      };
      const shuffleBlock = (who: Player, n: number, next: () => void): State => {
        if (n === 0) { next(); return state; }
        return store.prompt(state, new ShuffleDeckPrompt(who.id, { zone: 'hand', bottomCount: n }), order => {
          const deck = who.deck.cards;
          const start = deck.length - n;
          // Segment-relative answer (the adapter advertises the segment); a whole-deck answer keeps the segment's order.
          const segment = order.length === n ? order.map(i => start + i) : order.filter(i => i >= start);
          if (segment.length === n && new Set(segment).size === n && segment.every(i => i >= start && i < deck.length)) {
            who.deck.cards = [...deck.slice(0, start), ...segment.map(i => deck[i])];
          }
          next();
        });
      };
      return shuffleBlock(player, nPlayer, () => { shuffleBlock(opponent, nOpponent, draw); });
    }

    return state;
  }
}
