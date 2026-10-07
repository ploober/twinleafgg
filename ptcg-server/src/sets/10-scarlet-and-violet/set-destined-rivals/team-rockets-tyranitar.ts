import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  PowerType,
  StateUtils,
  PlayerType,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON } from '../../../game/store/prefabs/attack-effects';
import { BetweenTurnsEffect } from '../../../game/store/effects/game-phase-effects';
import { PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';

export class TeamRocketsTyranitar extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = "Team Rocket's Pupitar";
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [F];
  public hp: number = 180;
  public weakness = [{ type: G }];
  public retreat = [C, C, C];

  public powers = [
    {
      name: 'Sand Stream',
      powerType: PowerType.ABILITY,
      text: "As long as this Pokémon is in the Active Spot, put 2 damage counter on each of your opponent's Basic Pokémon during Pokémon Checkup.",
    },
  ];

  public attacks = [
    {
      name: 'Demolition Tackle',
      cost: [F, C, C, C],
      damage: 180,
      text: "Discard an Energy from your opponent's Active Pokémon.",
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '96';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Team Rocket's Tyranitar";
  public fullName: string = "Team Rocket's Tyranitar DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Sand Stream
    if (effect instanceof BetweenTurnsEffect) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }
      if (player.active.getPokemonCard() !== this) {
        return state;
      }

      opponent.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
        if (card.stage === Stage.BASIC) {
          // TA-253 / SD-13: route through PlaceDamageCountersEffect, not a raw `.damage +=`.
          // The raw write bypasses prevention effects AND leaves no placement log, so a Pokemon
          // this ability KO's gets a `ko` the projection cannot pair with a `damaged` (the lethal
          // tick is invisible to the KO reconstruction — the Demolition Tackle zone-axis rows).
          const placeCounters = new PlaceDamageCountersEffect(player, cardList, 20, this);
          state = store.reduceEffect(state, placeCounters);
        }
      });

      return state;
    }

    // Demolition Tackle. TA-655 / B.89 (1), (4): the attacker chooses the opponent's Energy at Step D, before the damage (recorded as
    // `chosen`); the damage reads it still attached (#77) and it is discarded after the damage, before damage reactions
    // and the Knock Out check.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return DISCARD_AN_ENERGY_FROM_OPPONENTS_ACTIVE_POKEMON(store, state, effect, undefined, 1, true);
    }

    return state;
  }
}
