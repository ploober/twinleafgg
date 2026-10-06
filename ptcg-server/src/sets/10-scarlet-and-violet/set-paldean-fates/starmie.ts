import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { ChoosePokemonPrompt, GameMessage, PlayerType, PowerType, SlotType, State, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import {WAS_POWER_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { PlaceDamageCountersEffect } from '../../../game/store/effects/game-effects';

export class Starmie extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Staryu';
  public cardType: CardType[] = [CardType.WATER];
  public hp: number = 90;
  public weakness = [{ type: CardType.LIGHTNING }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Mysterious Comet',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: ' Once during your turn, you may put 2 damage counters on 1 of your opponent\'s Pokémon. If you placed any damage counters in this way, discard this Pokémon and all attached cards.'
  }];

  public attacks = [{
    name: 'Speed Attack',
    cost: [CardType.WATER, CardType.COLORLESS],
    damage: 50,
    text: ''
  }];

  public set: string = 'PAF';
  public regulationMark = 'G';
  public setNumber: string = '119';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Starmie';
  public fullName: string = 'Starmie PAF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      state = store.prompt(state, new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        // TA-527: a counter placement (contract verb placeCounter), not a bare target pick.
        { min: 1, max: 1, allowCancel: false, operation: 'placeCounters' },
      ), selected => {
        const targets = selected || [];
        // TA-570: an Ability's counters go through PlaceDamageCountersEffect, so protection from the opponent's
        // Abilities applies (#1768: Stealthy Hood, Hide 'n' Sneak), and Starmie is discarded only "If you placed
        // any damage counters in this way".
        let placed = false;
        targets.forEach(target => {
          const place = new PlaceDamageCountersEffect(player, target, 20, this);
          store.reduceEffect(state, place);
          placed = placed || !place.preventDefault;
        });
        if (!placed) {
          return;
        }
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
          if (cardList.getPokemonCard() === this) {
            MOVE_CARDS(store, state, cardList, player.discard, { sourceCard: this });
            cardList.clearEffects();
          }
        });
      });

      return state;
    }

    return state;
  }
}