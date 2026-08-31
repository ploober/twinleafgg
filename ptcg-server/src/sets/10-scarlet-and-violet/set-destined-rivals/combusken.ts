import { PokemonCard, Stage, CardType, State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MULTIPLE_COIN_FLIPS_PROMPT, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Combusken extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Torchic';
  public cardType: CardType[] = [R];
  public hp: number = 100;
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Combustion',
      cost: [C],
      damage: 20,
      text: ''
    },
    {
      name: 'Double Kick',
      cost: [R, C],
      damage: 40,
      damageCalculation: 'x',
      text: 'Flip 2 coins. This attack does 40 damage for each heads.'
    },
  ];

  public set: string = 'DRI';

  public regulationMark = 'I';

  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '41';
  public name: string = 'Combusken';
  public fullName: string = 'Combusken DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      // TA-134 sibling: this used to fire two separate COIN_FLIP_PROMPTs and then assign
      // `effect.damage = 40 * heads` SYNCHRONOUSLY — before either callback had run, so `heads` was
      // still 0 and the attack did 0 damage on every outcome. It also discarded the State that each
      // COIN_FLIP_PROMPT returns, leaving the second flip to reduce against a stale state.
      // The damage must be assigned INSIDE the callback, and that State returned.
      return MULTIPLE_COIN_FLIPS_PROMPT(store, state, effect.player, 2, results => {
        effect.damage = 40 * results.reduce((sum, r) => sum + (r ? 1 : 0), 0);
      });
    }

    return state;
  }
}
