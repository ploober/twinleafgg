import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType, TrainerType, SpecialCondition } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, GameMessage, ChooseCardsPrompt, TrainerCard } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';

import { AddSpecialConditionsEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

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
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_COPY_EFFECT,
        opponent.hand,
        { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
        { allowCancel: false, min: 0, max: 1 }
      ), cards => {
        if (cards === null || cards.length === 0) {
          return;
        }
        const trainerCard = cards[0] as TrainerCard;
        const playTrainerEffect = new TrainerEffect(player, trainerCard);
        store.reduceEffect(state, playTrainerEffect);
      });
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const specialConditionEffect = new AddSpecialConditionsEffect(effect, [SpecialCondition.CONFUSED]);
      store.reduceEffect(state, specialConditionEffect);
    }
    return state;
  }
}
