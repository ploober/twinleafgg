import { PokemonCard, Stage, CardType, StoreLike, State, StateUtils, PowerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { IS_ABILITY_BLOCKED, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';

export class Togekiss extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Togetic';
  public cardType: CardType[] = [P];
  public hp: number = 140;
  public weakness = [{ type: M }];
  public retreat = [C];

  public powers = [{
    name: 'Wonder Kiss',
    powerType: PowerType.ABILITY,
    text: 'Whenever your opponent\'s Active Pokémon gets Knocked Out, flip a coin. If heads, take 1 more Prize card for that Knock Out. This Ability does not stack.'
  }];

  public attacks = [{
    name: 'Speed Wing',
    cost: [C, C, C],
    damage: 140,
    text: ''
  }];

  public regulationMark = 'H';

  public set: string = 'SSP';
  public setNumber: string = '72';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Togekiss';
  public fullName: string = 'Togekiss SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof KnockOutEffect && effect.target === effect.player.active) {
      const knockedOutOwner = effect.player;
      const attacker = StateUtils.getOpponent(state, knockedOutOwner);

      // Check if this card is in play (active or bench)
      const isInPlay = attacker.active.cards.includes(this) || attacker.bench.some(b => b.cards.includes(this));
      if (!isInPlay) {
        return state;
      }

      // TA-437: Wonder Kiss has NO turn condition in its text (#2043: "The KO can be during either
      // player's turn or during Pokemon Checkup, and it doesn't have to be from an attack"). The old
      // `phase !== ATTACK || activePlayer !== attacker` gate wrongly withheld the flip on a KO of the
      // opponent's Active during the opponent's OWN turn (a self-KO, a reaction-counter KO, or a Checkup
      // Poison/Burn KO). The only conditions are the printed "opponent's Active … Knocked Out" (checked
      // above via `effect.target === effect.player.active`) and this card being in play.
      // NOTE (TA-440, still open): this ability double-flips for one KO because a re-entrant checkState
      // re-dispatches the still-undiscarded victim after the flip resolves, and the per-KO dedup marker
      // does not survive the prompt pause. That is a store-level re-entrancy fix, tracked separately.

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, attacker, this)) {
        return state;
      }

      // Check if ability has already been activated for this knockout
      if (knockedOutOwner.marker.hasMarker('TOGEKISS_KNOCKOUT_FLIP')) {
        return state;
      }

      // Mark ability as used for this knockout
      knockedOutOwner.marker.addMarkerToState('TOGEKISS_KNOCKOUT_FLIP');

      return COIN_FLIP_PROMPT(store, state, attacker, result => {
        if (result === true) {
          //If Heads, take 1 more Prize card for that Knock Out
          if (effect.prizeCount > 0) {
            effect.prizeCount += 1;
          }
        }
        // Remove the marker after the coin flip
        knockedOutOwner.marker.removeMarker('TOGEKISS_KNOCKOUT_FLIP');
      });
    }

    return state;

  }
}