import { GameError } from '../../../game/game-error';
import { GameMessage } from '../../../game/game-message';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { Player } from '../../../game/store/state/player';
import { State } from '../../../game/store/state/state';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { PlayerType } from '../../../game/store/actions/play-card-action';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
export class TeamRocketsAriana extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  protected _tags = [CardTag.TEAM_ROCKET];
  public regulationMark = 'I';
  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '171';
  public name: string = "Team Rocket's Ariana";
  public fullName: string = "Team Rocket's Ariana DRI";

  public text: string =
    "Draw cards until you have 5 cards in your hand. If all of your Pokémon in play are Team Rocket's Pokemon, draw cards until you have 8 cards in your hand instead.";

  /**
   * The printed target, computed from the board: 8 when the player HAS Pokemon in play and every one
   * of them is a Team Rocket's Pokemon, otherwise 5. Shared with `reduceEffect` on purpose — a gate
   * that recomputes the target independently of the effect it gates can drift away from it, and then
   * the card is offered for a draw it will not perform.
   */
  private targetHandSize(player: Player): number {
    let allTeamRocket = true;
    let hasPokemon = false;

    if (player.active.cards.length > 0) {
      hasPokemon = true;
      const activePokemon = player.active.getPokemonCard();
      if (!activePokemon || !activePokemon.tags
        || !activePokemon.hasTag(CardTag.TEAM_ROCKET)) {
        allTeamRocket = false;
      }
    }

    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
      if (cardList !== player.active && card instanceof PokemonCard) {
        hasPokemon = true;
        if (!card.tags || !card.hasTag(CardTag.TEAM_ROCKET)) {
          allTeamRocket = false;
        }
      }
    });

    return (hasPokemon && allTeamRocket) ? 8 : 5;
  }

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }

    // TA-270 / §B.36: a COUNT that computes to zero makes the card unplayable — *"you cannot play a
    // Trainer card for no effect"* (#925, #1030). Compendium **#1042 (Hugh)** is this card's
    // arithmetic verbatim: *"If I have 6 cards in my hand including a Hugh ... can I play Hugh? — No.
    // After playing Hugh both players would have exactly 5 cards in their hands."* Note WHERE it
    // counts from: the hand AFTER the Supporter has left it, so the card's own trip to the discard is
    // not an effect. Hence `- 1`.
    const handAfterPlay = player.hand.cards.length - 1;
    if (handAfterPlay >= this.targetHandSize(player)) {
      return false;
    }

    // §B.29 / the other half: the count is non-zero but there is nothing to draw FROM.
    if (player.deck.cards.length === 0) {
      return false;
    }

    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      const supporterTurn = player.supporterTurn;
      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      player.rocketSupporter = true;
      player.hand.moveCardTo(effect.trainerCard, player.supporter);
      effect.preventDefault = true;

      // Same computation the play gate uses — see `targetHandSize`.
      const targetHandSize = this.targetHandSize(player);

      // Draw until target hand size is reached
      while (player.hand.cards.length < targetHandSize) {
        if (player.deck.cards.length === 0) {
          break;
        }
        player.deck.moveTo(player.hand, 1);
      }

      return state;
    }

    if (effect instanceof EndTurnEffect && effect.player.rocketSupporter) {
      effect.player.rocketSupporter = false;
    }

    return state;
  }
}
