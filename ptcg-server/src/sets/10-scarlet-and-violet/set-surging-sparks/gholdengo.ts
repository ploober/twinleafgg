import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, PokemonCardList, StateUtils, Resistance, ShuffleDeckPrompt } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MAY_CHOOSE_FIRST } from '../../../game/store/prefabs/attack-effects';

import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Gholdengo extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public cardType: CardType[] = [CardType.METAL];
  public hp: number = 130;
  public weakness = [{ type: CardType.FIRE }];
  public resistance: Resistance[] = [{ type: CardType.GRASS, value: -30 }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];
  public evolvesFrom = 'Gimmighoul';

  public attacks = [{
    name: 'Strike It Rich',
    cost: [CardType.METAL],
    damage: 30,
    damageCalculation: '+',
    text: 'If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.'
  },
  {
    name: 'Surf Back',
    cost: [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS],
    damage: 100,
    text: 'You may shuffle this Pokémon and all attached cards into your deck.'
  }];

  public set: string = 'SSP';
  public regulationMark = 'H';
  public cardImage: string = 'assets/cardback.png';
  public fullName: string = 'Gholdengo SSP';
  public name: string = 'Gholdengo';
  public setNumber: string = '131';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // From Lokix PAL 21
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const cardList = StateUtils.findCardList(state, this);

      if (cardList instanceof PokemonCardList) {
        if (cardList.pokemonPlayedTurn === state.turn) {
          effect.damage += 90;
        }
      }
      //From Mew V FST
    } else if (WAS_ATTACK_USED(effect, 1, this)) {
      // Surf Back. TA-670 (B.101 (4)): the "you may" is asked at Step D, before the damage; the shuffle is after it
      // (#649). It had dealt the 100 inline first and asked after it.
      const player = effect.player;
      return MAY_CHOOSE_FIRST(store, state, effect, () => {
        MOVE_CARDS(store, state, player.active, player.deck, { sourceCard: this });
        player.active.clearEffects();
        store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }
    return state;
  }
}