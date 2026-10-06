import { GameError, GameMessage, Player } from '../../../game';
import { TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { DRAW_CARDS, EACH_PLAYER_SHUFFLE_HAND_INTO_DECK, RECYCLE_RETURNS_EVERY_CARD } from '../../../game/store/prefabs/prefabs';
import { WAS_TRAINER_USED } from '../../../game/store/prefabs/trainer-prefabs';
import { StateUtils } from '../../../game/store/state-utils';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

export class Judge extends TrainerCard {

  public trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'SVI';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '176';

  public regulationMark = 'G';

  public name: string = 'Judge';

  public fullName: string = 'Judge SVI';

  public text: string =
    'Each player shuffles their hand into their deck and draws 4 cards.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    if (player.hand.cards.length === 0 && player.deck.cards.length === 0) {
      return false;
    }
    // TA-308 / B.41: both decks empty and each hand no larger than the draw of 4 — every card goes in and comes
    // straight back, for both players. A play for no effect; both operands are public, so withhold.
    const opponent = StateUtils.getOpponent(state, player);
    if (RECYCLE_RETURNS_EVERY_CARD(player.deck.cards.length, player.hand.cards.filter(c => c !== this).length, 4)
      && RECYCLE_RETURNS_EVERY_CARD(opponent.deck.cards.length, opponent.hand.cards.length, 4)) {
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

      if (player.hand.cards.filter(c => c !== this).length === 0 && player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // TA-556 / B.74: lockstep - both hands go into their decks, then both decks are shuffled, then each player
      // draws 4 (the card ran the player's whole sequence before the opponent's hand moved).
      return EACH_PLAYER_SHUFFLE_HAND_INTO_DECK(store, state, this, [
        { player, cards: player.hand.cards.filter(c => c !== this) },
        { player: opponent, cards: [...opponent.hand.cards] },
      ], included => {
        included.forEach(p => DRAW_CARDS(store, state, p, 4));
      });
    }

    return state;
  }

}
