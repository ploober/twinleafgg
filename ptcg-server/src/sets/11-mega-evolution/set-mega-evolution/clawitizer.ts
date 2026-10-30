import { PokemonCard, Stage, CardType, PowerType, State, StoreLike, ConfirmPrompt, GameMessage, SuperType, EnergyCard, EnergyType, GameError, CardTarget, PlayerType, SlotType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MovedFromActiveToBenchEffect, PowerEffect } from '../../../game/store/effects/game-effects';
import {DISCARD_ALL_ENERGY_FROM_POKEMON, MOVED_FROM_ACTIVE_TO_BENCH_THIS_TURN, REMOVE_MARKER_AT_END_OF_TURN, WAS_ATTACK_USED, ATTACH_ENERGY_PROMPT } from '../../../game/store/prefabs/prefabs';

export class Clawitizer extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Clauncher';
  public cardType: CardType[] = [W];
  public hp: number = 130;
  public weakness = [{ type: L }];
  public retreat = [C, C];

  public powers = [{
    name: 'Fall Back to Reload',
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, when this Pokémon moves from the Active Spot to the Bench, you may use this Ability. Attach up to 2 Basic [W] Energy cards from your hand to this Pokémon.'
  }];

  public attacks = [{
    name: 'Aqua Launcher',
    cost: [W, W, W],
    damage: 210,
    text: 'Discard all Energy from this Pokémon.'
  }];

  public set: string = 'MEG';
  public setNumber: string = '38';
  public regulationMark = 'I';
  public cardImage: string = 'assets/cardback.png';
  public fullName: string = 'Clawitizer M1S';
  public name: string = 'Clawitzer';

  public readonly ABILITY_USED_MARKER = 'ABILITY_USED_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    REMOVE_MARKER_AT_END_OF_TURN(effect, this.ABILITY_USED_MARKER, this);

    const player = state.players[state.activePlayer];
    if (
      effect instanceof MovedFromActiveToBenchEffect &&
      effect.pokemonCard === this &&
      state.players[state.activePlayer] === effect.player &&
      MOVED_FROM_ACTIVE_TO_BENCH_THIS_TURN(effect.player, this)
    ) {
      if (player.marker.hasMarker(this.ABILITY_USED_MARKER, this)) {
        return state;
      }

      try {
        const stub = new PowerEffect(player, {
          name: 'test',
          powerType: PowerType.ABILITY,
          text: ''
        }, this);
        store.reduceEffect(state, stub);
      } catch {
        return state;
      }

      const energyCards = player.hand.cards.filter(c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.BASIC && c.name === 'Water Energy');
      if (energyCards.length === 0) {
        return state;
      }

      state = store.prompt(state, new ConfirmPrompt(
        player.id,
        GameMessage.WANT_TO_USE_ABILITY,
      ), wantToUse => {
        if (!wantToUse) {
          return;
        }

        const hasEnergyInHand = player.hand.cards.some(c => {
          return c.superType === SuperType.ENERGY
            && c.energyType === EnergyType.BASIC
            && (c as EnergyCard).provides.includes(CardType.WATER);
        });
        if (!hasEnergyInHand) {
          throw new GameError(GameMessage.CANNOT_USE_POWER);
        }

        const blockedTo: CardTarget[] = [];
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (_list, card, target) => {
          if (card !== this) { blockedTo.push(target); }
        });
        player.marker.addMarker(this.ABILITY_USED_MARKER, this);
        return ATTACH_ENERGY_PROMPT(
          store, state, player, PlayerType.BOTTOM_PLAYER, SlotType.HAND,
          [SlotType.ACTIVE, SlotType.BENCH],
          { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Water Energy' },
          { min: 1, max: 2, allowCancel: false, blockedTo },
        );
      });
    }

    if (WAS_ATTACK_USED(effect, 0, this)) {
      // TA-613 (B.76, #2031): no card is chosen, so the discard is applied after the damage.
      effect.afterDamageMoves.push(() => DISCARD_ALL_ENERGY_FROM_POKEMON(store, state, effect, this));
    }

    return state;
  }
}
