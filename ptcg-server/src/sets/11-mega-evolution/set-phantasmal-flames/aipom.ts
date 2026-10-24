import { ChooseCardsPrompt, GameMessage, State, StateUtils, StoreLike } from '../../../game';
import { CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { AFTER_ATTACK, MOVE_CARDS, SHOW_CARDS_TO_PLAYER, SHUFFLE_DECK } from '../../../game/store/prefabs/prefabs';

export class Aipom extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 70;
  public cardType: CardType[] = [C];
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [{
    name: 'Astonish',
    cost: [C, C],
    damage: 20,
    text: 'Choose a random card from your opponent\'s hand, and your opponent reveals that card and shuffles it into their deck.'
  }];

  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '78';
  public name: string = 'Aipom';
  public fullName: string = 'Aipom PFL';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Astonish
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      if (opponent.hand.cards.length === 0) {
        return state;
      }

      // TA-749 / B.12: the random card is a secret pick (a system pick on the wire), not an inline random draw.
      state = store.prompt(state, new ChooseCardsPrompt(
        player, GameMessage.CHOOSE_CARD_TO_SHUFFLE, opponent.hand, {},
        { allowCancel: false, min: 1, max: 1, isSecret: true },
      ), cards => {
        const picked = cards || [];
        if (picked.length === 0) {
          return;
        }
        SHOW_CARDS_TO_PLAYER(store, state, player, picked);
        MOVE_CARDS(store, state, opponent.hand, opponent.deck, { cards: picked, sourceCard: this, sourceEffect: this.attacks[0] });
        SHUFFLE_DECK(store, state, opponent);
      });
    }

    return state;
  }
}
