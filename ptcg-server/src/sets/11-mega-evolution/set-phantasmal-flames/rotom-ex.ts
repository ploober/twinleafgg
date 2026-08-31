import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { State } from '../../../game/store/state/state';
import { PowerType, StateUtils, PlayerType } from '../../../game';
import { StoreLike } from '../../../game/store/store-like';
import { Effect } from '../../../game/store/effects/effect';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';
import {
  CheckProvidedEnergyEffect,
  CheckTableStateEffect,
} from '../../../game/store/effects/check-effects';
import { IS_ABILITY_BLOCKED, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Rotomex extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  protected _tags = [CardTag.POKEMON_ex];
  public cardType: CardType[] = [L];
  public hp: number = 190;
  public weakness = [{ type: F }];
  public retreat = [C];

  public powers = [{
    name: 'Multi Adapter',
    // TA-209: NOT player-activated. 'Multi Adapter' is a PASSIVE ability -- a continuous effect applied through CheckTableStateEffect below,
    // with no WAS_POWER_USED branch anywhere in this card. `useWhenInPlay: true` put it in the
    // menu as a `useAbility` the engine accepted and that did nothing; rotomancer never offered
    // it. Same fix as TA-77 (por-012) and TA-78 (meg-101).
    powerType: PowerType.ABILITY,
    text: 'Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away, discard Pokémon Tools from those Pokémon until only 1 remains on each.'
  }];

  public attacks = [
    {
      name: 'Thunderbolt',
      cost: [L, C],
      damage: 130,
      text: 'Discard all Energy from this Pokemon.',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '29';
  public name: string = 'Rotom ex';
  public fullName: string = 'Rotom ex M2';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof CheckTableStateEffect) {
      // CheckTableStateEffect.player is not populated on the post-KO cleanup pass
      // (check-effect.ts dispatches `new CheckTableStateEffect([5, 5])` with no player),
      // so derive the owner from state — dereferencing effect.player directly crashed
      // (StateUtils.isPokemonInPlay -> undefined.forEachPokemon) whenever this attack's
      // own KO triggered that cleanup. Match the sibling idiom (arceus-lv-x, dialga-g-lv-x).
      const cardList = StateUtils.findCardList(state, this);
      const player = StateUtils.findOwner(state, cardList);

      // Multi Adapter only applies while this Rotom ex is itself in play.
      if (player === undefined || !StateUtils.isPokemonInPlay(player, this)) {
        return state;
      }

      // Try to reduce PowerEffect, to check if something is blocking our ability
      if (IS_ABILITY_BLOCKED(store, state, player, this)) {
        return state;
      }

      // Multi Adapter: Set maxTools to 2 for any Pokemon with "Rotom" in their name [TA-113]
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
        if (card && card.name.includes('Rotom')) {
          card.maxTools = 2;
        }
      });
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // Discard all Energy from this Pokemon
      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player, player.active);
      store.reduceEffect(state, checkProvidedEnergy);

      const energyCards = checkProvidedEnergy.energyMap.map((e) => e.card);
      if (energyCards.length > 0) {
        const discardEnergy = new DiscardCardsEffect(effect, energyCards);
        discardEnergy.target = player.active;
        store.reduceEffect(state, discardEnergy);
      }
    }

    return state;
  }
}
