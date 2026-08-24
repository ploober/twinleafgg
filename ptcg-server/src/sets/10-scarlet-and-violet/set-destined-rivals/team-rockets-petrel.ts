import { Card } from '../../../game/store/card/card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, SuperType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { MOVE_CARDS, SHOW_CARDS_THEN, SHUFFLE_DECK } from '../../../game/store/prefabs/prefabs';
import { Player, StateUtils } from '../../../game';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect, self: Card): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);
  let cards: Card[] = [];

  const supporterTurn = player.supporterTurn;
  if (supporterTurn > 0) {
    throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
  }

  if (player.deck.cards.length === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  player.rocketSupporter = true;

  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_HAND,
    player.deck,
    { superType: SuperType.TRAINER },
    { min: 0, max: 1, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });

  // TA-265 residual / §B.34: `SHOW_CARDS_TO_PLAYER` is a `store.prompt` -- it ENQUEUES and returns --
  // so a flat call written after the move is not merely mis-ordered on the page, it CANNOT run first.
  // Swapping the two lines would change nothing; the move has to happen inside the show's
  // continuation, which is what `SHOW_CARDS_THEN` exists for. This card was the largest live-diverging
  // row in the 2026-08-23 corpus (7,396 occurrences) precisely because it does not call the
  // SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_INTO_HAND prefab that TA-265's first fix repaired.
  SHOW_CARDS_THEN(store, state, opponent, cards, () => {
    MOVE_CARDS(store, state, player.deck, player.hand, { cards: cards, sourceCard: self });
    SHUFFLE_DECK(store, state, player);
  });
}

export class TeamRocketsPetrel extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public tags = [CardTag.TEAM_ROCKET];
  public set: string = 'DRI';
  public name: string = 'Team Rocket\'s Petrel';
  public fullName: string = 'Team Rocket\'s Petrel DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '176';
  public regulationMark = 'I';

  public text: string =
    'Search your deck for a Trainer card, reveal it, and put it into your hand. Then, shuffle your deck.';

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
      const generator = playCard(() => generator.next(), store, state, effect, this);
      return generator.next().value;
    }

    if (effect instanceof EndTurnEffect && effect.player.rocketSupporter) {
      effect.player.rocketSupporter = false;
    }

    return state;
  }

}
