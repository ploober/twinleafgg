import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import {
  PokemonCard,
  StoreLike,
  State,
  StateUtils,
  ChoosePokemonPrompt,
  GameMessage,
  PlayerType,
  SlotType,
} from '../../../game';
import { PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Keldeo extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 110;
  public cardType: CardType[] = [W];
  public weakness = [{ type: L }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Shoot Through',
      cost: [W],
      damage: 20,
      text: "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
    {
      name: 'Reflect Energy',
      cost: [W, W],
      damage: 70,
      text: 'Move an Energy from this Pokémon to 1 of your Benched Pokémon.',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '19';
  public name: string = 'Keldeo';
  public fullName: string = 'Keldeo M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const hasBench = opponent.bench.some((b) => b.cards.length > 0);
      if (hasBench) {
        return store.prompt(
          state,
          new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
            PlayerType.TOP_PLAYER,
            [SlotType.BENCH],
            { min: 1, max: 1, allowCancel: false },
          ),
          (selected) => {
            const targets = selected || [];
            if (targets.length > 0) {
              const benchTarget = targets[0];
              const putDamage = new PutDamageEffect(effect, 20);
              putDamage.target = benchTarget;
              store.reduceEffect(state, putDamage);
            }
          },
        );
      }
    }
    // Reflect Energy
    if (WAS_ATTACK_USED(effect, 1, this)) {
      // TA-651 / B.82 (1), B.85 (1)(c): the Energy is chosen before the damage (recorded as `chosen`) and moves after it.
      return MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST(store, state, effect, this);
    }
    return state;
  }
}
