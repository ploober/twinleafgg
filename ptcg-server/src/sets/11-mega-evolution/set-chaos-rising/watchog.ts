import { CardType, Stage } from '../../../game/store/card/card-types';
import { Effect } from '../../../game/store/effects/effect';
import { PokemonCard, StateUtils, StoreLike, State } from '../../../game';
import { ChooseCardsPrompt, GameMessage, ShowCardsPrompt } from '../../../game';
import {
  MOVE_CARDS,
  MULTIPLE_COIN_FLIPS_PROMPT,
  SHUFFLE_DECK,
  WAS_ATTACK_USED,
} from '../../../game/store/prefabs/prefabs';

export class Watchog extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom = 'Patrat';
  public hp: number = 100;
  public cardType: CardType[] = [C];
  public weakness = [{ type: F }];
  public retreat = [C];

  public attacks = [
    {
      name: 'Snap Inspection',
      cost: [C],
      damage: 0,
      text: "Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck.",
    },
    {
      name: 'Low Kick',
      cost: [C],
      damage: 50,
      text: '',
    },
  ];

  public regulationMark = 'J';

  public set: string = 'CRI';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '71';
  public name: string = 'Watchog';
  public fullName: string = 'Watchog M4';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      return MULTIPLE_COIN_FLIPS_PROMPT(store, state, player, 3, (results) => {
        const heads = results.filter((r) => r).length;
        if (heads === 0 || opponent.hand.cards.length === 0) {
          return state;
        }
        // TA-411: "If any of them are heads, your opponent reveals their hand." A public reveal (CF-18).
        return store.prompt(state, new ShowCardsPrompt(
          player.id,
          GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
          opponent.hand.cards,
        ), () => {
          // TA-411: "For each heads, choose a card you find there and shuffle it into your opponent's deck."
          // Compendium #2356: "You have to do as much as you can." So the pick is exactly min(heads, hand) with no
          // stop, and it is a move to the DECK (CHOOSE_CARD_TO_DECK), not a discard.
          const count = Math.min(heads, opponent.hand.cards.length);
          return store.prompt(
            state,
            new ChooseCardsPrompt(
              player,
              GameMessage.CHOOSE_CARD_TO_DECK,
              opponent.hand,
              {},
              { min: count, max: count, allowCancel: false },
            ),
            (selected) => {
              const cards = selected || [];
              if (cards.length > 0) {
                MOVE_CARDS(store, state, opponent.hand, opponent.deck, {
                  cards,
                  sourceCard: this,
                  sourceEffect: effect,
                });
                SHUFFLE_DECK(store, state, opponent);
              }
            },
          );
        });
      });
    }
    return state;
  }
}
