import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';

import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class HoOh extends PokemonCard {
  public stage: Stage = Stage.BASIC;

  public regulationMark = 'H';

  public cardType: CardType[] = [CardType.FIRE];

  public hp: number = 130;

  public weakness = [{ type: CardType.LIGHTNING }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Flap',
      cost: [CardType.FIRE, CardType.COLORLESS],
      damage: 50,
      text: '',
    },
    {
      name: 'Shining Blaze',
      cost: [CardType.FIRE, CardType.FIRE, CardType.COLORLESS],
      damage: 100,
      damageCalculation: '+',
      // SD-11 round 2 / TA-199: "in play" should be "on your Bench" (unanimous; rotomancer matches).
      text: 'If you have any Tera Pokémon on your Bench, this attack does 100 more damage.'
    }
  ];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '19';

  public name: string = 'Ho-Oh';

  public fullName: string = 'Ho-Oh SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // TA-199: the condition is "on your Bench", not "in play". forEachPokemon(BOTTOM_PLAYER) also
      // visits the ACTIVE slot, so this was the wider reading.
      //
      // The widening is VACUOUS here, and deliberately not filed as a behavioural defect: the only
      // in-play slot that is not the Bench is the Active, and while Shining Blaze is resolving the
      // Active is necessarily Ho-Oh itself (WAS_ATTACK_USED pins `this`), which carries no Tera tag.
      // So no board can distinguish the two readings. Narrowed anyway so the code states the rule it
      // is implementing -- but no measurement changes, and none was claimed.
      let hasTeraOnBench = false;
      player.bench.forEach(benchSlot => {
        const card = benchSlot.getPokemonCard();
        if (card && card.hasTag(CardTag.POKEMON_TERA)) {
          hasTeraOnBench = true;
        }
      });

      if (hasTeraOnBench) {
        effect.damage += 100;
      }
    }

    return state;
  }
}
