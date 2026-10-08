import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Murkrow extends PokemonCard {

  public regulationMark = 'G';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.DARK];

  public hp: number = 60;

  public weakness = [{ type: CardType.LIGHTNING }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Spin Turn',
      cost: [CardType.COLORLESS],
      damage: 10,
      text: 'Switch this Pokémon with one of your Benched Pokémon.'
    },
    {
      name: 'United Wings',
      cost: [CardType.DARK],
      damage: 20,
      damageCalculation: 'x',
      text: 'This attack does 20 damage for each Pokémon in your ' +
        'in your discard pile that have the United Wings attack.'
    }
  ];

  public set: string = 'PAL';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '131';

  public name: string = 'Murkrow';

  public fullName: string = 'Murkrow PAL';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // TA-672 (B.101 (3)): the new Active is chosen at Step D, before the damage; the switch is after it (#352).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return SWITCH_THIS_POKEMON_WITH_BENCHED_CHOOSE_FIRST(store, state, effect);
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      let pokemonCount = 0;
      player.discard.cards.forEach(c => {
        if (c instanceof PokemonCard && c.attacks.some(a => a.name === 'United Wings')) {
          pokemonCount += 1;
        }
      });

      effect.damage = pokemonCount * 20;
    }

    return state;
  }

}