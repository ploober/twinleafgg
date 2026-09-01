import { YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_CONFUSED } from '../../../game/store/prefabs/attack-effects';
import { PokemonCard, Stage, CardType, CardTag, StoreLike, State, PowerType, StateUtils, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PowerEffect, PutDamageCountersEffect } from '../../../game/store/effects/game-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { AFTER_ATTACK, CONFIRMATION_PROMPT, IS_ABILITY_BLOCKED } from '../../../game/store/prefabs/prefabs';

export class TeamRocketsGolbat extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = "Team Rocket's Zubat";
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [D];
  public hp: number = 80;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public powers = [
    {
      name: 'Sneaky Bite',
      powerType: PowerType.ABILITY,
      text: "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may put 2 damage counters on 1 of your opponent's Pokémon.",
    },
  ];

  public attacks = [
    {
      name: 'Confuse Ray',
      cost: [D],
      damage: 30,
      text: "Your opponent's Active Pokémon is now Confused.",
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '121';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Team Rocket's Golbat";
  public fullName: string = "Team Rocket's Golbat DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Sneaky Bite
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = StateUtils.findOwner(state, effect.target);

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // TA-347 (the TA-341 shape one stage down): the target prompt belongs INSIDE the "you may" —
      // a decline used to fall through to it — and the counters go through PutDamageCountersEffect
      // so a "prevent effects of your opponent's Abilities" protector can intercept them (SD-26);
      // `target.damage += 20` bypassed every sink AND left no placement log for the event mapper.
      CONFIRMATION_PROMPT(store, state, player, (result) => {
        if (!result) {
          return state;
        }
        return store.prompt(
          state,
          new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
            PlayerType.TOP_PLAYER,
            [SlotType.ACTIVE, SlotType.BENCH],
            // CF-32: "put 2 damage counters" is counter PLACEMENT — the wire verb is placeCounter.
            { min: 1, max: 1, allowCancel: false, operation: 'placeCounters' },
          ),
          (selected) => {
            const targets = selected || [];
            targets.forEach((target) => {
              const powerEffect = new PowerEffect(player, this.powers[0], this, target);
              store.reduceEffect(state, new PutDamageCountersEffect(powerEffect, 20));
            });
          },
        );
      });
      return state;
    }

    // Confuse Ray
    if (AFTER_ATTACK(effect, 0, this)) {
      YOUR_OPPPONENTS_ACTIVE_POKEMON_IS_NOW_CONFUSED(store, state, effect);
    }
    return state;
  }
}
