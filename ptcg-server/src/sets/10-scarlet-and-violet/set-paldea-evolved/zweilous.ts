import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike, State, ChooseCardsPrompt, GameMessage, ShuffleDeckPrompt, StateUtils, Card } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { WAS_ATTACK_USED, MOVE_CARDS, SHOW_CARDS_THEN } from '../../../game/store/prefabs/prefabs';

export class Zweilous extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public cardType: CardType[] = [CardType.DARK];
  public hp: number = 100;
  public weakness = [{ type: CardType.GRASS }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];
  public evolvesFrom = 'Deino';

  public attacks = [{
    name: 'Find a Friend',
    cost: [CardType.COLORLESS],
    damage: 0,
    text: ' Search your deck for up to 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.'
  },
  {
    name: 'Headbutt Bounce',
    cost: [CardType.DARK, CardType.DARK, CardType.COLORLESS],
    damage: 80,
    text: ''
  }];

  public set = 'PAL';
  public regulationMark = 'G';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '139';
  public name = 'Zweilous';
  public fullName = 'Zweilous PAL';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      let cards: Card[] = [];

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { superType: SuperType.POKEMON },
        { min: 0, max: 2, allowCancel: true }
      ), selected => {
        cards = selected || [];
        // TA-543 / B.34: "reveal them, and put them into your hand" -- the reveal names only the cards found (none
        // found = nothing revealed) and happens before they enter the hand; then the shuffle.
        SHOW_CARDS_THEN(store, state, opponent, cards, () => {
          cards.forEach(card => {
            MOVE_CARDS(store, state, player.deck, player.hand, { cards: [card], sourceCard: this });
          });
          store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
            player.deck.applyOrder(order);
          });
        });
      });

    }

    return state;
  }

}