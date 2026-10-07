import { Card, CardType, ChooseCardsPrompt, GameMessage, PokemonCard, Stage, State, StoreLike, SuperType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Crocalor extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Fuecoco';
  public cardType: CardType[] = [CardType.FIRE];
  public hp: number = 100;
  public weakness = [{ type: CardType.WATER }];
  public resistance = [];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [{
    name: 'Rolling Fireball',
    cost: [CardType.FIRE, CardType.FIRE],
    damage: 90,
    text: 'Put an Energy attached to this Pokémon into your hand.'
  }];

  public regulationMark = 'G';
  public set: string = 'PAR';
  public setNumber: string = '24';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Crocalor';
  public fullName: string = 'Crocalor PAR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Rolling Fireball. TA-658 / B.89 (1), (4): the pick of the Energy is the attacker's Step-D choice, asked before the
    // damage (recorded `chosen`; a `choose`, not a `discard`: it goes to the hand, CF-32), and the Energy goes to the
    // hand after the damage.
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const source = player.active;
      const prompt = new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        source,
        { superType: SuperType.ENERGY },
        { min: 1, max: 1, allowCancel: false }
      );
      prompt.deferredMove = true;
      return store.prompt(state, prompt, selected => {
        const cards: Card[] = selected || [];
        if (cards.length === 0) {
          return;
        }
        effect.afterDamageMoves.push(() => {
          const still = cards.filter(c => source.cards.includes(c));
          if (still.length > 0) {
            MOVE_CARDS(store, state, source, player.hand, { cards: still, sourceCard: this });
          }
        });
      });
    }

    return state;
  }

}
