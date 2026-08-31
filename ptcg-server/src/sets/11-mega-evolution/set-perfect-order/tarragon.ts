import { GameError, PokemonCard, Player, pokemonHasCardType } from '../../../game';
import { GameMessage } from '../../../game/game-message';
import { Card } from '../../../game/store/card/card';
import { CardType, EnergyType, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { DiscardToHandEffect, TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { ShowCardsPrompt } from '../../../game/store/prompts/show-cards-prompt';
import { StateUtils } from '../../../game/store/state-utils';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

function* playCard(next: Function, store: StoreLike, state: State, self: Tarragon, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);
  let cards: Card[] = [];

  const supporterTurn = player.supporterTurn;

  if (supporterTurn > 0) {
    throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
  }

  player.hand.moveCardTo(effect.trainerCard, player.supporter);
  // We will discard this card after prompt confirmation
  effect.preventDefault = true;

  let pokemons = 0;
  let energies = 0;
  const blocked: number[] = [];
  player.discard.cards.forEach((c, index) => {
    if (c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC && c.name === 'Fighting Energy') {
      energies += 1;
    } else if (c instanceof PokemonCard && pokemonHasCardType(c, CardType.FIGHTING)) {
      pokemons += 1;
    } else {
      blocked.push(index);
    }
  });

  const maxPokemons = Math.min(pokemons, 4);
  const maxEnergies = Math.min(energies, 4);
  const count = 4;

  yield store.prompt(state, new ChooseCardsPrompt(
    player,
    GameMessage.CHOOSE_CARD_TO_HAND,
    player.discard,
    {},
    { min: 0, max: count, allowCancel: false, blocked, maxPokemons, maxEnergies }
  ), selected => {
    cards = selected || [];
    next();
  });

  player.discard.moveCardsTo(cards, player.hand);


  if (cards.length > 0) {
    yield store.prompt(state, new ShowCardsPrompt(
      opponent.id,
      GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
      cards
    ), () => next());
  }
}

export class Tarragon extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '85';
  public regulationMark = 'J';
  public name: string = 'Tarragon';
  public fullName: string = 'Tarragon M3';
  public text: string = 'Put up to 4 in any combination of [F] Pokémon and Basic [F] Energy cards from your discard pile into your hand.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    // §B.18: "Put **up to 4** …" is a TRAINER effect, and compendium **#2301** floors a Trainer's
    // "up to X" at **1**, not 0 (only *attack* effects may take zero). With no [F] Pokémon and no
    // Basic [F] Energy in the discard that floor is unreachable, so **#925** makes the card
    // unplayable rather than a legal no-op that burns the turn's Supporter.
    //
    // The #968 untyped-search exception does not reach this: fail-to-find is a HIDDEN-zone doctrine
    // ("the contents of the deck are unknown"), and this is a TYPED retrieval from the discard pile,
    // where contents and quantity are both public.
    //
    // The predicate deliberately mirrors `playCard`'s own classification below — same energy test,
    // same Pokémon test — so `canPlay` and `reduceEffect` cannot disagree the way TA-181 does.
    return player.discard.cards.some(c =>
      (c.superType === SuperType.ENERGY && (c as any).energyType === EnergyType.BASIC && c.name === 'Fighting Energy')
      || (c instanceof PokemonCard && pokemonHasCardType(c, CardType.FIGHTING)));
  }


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      // Check if DiscardToHandEffect is prevented
      const discardEffect = new DiscardToHandEffect(player, this);
      store.reduceEffect(state, discardEffect);

      if (discardEffect.preventDefault) {
        // If prevented, just discard the card and return

        return state;
      }

      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }
    return state;
  }
}