import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage } from '../../../game/store/card/card-types';
import { State, StoreLike, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { ADD_PARALYZED_TO_PLAYER_ACTIVE, AFTER_ATTACK, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';

export class Deino extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType = D;
  public hp: number = 80;
  public weakness = [{ type: G }];
  public resistance = [];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Body Slam',
      cost: [C, C],
      damage: 20,
      text: 'Flip a coin. If heads, your opponent\'s Active Pokémon is now Paralyzed.'
    },
    {
      name: 'Darkness Fang',
      cost: [D, C, C],
      damage: 50,
      text: ''
    }
  ];

  public set: string = 'WHT';
  public regulationMark: string = 'I';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '65';
  public name: string = 'Deino';
  public fullName: string = 'Deino SV11W';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (AFTER_ATTACK(effect, 0, this)) {
      // Body Slam paralyzes the OPPONENT's Active on heads ("your opponent's Active Pokemon is now
      // Paralyzed"). ADD_PARALYZED_TO_PLAYER_ACTIVE targets the PASSED player's own active, so pass the
      // opponent — not effect.player (the attacker), which paralyzed the wrong board (matching the
      // universal convention: 248/250 callers pass the opponent).
      const opponent = StateUtils.getOpponent(state, effect.player);
      return COIN_FLIP_PROMPT(store, state, effect.player, result => {
        if (result) {
          ADD_PARALYZED_TO_PLAYER_ACTIVE(store, state, opponent, this);
        }
      });
    }
    return state;
  }
}

