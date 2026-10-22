import {
  Card,
  CardType,
  GameError,
  GameMessage,
  PlayerType,
  PokemonCard,
  State,
  StateUtils,
  StoreLike,
  SuperType,
  TrainerCard,
  TrainerType,
  pokemonHasCardType,
} from '../../../game';
import { UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* useStadium(
  next: Function,
  store: StoreLike,
  state: State,
  effect: UseStadiumEffect,
): IterableIterator<State> {
  const player = effect.player;

  if (player.hand.cards.every((c) => c.superType !== SuperType.ENERGY)) {
    throw new GameError(GameMessage.CANNOT_USE_STADIUM);
  }

  let psychicPokemon = 0;
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
    if (card instanceof PokemonCard && pokemonHasCardType(card, CardType.PSYCHIC)) {
      psychicPokemon++;
    }
  });

  // TA-161 / compendium #2232 (this card): "Can I use Mystery Garden if I won't be able to draw cards? — No, you can't
  // just discard an Energy card for no draw." Judged against the hand the EFFECT will see: the discard is a cost (#1004),
  // so one card is already gone when the draw target is compared — hence `>=`.
  if (psychicPokemon < player.hand.cards.length || player.deck.cards.length === 0) {
    throw new GameError(GameMessage.CANNOT_USE_STADIUM);
  }

  let cards: Card[] = [];
  yield store.prompt(
    state,
    new ChooseCardsPrompt(
      player,
      GameMessage.CHOOSE_CARD_TO_DISCARD,
      player.hand,
      { superType: SuperType.ENERGY },
      { min: 1, max: 1, allowCancel: true },
    ),
    (selected) => {
      cards = selected || [];
      next();
    },
  );

  if (cards.length === 0) {
    return state;
  }

  MOVE_CARDS(store, state, player.hand, player.discard, {
    cards: cards,
    sourceCard: effect.stadium,
  });

  const cardsToDraw = psychicPokemon - player.hand.cards.length;
  if (cardsToDraw > 0) {
    MOVE_CARDS(store, state, player.deck, player.hand, {
      count: cardsToDraw,
      sourceCard: effect.stadium,
    });
  }

  return state;
}

export class MysteryGarden extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.STADIUM;
  public set: string = 'MEG';
  public regulationMark = 'I';
  public setNumber: string = '122';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Mystery Garden';
  public fullName: string = 'Mystery Garden M1S';
  public text: string =
    "Once during each player's turn, that player may discard an Energy card from their hand in order to draw cards until they have as many cards in their hand as they have Psychic Pokémon in play.";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const generator = useStadium(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }
}
