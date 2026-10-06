import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { Player } from '../../../game/store/state/player';
import { GamePhase, State } from '../../../game/store/state/state';
import { StateUtils } from '../../../game/store/state-utils';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { REMOVE_OPPONENT_LAST_TURN_MARKER_AT_END_OF_TURN, DRAW_CARDS, EACH_PLAYER_SHUFFLE_HAND_INTO_DECK } from '../../../game/store/prefabs/prefabs';

function* playCard(
  next: Function,
  store: StoreLike,
  state: State,
  self: UnfairStamp,
  effect: TrainerEffect,
): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  // No Pokemon KO last turn
  if (!player.marker.hasMarker(self.UNFAIR_STAMP_MARKER)) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  if (player.deck.cards.length === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  const cards = player.hand.cards.filter((c) => c !== self);

  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  // TA-556 / B.74: lockstep - both hands go into their decks, both decks are shuffled, then you draw 5 and your
  // opponent draws 2. Each shuffle is applied as it is answered (the batched prompt pair held A's answered order back
  // until B's shuffle was answered).
  yield EACH_PLAYER_SHUFFLE_HAND_INTO_DECK(store, state, self, [
    { player, cards },
    { player: opponent, cards: [...opponent.hand.cards] },
  ], included => {
    DRAW_CARDS(store, state, player, 5);
    if (included.includes(opponent)) {
      DRAW_CARDS(store, state, opponent, 2);
    }
  });
}

export class UnfairStamp extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  protected _tags = [CardTag.ACE_SPEC];
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '165';
  public regulationMark = 'H';
  public name: string = 'Unfair Stamp';
  public fullName: string = 'Unfair Stamp TWM';

  public text: string = `You can use this card only if one of your Pokémon was Knocked Out during your opponent's last turn.

Each player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards.`;

  public readonly UNFAIR_STAMP_MARKER = 'UNFAIR_STAMP_MARKER';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (!player.marker.hasMarker(this.UNFAIR_STAMP_MARKER)) {
      return false;
    }
    if (player.deck.cards.length === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }

    if (effect instanceof KnockOutEffect) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const duringTurn = [GamePhase.PLAYER_TURN, GamePhase.ATTACK].includes(state.phase);

      // Do not activate between turns, or when it's not opponents turn.
      if (!duringTurn || state.players[state.activePlayer] !== opponent) {
        return state;
      }

      const cardList = StateUtils.findCardList(state, this);
      const owner = StateUtils.findOwner(state, cardList);
      if (owner === player) {
        effect.player.marker.addMarker(this.UNFAIR_STAMP_MARKER, this);
      }
      return state;
    }

    REMOVE_OPPONENT_LAST_TURN_MARKER_AT_END_OF_TURN(effect, this.UNFAIR_STAMP_MARKER, this);

    return state;
  }
}
