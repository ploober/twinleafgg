import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class TeamRocketsZapdos extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [L];
  public hp: number = 120;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Jamming Wing',
      cost: [C, C],
      damage: 30,
      text: "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
    },
    {
      name: 'Wicked Thunder',
      cost: [L, C, C],
      damage: 60,
      damageCalculation: '+',
      text: 'If this Pokémon has Team Rocket Energy attached, this attack does 60 more damage.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '70';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Team Rocket's Zapdos";
  public fullName: string = "Team Rocket's Zapdos DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Jamming Wing. TA-655 / B.89 (1), (4): the "you may" (CF-32: a standalone confirm), the Energy and its Benched
    // destination are Step-D choices, asked before the damage (the Energy recorded as `chosen`); the damage reads the
    // Energy still attached and it moves after the damage, to THEIR Bench (TA-147: the prefab resolves the destination in
    // the prompt's frame). No Energy or no Bench: nothing is asked (TA-149 / CF-33).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST(store, state, effect, this);
    }

    // Bad Thunder
    if (WAS_ATTACK_USED(effect, 1, this)) {
      if (
        effect.player.active.cards.some(
          (c) => c.superType === SuperType.ENERGY && c.name === 'Team Rocket Energy',
        )
      ) {
        effect.damage += 60;
      }
    }

    return state;
  }
}
