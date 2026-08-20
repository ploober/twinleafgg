import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import {
  PokemonCard,
  StoreLike,
  State,
  StateUtils,
  PlayerType,
  SlotType,
  ChoosePokemonPrompt,
  GameMessage,
  ConfirmPrompt,
} from '../../../game';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { AFTER_ATTACK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DISCARD_UP_TO_X_TYPE_ENERGY_FROM_YOUR_POKEMON } from '../../../game/store/prefabs/costs';

export class Metagross extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Metang';
  public hp: number = 180;
  public cardType: CardType = M;
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Bounce Back',
      cost: [M],
      damage: 60,
      text: 'Your opponent switches their Active Pokémon with 1 of their Benched Pokémon.',
    },
    {
      name: 'Metallic Hammer',
      cost: [M, M, M, C],
      damage: 150,
      damageCalculation: '+',
      text: 'You may discard 3 [M] Energy from this Pokémon and have this attack do 150 more damage.',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '61';
  public name: string = 'Metagross';
  public fullName: string = 'Metagross M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const hasBench = opponent.bench.some((b) => b.cards.length > 0);
      if (!hasBench) return state;
      return store.prompt(
        state,
        new ChoosePokemonPrompt(
          player.id,
          GameMessage.CHOOSE_POKEMON_TO_SWITCH,
          PlayerType.TOP_PLAYER,
          [SlotType.BENCH],
          { allowCancel: false },
        ),
        (result) => {
          if (result && result.length > 0) {
            opponent.switchPokemon(result[0]);
          }
        },
      );
    }
    if (WAS_ATTACK_USED(effect, 1, this) && effect instanceof AttackEffect) {
      const player = effect.player;
      // §B.38 / TA-285. The rider says "You may discard 3 [M] Energy from this Pokemon AND have
      // this attack do 150 more damage" — there is no "in order to", so the discard is NOT a cost
      // (#454, #456, and #2352 naming this very card). Consequences, all three of which the old
      // `metalCount >= 3` gate got wrong because it implemented the superseded #327:
      //   1. the "You may" is OFFERED at every holding, including zero Metal;
      //   2. accepting adds the +150 REGARDLESS of how much Metal is attached; and
      //   3. the discard is performed "as much as you can, up to 3" — which is already what
      //      DISCARD_UP_TO_X_TYPE_ENERGY_FROM_YOUR_POKEMON does (it clamps max AND min to the
      //      available count, and returns untouched when none is attached).
      // Reachable only through a copier (Metagross itself must pay [M][M][M][C] to attack), which
      // is why the direct-route tests never saw it.
      return store.prompt(
        state,
        new ConfirmPrompt(player.id, GameMessage.WANT_TO_DISCARD_ENERGY),
        (confirm) => {
          if (confirm) {
            effect.damage += 150;
            return DISCARD_UP_TO_X_TYPE_ENERGY_FROM_YOUR_POKEMON(
              store,
              state,
              effect,
              3,
              CardType.METAL,
              3,
              [SlotType.ACTIVE],
            );
          }
        },
      );
    }
    return state;
  }
}
