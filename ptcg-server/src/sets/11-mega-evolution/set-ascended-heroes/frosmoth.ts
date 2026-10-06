import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, BoardEffect } from '../../../game/store/card/card-types';
import { StoreLike, State, StateUtils, GameError, GameMessage, PlayerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { PowerType } from '../../../game/store/card/pokemon-types';
import { EndTurnEffect } from '../../../game/store/effects/game-phase-effects';
import { PlayPokemonEffect } from '../../../game/store/effects/play-card-effects';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';
import { DRAW_CARDS, WAS_ATTACK_USED, WAS_POWER_USED } from '../../../game/store/prefabs/prefabs';

export class Frosmoth extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Snom';
  public cardType: CardType[] = [W];
  public hp: number = 110;
  public weakness = [{ type: M }];
  public resistance = [];
  public retreat = [C, C];

  public powers = [{
    name: 'Alluring Wings',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Each player draws a card.'
  }];

  public attacks = [{
    name: 'Cold Cyclone',
    cost: [W, W],
    damage: 90,
    text: 'Move a [W] Energy from this Pokémon to 1 of your Benched Pokémon.'
  }];

  public regulationMark: string = 'I';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '53';
  public name: string = 'Frosmoth';
  public fullName: string = 'Frosmoth M2a';

  public readonly INVITING_WINGS_MARKER = 'INVITING_WINGS_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Reset marker when Pokemon is played
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      player.marker.removeMarker(this.INVITING_WINGS_MARKER, this);
    }

    // Reset marker at end of turn
    if (effect instanceof EndTurnEffect && effect.player.marker.hasMarker(this.INVITING_WINGS_MARKER, this)) {
      const player = effect.player;
      player.marker.removeMarker(this.INVITING_WINGS_MARKER, this);
    }

    // Inviting Wings ability
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;
      const pokemonCard = player.active.getPokemonCard();

      // Check if Pokemon is in active spot
      if (pokemonCard !== this) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // Check if ability was already used this turn
      if (player.marker.hasMarker(this.INVITING_WINGS_MARKER, this)) {
        throw new GameError(GameMessage.POWER_ALREADY_USED);
      }

      // Check if decks have cards to draw
      const opponent = StateUtils.getOpponent(state, player);
      if (player.deck.cards.length === 0 && opponent.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // Draw cards for both players
      if (player.deck.cards.length > 0) {
        DRAW_CARDS(store, state, player, 1);
      }
      if (opponent.deck.cards.length > 0) {
        DRAW_CARDS(store, state, opponent, 1);
      }

      // Mark ability as used
      player.marker.addMarker(this.INVITING_WINGS_MARKER, this);

      // Add visual effect
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
        if (cardList.getPokemonCard() === this) {
          cardList.addBoardEffect(BoardEffect.ABILITY_USED);
        }
      });
    }

    // Cold Cyclone
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      // TA-383 (the F-026 class, second carrier). A movable "[W] Energy" is any Energy that PROVIDES a
      // [W]-ish type RIGHT NOW. A Special Energy can carry a static `provides` that says nothing about
      // its real type — Legacy Energy `twm-167` is `[COLORLESS]` statically and `[ANY]` only via
      // `CheckProvidedEnergyEffect`; Wash Water Energy `viv-165` is `[COLORLESS]` statically and
      // `[WATER]` dynamically — so the dynamic map is the only correct operand. Compendium #443
      // ("Rainbow Energy counts as all types of energy when in play") and #383 (an all-types Energy
      // SATISFIES a type-specific condition) put it beyond doubt, and rotomancer already offers it.
      //
      // Express the restriction as an eligibility test over the dynamic map (the prefab blocks the rest by index),
      // NOT as a static-type filter, which would drop the Special Energy right back out.
      //
      // The count is clamped to what actually qualifies (the prefab): with the Special Energy wrongly
      // excluded the lone basic left made the pick collapse, and the player never chose which Energy left.
      // Upstream 9e6e302fd deleted the WLFM/GRW/LPM/FDY/GRPD pseudo-CardTypes: a blend/unit Energy
      // now reports its REAL types in `provides` and StateUtils treats a multi-type provides as one
      // choosable unit, so [WATER, ANY] already matches a WLFM blend. Nothing to enumerate.
      const validTypes = [CardType.WATER, CardType.ANY];
      const checkEnergy = new CheckProvidedEnergyEffect(player, player.active);
      store.reduceEffect(state, checkEnergy);
      const providesValidType = new Set(
        checkEnergy.energyMap
          .filter(em => em.provides.some(t => validTypes.includes(t)))
          .map(em => em.card)
      );
      // TA-651 / B.82 (1), B.85 (1)(c): the Energy is chosen before the damage (recorded as `chosen`) and moves after it.
      return MOVE_ENERGY_FROM_THIS_POKEMON_TO_BENCH_CHOOSE_FIRST(store, state, effect, this,
        { eligible: card => providesValidType.has(card) });
    }

    return state;
  }
}

