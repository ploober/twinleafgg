import { PokemonCard, Stage, CardType, CardTag, StoreLike, State, PowerType, StateUtils, ChoosePokemonPrompt, GameMessage, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';

import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { CONFIRMATION_PROMPT, IS_ABILITY_BLOCKED, WAS_ATTACK_USED, MOVE_POKEMON_OFF_BOARD } from '../../../game/store/prefabs/prefabs';
import { MAY_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class TeamRocketsCrobatex extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = "Team Rocket's Golbat";
  protected _tags = [CardTag.TEAM_ROCKET, CardTag.POKEMON_ex];
  public cardType: CardType[] = [D];
  public hp: number = 310;
  public weakness = [{ type: L }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public powers = [
    {
      name: 'Biting Spree',
      powerType: PowerType.ABILITY,
      text: "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may put 2 damage counters on 2 of your opponent's Pokémon.",
    },
  ];

  public attacks = [
    {
      name: "Assassin's Return",
      cost: [D, D],
      damage: 120,
      text: 'You may put this Pokémon into your hand. (Discard all attached cards.)',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '122';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Team Rocket's Crobat ex";
  public fullName: string = "Team Rocket's Crobat ex DRI";


  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Bite About — Ref: set-phantom-forces/golbat.ts (Sneaky Bite)
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = StateUtils.findOwner(state, effect.target);

      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      return CONFIRMATION_PROMPT(store, state, player, (result) => {
        if (!result) {
          return;
        }

        // TA-763: "on 2 of your opponent's Pokémon" is two, not up to two: as many as they have, up to 2, so a pick of
        // exactly the Pokémon there is forced (CF-14) and the second pick offers no stop.
        const opponent = StateUtils.getOpponent(state, player);
        let inPlay = 0;
        opponent.forEachPokemon(PlayerType.TOP_PLAYER, () => { inPlay++; });
        const count = Math.min(2, inPlay);
        store.prompt(
          state,
          new ChoosePokemonPrompt(
            player.id,
            GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
            PlayerType.TOP_PLAYER,
            [SlotType.ACTIVE, SlotType.BENCH],
            // CF-32: "put 2 damage counters on each" is counter PLACEMENT — the wire verb is placeCounter.
            { min: count, max: count, allowCancel: false, operation: 'placeCounters' },
          ),
          (selected) => {
            const targets = selected || [];
            targets.forEach((target) => {
              store.reduceEffect(
                state,
                new PlaceDamageCountersEffect(player, target, 20, this, this.powers[0]),
              );
            });
          },
        );
      });
    }

    // Assassin's Return. TA-670 (B.101 (4)): the "you may" is asked at Step D, before the damage; this Pokemon goes to
    // the hand after it (#649). (TA-232's flag, which let the rider leak into the next attack, is gone with it.)
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      return MAY_CHOOSE_FIRST(store, state, effect, () => {
        if (player.active.getPokemonCard() !== this) {
          return;
        }
        MOVE_POKEMON_OFF_BOARD(store, state, player.active, {
          pokemonDestination: player.hand,
          attachedDestination: player.discard,
          sourceCard: this,
        });
      });
    }
    return state;
  }
}
