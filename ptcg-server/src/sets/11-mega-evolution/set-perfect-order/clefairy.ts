import { PokemonCard, Stage, CardType, StoreLike, State, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, GUST_OPPONENT_BENCHED_POKEMON } from '../../../game/store/prefabs/prefabs';

export class Clefairy extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [P];
  public hp: number = 70;
  public weakness = [{ type: M }];
  public retreat = [C];

  public attacks = [{
    name: 'Follow Me',
    cost: [P],
    damage: 0,
    text: 'Switch in 1 of your opponent\'s Benched Pokémon to the Active Spot.'
  },
  {
    name: 'Flop',
    cost: [P, P],
    damage: 30,
    text: ''
  }];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '30';
  public name: string = 'Clefairy';
  public fullName: string = 'Clefairy M3';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Follow Me - Switch opponent's Benched with Active
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const hasBench = opponent.bench.some(b => b.cards.length > 0);

      if (!hasBench) {
        // No Benched Pokémon to switch in — the attack is still declarable and simply whiffs ("do as
        // much of the attack as you can"). An attack that switches the opponent's Active is never a
        // play-restriction (that rule is for Trainers). Compendium #8732/#14066/#14808/#15106. (TA-80)
        return state;
      }

      return GUST_OPPONENT_BENCHED_POKEMON(store, state, effect.player, {
        sourceEffect: effect,
      });
    }

    return state;
  }
}
