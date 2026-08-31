import { BoardEffect, CardType, Stage, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { CardList } from '../../../game/store/state/card-list';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { GameMessage } from '../../../game/game-message';
import { GameError, PlayerType, PokemonCard, PowerType, ShowCardsPrompt, ShuffleDeckPrompt, StateUtils } from '../../../game';

import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Tatsugiri extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public regulationMark = 'H';

  public cardType: CardType[] = [CardType.DRAGON];

  public hp: number = 70;

  public weakness = [];

  public resistance = [];

  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Attract Customers',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, if this Pokémon is in the Active Spot, you may look at the top 6 cards of your deck, reveal a Supporter you find there, and put it into your hand. Shuffle the other cards back into your deck.'
  }];

  public attacks = [
    {
      name: 'Surf',
      cost: [CardType.FIRE, CardType.WATER],
      damage: 50,
      text: ''
    }
  ];

  public set: string = 'TWM';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '131';

  public name: string = 'Tatsugiri';

  public fullName: string = 'Tatsugiri TWM';

  public readonly CROWD_PULLER_MARKER = 'CROWD_PULLER_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.CROWD_PULLER_MARKER, this);
      return state;
    }

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      if (player.marker.hasMarker(this.CROWD_PULLER_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      if (player.active.cards[0] !== this) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      const deckTop = new CardList();
      player.deck.moveTo(deckTop, 6);
      const opponent = StateUtils.getOpponent(state, player);

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        deckTop,
        { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
        { min: 0, max: 1, allowCancel: true }
      ), selected => {

        player.marker.addMarker(this.CROWD_PULLER_MARKER, this);

        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
          if (cardList.getPokemonCard() === this) {
            cardList.addBoardEffect(BoardEffect.ABILITY_USED);
          }
        });

        deckTop.moveCardsTo(selected, player.hand);

        // TA-251 / B.33: "Shuffle THE OTHER cards back into your deck" is a SEPARATE, unconditional
        // printed instruction — the up-to-6 looked-at cards minus the taken Supporter. The reveal
        // branch (a Supporter WAS taken) returned WITHOUT shuffling, a MISSING shuffle rotomancer
        // performs (RO-ONLY: it shuffles the other 5 whether or not a Supporter left). It is still
        // suppressed when the object is empty — a lone Supporter looked at and taken leaves no
        // "other cards" (#1979) — so key on the OBJECT going back, not on whether a Supporter was
        // taken. otherCards is counted BEFORE moving the remainder back to the deck.
        const otherCards = deckTop.cards.length;
        deckTop.moveTo(player.deck);

        const shuffleBack = (): State => {
          if (otherCards === 0) {
            return state;
          }
          return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
            player.deck.applyOrder(order);
          });
        };

        if (selected.length > 0) {
          return store.prompt(state, new ShowCardsPrompt(
            opponent.id,
            GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
            selected
          ), () => { return shuffleBack(); });
        }
        return shuffleBack();
      });
    }

    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.CROWD_PULLER_MARKER, this)) {
      effect.player.marker.removeMarker(this.CROWD_PULLER_MARKER, this);
    }

    return state;
  }
}
