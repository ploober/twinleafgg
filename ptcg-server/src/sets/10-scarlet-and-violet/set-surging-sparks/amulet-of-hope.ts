import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State, GamePhase } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { KnockOutEffect } from '../../../game/store/effects/game-effects';
import { Card } from '../../../game/store/card/card';
import { ChooseCardsPrompt, GameLog, GameMessage, ShuffleDeckPrompt } from '../../../game';
import { ToolEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class AmuletofHope extends TrainerCard {

  protected _tags = [CardTag.ACE_SPEC];

  public trainerType: TrainerType = TrainerType.TOOL;

  public set: string = 'SSP';

  public setNumber = '162';

  public cardImage = 'assets/cardback.png';

  public regulationMark: string = 'H';

  public name: string = 'Amulet of Hope';

  public fullName: string = 'Amulet of Hope SSP';

  public text: string =
    'If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent\'s Pokémon, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof KnockOutEffect && effect.target.tools.includes(this)) {
      const player = effect.player;

      if (state.phase !== GamePhase.ATTACK) {
        return state;
      }

      // Try to reduce ToolEffect, to check if something is blocking the tool from working
      try {
        const stub = new ToolEffect(effect.player, this);
        store.reduceEffect(state, stub);
      } catch {
        return state;
      }

      // TA-283 / B.14: the search resolves IN the Knock Out window, before the opponent takes a Prize card and before
      // the owner promotes (#810: prizes are taken "as soon as all triggered effects have finished resolving"; #808
      // Wishful Baton and #1918 Cursed Duster, Tools on the Knocked Out Pokemon, both resolve before Prizes). This
      // used to stamp a marker here and run the search at BetweenTurnsEffect, after Prizes, promotion and the rest
      // of the turn. As a KO-window reactor (Store.resolveKnockOutReactions) the handler runs before the core discard.
      store.log(state, GameLog.LOG_PLAYER_USES_ABILITY, { name: player.name, ability: 'Amulet of Hope' });

      // TA-250 / B.33: on an empty deck there is nothing to take (the search is suppressed, which keeps TA-157's
      // floor of 1 satisfiable), but "Then, shuffle your deck" names an object that survives, so the shuffle is
      // still owed.
      if (player.deck.cards.length === 0) {
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      }

      // TA-157 / compendium #2061 (this exact card): "You must take at least 1 card with Amulet of
      // Hope when it applies." The untyped-search exception (#2301 / roto #968) floors an
      // any-card deck search at 1 — min:0 let the player whiff a mandatory search. The empty-deck
      // guard above keeps the 1-floor satisfiable.
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        {},
        { min: 1, max: 3, allowCancel: false }
      ), selected => {
        const cards: Card[] = selected || [];
        MOVE_CARDS(store, state, player.deck, player.hand, { cards: cards, sourceCard: this });
        // TA-582: the shuffle follows the search, so it is raised inside the pick callback; raised beside the open
        // pick, the live arbiter shuffled first and the deck stayed in the searched order.
        store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
          player.deck.applyOrder(order);
        });
      });
    }

    return state;
  }

}
