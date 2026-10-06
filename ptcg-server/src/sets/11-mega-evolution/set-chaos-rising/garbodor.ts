import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StoreLike, State, StateUtils, PlayerType, PowerType, Player } from '../../../game';
import { DealDamageEffect, PutDamageEffect } from '../../../game/store/effects/attack-effects';
import { GamePhase } from '../../../game/store/state/state';
import { IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class Garbodor extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Trubbish';
  public hp: number = 140;
  public cardType: CardType[] = [D];
  public weakness = [{ type: F }];
  public retreat = [C, C, C];

  public powers = [
    {
      name: 'Gloomy Garbage',
      powerType: PowerType.ABILITY,
      text: "Attacks used by your opponent's Active Pokémon that has a Pokémon Tool attached do 20 less damage (before applying Weakness and Resistance).",
    },
  ];
  public attacks = [
    {
      name: 'Sludge Bomb',
      cost: [D, D, C],
      damage: 100,
      text: '',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '57';
  public name: string = 'Garbodor';
  public fullName: string = 'Garbodor M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // TA-616 / TA-623: "Attacks used by your opponent's Active Pokemon that has a Pokemon Tool attached do 20 less damage
    // (before applying Weakness and Resistance)." Every damage placement of that attack is reduced once: a
    // DealDamageEffect (any target, before W/R), or a PutDamageEffect placed DIRECTLY by the attack (Bench damage;
    // weaknessApplied false -- the one DealDamageEffect emits is already reduced). Only the Garbodor owner's OPPONENT's
    // attacks are reduced, never its owner's own.
    if ((effect instanceof DealDamageEffect || (effect instanceof PutDamageEffect && !effect.weaknessApplied))
      && effect.damage > 0 && state.phase === GamePhase.ATTACK) {
      let owner: Player | undefined;
      for (const p of state.players) {
        p.forEachPokemon(PlayerType.BOTTOM_PLAYER, (_cardList, card) => {
          if (card === this) {
            owner = p;
          }
        });
      }
      if (owner === undefined) {
        return state;
      }
      const opponent = StateUtils.getOpponent(state, owner);
      if (effect.source !== opponent.active || effect.source.tools.length === 0) {
        return state;
      }
      if (IS_ABILITY_BLOCKED(store, state, owner, this)) {
        return state;
      }
      effect.damage = Math.max(0, effect.damage - 20);
    }
    return state;
  }
}
