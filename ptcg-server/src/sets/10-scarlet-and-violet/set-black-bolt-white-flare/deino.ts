import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_PARALYZED } from '../../../game/store/prefabs/attack-effects';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, COIN_FLIP_PROMPT } from '../../../game/store/prefabs/prefabs';

export class Deino extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [D];
  public hp: number = 80;
  public weakness = [{ type: G }];
  public resistance = [];
  public retreat = [C, C];

  public attacks = [{
    name: 'Body Slam',
    cost: [C, C],
    damage: 20,
    text: 'Flip a coin. If heads, your opponent\'s Active Pokémon is now Paralyzed.'
  }, {
    name: 'Darkness Fang',
    cost: [D, C, C],
    damage: 50,
    text: ''
  }];

  public set: string = 'WHT';

  public regulationMark: string = 'I';

  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '65';
  public name: string = 'Deino';
  public fullName: string = 'Deino SV11W';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (AFTER_ATTACK(effect, 0, this)) {
      // Body Slam paralyzes the OPPONENT's Active on heads ("your opponent's Active Pokemon is now
      // Paralyzed"). This previously used ADD_PARALYZED_TO_PLAYER_ACTIVE, which targets the PASSED
      // player's own active and so had to be handed the opponent explicitly. The attack-route prefab
      // derives the target from the AttackEffect, so the perspective is right by construction — and,
      // per TA-167/SD-6, the condition now carries the attack identity that "prevent all effects of
      // attacks" guards need in order to see it at all.
      return COIN_FLIP_PROMPT(store, state, effect.player, result => {
        if (result) {
          YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_PARALYZED(store, state, effect);
        }
      });
    }
    return state;
  }
}

