import { Card } from '../../../game/store/card/card';
import { GameMessage } from '../../../game/game-message';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType, EnergyType, CardType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { StateUtils } from '../../../game/store/state-utils';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { ShowCardsPrompt } from '../../../game/store/prompts/show-cards-prompt';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardList, EnergyCard, Player, pokemonHasCardType } from '../../../game';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* playCard(
  next: Function,
  store: StoreLike,
  state: State,
  self: BugCatchingSet,
  effect: TrainerEffect,
): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);
  let cards: Card[] = [];

  MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: self });
  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  let grassPokemonOrEnergyCount: number = 0;
  const blocked: number[] = [];
  player.deck.cards.forEach((c, index) => {
    const isPokemon = c instanceof PokemonCard && pokemonHasCardType(c, CardType.GRASS);
    const isBasicEnergy =
      c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.name === 'Grass Energy';
    if (isPokemon || isBasicEnergy) {
      grassPokemonOrEnergyCount += 1;
    } else {
      blocked.push(index);
    }
  });

  const maxGrassPokemonOrEnergyCount = Math.min(grassPokemonOrEnergyCount, 2);

  const deckTop = new CardList();
  MOVE_CARDS(store, state, player.deck, deckTop, { count: 7, sourceCard: self });

  yield store.prompt(
    state,
    new ChooseCardsPrompt(
      player,
      GameMessage.CHOOSE_CARD_TO_HAND,
      deckTop,
      {},
      { min: 0, max: maxGrassPokemonOrEnergyCount, allowCancel: false, blocked },
    ),
    (selected) => {
      cards = selected || [];
      next();
    },
  );

  if (cards.length === 0) {
    // TA-387 (2026-09-07): "Shuffle the other cards back into your deck" — on a DECLINE the other cards
    // are all seven, so the shuffle is owed exactly as on the take path (B.33: the shuffle's object is
    // non-empty). This used to return without shuffling, leaving the window in player-known order
    // (rotomancer shuffles). The shuffle is externalized as the same system pending as below.
    deckTop.moveTo(player.deck); // TA-387: the other cards are shuffled back on a decline too
    return store.prompt(state, new ShuffleDeckPrompt(player.id), (order) => {
      player.deck.applyOrder(order);
    });
  }
  // B.80 / B.81 (amends the TA-265 residual / §B.34 staging): the looked-at window is LIFTED (in transit), and a
  // card revealed out of it is revealed `from: transit`. The window used to go back into the deck first so the
  // reveal would say `deck`; that parked every card at the deck bottom before the take. Reveal from the window,
  // take the chosen cards from it, and only then return the others for the shuffle.
  if (cards.length > 0) {
    yield store.prompt(
      state,
      new ShowCardsPrompt(opponent.id, GameMessage.CARDS_SHOWED_BY_THE_OPPONENT, cards),
      () => next(),
    );
  }

  deckTop.moveCardsTo(cards, player.hand);
  MOVE_CARDS(store, state, deckTop, player.deck, { sourceCard: self });

  return store.prompt(state, new ShuffleDeckPrompt(player.id), (order) => {
    player.deck.applyOrder(order);
  });
}

export class BugCatchingSet extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public regulationMark = 'H';
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '143';
  public name: string = 'Bug Catching Set';
  public fullName: string = 'Bug Catching Set TWM';

  public text: string =
    'Look at the top 7 cards of your deck. You may reveal up to 2 in any combination of [G] Pokémon and Basic [G] Energy cards you find there and put them into your hand. Shuffle the other cards back into your deck.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }

    return state;
  }
}
