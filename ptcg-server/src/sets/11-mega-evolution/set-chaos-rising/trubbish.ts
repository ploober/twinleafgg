import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StoreLike, State } from '../../../game';
import { AFTER_ATTACK, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';

export class Trubbish extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 70;
  public cardType: CardType[] = [D];
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Acid Spray',
      cost: [D],
      damage: 10,
      text: "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
    },
  ];

  public regulationMark = 'J';

  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '56';
  public name: string = 'Trubbish';
  public fullName: string = 'Trubbish M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-494 (B.84 (1), (3); #571): the flip only gates the discard, so the flip and the choice are effects of the
    // attack and come after its damage (AFTER_ATTACK), as Ekans mew-023 / Tympole obf-050.
    if (AFTER_ATTACK(effect, 0, this)) {
      COIN_FLIP_PROMPT(store, state, effect.player, (result) => {
        if (result) {
          DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect);
        }
      });
    }
    return state;
  }
}
