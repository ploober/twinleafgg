import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { Card, GameError, GameMessage, Player, State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_TRAINER_USED } from '../../../game/store/prefabs/trainer-prefabs';
import { COIN_FLIP_PROMPT, DRAW_CARDS } from '../../../game/store/prefabs/prefabs';
import { MoveCardsEffect } from '../../../game/store/effects/game-effects';
import { CardList } from '../../../game/store/state/card-list';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';

export class Lucian extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.SUPPORTER;
  public regulationMark = 'H';
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '157';
  public name: string = 'Lucian';
  public fullName: string = 'Lucian TWM';
  public text: string =
    'Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player flips a coin. If heads, that player draws 6 cards. If tails, they draw 3 cards.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }

    const opponent = StateUtils.getOpponent(state, player);
    const playerCards = player.hand.cards.filter((c) => c !== this).length;
    const opponentCards = opponent.hand.cards.length;

    if (playerCards === 0 && player.deck.cards.length === 0) {
      return false;
    }
    if (playerCards === 0 && opponentCards === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_TRAINER_USED(effect, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (player.supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      const playerCards = player.hand.cards.filter((c) => c !== this);
      const opponentCards = [...opponent.hand.cards];

      if (playerCards.length === 0 && player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }
      if (playerCards.length === 0 && opponentCards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // Each hand was shuffled with an inline PRNG (the card sat in EXCLUDED_RANDOM_CARDS). Iono's shape (TA-608, B.74):
      // every hand is shuffled, then every hand goes on the bottom of its deck, then each player flips and draws. Each
      // hand is lifted into a pile (B.80: transit {hand -> deck bottom, owner}); for its shuffle the pile goes under the
      // deck as the bottom segment of a ShuffleDeckPrompt {zone: hand, bottomCount} and comes back out in the answered
      // order. A player protected from the Supporter keeps their hand and does not flip.
      const lift = (who: Player, cards: Card[]): CardList | undefined => {
        const pile = new CardList();
        const move = new MoveCardsEffect(who.hand, pile, { cards, sourceCard: this });
        state = store.reduceEffect(state, move);
        if (move.preventDefault) { return undefined; }
        pile.cards.forEach(c => CardList.transit.set(c, { origin: 'hand', destination: 'deckBottom', visibility: 'owner' }));
        return pile;
      };
      const piles: Array<[Player, CardList | undefined]> = [[player, lift(player, playerCards)], [opponent, lift(opponent, opponentCards)]];

      const flipAndDraw = (i: number): void => {
        if (i === piles.length) { return; }
        const [who, pile] = piles[i];
        if (pile === undefined) { return flipAndDraw(i + 1); }
        COIN_FLIP_PROMPT(store, state, who, (heads) => {
          DRAW_CARDS(store, state, who, heads ? 6 : 3);
          flipAndDraw(i + 1);
        });
      };

      const shuffle = (i: number): State => {
        if (i === piles.length) {
          // Put, then flip and draw.
          const put = piles.some(([, pile]) => pile !== undefined && pile.cards.length > 0);
          for (const [who, pile] of piles) {
            if (pile !== undefined) { pile.cards.forEach(c => CardList.transit.delete(c)); pile.moveTo(who.deck); }
          }
          if (put) { flipAndDraw(0); }
          return state;
        }
        const [who, pile] = piles[i];
        if (pile === undefined) { return shuffle(i + 1); }
        const n = pile.cards.length;
        const start = who.deck.cards.length;
        pile.moveTo(who.deck);
        return store.prompt(state, new ShuffleDeckPrompt(who.id, { zone: 'hand', bottomCount: n }), order => {
          const deck = who.deck.cards;
          // Segment-relative answer (the adapter advertises the segment); a whole-deck answer keeps the segment's order.
          const segment = order.length === n ? order.map(k => start + k) : order.filter(k => k >= start);
          const block = segment.length === n && new Set(segment).size === n && segment.every(k => k >= start && k < deck.length)
            ? segment.map(k => deck[k]) : deck.slice(start);
          who.deck.cards = deck.slice(0, start);
          pile.cards = block;
          block.forEach((c, k) => CardList.transit.set(c, { origin: 'hand', destination: 'deckBottom', visibility: 'owner', order: k }));
          shuffle(i + 1);
        });
      };
      return shuffle(0);
    }

    return state;
  }
}
