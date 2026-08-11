import { CardType, PokemonCard, Stage, State, StoreLike } from "../../../game";
import { DealDamageEffect } from "../../../game/store/effects/attack-effects";
import { Effect } from "../../../game/store/effects/effect";
import { WAS_ATTACK_USED, DEFENDING_POKEMON_ATTACKS_COST_MORE, DEFENDING_POKEMON_RETREAT_COSTS_MORE } from "../../../game/store/prefabs/prefabs";

export class Rillaboom extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Thwackey';
  public cardType: CardType = G;
  public hp: number = 180;
  public weakness = [{ type: R }];
  public retreat = [C, C, C, C];

  public attacks = [{
    name: 'Drum Beating',
    cost: [G],
    damage: 60,
    text: "During your opponent's next turn, attacks used by the Defending Pokémon cost [C] more, and its Retreat Cost is [C] more.",
  },
  {
    name: 'Wood Hammer',
    cost: [G, G],
    damage: 180,
    text: 'This Pokémon also does 50 damage to itself.',
  }];

  public regulationMark = 'H';
  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '16';
  public name: string = 'Rillaboom';
  public fullName: string = 'Rillaboom TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Drum Beating
    if (WAS_ATTACK_USED(effect, 0, this)) {
      state = DEFENDING_POKEMON_ATTACKS_COST_MORE(store, state, effect, 1);
      state = DEFENDING_POKEMON_RETREAT_COSTS_MORE(store, state, effect, 1);
      return state;
    }
    // Wood Hammer
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      const dealDamage = new DealDamageEffect(effect, 50);
      dealDamage.target = player.active;
      return store.reduceEffect(state, dealDamage);
    }

    // TA-236: two card-local cost consumers used to sit here, CROSS-WIRED — the retreat block read
    // `attackCostIncreaseNextTurn` and the attack block read `retreatCostIncreaseNextTurn`. Both
    // consumers now live engine-side in `check-effect.ts` reading the correct fields (any card
    // using the DEFENDING_POKEMON_*_COST_MORE prefabs gets them), and the arming window in
    // `game-phase-effect.ts` was inverted — see TA-236 in the conformance findings register.

    return state;
  }
}
