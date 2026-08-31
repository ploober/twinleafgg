import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SpecialCondition } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class NsKlang extends PokemonCard {
  protected _tags = [CardTag.NS];
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = "N's Klink";
  public cardType: CardType[] = [M];
  public hp: number = 90;
  public weakness = [{ type: R }];
  public resistance = [{ type: G, value: -30 }];
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Spinning Gears',
      cost: [C],
      damage: 20,
      damageCalculation: 'x',
      text: "Your opponent's Active Pokémon is now Confused.",
    },
    { name: 'Confront', cost: [M, C], damage: 40, text: '' },
  ];

  public set: string = 'JTG';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '104';
  public name: string = "N's Klang";
  public fullName: string = "N's Klang JTG";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Spinning Gears is attack index 0 (Confront, index 1, is a vanilla 40). The Confuse belongs to
    // Spinning Gears — was mis-wired to index 1, so it never fired on Spinning Gears (and would have
    // wrongly fired on Confront). Surfaced by the rotomancer corpus differential after the main merge.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      opponent.active.addSpecialCondition(SpecialCondition.CONFUSED);
    }
    return state;
  }
}
