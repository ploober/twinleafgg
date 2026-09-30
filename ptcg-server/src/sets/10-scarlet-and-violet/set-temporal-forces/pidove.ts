import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { GameMessage } from '../../../game/game-message';
import { GameError, PowerType } from '../../../game';

import { PlayerType } from '../../../game';
import { Card } from '../../../game/store/card/card';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { CheckHpEffect } from '../../../game/store/effects/check-effects';
import { ABILITY_USED, SHUFFLE_DECK, WAS_POWER_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Pidove extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.COLORLESS];

  public hp: number = 50;

  public weakness = [{ type: CardType.LIGHTNING }];

  public resistance = [{ type: CardType.FIGHTING, value: -30 }];

  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Emergency Evolution',
    powerType: PowerType.ABILITY,
    useWhenInPlay: true,
    text: 'Once during your turn, if this Pokémon\'s remaining HP is 30 or less, you may search your deck for an Unfezant or Unfezant ex and put it onto this Pidove to evolve it. Then, shuffle your deck.'
  }];

  public attacks = [{
    name: 'Gust',
    cost: [CardType.COLORLESS],
    damage: 10,
    text: ''
  }];

  public set: string = 'TEF';

  public setNumber = '133';

  public cardImage = 'assets/cardback.png';

  public regulationMark: string = 'H';

  public name: string = 'Pidove';

  public fullName: string = 'Pidove TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Emergency Evolution
    if (WAS_POWER_USED(effect, 0, this)) {
      const player = effect.player;

      // TA-210 / B.27: this bail-out used to sit ABOVE the HP gate below and `return state`, so with an
      // empty deck the reducer finished without raising -- and legal-actions.ts, which probes by dry-run
      // and offers anything that does not throw, put the Ability in the menu even though the card's own
      // printed precondition ("if this Pokémon's remaining HP is 30 or less") was unmet. The early return
      // masked the gate. Now: THROW (an empty deck cannot be searched, compendium #13), and let the HP
      // gate below run on every path. Note a NON-empty deck holding no Unfezant must still be usable --
      // searching and failing to find is a legal use (#127) -- so this stays `=== 0`.
      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        if (cardList.getPokemonCard() === this) {
          const checkHpEffect = new CheckHpEffect(player, cardList);

          if (checkHpEffect.hp - cardList.damage > 30) {
            throw new GameError(GameMessage.CANNOT_USE_POWER);
          }

          // TA-212 (half 2): "Once during your turn" — mark the slot ABILITY_USED here, at the point
          // the use is committed (gate met, deck non-empty), BEFORE the search prompt. legal-actions.ts
          // filters slots carrying BoardEffect.ABILITY_USED from the menu (cleared at EndTurnEffect), so
          // a fruitless search no longer refunds the once-per-turn — twinleaf re-offered it, rotomancer
          // did not (#127: "since you searched your deck the ability is used up for the turn"). The
          // sibling shuffle path (TA-250) fixed half 1. Mirrors silvally.ts's ABILITY_USED(player, this).
          ABILITY_USED(player, this);

          let cards: Card[] = [];
          return store.prompt(state, new ChooseCardsPrompt(
            player,
            GameMessage.CHOOSE_CARD_TO_EVOLVE,
            player.deck,
            { superType: SuperType.POKEMON, name: 'Unfezant' },
            { min: 0, max: 1, allowCancel: false }
          ), selected => {
            cards = selected || [];
            if (cards) {
              MOVE_CARDS(store, state, player.deck, cardList, { cards: cards, sourceCard: this });
              cardList.clearEffects();
              cardList.pokemonPlayedTurn = state.turn;
            }
            // TA-250 / B.33: "Then, shuffle your deck" is a SEPARATE printed instruction, owed even
            // on the whiff (min:0 decline) and after the searched card leaves the deck. rotomancer
            // emits `shuffled`; twinleaf omitted it (bespoke reduceEffect, not the shared prefab).
            // Mirrors magmar.ts / SEARCH_DECK_FOR_CARDS_TO_HAND, both of which shuffle unconditionally.
            SHUFFLE_DECK(store, state, player);
          });
        }
      });
    }

    return state;
  }

}
