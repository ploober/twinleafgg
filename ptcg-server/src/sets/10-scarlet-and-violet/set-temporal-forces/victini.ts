import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';

import { Card, ChooseCardsPrompt, EnergyCard, GameMessage, StateUtils } from '../../..';
import { CheckProvidedEnergyEffect } from '../../../game/store/effects/check-effects';
import { WAS_ATTACK_USED, SHUFFLE_THEN_DRAW, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class Victini extends PokemonCard {

  public stage: Stage = Stage.BASIC;

  public cardType: CardType[] = [CardType.FIRE];

  public hp: number = 80;

  public weakness = [{ type: CardType.WATER }];

  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Flippity Flap',
      cost: [CardType.COLORLESS],
      damage: 0,
      text: 'Shuffle your hand into your deck. Then, draw 6 cards.'
    },
    {
      name: 'Singe Off',
      cost: [CardType.FIRE],
      damage: 30,
      text: 'Discard a Special Energy from your opponent\'s Active Pokémon.'
    }
  ];

  public set: string = 'TEF';

  public regulationMark = 'H';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '30';

  public name: string = 'Victini';

  public fullName: string = 'Victini TEF';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {

      const player = effect.player;
      // TA-304: the draw ran AFTER the `store.prompt` call but BEFORE the prompt resolved --
      // `store.prompt` enqueues and returns -- so the six cards came off the UNSHUFFLED deck and were
      // fully determined by the pre-attack order. The printed clause sequences it with "Then", and
      // randomising the draw is the only thing the shuffle is there for. Now inside the continuation.
      //
      // The `.filter(c => c !== this)` that used to guard the move is gone with it: `this` is the
      // ATTACKING Victini, which is in play and never in hand, so the filter excluded nothing. A
      // second copy of Victini in hand is a different object and was never excluded by it either.
      //
      // The `if (cards.length > 0)` guard is gone too, and deliberately: with an empty hand it
      // skipped the shuffle entirely, so the draw again came off an unshuffled deck. #930 reads a
      // hand of zero cards as still shufflable, and rotomancer shuffles on that board.
      const cards = [...player.hand.cards];
      cards.forEach(c => player.hand.moveCardTo(c, player.deck));
      return SHUFFLE_THEN_DRAW(store, state, player, 6);
    }

    if (WAS_ATTACK_USED(effect, 1, this)) {

      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const oppActive = opponent.active;

      const checkEnergy = new CheckProvidedEnergyEffect(player, oppActive);
      store.reduceEffect(state, checkEnergy);

      checkEnergy.energyMap.forEach(em => {
        const energyCard = em.card;
        if (energyCard instanceof EnergyCard && energyCard.energyType === EnergyType.SPECIAL) {

          let cards: Card[] = [];
          store.prompt(state, new ChooseCardsPrompt(
            player,
            GameMessage.CHOOSE_CARD_TO_DISCARD,
            oppActive,
            { superType: SuperType.ENERGY, energyType: EnergyType.SPECIAL },
            { min: 1, max: 1, allowCancel: false }
          ), selected => {
            cards = selected;
          });
          MOVE_CARDS(store, state, oppActive, opponent.discard, { cards: cards, sourceCard: this });
        }
      });
    }
    return state;
  }
}