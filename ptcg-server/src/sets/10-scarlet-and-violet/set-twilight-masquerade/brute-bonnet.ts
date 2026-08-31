import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED } from '../../../game/store/prefabs/attack-effects';
import { CardTag, CardType, PokemonCard, Stage, State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { THIS_ATTACK_DOES_X_MORE_DAMAGE, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class BruteBonnet extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.ANCIENT];
  public cardType: CardType[] = [D];
  public hp: number = 120;
  public weakness = [{ type: G }];
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Poison Spray',
      cost: [D],
      damage: 0,
      text: "Your opponent's Active Pokémon is now Poisoned.",
    },
    {
      name: 'Relentless Punches',
      cost: [D, D, D],
      damage: 50,
      damageCalculation: '+',
      text: "This attack does 50 more damage for each damage counter on your opponent's Active Pokémon.",
    },
  ];

  public regulationMark: string = 'H';
  public set: string = 'TWM';
  public setNumber: string = '118';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Brute Bonnet';
  public fullName: string = 'Brute Bonnet TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED(store, state, effect);
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const opponent = StateUtils.getOpponent(state, effect.player);
      THIS_ATTACK_DOES_X_MORE_DAMAGE(effect, store, state, 5 * opponent.active.damage);
    }

    return state;
  }
}
