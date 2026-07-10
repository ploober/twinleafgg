import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { CoinFlipPrompt, GameMessage } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AbstractAttackEffect } from '../../../game/store/effects/attack-effects';
import { StateUtils } from '../../../game/store/state-utils';
import { MarkerConstants } from '../../../game/store/markers/marker-constants';
import { WAS_ATTACK_USED, PREVENT_DAMAGE, CLEAR_MARKER_AND_OPPONENTS_POKEMON_MARKER_AT_END_OF_TURN, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS } from '../../../game/store/prefabs/prefabs';

export class Dunsparce extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = C;
  public hp: number = 60;
  public weakness = [{ type: F }];
  public retreat = [];

  public attacks = [{
    name: 'Gnaw',
    cost: [C],
    damage: 10,
    text: ''
  },
  {
    name: 'Dig',
    cost: [C, C],
    damage: 30,
    text: 'Flip a coin. If heads, during your opponent\'s next turn, prevent all damage from and effects of attacks done to this Pokémon.'
  }];

  public regulationMark = 'H';
  public set: string = 'TEF';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '128';
  public name: string = 'Dunsparce';
  public fullName: string = 'Dunsparce TEF';

  public readonly PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER = 'PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER';
  public readonly CLEAR_PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER = 'CLEAR_PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // "Dig" is attack index 1 ("Gnaw" is index 0, a vanilla 10-damage attack). The coin flip +
    // prevent-damage belongs to Dig; it was wrongly gated on index 0, so Dig did nothing (no flip,
    // turn just ended) while Gnaw wrongly flipped.
    if (WAS_ATTACK_USED(effect, 1, this)) {
      // Rulebook step F / compendium #543/#649: apply damage before the coin-flip rider.
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);

      state = store.prompt(state, new CoinFlipPrompt(effect.player.id, GameMessage.COIN_FLIP), result => {
        if (result) {
          PREVENT_DAMAGE(store, state, effect, this);
        }
      });
    }

    if (effect instanceof AbstractAttackEffect && effect.target.cards.includes(this)) {
      const opponent = StateUtils.getOpponent(state, effect.player);
      const sourceCard = effect.source.getPokemonCard();

      if (sourceCard && opponent.active.marker.hasMarker(MarkerConstants.PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER, this)) {
        effect.preventDefault = true;
      }
    }

    CLEAR_MARKER_AND_OPPONENTS_POKEMON_MARKER_AT_END_OF_TURN(state, effect, MarkerConstants.CLEAR_PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER, MarkerConstants.PREVENT_DAMAGE_DURING_OPPONENTS_NEXT_TURN_MARKER, this);

    return state;
  }
}