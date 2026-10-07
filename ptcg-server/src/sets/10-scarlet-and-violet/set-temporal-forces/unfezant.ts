import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, GameMessage, StateUtils, Card, ChooseCardsPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { CONFIRMATION_PROMPT, THIS_POKEMON_CANNOT_ATTACK_NEXT_TURN, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Unfezant extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Tranquill';
  public cardType: CardType[] = [C];
  public hp: number = 150;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [];
  public attacks = [{
    name: 'Opposing Winds',
    cost: [C, C],
    damage: 70,
    text: 'You may put 2 Energy attached to your opponent\'s Active Pokémon into their hand.'
  },
  {
    name: 'Boundless Power',
    cost: [C, C, C],
    damage: 180,
    text: 'During your next turn, this Pokémon can\'t attack.'
  }];

  public regulationMark: string = 'H';
  public set: string = 'TEF';
  public setNumber = '135';
  public cardImage = 'assets/cardback.png';
  public name: string = 'Unfezant';
  public fullName: string = 'Unfezant TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Opposing Winds. TA-655 / B.89 (1), (4): the "you may" (CF-32 count-2 arm: a standalone confirm) and the pick of
    // the 2 Energy are the attacker's Step-D choices, asked before the damage (each Energy recorded as `chosen`); the
    // damage reads them still attached (#77) and they go to the hand after the damage, before damage reactions and the
    // Knock Out check. At one attached Energy the gate is still offered and takes the one (min(2, available), measured
    // on rotomancer 2026-08-26); at none the may can achieve nothing and nothing is asked (CF-33, the re70 row).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const source = opponent.active;
      const available = opponent.active.cards.filter(c => c.superType === SuperType.ENERGY).length;
      if (available === 0) {
        return state;
      }

      return CONFIRMATION_PROMPT(store, state, player, result => {
        if (!result) {
          return;
        }
        const prompt = new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_HAND, // TA-658: the Energy goes to the opponent's hand (CF-32: a choose, not a discard)
          source,
          { superType: SuperType.ENERGY },
          { min: Math.min(2, available), max: 2, allowCancel: false },
        );
        prompt.deferredMove = true;
        store.prompt(state, prompt, selected => {
          const cards: Card[] = selected || [];
          if (cards.length === 0) {
            return;
          }
          effect.afterDamageMoves.push(() => {
            const still = cards.filter(c => source.cards.includes(c));
            if (still.length > 0) {
              MOVE_CARDS(store, state, source, opponent.hand, { cards: still, sourceCard: this });
            }
          });
        });
      });
    }

    // Boundless Power
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // Legacy implementation:
      // - Set player.active.cannotAttackNextTurnPending = true directly.
      //
      // Converted to prefab version (THIS_POKEMON_CANNOT_ATTACK_NEXT_TURN).
      THIS_POKEMON_CANNOT_ATTACK_NEXT_TURN(player);
    }

    return state;
  }
}
