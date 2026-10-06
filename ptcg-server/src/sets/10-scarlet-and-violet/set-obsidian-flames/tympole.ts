import { ChooseCardsPrompt, GameMessage, State, StateUtils, StoreLike } from '../../../game';
import { CardType, Stage, SuperType } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import { Effect } from '../../../game/store/effects/effect';

import { AFTER_ATTACK, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';

export class Tympole extends PokemonCard {
  public regulationMark = 'G';
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [W];
  public hp: number = 70;
  public weakness = [{ type: L }];
  public retreat = [C];

  public attacks = [{
    name: 'Screw Tail',
    cost: [W],
    damage: 10,
    text: 'Flip a coin. If heads, discard an Energy from your opponent\'s Active Pokémon.'
  }];

  public set: string = 'OBF';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '50';
  public name: string = 'Tympole';
  public fullName: string = 'Tympole OBF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-498 / TA-499: "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon." A guard above
    // the flip returned when the Defending Pokémon had no Energy, skipping the flip; the flip is a step of the attack
    // and is flipped even when heads can do nothing (#1661, TA-306), so only the discard is gated. The flip is an
    // effect of the attack and runs after the base damage (#649, TA-494 family A), so it is keyed on AFTER_ATTACK.
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const attackEffect = effect.attackEffect;

      return COIN_FLIP_PROMPT(store, state, player, result => {
        if (!result || !opponent.active.cards.some(c => c.superType === SuperType.ENERGY)) {
          return state;
        }
        return store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_DISCARD,
          opponent.active,
          { superType: SuperType.ENERGY },
          { min: 1, max: 1, allowCancel: false }
        ), selected => {
          const discardEnergy = new DiscardCardsEffect(attackEffect, selected || []);
          discardEnergy.target = opponent.active;
          return store.reduceEffect(state, discardEnergy);
        });
      });
    }

    return state;
  }
}
