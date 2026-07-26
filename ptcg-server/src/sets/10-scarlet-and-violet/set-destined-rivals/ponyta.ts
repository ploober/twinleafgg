import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MULTIPLE_COIN_FLIPS_PROMPT, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Ponyta extends PokemonCard {
  public regulationMark = 'I';
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = R;
  public hp: number = 70;
  public weakness = [{ type: W }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Double Headbutt',
      cost: [C],
      damage: 10,
      damageCalculation: 'x',
      text: 'Flip 2 coins. This attack does 10 damage for each heads.'
    }
  ];

  public set: string = 'DRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '29';
  public name: string = 'Ponyta';
  public fullName: string = 'Ponyta DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Double Strike
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-134 sibling (same shape as Combusken dri-041): `effect.damage = heads * 10` used to run
      // SYNCHRONOUSLY, before either flip callback had fired, so `heads` was still 0 and the attack
      // did 0 damage on every outcome. The State each COIN_FLIP_PROMPT returned was discarded too.
      // Assign inside the callback and return that State.
      return MULTIPLE_COIN_FLIPS_PROMPT(store, state, player, 2, results => {
        effect.damage = 10 * results.reduce((sum, r) => sum + (r ? 1 : 0), 0);
      });
    }

    return state;
  }
}