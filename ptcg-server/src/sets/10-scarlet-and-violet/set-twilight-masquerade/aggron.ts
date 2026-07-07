import { CardType, Stage } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { PlayerType, PokemonCard } from '../../../game';

import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Aggron extends PokemonCard {

  public stage: Stage = Stage.STAGE_2;

  public evolvesFrom: string = 'Lairon';

  public regulationMark = 'H';

  public cardType: CardType = CardType.METAL;

  public weakness = [{ type: CardType.FIRE }];

  public resistance = [{ type: CardType.GRASS, value: -30 }];

  public hp: number = 180;

  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Angry Slam',
      cost: [CardType.METAL],
      damage: 50,
      damageCalculation: 'x',
      text: 'This attack does 50 damage for each of your Pokémon that has any damage counters on it.'
    },
    {
      name: 'Guard Claw',
      cost: [CardType.METAL, CardType.COLORLESS, CardType.COLORLESS],
      damage: 120,
      text: 'During your opponent\'s next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance).'
    }
  ];

  public set: string = 'TWM';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '122';

  public name: string = 'Aggron';

  public fullName: string = 'Aggron TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // "50 damage for each of your Pokémon that has any damage counters on it." No bench requirement —
      // with no damaged Pokémon this is a legal 0-damage whiff, so do NOT reject it (an offer-then-reject
      // hid the attack whenever the player had no Bench). forEachPokemon already covers Active + Bench.
      let pokemonWithDamage = 0;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
        if (cardList.damage !== 0) {
          pokemonWithDamage++;
        }
      });

      effect.damage = pokemonWithDamage * 50;

    }
    if (WAS_ATTACK_USED(effect, 1, this)) {
      effect.player.active.damageReductionNextTurn = 50;
    }

    return state;
  }
}
