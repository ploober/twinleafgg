import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, TrainerType, SpecialCondition } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, GameMessage, ChooseCardsPrompt, ShowCardsPrompt, TrainerCard } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { USE_COPIED_SUPPORTER_EFFECT, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class MrMime extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.PSYCHIC];

  public hp: number = 90;

  public weakness = [{ type: CardType.DARK }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [CardType.COLORLESS];

  public attacks =
    [
      {
        name: 'Look-Alike Show',
        cost: [CardType.COLORLESS],
        damage: 0,
        text: 'Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.'
      },
      {
        name: 'Eerie Wave',
        cost: [CardType.PSYCHIC],
        damage: 20,
        text: 'Your opponent\'s Active Pokémon is now Confused.'
      }
    ];

  public set: string = 'TEF';

  public regulationMark = 'H';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '63';

  public name: string = 'Mr. Mime';

  public fullName: string = 'Mr. Mime TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Look-Alike Show is an ATTACK: special conditions (Poison/Burn/Confusion) do NOT prevent
      // attacking — only Asleep/Paralyzed do, which the engine already enforces. The old
      // `specialConditions.length > 0` guard wrongly blocked a Poisoned/Burned Mr. Mime.
      // TA-727 / B.97 (TA-690's shape): "Your opponent reveals their hand": the whole hand is shown before the pick.
      return store.prompt(state, new ShowCardsPrompt(
        player.id,
        GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
        opponent.hand.cards
      ), () => store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_COPY_EFFECT,
        opponent.hand,
        { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
        { allowCancel: false, min: 0, max: 1 }
      ), cards => {
        if (cards === null || cards.length === 0) {
          return;
        }
        // TA-729: the effect is used, the card is not played (compendium #660).
        USE_COPIED_SUPPORTER_EFFECT(store, state, player, cards[0] as TrainerCard);
      }));
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const specialConditionEffect = new AddSpecialConditionsEffect(effect, [SpecialCondition.CONFUSED]);
      store.reduceEffect(state, specialConditionEffect);
    }
    return state;
  }
}
