import { TrainerCard, TrainerType, StoreLike, State, GameError, GameMessage, CardList, ChooseCardsPrompt, SuperType, EnergyType, AttachEnergyPrompt, PlayerType, SlotType, StateUtils, Player } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { SHUFFLE_DECK, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { WAS_TRAINER_USED } from '../../../game/store/prefabs/trainer-prefabs';

export class Waitress extends TrainerCard {
  protected _trainerType: TrainerType = TrainerType.SUPPORTER;
  public regulationMark = 'J';
  public set: string = 'ASC';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '215';
  public name: string = 'Waitress';
  public fullName: string = 'Waitress MC';

  public text: string = 'Look at the top 6 cards of your deck, and attach a Basic Energy you find there to 1 of your Pokémon. Shuffle the other cards back into your deck.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    if (player.supporterTurn > 0) {
      return false;
    }
    if (player.deck.cards.length === 0) {
      return false;
    }
    return true;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_TRAINER_USED(effect, this)) {
      const player = effect.player;

      const supporterTurn = player.supporterTurn;
      if (supporterTurn > 0) {
        throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
      }

      MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: this });
      effect.preventDefault = true;

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      const deckTop = new CardList();
      const cardsToLook = Math.min(6, player.deck.cards.length);
      MOVE_CARDS(store, state, player.deck, deckTop, { count: cardsToLook, sourceCard: this });

      // TA-386 (2026-09-07): "attach a Basic Energy card you find there" carries no "may" and no
      // "up to" — when the looked-at window holds a Basic Energy the attach is MANDATORY, and the
      // window is known to the player, so the search-may-fail licence (B.43/#903) does not apply.
      // `min: 0` put a `confirm:false` decline on the wire beside the picks (rotomancer offers none);
      // the floor is 1 when a Basic Energy is there and 0 (auto-skip) when none is.
      const eligible = deckTop.cards.filter(c =>
        c instanceof EnergyCard && c.energyType === EnergyType.BASIC).length;
      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        deckTop,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { min: eligible > 0 ? 1 : 0, max: 1, allowCancel: false }
      ), selected => {
        const cards = selected || [];
        if (cards.length > 0) {
          // TA-386 (b): the WHICH-card decision was just made; the attach prompt used to run over the
          // whole 6-card window again, re-asking the card beside the target (six `attachEnergy` rows
          // with one target on a no-Bench board, where rotomancer attaches at once). Prompt over the
          // chosen card only, so the remaining decision is the TARGET — real with a Bench, collapsed
          // by the decomposer with one Pokémon.
          const chosen = new CardList();
          deckTop.moveCardsTo(cards, chosen);
          return store.prompt(state, new AttachEnergyPrompt(
            player.id,
            GameMessage.ATTACH_ENERGY_CARDS,
            chosen,
            PlayerType.BOTTOM_PLAYER,
            [SlotType.ACTIVE, SlotType.BENCH],
            {},
            { allowCancel: false, min: 1, max: 1 }
          ), transfers => {
            transfers = transfers || [];
            if (transfers.length > 0) {
              for (const transfer of transfers) {
                const target = StateUtils.getTarget(state, player, transfer.to);
                chosen.moveCardTo(transfer.card, target);
              }
            }
            // Put remaining cards back into deck
            chosen.moveTo(player.deck);
            MOVE_CARDS(store, state, deckTop, player.deck, { sourceCard: this });
            SHUFFLE_DECK(store, state, player);

          });
        } else {
          // No energy selected, put all cards back
          MOVE_CARDS(store, state, deckTop, player.deck, { sourceCard: this });
          SHUFFLE_DECK(store, state, player);

        }
      });
    }
    return state;
  }
}

