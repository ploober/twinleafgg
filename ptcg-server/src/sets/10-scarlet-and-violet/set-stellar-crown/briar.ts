import { GameError, GameMessage, GamePhase, Player, State, StateUtils, StoreLike, TrainerCard, TrainerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Briar extends TrainerCard {

  protected _trainerType: TrainerType = TrainerType.SUPPORTER;
  public regulationMark = 'H';
  public set: string = 'SCR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '132';
  public name: string = 'Briar';
  public fullName: string = 'Briar SCR';

  public text: string =
    `You can use this card only if your opponent has exactly 2 Prize cards remaining.

During this turn, if your opponent's Active Pokémon is Knocked Out by damage from an attack used by your Tera Pokémon, take 1 more Prize card.`;

  public extraPrizes = false;
  // TA-477: "during this turn" - the extra Prize is owed only on the turn Briar was played.
  public extraPrizesTurn = -1;

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    // TA-476: the only printed play condition is the opponent's 2 remaining Prizes (no discard requirement).
    return StateUtils.getOpponent(state, player).getPrizeLeft() === 2;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const supporterTurn = player.supporterTurn;

      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: this });
      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      if (opponent.getPrizeLeft() !== 2) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      this.extraPrizes = true;
      this.extraPrizesTurn = state.turn;
      return state;
    }

    if (effect instanceof KnockOutEffect && effect.target === effect.player.active) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Do not activate between turns, or when it's not opponents turn.
      if (state.phase !== GamePhase.ATTACK || state.players[state.activePlayer] !== opponent) {
        return state;
      }

      // Check if the knocked out Pokémon belongs to the opponent and if extra prize should be taken
      if (effect.target === player.active) {
        const attackingPokemon = opponent.active;
        if (attackingPokemon.isTera() && this.extraPrizes && this.extraPrizesTurn === state.turn) {
          if (effect.prizeCount > 0) {
            effect.prizeCount += 1;
          }
        }
        this.extraPrizes = false;
      }
      MOVE_CARDS(store, state, player.supporter, player.discard, { cards: [this], sourceCard: this });
      return state;
    }
    return state;
  }
}