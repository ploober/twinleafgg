import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { CardTag } from '../../game/store/card/card-types';
import { StoreLike, State } from '../../game';
import { Effect } from '../../game/store/effects/effect';

import { WAS_ATTACK_USED } from '../../game/store/prefabs/prefabs';

export class Koraidon extends PokemonCard {

  public tags = [CardTag.ANCIENT];

  public regulationMark = 'H';

  public stage: Stage = Stage.BASIC;

  public cardType: CardType = F;

  public hp: number = 130;

  public retreat = [C, C];

  public weakness = [{ type: P }];

  public attacks = [
    {
      name: 'Unrelenting Onslaught',
      cost: [C, C],
      damage: 30,
      damageCalculator: '+',
      text: 'If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.'
    },
    {
      name: 'Hammer In',
      cost: [F, F, C],
      damage: 110,
      text: ''
    }
  ];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '116';

  public name: string = 'Koraidon';

  public fullName: string = 'Koraidon SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const playerLastAttackInfo = state.playerLastAttack?.[player.id];
      const originalCard = playerLastAttackInfo ? playerLastAttackInfo.sourceCard : null;

      // "1 of your other Ancient Pokémon used an attack during your last turn":
      // the previous attack must be from the player's immediately preceding turn,
      // by an Ancient Pokémon that is not this one.
      if (originalCard && originalCard !== this
        && originalCard.tags.includes(CardTag.ANCIENT)
        && playerLastAttackInfo?.turn === state.turn - 2) {
        effect.damage += 150;
      }
    }
    return state;
  }

}