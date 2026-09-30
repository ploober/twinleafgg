import { CardType, EnergyType, Stage, SuperType } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import {
  PokemonCard,
  StoreLike,
  State,
  ChooseCardsPrompt,
  GameMessage,
  ShuffleDeckPrompt,
} from '../../../game';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { SHUFFLE_DECK, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { DealDamageEffect } from '../../../game/store/effects/attack-effects';

export class Quilladin extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Chespin';
  public hp: number = 100;
  public cardType: CardType[] = [G];
  public weakness = [{ type: R }];
  public retreat = [C, C, C];

  public attacks = [
    {
      name: 'Leafy Charge',
      cost: [G],
      damage: 20,
      text: 'Search your deck for 1 Basic [G] Energy card and attach it to this Pokémon. Then, shuffle your deck.',
    },
    {
      name: 'Vine Whip',
      cost: [G, G, C],
      damage: 80,
      text: '',
    },
  ];

  public regulationMark = 'J';
  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '6';
  public name: string = 'Quilladin';
  public fullName: string = 'Quilladin M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-351: rulebook step F / #543/#649 — the 20 lands on the Defending Pokémon BEFORE the deck
      // search pauses; left to the framework it landed after the prompt and the defender read 0 at
      // the pending (the TA-66/TA-69/TA-79 shape; a standing fuzz-baseline row on this card).
      const damageEffect = new DealDamageEffect(effect, effect.damage);
      state = store.reduceEffect(state, damageEffect);
      effect.damage = 0;

      // B.43: a search over the non-public deck is always PERFORMED (no gate on what the deck holds —
      // that both leaks the deck and skips the shuffle). An empty deck cannot be searched: no prompt,
      // but "Then, shuffle" still runs and CF-11 says the `shuffled` event is emitted at any size
      // (the TA-79 Pupitar idiom; rotomancer emits it here).
      if (player.deck.cards.length === 0) {
        return SHUFFLE_DECK(store, state, player);
      }

      const blocked: number[] = [];
      player.deck.cards.forEach((c, i) => {
        if (!(c instanceof EnergyCard)) blocked.push(i);
        else if (c.energyType !== EnergyType.BASIC) blocked.push(i);
        else if (!c.provides.includes(G)) blocked.push(i);
      });
      return store.prompt(
        state,
        new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_ATTACH,
          player.deck,
          { superType: SuperType.ENERGY },
          // TA-350 (sibling): a DECK search may always fail to find (#903) — `min: 0`, so the pick is
          // never "forced" and CHOOSE_CARD_TO_ATTACH's CF-14 collapse (choose-cards.ts) cannot fire
          // off hidden deck contents. rotomancer keeps the decline on this exact board.
          { min: 0, max: 1, allowCancel: false, blocked },
        ),
        (selected) => {
          const cards = selected || [];
          if (cards.length > 0) {
            MOVE_CARDS(store, state, player.deck, player.active, { cards: [cards[0]], sourceCard: this });
          }
          // "Then, shuffle your deck." follows the performed search whether or not it found (#2303,
          // B.44's wording test) — TA-351.
          return store.prompt(state, new ShuffleDeckPrompt(player.id), (order) => {
            player.deck.applyOrder(order);
          });
        },
      );
    }
    return state;
  }
}
