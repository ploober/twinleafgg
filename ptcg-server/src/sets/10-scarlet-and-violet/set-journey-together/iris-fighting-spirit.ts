import { TrainerCard } from '../../../game/store/card/trainer-card';
import { TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { ChooseCardsPrompt, GameMessage, Player } from '../../../game';
import {DRAW_CARDS_UNTIL_CARDS_IN_HAND, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class IrisFightingSpirit extends TrainerCard {

  public regulationMark = 'I';

  public trainerType: TrainerType = TrainerType.SUPPORTER;

  public set: string = 'JTG';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '149';

  public name: string = 'Iris\'s Fighting Spirit';

  public fullName: string = 'Iris\'s Fighting Spirit JTG';

  public text: string =
    'You can use this card only if you discard another card from your hand.' +
    '\n\n' +
    'Draw cards until you have 6 cards in your hand.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    if (player.hand.cards.filter(c => c !== this).length === 0) {
      return false;
    }
    // TA-368 (B.41 self-side addendum, TA-349's Lacey pattern; #2042 "you have to be able to
    // draw"): at deck = 0 the draw arm provably draws nothing, so the discard is pure cost and
    // the play is withheld.
    if (player.deck.cards.length === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {

      const player = effect.player;

      state = store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        {},
        // TA-184: this was `min: 0`, which offered a DECLINE on what the printed text makes a
        // precondition of use — "You can use this card **only if** you discard another card from
        // your hand." That is a COST, not an "up to": there is no legal way to use the card without
        // paying it. With min:0 the player could play the Supporter, decline the discard, and get
        // nothing at all — the Supporter still went to the discard and the turn's Supporter was
        // spent. Rotomancer answers `invalidAction` to that decline, correctly.
        //
        // Note the draw itself was never broken: with the discard actually taken, both engines end
        // on hand=6 / deck=11 identically. The filed symptom ("discards the cost but never draws")
        // described the decline path, where nothing is discarded and nothing is drawn.
        //
        // `canPlay` already refuses the card when the hand holds nothing else to discard, so a
        // floor of 1 is always satisfiable by the time this prompt is built.
        { allowCancel: false, min: 1, max: 1 }
      ), cards => {
        cards = cards || [];
        if (cards.length === 0) {
          return; // unreachable with min:1 — kept as a defensive guard
        }
        MOVE_CARDS(store, state, player.hand, player.discard, { cards: cards, sourceCard: this });
        if (player.hand.cards.length >= 6) {
          return;
        }

        DRAW_CARDS_UNTIL_CARDS_IN_HAND(player, 6);
      });

      return state;
    }
    return state;
  }
}