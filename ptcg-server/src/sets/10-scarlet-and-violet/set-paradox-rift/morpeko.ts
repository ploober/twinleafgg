import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { PowerType } from '../../../game/store/card/pokemon-types';
import { Effect } from '../../../game/store/effects/effect';
import { CheckRetreatCostEffect, CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { AttachEnergyPrompt, GameMessage, PlayerType, SlotType, StateUtils } from '../../../game';
import {IS_ABILITY_BLOCKED, AFTER_ATTACK, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

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

    // TA-490: the move runs AFTER_ATTACK, so the 70 damage lands first (#649 / #543).
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const hasBench = player.bench.some(b => b.cards.length > 0);

      if (hasBench === false) {
        return state;
      }

      const checkProvidedEnergy = new CheckProvidedEnergyEffect(player, player.active);
      state = store.reduceEffect(state, checkProvidedEnergy);
      // TA-490: `blocked` holds indices into the source list (it held card ids, so the collapsed move failed validate).
      const blocked: number[] = [];
      let dark = 0;
      player.active.cards.forEach((card, index) => {
        const em = checkProvidedEnergy.energyMap.find(e => e.card === card);
        if (em && (em.provides.includes(CardType.DARK) || em.provides.includes(CardType.ANY))) {
          dark++;
        } else {
          blocked.push(index);
        }
      });
      const count = Math.min(2, dark);
      if (count === 0) {
        return state;
      }

      return store.prompt(state, new AttachEnergyPrompt(
        player.id,
        GameMessage.ATTACH_ENERGY_TO_BENCH,
        player.active,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { superType: SuperType.ENERGY },
        { allowCancel: false, min: count, max: count, sameTarget: true, blocked }
      ), transfers => {
        transfers = transfers || [];
        for (const transfer of transfers) {
          const target = StateUtils.getTarget(state, player, transfer.to);
          MOVE_CARDS(store, state, player.active, target, { cards: [transfer.card], sourceCard: this });
        }
      });
    }
    return state;
  }
}