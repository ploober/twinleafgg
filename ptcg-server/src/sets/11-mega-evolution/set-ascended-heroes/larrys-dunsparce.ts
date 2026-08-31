import { PokemonCard, Stage, CardTag, CardType, StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { COIN_FLIP_PROMPT, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class LarrysDunsparce extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.LARRYS];
  public cardType: CardType[] = [C];
  public hp: number = 70;
  public weakness = [{ type: F }];
  public resistance = [];
  public retreat = [];

  public attacks = [
    {
      name: 'Rising Lunge',
      cost: [C],
      damage: 10,
      damageCalculation: '+',
      text: 'Flip a coin. If heads, this attack does 20 more damage.',
    },
  ];

  public regulationMark = 'I';

  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '163';
  public name: string = "Larry's Dunsparce";
  public fullName: string = "Larry's Dunsparce MC";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Rulebook: the coin flip is part of resolving the attack — flip in WAS_ATTACK_USED so the
    // +20 modifies effect.damage BEFORE the damage step (and the flip externalizes as a system
    // pending rather than faulting the conformance adapter, per TA-56 Marill "Hide").
    if (WAS_ATTACK_USED(effect, 0, this)) {
      COIN_FLIP_PROMPT(store, state, effect.player, (result) => {
        if (result && effect instanceof AttackEffect) {
          effect.damage += 20;
        }
      });
    }
    return state;
  }
}
