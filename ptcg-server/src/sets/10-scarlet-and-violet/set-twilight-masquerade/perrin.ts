import { Card } from '../../../game/store/card/card';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { Player } from '../../../game/store/state/player';
import { State } from '../../../game/store/state/state';
import { StateUtils } from '../../../game/store/state-utils';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { ShowCardsPrompt } from '../../../game/store/prompts/show-cards-prompt';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';
import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);
  const hasPokemon = player.hand.cards.some(c => c.superType === SuperType.POKEMON);

  if (!hasPokemon) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  const supporterTurn = player.supporterTurn;

  if (supporterTurn > 0) {
    throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
  }

  MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: effect.trainerCard });
  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_DECK,
    player.hand,
    { superType: SuperType.POKEMON },
    { min: 1, max: 2, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length === 0) {
    return;
  }
  // TA-265 residual / §B.34 — THE INVERTED CELL. Every earlier B.34 witness moved deck -> hand and
  // twinleaf answered `from: 'hand'`, which reads like a (wrong but stable) "a reveal is always from
  // the hand" convention. This move is hand -> deck, and showing after it answered `from: 'deck'`.
  // So the bug is not "names the hand", it is "names the DESTINATION" -- and a population detector
  // keyed on "a deck search paired with a reveal" cannot see this direction at all.
  yield store.prompt(state, new ShowCardsPrompt(
    opponent.id,
    GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
    cards
  ), () => next());

  // Put Pokemon from hand into the deck
  MOVE_CARDS(store, state, player.hand, player.deck, { cards: cards, sourceCard: effect.trainerCard });

  const minMax = cards.length;

  // TA-423 / A.9 (2026-09-14): "search your deck for up to that many Pokemon" is a category search of
  // a SECRET zone, so it is always whiffable to 0 -- deck contents are technically unknown, so the
  // player may decline to find even when a Pokemon is present (Meta-Ruling / Roll Call / Computer
  // Search carve-out). Hence `min: 0`. #2301's Trainer min-1 binds only the PUBLIC hand-reveal above
  // (that prompt stays `min: 1`), NOT this secret deck search. `max` stays `minMax`.
  // (History: TA-319 first set this `min: minMax -> min: 1`; A.9 relaxed it further to `min: 0` and
  //  overturned RE-134 -- rotomancer's confirm{false} 0-take here is the CORRECT fail-to-find.)
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_HAND,
    player.deck,
    { superType: SuperType.POKEMON },
    { min: 0, max: minMax, allowCancel: false }
  ), selected => {
    cards = selected || [];
    next();
  });

  // TA-265 residual / §B.34: the reveal is printed BEFORE the card changes zones, so the
  // `reveal` event must name the SOURCE zone. Showing after the move made the adapter read the
  // card's zone with the move already applied, and it reported the DESTINATION.
  if (cards.length > 0) {
    yield store.prompt(state, new ShowCardsPrompt(
      opponent.id,
      GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
      cards
    ), () => next());
  }

  MOVE_CARDS(store, state, player.deck, player.hand, { cards: cards, sourceCard: effect.trainerCard });

  return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
  });
}

export class Perrin extends TrainerCard {

  public regulationMark = 'H';
  protected _trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'TWM';
  public name: string = 'Perrin';
  public fullName: string = 'Perrin TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '160';

  public text: string =
    'Reveal up to 2 Pokémon in your hand and put them into your deck. If you do, search your deck for up to that many Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    const hasPokemon = player.hand.cards.some(c => c instanceof PokemonCard);
    if (!hasPokemon) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}
