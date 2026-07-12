import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { defendingPokemonTakesMoreDamageDuringAttackerNextTurnEffect } from '../../../game/store/effects/effect-of-attack-effects';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Vibrava extends PokemonCard {

  public stage: Stage = Stage.STAGE_1;

  public evolvesFrom = 'Trapinch';

  public regulationMark = 'H';

  public cardType: CardType = CardType.FIGHTING;

  public hp: number = 90;

  public weakness = [{ type: CardType.GRASS }];

  public retreat = [CardType.COLORLESS];

  public attacks =
    [
      {
        name: 'Screech',
        cost: [CardType.COLORLESS],
        damage: 0,
        text: 'During your next turn, the Defending Pokémon takes 50 more damage from this Pokémon\'s attacks'
      },
      {
        name: 'Cutting Wind',
        cost: [CardType.FIGHTING, CardType.COLORLESS],
        damage: 50,
        text: ''
      }
    ];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '105';

  public name: string = 'Vibrava';

  public fullName: string = 'Vibrava SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // "During your next turn, the Defending Pokémon takes 50 more damage from this Pokémon's attacks."
    // Use the engine's purpose-built mechanism: it marks the Defending Pokémon (opponent's Active),
    // scopes the bonus to THIS attacker, promotes it past the opponent's intervening turn, applies it
    // during the attacker's next turn, and expires it at that turn's end. (The old custom markers set
    // the flag on the wrong Pokémon and cleared it on the wrong player, so the +50 never applied.)
    if (WAS_ATTACK_USED(effect, 0, this)) {
      store.reduceEffect(state, defendingPokemonTakesMoreDamageDuringAttackerNextTurnEffect(effect, this, 50));
    }

    return state;
  }
}
