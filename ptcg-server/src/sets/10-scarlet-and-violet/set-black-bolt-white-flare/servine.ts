import { PokemonCard, Stage, CardType, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED, APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';
import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_PARALYZED } from '../../../game/store/prefabs/attack-effects';

export class Servine extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Snivy';
  public cardType: CardType[] = [G];
  public hp: number = 100;
  public weakness = [{ type: R }];
  public retreat = [C];

  public attacks = [{
    name: 'Wrap',
    cost: [G],
    damage: 20,
    text: 'Flip a coin. If heads, your opponent\'s Active Pokémon is now Paralyzed.'
  }, {
    name: 'Vine Whip',
    cost: [G, C, C],
    damage: 60,
    text: ''
  }];

  public regulationMark = 'I';

  public set: string = 'BLK';
  public setNumber: string = '2';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Servine';
  public fullName: string = 'Servine SV11B';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // Rulebook step F / compendium #543/#649: apply damage before the coin-flip rider.
      state = APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS(store, state, effect);

      return COIN_FLIP_PROMPT(store, state, player, flipResult => {
        if (flipResult) {
          YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_PARALYZED(store, state, effect);
        }
        return state;
      });
    }
    return state;
  }
}
