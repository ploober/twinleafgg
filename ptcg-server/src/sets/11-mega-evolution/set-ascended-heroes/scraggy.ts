import { CardType, Stage } from '../../../game/store/card/card-types';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Effect } from '../../../game/store/effects/effect';
import { ChooseCardsPrompt, GameMessage, State, StateUtils, StoreLike } from '../../../game';
import { AFTER_ATTACK, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Scraggy extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [D];
  public hp: number = 80;
  public weakness = [{ type: G }];
  public resistance = [];
  public retreat = [C, C];

  public attacks = [{
    name: 'Knock Off',
    cost: [D, C],
    damage: 20,
    text: 'Discard a random card from your opponent\'s hand.'
  }];

  public regulationMark = 'I';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '134';
  public name: string = 'Scraggy';
  public fullName: string = 'Scraggy M2a';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    // Knock Off
    // TA-646 / B.85 (3)(a): an effect on the opponent's hand, the pick and the discard, comes after the attack's damage.
    if (AFTER_ATTACK(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // TA-749 / B.12: the random card is a secret pick (a system pick on the wire), not an inline random draw.
      if (opponent.hand.cards.length > 0) {
        state = store.prompt(state, new ChooseCardsPrompt(
          player, GameMessage.CHOOSE_CARD_TO_DISCARD, opponent.hand, {},
          { allowCancel: false, min: 1, max: 1, isSecret: true },
        ), cards => {
          MOVE_CARDS(store, state, opponent.hand, opponent.discard, { cards: cards || [], sourceCard: this });
        });
      }
    }

    return state;
  }
}