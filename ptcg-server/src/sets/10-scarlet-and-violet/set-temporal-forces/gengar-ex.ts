import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, PlayerType, StateUtils, PowerType } from '../../../game';
import { Effect, PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';
import { AttachEnergyEffect } from '../../../game/store/effects/play-card-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Gengarex extends PokemonCard {
  protected _tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom = 'Haunter';
  public cardType: CardType[] = [CardType.DARK];
  public hp: number = 310;
  public weakness = [{ type: CardType.FIGHTING }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public powers = [
    {
      name: 'Gnawing Curse',
      powerType: PowerType.ABILITY,
      text: 'Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.',
    },
  ];

  public attacks = [
    {
      name: 'Tricky Steps',
      cost: [CardType.DARK, CardType.DARK],
      damage: 160,
      text: "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
    },
  ];

  public regulationMark = 'H';
  public set: string = 'TEF';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '104';
  public name: string = 'Gengar ex';
  public fullName: string = 'Gengar ex TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Tricky Steps. TA-655 / B.89 (1), (4): the "you may" (CF-32: a standalone confirm), the Energy and its Benched
    // destination are Step-D choices, asked before the damage (the Energy recorded as `chosen`); the damage reads the
    // Energy still attached and it moves after the damage. No Energy or no Bench: nothing is asked (CF-33).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      return MOVE_AN_ENERGY_FROM_OPPONENTS_ACTIVE_TO_THEIR_BENCH_CHOOSE_FIRST(store, state, effect, this);
    }

    // TA-641: "attaches an Energy card from their hand" -- an attach from the discard (Eelektrik asc-060 Dynamotor)
    // or the deck does not trigger it.
    if (effect instanceof AttachEnergyEffect && effect.fromHand) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      // Find the owner of this Gengar-EX
      let isGengarInPlay = false;
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card) => {
        if (card === this) {
          isGengarInPlay = true;
        }
      });

      if (!isGengarInPlay) {
        return state;
      }

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }
      // TA-254 / SD-13 (same fix as TA-253): route through PlaceDamageCountersEffect, not a raw
      // `.damage +=`. The raw write bypasses prevention effects AND leaves no placement log, so the
      // LETHAL tick produced a `ko` whose `damaged` the projection could not reconstruct (TA-132 —
      // twinleaf emitted 2 damaged events to rotomancer's 3, dropping exactly the one that KO'd).
      // The counters are placed by Gengar's OWNER (`opponent` of the attaching player).
      const placeCounters = new PlaceDamageCountersEffect(opponent, effect.target, 20, this);
      state = store.reduceEffect(state, placeCounters);
    }
    return state;
  }
}
