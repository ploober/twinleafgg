import {
  PokemonCard,
  Stage,
  CardType,
  CardTag,
  StoreLike,
  State,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import {
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class ChienPao extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [D];
  public hp: number = 120;
  public weakness = [{ type: G }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Strafe',
      cost: [D],
      damage: 20,
      text: 'You may switch this Pokémon with 1 of your Benched Pokémon.',
    },
    {
      name: 'Rising Blade',
      cost: [D, D, C],
      damage: 80,
      damageCalculation: '+',
      text: "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage.",
    },
  ];

  public regulationMark = 'J';
  public set: string = 'POR';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '54';
  public name: string = 'Chien-Pao';
  public fullName: string = 'Chien-Pao M3';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Strafe - optional switch
    // TA-672 (B.101 (3)): the "you may" and the new Active are chosen at Step D, before the damage; the switch is after it.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect, { may: true });
    }

    // Rising Blade - extra damage vs ex Pokemon
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const opponent = effect.opponent;
      const opponentActive = opponent.active.getPokemonCard();

      if (opponentActive && opponentActive.hasTag(CardTag.POKEMON_ex)) {
        effect.damage = 80 + 80;
      }
    }

    return state;
  }
}
