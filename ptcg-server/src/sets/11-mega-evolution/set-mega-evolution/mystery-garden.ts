import { Card, CardType, GameError, GameMessage, PlayerType, PokemonCard, State, StateUtils, StoreLike, SuperType, TrainerCard, TrainerType } from '../../../game';
import { UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { Effect } from '../../../game/store/effects/effect';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';


function* useStadium(next: Function, store: StoreLike, state: State, effect: UseStadiumEffect): IterableIterator<State> {
  const player = effect.player;

  if (player.hand.cards.every(c => c.superType !== SuperType.ENERGY)) {
    throw new GameError(GameMessage.CANNOT_USE_STADIUM);
  }

  let psychicPokemon = 0;
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
    if (card instanceof PokemonCard && card.cardType === CardType.PSYCHIC) {
      psychicPokemon++;
    }
  });

  // TA-161 / compendium #2232 (this card): "Can I use Mystery Garden if I won't be able to draw
  // cards? — No, you can't just discard an Energy card for no draw." Judge the draw against the hand
  // the EFFECT will see, not the one the player is holding: the discard is a cost, not the effect
  // (#1004), so one card is already gone by the time the draw target is compared. Hence
  // `>= hand.length` and not `> hand.length` — with 1 Psychic in play and the Energy as the only
  // card in hand, this reads inert before the payment and draws 1 after it.
  if (psychicPokemon < player.hand.cards.length || player.deck.cards.length === 0) {
    throw new GameError(GameMessage.CANNOT_USE_STADIUM);
  }

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_DISCARD,
    player.hand,
    { superType: SuperType.ENERGY },
    { min: 1, max: 1, allowCancel: true }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length === 0) {
    return state;
  }

  player.hand.moveCardsTo(cards, player.discard);

  const cardsToDraw = psychicPokemon - player.hand.cards.length;
  if (cardsToDraw > 0) {
    player.deck.moveTo(player.hand, cardsToDraw);
  }

  return state;
}

export class MysteryGarden extends TrainerCard {

  public trainerType: TrainerType = TrainerType.STADIUM;
  public set: string = 'MEG';
  public regulationMark = 'I';
  public setNumber: string = '122';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Mystery Garden';
  public fullName: string = 'Mystery Garden M1S';
  public text: string = 'Once during each player\'s turn, that player may discard 1 Energy card from their hand. If they do, that player draws cards until they have as many cards in hand as they have Psychic Pokémon in play.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const generator = useStadium(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

} 