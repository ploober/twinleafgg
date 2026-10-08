import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST, YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED, YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_CONFUSED } from '../../../game/store/prefabs/attack-effects';
import { CardType, PokemonCard, Stage, State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Accelgor extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Shelmet';
  public cardType: CardType[] = [G];
  public hp: number = 100;
  public weakness = [{ type: R }];
  public retreat = [C];

  public attacks = [{
    name: 'Poisonous Ploy',
    cost: [G, C],
    damage: 70,
    text: 'Your opponent\'s Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.'
  }];

  public regulationMark: string = 'I';
  public set: string = 'JTG';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '13';
  public name: string = 'Accelgor';
  public fullName: string = 'Accelgor JTG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }
    if (AFTER_ATTACK(effect, 0, this)) {
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_POISIONED(store, state, effect);
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_CONFUSED(store, state, effect);
    }

    return state;
  }
}