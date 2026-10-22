import { CardType, ChooseCardsPrompt, EnergyCard, EnergyType, GameError, GameMessage, PlayerType, State, StateUtils, StoreLike, SuperType, TrainerCard, TrainerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { HealEffect, UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { IS_STADIUM_EFFECT_BLOCKED } from '../../../game/store/prefabs/stadium-effect';

export class MoonlightHill extends TrainerCard {
  public regulationMark = 'G';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '81';
  protected _trainerType = TrainerType.STADIUM;
  public set = 'PAF';
  public name = 'Moonlit Hill';
  public fullName = 'Moonlit Hill PAF';
  public text = 'Once during each player\'s turn, that player may discard a Basic [P] Energy from their hand. If they do, they may heal 30 damage from each of their Pokémon.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const player = effect.player;
      const stadiumUsedTurn = player.stadiumUsedTurn;

      const hasPsychicBasic = player.hand.cards.some(c =>
        c instanceof EnergyCard &&
        c.energyType === EnergyType.BASIC &&
        c.provides.includes(CardType.PSYCHIC)
      );

      if (!hasPsychicBasic) {
        throw new GameError(GameMessage.CANNOT_USE_STADIUM);
      }
      // TA-723 / B.29, B.47: the discard is only the price of the heal; with no damage on any of this player's Pokémon
      // the heal does nothing, so the Stadium cannot be used.
      let anyDamaged = false;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => { anyDamaged = anyDamaged || cardList.damage > 0; });
      if (!anyDamaged) {
        throw new GameError(GameMessage.CANNOT_USE_STADIUM);
      }

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Psychic Energy' },
        // TA-744 / CF-14: using the Stadium is the "may"; the discard is its price, not a second choice. A cancelable
        // pick never collapses, so with one Basic [P] Energy in hand the player was asked a pick with one answer.
        { allowCancel: false, min: 1, max: 1 }
      ), cards => {
        cards = cards || [];
        if (cards.length === 0) {
          player.stadiumUsedTurn = stadiumUsedTurn;
          return;
        }

        MOVE_CARDS(store, state, player.hand, player.discard, { cards, sourceCard: this });

        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
          if (IS_STADIUM_EFFECT_BLOCKED(store, state, player, cardList, this)) {
            return;
          }
          store.reduceEffect(state, new HealEffect(player, cardList, 30));
        });
      });
    }

    return state;
  }
}
