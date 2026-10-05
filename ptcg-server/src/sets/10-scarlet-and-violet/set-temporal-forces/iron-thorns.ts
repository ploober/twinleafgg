import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../../game/store/card/card-types';
import {
  StoreLike,
  State,
  CardList,
  ShuffleDeckPrompt,
  GameMessage,
  ShowCardsPrompt,
  StateUtils,
} from '../../../game';
import { Effect } from '../../../game/store/effects/effect';

import {WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class IronThorns extends PokemonCard {
  public stage: Stage = Stage.BASIC;

  protected _tags = [CardTag.FUTURE];

  public cardType: CardType[] = [L];

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
      text: 'Reveal the top 5 cards of your deck. This attack does 70 damage times for each Future card you find there. Then, discard the revealed Future cards and shuffle the other cards back into your deck.',
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
      // TA-564: "each Future card" — any card with the Future tag (Techno Radar, Future Booster Energy Capsule are
      // Future Trainers), not only Future Pokémon.
      const futureCards = top5.filter(c => c.hasTag(CardTag.FUTURE));

      // TA-247: assign the damage BEFORE the empty-deck bail-out, not after. `damage: 70` with
      // `damageCalculation: 'x'` declares a MULTIPLICAND, not a base — so returning early left the
      // full 70 in place and an empty deck dealt 70 instead of 0, with nothing revealed and no
      // Future card found. The stocked-deck path was correct throughout, which is why no board in
      // the corpus could see it: 0 of 9,058 sides ever starts with an empty deck (G-8).
      effect.damage = 70 * futureCards.length;

      if (top5.length === 0) {
        return state;
      }

      return store.prompt(state, new ShowCardsPrompt(
        opponent.id,
        GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
        top5), () => {

        const deckTop = new CardList();
        MOVE_CARDS(store, state, player.deck, deckTop, { count: 5, sourceCard: this });

        // Discard the revealed Future cards; shuffle the rest back into the deck.
        const toDiscard = deckTop.cards.filter(c => c.hasTag(CardTag.FUTURE));   // TA-564: every Future card
        deckTop.moveCardsTo(toDiscard, player.discard);

        // TA-251 / B.33: "shuffle THE OTHER cards back" — the revealed cards NOT discarded. If every
        // revealed card was a Future card (all discarded), there are no "other cards" and the
        // shuffle is suppressed (#1979). Key on the OBJECT, not the deck: the top5-empty guard above
        // reds only the empty-DECK cell and never reaches the all-Future-with-stocked-deck path.
        // rotomancer suppresses here.
        const otherCards = deckTop.cards.length;
        MOVE_CARDS(store, state, deckTop, player.deck, { count: deckTop.cards.length, sourceCard: this });

        if (otherCards === 0) {
          return state;
        }

        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
          return state;
        });
      });
    }

    return state;
  }
}
