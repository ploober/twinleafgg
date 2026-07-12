import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import { StoreLike, State, CardList, ShuffleDeckPrompt, GameMessage, ShowCardsPrompt, StateUtils } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import { WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class IronThorns extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public tags = [CardTag.FUTURE];

  public cardType: CardType = L;

  public hp: number = 140;

  public weakness = [{ type: F }];

  public resistance = [];

  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Destructo-Press',
      cost: [L, C],
      damage: 70,
      damageCalculation: 'x',
      text: 'Reveal the top 5 cards of your deck. This attack does 70 damage times for each Future card you find there. Then, discard the revealed Future cards and shuffle the other cards back into your deck.'
    },
    { name: 'Megaton Lariat', cost: [L, L, L, C], damage: 140, text: '' },
  ];

  public set: string = 'TEF';

  public regulationMark = 'H';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '62';

  public name: string = 'Iron Thorns';

  public fullName: string = 'Iron Thorns TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // "Reveal the top 5 cards of your deck" — ALL five, publicly, while they are still in the deck.
      // The damage (70 × Future count) is decided from the same five, so compute it now; the discard
      // + shuffle-back are deferred into the reveal's callback so the reveal is observed BEFORE the
      // cards move — the reveal then carries `from:"deck"` and the full top-5 in top-first order,
      // converging with rotomancer's CF-18 `reveal{owner, cards, from:"deck", to:"all"}`.
      const top5 = player.deck.cards.slice(0, 5);
      if (top5.length === 0) {
        return state;
      }

      const futureCards = top5.filter(c =>
        c instanceof PokemonCard && c.tags.includes(CardTag.FUTURE));
      effect.damage = 70 * futureCards.length;

      return store.prompt(state, new ShowCardsPrompt(
        opponent.id,
        GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
        top5), () => {

        const deckTop = new CardList();
        player.deck.moveTo(deckTop, 5);

        // Discard the revealed Future cards; shuffle the rest back into the deck.
        const toDiscard = deckTop.cards.filter(c =>
          c instanceof PokemonCard && c.tags.includes(CardTag.FUTURE));
        deckTop.moveCardsTo(toDiscard, player.discard);
        deckTop.moveTo(player.deck, deckTop.cards.length);

        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
          return state;
        });
      });
    }

    return state;
  }
}