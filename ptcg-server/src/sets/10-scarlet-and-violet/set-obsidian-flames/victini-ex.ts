import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import {
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Victiniex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [R];
  public hp: number = 190;
  public weakness = [{ type: W }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Strafe',
      cost: [R],
      damage: 30,
      text: 'You may switch this Pokémon with 1 of your Benched Pokémon.',
    },
    {
      name: 'Victory Flame',
      cost: [R, R, C],
      damage: 220,
      text: "During your next turn, this Pokémon can't attack.",
    },
  ];

  public regulationMark = 'G';
  public set: string = 'OBF';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '33';
  public name: string = 'Victini ex';
  public fullName: string = 'Victini ex OBF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-672 (B.101 (3)): the "you may" and the new Active are chosen at Step D, before the damage; the switch is after it.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, { may: true });
    }

    // Victory Flame
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      player.active.cannotAttackNextTurnPending = true;
    }

    return state;
  }
}
