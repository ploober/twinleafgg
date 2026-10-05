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
import { CardList } from '../../../game/store/state/card-list';
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

      // TA-608: each hand was shuffled with an inline PRNG, so no shuffle was ever offered and the bottom order could
      // not be supplied. TA-556 / B.74: the steps run in LOCKSTEP and in printed order — every hand is shuffled, then
      // every hand goes on the bottom of its deck, then every player draws. Each hand is lifted into a pile (B.80:
      // transit {hand -> deck bottom, owner}); for its shuffle the pile goes under the deck as the bottom segment of a
      // ShuffleDeckPrompt {zone: hand, bottomCount} (the Grand Wing TA-458 shape) and comes back out in the answered
      // order. A player protected from the Supporter (Milotic Dew Guard: "prevent all effects of that card done to you
      // or your hand") keeps their hand and does not draw.
      const lift = (who: Player, cards: Card[]): CardList | undefined => {
        const pile = new CardList();
        if (cards.length === 0) { return pile; }
        const move = new MoveCardsEffect(who.hand, pile, { cards, sourceCard: this });
        state = store.reduceEffect(state, move);
        if (move.preventDefault) { return undefined; }
        pile.cards.forEach(c => CardList.transit.set(c, { origin: 'hand', destination: 'deckBottom', visibility: 'owner' }));
        return pile;
      };
      const piles: Array<[Player, CardList | undefined]> = [[player, lift(player, playerCards)], [opponent, lift(opponent, opponentCards)]];

      const shuffle = (i: number): State => {
        if (i === piles.length) {
          // Put, then draw.
          const put = piles.some(([, pile]) => pile !== undefined && pile.cards.length > 0);
          for (const [who, pile] of piles) {
            if (pile !== undefined) { pile.cards.forEach(c => CardList.transit.delete(c)); pile.moveTo(who.deck); }
          }
          if (put) {
            for (const [who, pile] of piles) {
              if (pile !== undefined) { DRAW_CARDS(store, state, who, who.getPrizeLeft()); }
            }
          }
          return state;
        }
        const [who, pile] = piles[i];
        const n = pile === undefined ? 0 : pile.cards.length;
        if (n === 0) { return shuffle(i + 1); }
        const start = who.deck.cards.length;
        pile!.moveTo(who.deck);
        return store.prompt(state, new ShuffleDeckPrompt(who.id, { zone: 'hand', bottomCount: n }), order => {
          const deck = who.deck.cards;
          // Segment-relative answer (the adapter advertises the segment); a whole-deck answer keeps the segment's order.
          const segment = order.length === n ? order.map(k => start + k) : order.filter(k => k >= start);
          const block = segment.length === n && new Set(segment).size === n && segment.every(k => k >= start && k < deck.length)
            ? segment.map(k => deck[k]) : deck.slice(start);
          who.deck.cards = deck.slice(0, start);
          pile!.cards = block;
          block.forEach((c, k) => CardList.transit.set(c, { origin: 'hand', destination: 'deckBottom', visibility: 'owner', order: k }));
          shuffle(i + 1);
        });
      };
      return shuffle(0);
    }

    return state;
  }
}
