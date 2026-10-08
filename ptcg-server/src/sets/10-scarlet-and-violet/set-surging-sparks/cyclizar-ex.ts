import { PokemonCard } from '../../../game/store/card/pokemon-card';
import {
  StoreLike,
  State,
  StateUtils,
  CardTag,
  CardType,
  Stage,
  GameMessage,
  ChoosePokemonPrompt,
  PlayerType,
  SlotType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { MAY_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Cyclizarex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [C];
  public hp: number = 210;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Break Through',
      cost: [C, C, C],
      damage: 130,
      text: "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
    {
      name: 'Zircon Road',
      cost: [G, R, P],
      damage: 180,
      text: 'You may draw 5 cards.',
    },
  ];

  public set: string = 'SSP';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '159';
  public name: string = 'Cyclizar ex';
  public fullName: string = 'Cyclizar ex SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Break Through
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const hasBenched = opponent.bench.some((b) => b.cards.length > 0);
      if (!hasBenched) {
        return state;
      }

      return store.prompt(
        state,
        new ChoosePokemonPrompt(
          player.id,
          GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
          PlayerType.TOP_PLAYER,
          [SlotType.BENCH],
          { allowCancel: false },
        ),
        (targets) => {
          if (!targets || targets.length === 0) {
            return;
          }
          const damageEffect = new PutDamageEffect(effect, 30);
          damageEffect.target = targets[0];
          store.reduceEffect(state, damageEffect);
        },
      );
    }

    // Zircon Road. TA-670 (B.101 (4)): the "you may" is asked at Step D, before the damage; the draw is after it
    // (#649). It had been keyed on AFTER_ATTACK (TA-128). CF-33: with an empty deck nothing is asked.
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      if (player.deck.cards.length === 0) {
        return state;
      }
      return MAY_CHOOSE_FIRST(store, state, effect, () => {
        MOVE_CARDS(store, state, player.deck, player.hand, { count: 5, sourceCard: this });
      });
    }

    if (
      effect instanceof PutDamageEffect &&
      effect.target.cards.includes(this) &&
      effect.target.getPokemonCard() === this
    ) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Target is not Active
      if (effect.target === player.active || effect.target === opponent.active) {
        return state;
      }

      effect.preventDefault = true;
    }
    return state;
  }
}
