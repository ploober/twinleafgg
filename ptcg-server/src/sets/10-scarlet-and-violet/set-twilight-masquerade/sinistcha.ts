import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { Card, StoreLike, State, StateUtils, PlayerType, GameMessage, SlotType, DiscardEnergyPrompt, CardTarget, PokemonCardList } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { DiscardCardsEffect } from '../../../game/store/effects/attack-effects';

import { PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE } from '../../../game/store/prefabs/attack-effects';
import {WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Sinistcha extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Poltchageist';
  public cardType: CardType[] = [CardType.GRASS];
  public hp: number = 70;
  public weakness = [{ type: CardType.FIRE }];
  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Cursed Drop',
      cost: [CardType.GRASS],
      damage: 0,
      text: 'Put 4 damage counters on your opponent\'s Pokémon in any way you like.'
    },
    {
      name: 'Spill the Tea',
      cost: [CardType.GRASS],
      damage: 70,
      damageCalculation: 'x',
      text: 'Discard up to 3 [G] Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.'
    },
  ];

  public set: string = 'TWM';
  public name: string = 'Sinistcha';
  public fullName: string = 'Sinistcha TWM';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '22';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Cursed Drop
    if (WAS_ATTACK_USED(effect, 0, this)) {
      PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE(4, store, state, effect);
    }

    // Spill the Tea
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;

      // TA-602: "[G] Energy cards" are the attached Energy cards that PROVIDE [G] -- Legacy / Luminous Energy provide
      // every type while attached (#687, #443) -- not only Basic cards named "Grass Energy". The provided type is
      // dynamic (CheckProvidedEnergyEffect), so every other attached Energy is blocked per Pokemon.
      let totalGrassEnergy = 0;
      const blockedMap: { source: CardTarget, blocked: number[] }[] = [];
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, _card, target) => {
        const provided = new CheckProvidedEnergyEffect(player, cardList);
        store.reduceEffect(state, provided);
        const grass = provided.energyMap
          .filter(em => em.provides.includes(CardType.GRASS) || em.provides.includes(CardType.ANY))
          .map(em => em.card);
        const blocked: number[] = [];
        cardList.cards.forEach((card, index) => {
          if (card.superType !== SuperType.ENERGY) {
            return;
          }
          if (grass.includes(card)) {
            totalGrassEnergy++;
          } else {
            blocked.push(index);
          }
        });
        if (blocked.length > 0) {
          blockedMap.push({ source: target, blocked });
        }
      });

      return store.prompt(state, new DiscardEnergyPrompt(
        player.id,
        GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],// Card source is target Pokemon
        { superType: SuperType.ENERGY },
        { min: 0, max: Math.min(totalGrassEnergy, 3), allowCancel: false, blockedMap }
      ), transfers => {
        // TA-392: "70 damage for each card you discarded in this way" — the multiplier was assigned
        // INSIDE the transfer loop, so with zero cards chosen the printed base 70 was never zeroed and
        // the attack dealt 70 for nothing (rotomancer: 0). Count first, then move.
        // TA-688 (B.82): the chosen Energy stay attached through the damage and are discarded after it; a raw
        // moveCardTo discarded them at the pick. DiscardCardsEffect per source Pokémon: its reducer queues the move.
        const discarded = transfers || [];
        const grouped = new Map<PokemonCardList, Card[]>();
        for (const transfer of discarded) {
          const source = StateUtils.getTarget(state, player, transfer.from);
          grouped.set(source, [...(grouped.get(source) ?? []), transfer.card]);
        }
        grouped.forEach((cards, source) => {
          const discardEnergy = new DiscardCardsEffect(effect, cards);
          discardEnergy.target = source;
          state = store.reduceEffect(state, discardEnergy);
        });
        effect.damage = discarded.length * 70;
        return state;
      });
    }

    return state;
  }

}