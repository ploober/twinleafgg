import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardTag, CardType, Stage } from '../../../game/store/card/card-types';
import { StoreLike, State, GameError, GameMessage } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';
import { OPPONENT_CANNOT_PLAY_SUPPORTER_CARDS } from '../../../game/store/prefabs/effect-of-attack-prefabs';

export class ScreamTailex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex, CardTag.ANCIENT];
  public regulationMark = 'H';
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [P];
  public hp: number = 190;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [{
    name: 'Scream',
    cost: [C],
    damage: 0,
    text: 'You can use this attack only if you go second, and only during your first turn. During your opponent\'s next turn, they can\'t play any Supporter cards from their hand.'
  },
  {
    name: 'Crunch',
    cost: [P, C, C],
    damage: 120,
    text: 'Discard an Energy from your opponent\'s Active Pokémon.'
  }];

  public set: string = 'TWM';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '94';
  public name: string = 'Scream Tail ex';
  public fullName: string = 'Scream Tail ex TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Scream
    if (WAS_ATTACK_USED(effect, 0, this)) {
      if (state.turn !== 2) {
        throw new GameError(GameMessage.CANNOT_USE_ATTACK);
      }
      return OPPONENT_CANNOT_PLAY_SUPPORTER_CARDS(store, state, effect, this);
    }

    // Crunch. TA-655 / B.89 (1), (4): the attacker chooses the opponent's Energy at Step D, before the damage (recorded as
    // `chosen`); the damage reads it still attached (#77) and it is discarded after the damage, before damage reactions
    // and the Knock Out check.
    if (WAS_ATTACK_USED(effect, 1, this)) {
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, undefined, 1, true);
    }
    return state;
  }
}
