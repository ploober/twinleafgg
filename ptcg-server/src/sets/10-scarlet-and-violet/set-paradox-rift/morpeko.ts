import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { Effect } from '../../../game/store/effects/effect';
import { CheckRetreatCostEffect, CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';
import { MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

export class Morpeko extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.DARK];

  public hp: number = 70;

  public weakness = [{ type: CardType.GRASS }];

  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'In a Hungry Hurry',
    powerType: PowerType.ABILITY,
    text: 'If this Pokemon has no Energy attached to it, this Pokemon has ' +
      'no Retreat Cost.'
  }];

  public attacks = [{
    name: 'Energizer Wheel',
    cost: [CardType.DARK, CardType.DARK],
    damage: 70,
    text: 'Move 2 [D] Energy from this Pokémon to 1 of your Benched Pokémon.'
  }];

  public regulationMark = 'G';

  public set: string = 'PAR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '121';

  public name: string = 'Morpeko';

  public fullName: string = 'Morpeko PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof CheckRetreatCostEffect && effect.player.active.cards.includes(this)) {
      const player = effect.player;
      const pokemonCard = player.active.getPokemonCard();

      if (pokemonCard !== this) {
        return state;
      }

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player);
      state = store.reduceEffect(state, checkProvidedEnergy);

      if (checkProvidedEnergy.energyMap.length === 0) {
        effect.cost = [];
      }
    }

    // Energizer Wheel. TA-659 / B.89 (1), (4) (rulebook Step D): the 2 [D] Energy and the Benched Pokémon are the
    // attacker's choices, made before the damage (one joint `moveEnergy` pick per Energy, each recorded `chosen`, the
    // first fixing the Benched Pokémon); the 70 reads them still attached and they move after it (#649 / #543). An
    // Energy that provides [D] (an all-types Energy included) is eligible; the rest are blocked (TA-490).
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player, player.active);
      state = store.reduceEffect(state, checkProvidedEnergy);
      const dark = new Set(checkProvidedEnergy.energyMap
        .filter(em => em.provides.includes(CardType.DARK) || em.provides.includes(CardType.ANY))
        .map(em => em.card));
      return MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST(store, state, effect, this,
        { count: 2, eligible: card => dark.has(card) });
    }
    return state;
  }
}