import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, TrainerType, SuperType } from '../../../game/store/card/card-types';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { StoreLike, State, StateUtils, GameMessage, TrainerCard, ChooseCardsPrompt, Card, ShowCardsPrompt, SelectPrompt, ShuffleDeckPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { IS_ABILITY_BLOCKED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { ConfirmPrompt } from '../../../game';

export class Pelipper extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Wingull';
  public cardType: CardType[] = [CardType.COLORLESS];
  public hp: number = 120;
  public weakness = [{ type: CardType.LIGHTNING }];
  public resistance = [{ type: CardType.FIGHTING, value: -30 }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public powers = [{
    name: 'Hearsay',
    powerType: PowerType.ABILITY,
    text: 'When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may choose 1: put a Supporter card from your discard pile into your hand; or search your deck for a Supporter card, reveal it, put it into your hand, and then shuffle your deck. '
  }];

  public attacks = [{
    name: 'Wing Attack',
    cost: [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS],
    damage: 90,
    text: ''
  }];

  public set: string = 'PAL';
  public setNumber: string = '159';
  public regulationMark: string = 'G';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Pelipper';
  public fullName: string = 'Pelipper PAL';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // if (player.deck.cards.length === 0) {
      //   return state;
      // }

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // TA-509: "you may choose 1: ..." -- the "may" is a decline (CF-32: confirm{true,false}), and only a mode the
      // player can perform is offered: the discard mode needs a Supporter in the (public) discard pile; the deck mode
      // needs a deck to search (a hidden zone, so the search may find nothing). With one mode left it applies directly
      // (CF-14). Before, a SelectPrompt with no cancel always offered both modes and refused the discard mode on a
      // discard with no Supporter.
      const hasSupporterInDiscard = player.discard.cards.some(c => {
        return c instanceof TrainerCard && c.trainerType === TrainerType.SUPPORTER;
      });
      const canSearchDeck = player.deck.cards.length > 0;
      if (!hasSupporterInDiscard && !canSearchDeck) {
        return state;
      }

      const fromDiscard = () => {
        store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_HAND,
          player.discard,
          { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
          { min: 1, max: 1, allowCancel: false }
        ), selected => {
          const cards: Card[] = selected || [];
          if (cards.length > 0) {
            store.prompt(state, [new ShowCardsPrompt(
              opponent.id,
              GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
              cards
            )], () => {
              MOVE_CARDS(store, state, player.discard, player.hand, { cards: cards, sourceCard: this });
            });
          }
        });
      };

      const fromDeck = () => {
        store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_HAND,
          player.deck,
          { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
          { min: 0, max: 1, allowCancel: false }
        ), selected => {
          const cards: Card[] = selected || [];
          const shuffle = () => {
            store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
              player.deck.applyOrder(order);
            });
          };
          if (cards.length === 0) {
            shuffle();
            return;
          }
          // "reveal it, put it into your hand, and then shuffle your deck"
          store.prompt(state, [new ShowCardsPrompt(
            opponent.id,
            GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
            cards
          )], () => {
            MOVE_CARDS(store, state, player.deck, player.hand, { cards: cards, sourceCard: this });
            shuffle();
          });
        });
      };

      const options: { message: GameMessage, action: () => void }[] = [];
      if (hasSupporterInDiscard) {
        options.push({ message: GameMessage.CHOOSE_SUPPORTER_FROM_DISCARD, action: fromDiscard });
      }
      if (canSearchDeck) {
        options.push({ message: GameMessage.CHOOSE_SUPPORTER_FROM_DECK, action: fromDeck });
      }

      return store.prompt(state, new ConfirmPrompt(player.id, GameMessage.WANT_TO_USE_ABILITY), wantToUse => {
        if (!wantToUse) {
          return;
        }
        if (options.length === 1) {
          options[0].action();
          return;
        }
        store.prompt(state, new SelectPrompt(
          player.id,
          GameMessage.CHOOSE_OPTION,
          options.map(opt => opt.message),
          { allowCancel: false }
        ), choice => {
          options[choice].action();
        });
      });

    }

    return state;
  }
}