import { PokemonCard, Stage, CardType, PowerType, StoreLike, State, StateUtils, GameMessage, GameError, SpecialCondition, SelectPrompt } from "../../../game";
import { AddSpecialConditionsPowerEffect } from "../../../game/store/effects/check-effects";
import { Effect } from "../../../game/store/effects/effect";
import { WAS_POWER_USED, USE_ABILITY_ONCE_PER_TURN, ABILITY_USED, COIN_FLIP_PROMPT, WAS_ATTACK_USED, REMOVE_MARKER_AT_END_OF_TURN } from "../../../game/store/prefabs/prefabs";

export class Cradily extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Lileep';
  public hp: number = 150;
  public cardType: CardType[] = [G];
  public weakness = [{ type: R }];
  public retreat = [C, C, C];

  public powers = [{
    name: 'Selective Slime',
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may flip a coin. If heads, choose Burned, Confused, or Poisoned. Your opponent\'s Active Pokémon is now affected by that Special Condition.',
    useWhenInPlay: true
  }];

  public attacks = [{
    name: 'Miasma Wind',
    cost: [G],
    damage: 100,
    damageCalculation: 'x',
    text: 'This attack does 100 damage for each Special Condition affecting your opponent\'s Active Pokémon.'
  }];

  public regulationMark = 'H';
  public set: string = 'SCR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '6';
  public name: string = 'Cradily';
  public fullName: string = 'Cradily SCR';

  public readonly SELECTIVE_SLIME_MARKER = 'CRADILY_SELECTIVE_SLIME_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Selective Slime
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // TA-343 / #2014: "Can I use Selective Slime if my opponent's Active Pokemon is already
      // Burned, Confused, and Poisoned? — No, you cannot." The effect provably does nothing and the
      // operand is public (B.41's withhold line), so the ability is not usable at all.
      const already = opponent.active.specialConditions;
      if ([SpecialCondition.BURNED, SpecialCondition.CONFUSED, SpecialCondition.POISONED].every(c => already.includes(c))) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      USE_ABILITY_ONCE_PER_TURN(player, this.SELECTIVE_SLIME_MARKER, this);
      ABILITY_USED(player, this);
      COIN_FLIP_PROMPT(store, state, player, result => {
        if (result) {
          // TA-343: the printed choice is "Burned, Confused, or Poisoned" — no Asleep.
          const options: { message: GameMessage, value: SpecialCondition }[] = [
            { message: GameMessage.SPECIAL_CONDITION_BURNED, value: SpecialCondition.BURNED },
            { message: GameMessage.SPECIAL_CONDITION_CONFUSED, value: SpecialCondition.CONFUSED },
            { message: GameMessage.SPECIAL_CONDITION_POISONED, value: SpecialCondition.POISONED }
          ];
          store.prompt(state, new SelectPrompt(
            player.id,
            GameMessage.CHOOSE_SPECIAL_CONDITION,
            options.map(c => c.message),
            { allowCancel: false }
          ), choice => {
            const option = options[choice];
            if (option !== undefined) {
              const specialConditionEffect = new AddSpecialConditionsPowerEffect(player, this, opponent.active, [option.value]);
              store.reduceEffect(state, specialConditionEffect);
            }
          });
        }
      });
    }

    REMOVE_MARKER_AT_END_OF_TURN(effect, this.SELECTIVE_SLIME_MARKER, this);

    // Miasma Wind
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const specialConditionCount = opponent.active.specialConditions.length;
      effect.damage = 100 * specialConditionCount;
    }

    return state;
  }
}
