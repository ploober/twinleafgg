import { CardType, Stage } from '../../../game/store/card/card-types';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { Effect } from '../../../game/store/effects/effect';
import { RetreatEffect } from '../../../game/store/effects/game-effects';
import { PokemonCard, StateUtils, StoreLike, State } from '../../../game';
import { CAN_APPLY_ABILITY_TO_TARGET } from '../../../game/store/prefabs/effect-of-ability-prefabs';
import { ADD_MARKER, COIN_FLIP_PROMPT, DISCARD_TOP_X_CARDS_FROM_YOUR_DECK, IS_ABILITY_BLOCKED, REMOVE_MARKER, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { assertRetreatLegal } from '../../../game/store/effect-reducers/retreat-effect';

const GOODRA_SLIMY_SLIP_ALLOWED = 'GOODRA_SLIMY_SLIP_ALLOWED';

export class Goodra extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Sliggoo';
  public hp: number = 160;
  public cardType: CardType[] = [N];
  public weakness: { type: CardType }[] = [];
  public resistance: { type: CardType; value: number }[] = [];
  public retreat = [C, C, C];

  public powers = [{
    name: 'Slimy Sliding',
    powerType: PowerType.ABILITY,
    text: "When your opponent's Active Pokémon retreats, your opponent flips a coin. If tails, Energy for its Retreat Cost is not discarded, and they don't switch Pokémon. The effect of Slimy Sliding doesn't stack.",
  }];

  public attacks = [{
    name: 'Dragon Pulse',
    cost: [W, P],
    damage: 160,
    text: 'Discard the top card of your deck.',
  }];

  public regulationMark = 'J';

  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '68';
  public name: string = 'Goodra';
  public fullName: string = 'Goodra M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Slimy Sliding
    if (effect instanceof RetreatEffect) {
      const retreatingPlayer = effect.player;
      const abilityOwner = StateUtils.getOpponent(state, retreatingPlayer);

      if (retreatingPlayer.marker.hasMarker(GOODRA_SLIMY_SLIP_ALLOWED)) {
        REMOVE_MARKER(GOODRA_SLIMY_SLIP_ALLOWED, retreatingPlayer);
        return state;
      }

      if (!StateUtils.isPokemonInPlay(abilityOwner, this)) {
        return state;
      }

      if (IS_ABILITY_BLOCKED(store, state, abilityOwner, this)) {
        return state;
      }

      if (!CAN_APPLY_ABILITY_TO_TARGET(
        store,
        state,
        abilityOwner,
        this.powers[0],
        this,
        retreatingPlayer.active,
      )) {
        return state;
      }

      // TA-394 (b): this intercept runs BEFORE the retreat reducer's legality checks, so a retreat the menu never
      // offered was accepted and pended a coin flip. Refuse it exactly as the reducer would, first.
      assertRetreatLegal(store, state, effect);

      effect.preventDefault = true;
      return COIN_FLIP_PROMPT(store, state, retreatingPlayer, (result) => {
        if (!result) {
          // TA-394 (a): tails is a legal outcome, not an error — nothing is paid and nothing switches, but it uses up
          // the turn's retreat (compendium #2348, Chaos Rising FAQ 2026-05-21).
          retreatingPlayer.retreatedTurn = state.turn;
          return;
        }
        ADD_MARKER(GOODRA_SLIMY_SLIP_ALLOWED, retreatingPlayer, this);
        effect.preventDefault = false;
        store.reduceEffect(state, effect);
      });
    }

    // Dragon Pulse
    if (WAS_ATTACK_USED(effect, 0, this)) {
      DISCARD_TOP_X_CARDS_FROM_YOUR_DECK(store, state, effect.player, 1, this, effect);
    }

    return state;
  }
}
