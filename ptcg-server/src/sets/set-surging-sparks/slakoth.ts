import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, PokemonCardList, StateUtils, GameError, GameMessage } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { HealEffect } from '../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../game/store/effects/game-phase-effects';
import { CheckRetreatCostEffect } from '../../game/store/effects/check-effects';
import { WAS_ATTACK_USED } from '../../game/store/prefabs/prefabs';

export class Slakoth extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType = CardType.COLORLESS;

  public hp: number = 60;

  public weakness = [{ type: CardType.FIGHTING }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Take It Easy',
      cost: [CardType.COLORLESS],
      damage: 0,
      text: 'Heal 60 damage from this Pokemon. During your next turn, this Pokemon can\'t retreat.'
    }
  ];

  public set: string = 'SSP';

  public setNumber = '145';

  public cardImage = 'assets/cardback.png';

  public regulationMark: string = 'H';

  public name: string = 'Slakoth';

  public fullName: string = 'Slakoth SSP';

  private readonly CANT_RETREAT_PENDING_MARKER = 'CANT_RETREAT_PENDING_MARKER';
  private readonly CANT_RETREAT_ACTIVE_MARKER = 'CANT_RETREAT_ACTIVE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Take It Easy
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const cardList = StateUtils.findCardList(state, this) as PokemonCardList;

      // Do heal effect
      const healEffect = new HealEffect(player, cardList, 60);
      store.reduceEffect(state, healEffect);

      // "During your next turn, this Pokemon can't retreat." — two-stage
      // marker on this Pokemon's own card list: armed at the end of the turn
      // the attack was used, expired at the end of the player's next turn.
      cardList.marker.addMarker(this.CANT_RETREAT_PENDING_MARKER, this);
    }

    if (effect instanceof EndTurnEffect) {
      const cardList = StateUtils.findCardList(state, this);
      if (cardList instanceof PokemonCardList
        && StateUtils.findOwner(state, cardList) === effect.player) {
        // NOT else-if: a re-use during the blocked turn has BOTH markers at this
        // end-of-turn — the old block expires AND the new one arms.
        if (cardList.marker.hasMarker(this.CANT_RETREAT_ACTIVE_MARKER, this)) {
          cardList.marker.removeMarker(this.CANT_RETREAT_ACTIVE_MARKER, this);
        }
        if (cardList.marker.hasMarker(this.CANT_RETREAT_PENDING_MARKER, this)) {
          cardList.marker.removeMarker(this.CANT_RETREAT_PENDING_MARKER, this);
          cardList.marker.addMarker(this.CANT_RETREAT_ACTIVE_MARKER, this);
        }
      }
    }

    // Block this Pokemon's retreat while the marker is armed.
    if (effect instanceof CheckRetreatCostEffect) {
      const cardList = StateUtils.findCardList(state, this);
      if (cardList === effect.player.active
        && cardList instanceof PokemonCardList
        && cardList.marker.hasMarker(this.CANT_RETREAT_ACTIVE_MARKER, this)) {
        throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
      }
    }

    return state;
  }

}
