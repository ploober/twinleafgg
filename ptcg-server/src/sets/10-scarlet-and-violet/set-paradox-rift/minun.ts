import { PlayerType, PowerType, State, StateUtils, StoreLike } from '../../../game';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect, PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';
import { AttachEnergyEffect } from '../../../game/store/effects/play-card-effects';
import { IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class Minun extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [CardType.LIGHTNING];
  public hp: number = 70;
  public weakness = [{ type: CardType.FIGHTING }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Buddy Pulse',
    powerType: PowerType.ABILITY,
    text: 'If you have Plusle in play, whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon. The effect of Buddy Pulse doesn\'t stack.'
  }];

  public attacks = [{
    name: 'Speed Ball',
    cost: [CardType.LIGHTNING],
    damage: 20,
    text: '',
  }];

  public set: string = 'PAR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '61';
  public name: string = 'Minun';
  public regulationMark: string = 'G';
  public fullName: string = 'Minun PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AttachEnergyEffect) {
      if (effect.buddyPulseSV) {
        return state;
      }

      const attachingPlayer = effect.player;
      const abilityOwner = StateUtils.getOpponent(state, attachingPlayer);

      if (!StateUtils.isPokemonInPlay(abilityOwner, this)) {
        return state;
      }

      // TA-641: "attaches an Energy card from their hand" -- not an attach from the discard or the deck. Read from the
      // attach itself: inside the attach-trigger window (B.52) the card has already left the hand.
      if (!effect.fromHand) {
        return state;
      }

      let hasPlusleInPlay = false;
      abilityOwner.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
        if (card.name === 'Plusle') {
          hasPlusleInPlay = true;
        }
      });

      if (!hasPlusleInPlay) {
        return state;
      }

      if (IS_ABILITY_BLOCKED(store, state, abilityOwner, this)) {
        return state;
      }

      store.reduceEffect(
        state,
        new PlaceDamageCountersEffect(
          abilityOwner,
          effect.target,
          20,
          this,
          this.powers[0],
        ),
      );
      effect.buddyPulseSV = true;
    }

    return state;
  }
}
