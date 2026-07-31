import { ChoosePokemonPrompt, GameError, Player, PlayerType, SlotType } from '../../../game';
import { GameMessage } from '../../../game/game-message';
import { TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

export class Surfer extends TrainerCard {

  public trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '187';

  public regulationMark = 'H';

  public name: string = 'Surfer';

  public fullName: string = 'Surfer SSP';

  public text: string =
    'Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, draw cards until you have 5 cards in your hand.';


  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
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

      player.hand.moveCardTo(effect.trainerCard, player.supporter);
      // We will discard this card after prompt confirmation
      effect.preventDefault = true;

      return store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_SWITCH,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { allowCancel: false }
      ), result => {
        const cardList = result[0];
        // TA-171: `switchPokemon` only dispatches MovedToActiveEffect / MovedFromActiveToBenchEffect
        // when it is handed store+state — both are optional parameters, so a call site that omits
        // them performs the switch SILENTLY and every "when this Pokémon moves from your Bench to
        // the Active Spot" Ability is skipped. Yanmega ex dri-003's "Buzzing Boost" was never
        // offered after a Surfer switch; rotomancer offers it.
        //
        // The DRAW STAYS BELOW THE SWITCH, and that ordering is the rule, not an accident:
        // compendium #2142 asks this exact pairing — "If I use Surfer to switch in Yanmega ex, do I
        // draw cards for Surfer first or do I use Yanmega ex's Buzzing Boost Ability first? — You
        // must complete the use of Surfer FIRST and draw cards, then you get to use Buzzing Boost
        // afterward." #1198 (Welder + Eevee's Energy Evolution) is the same rule on a different pair.
        // The arrival Ability's prompt is queued by the dispatch and resolves after this callback
        // returns, so the hand has already been filled to 5 when the player is asked.
        player.switchPokemon(cardList, store, state);

        while (player.hand.cards.length < 5) {
          if (player.deck.cards.length === 0) {
            break;
          }
          player.deck.moveTo(player.hand, 1);
        }

        return state;
      });

    }
    return state;
  }



}