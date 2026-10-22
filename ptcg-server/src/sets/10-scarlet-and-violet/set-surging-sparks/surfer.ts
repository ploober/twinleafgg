import { ChoosePokemonPrompt, GameError, Player, PlayerType, SlotType } from '../../../game';
import { GameMessage } from '../../../game/game-message';
import { TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Surfer extends TrainerCard {

  protected _trainerType: TrainerType = TrainerType.SUPPORTER;

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
    // TA-173 / CF-33: with an empty Bench there is nothing to switch in, the switch does not happen,
    // and the draw is conditional on it ("IF YOU DO") — so the whole card achieves nothing and must
    // not be offered. This is the no-effect-Trainer family (cf. RE-57/RE-58 on the rotomancer side).
    // Deliberately gated on the BENCH and not on the hand size: "can this card do anything" is a
    // question about the switch, and a hand-size proxy answers a different one.
    return player.bench.some(b => b.cards.length > 0);
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {

      const player = effect.player;

      const supporterTurn = player.supporterTurn;

      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: this });
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
        const activeBefore = player.active;
        player.switchPokemon(cardList, store, state);

        // TA-172: the draw is conditional — "Switch your Active Pokémon with 1 of your Benched
        // Pokémon. IF YOU DO, draw cards until you have 5 cards in your hand." It ran
        // unconditionally, so on an empty Bench (nothing to switch in, `switchPokemon` is a no-op)
        // twinleaf still drew to five. Compendium #2052 is the ruling for the empty-Bench end of
        // this family. Gate on what the switch ACTUALLY MOVED rather than on any proxy for it —
        // that is rotomancer's note seventeen, where a Bench-occupancy test stood in for "did the
        // switch happen" and held on every board where the move was attempted and REFUSED.
        if (player.active === activeBefore) {
          return state;
        }

        while (player.hand.cards.length < 5) {
          if (player.deck.cards.length === 0) {
            break;
          }
          MOVE_CARDS(store, state, player.deck, player.hand, { count: 1, sourceCard: this });
        }

        return state;
      });

    }
    return state;
  }

}