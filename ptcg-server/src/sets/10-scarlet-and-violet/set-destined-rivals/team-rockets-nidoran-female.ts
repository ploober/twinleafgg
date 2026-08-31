import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { COIN_FLIP_PROMPT, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class TeamRocketsNidoranFemale extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [D];
  public hp: number = 70;
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Surprise Attack',
      cost: [D],
      damage: 30,
      text: 'Flip a coin. If tails, this attack does nothing.',
    },
  ];

  public regulationMark = 'I';

  public set: string = 'DRI';
  public setNumber: string = '114';
  public cardImage: string = 'assets/cardback.png';
  // TA-261: canonical (and every printed card) writes the gender glyph with NO space before it —
  // "Nidoran♀"/"Nidoran♂". The spaced form is a twinleaf-only orthography, and `evolvesFrom` is a
  // STRING MATCH, so the name and the two evolvesFrom references must move together or Nidorina /
  // Nidorino stop evolving. fullName (…"Nidoran F DRI"/"Nidoran M DRI") is the identity key and is
  // deliberately untouched.
  public name: string = "Team Rocket's Nidoran♀";
  public fullName: string = "Team Rocket's Nidoran F DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      COIN_FLIP_PROMPT(store, state, effect.player, (result) => {
        if (!result) {
          effect.damage = 0;
        }
      });
    }

    return state;
  }
}
