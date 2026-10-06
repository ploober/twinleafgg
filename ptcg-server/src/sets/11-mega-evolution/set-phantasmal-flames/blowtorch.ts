import { Card, CardList, ChooseCardsPrompt, EnergyCard, GameError, GameMessage, Player, PlayerType, StateUtils } from '../../../game';
import { EnergyType, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';

export class Blowtorch extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public regulationMark = 'I';
  public set: string = 'PFL';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '86';
  public name: string = 'Blowtorch';
  public fullName: string = 'Blowtorch PFL';

  public text: string =
    'You can use this card only if you discard a Basic [R] Energy card from your hand.\n\nDiscard a Pokémon Tool or Special Energy card from 1 of your opponent\'s Pokémon, or discard a Stadium in play.';

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    const opponent = StateUtils.getOpponent(state, player);

    if (!player.hand.cards.some(c => c.superType === SuperType.ENERGY && c.name === 'Fire Energy')) {
      return false;
    }

    let pokemonsWithTool = 0;
    opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
      if (cardList.tools.length > 0) {
        pokemonsWithTool += 1;
      }
    });

    let specialEnergy = 0;
    opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
      if (cardList.energies.cards.some(c => c.superType === SuperType.ENERGY && c.energyType === EnergyType.SPECIAL)) {
        specialEnergy += 1;
      }
    });

    const stadiumCard = StateUtils.getStadiumCard(state);

    if (pokemonsWithTool === 0 && stadiumCard === undefined && specialEnergy === 0) {
      return false;
    }

    // No other restrictions - card can be played
    return true;
  }

  /** Every Pokémon Tool and Special Energy attached to the opponent's Pokémon, then the Stadium in play (B.71). */
  private discardCandidates(state: State, opponent: Player): Card[] {
    const result: Card[] = [];
    opponent.forEachPokemon(PlayerType.TOP_PLAYER, cardList => {
      cardList.tools.forEach(t => result.push(t));
      cardList.energies.cards
        .filter(c => c.superType === SuperType.ENERGY && (c as EnergyCard).energyType === EnergyType.SPECIAL)
        .forEach(c => result.push(c));
    });
    const stadiumCard = StateUtils.getStadiumCard(state);
    if (stadiumCard !== undefined) {
      result.push(stadiumCard);
    }
    return result;
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      if (!player.hand.cards.some(c => c.superType === SuperType.ENERGY && c.name === 'Fire Energy')) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // TA-554 / B.71 (addendum 2026-10-02): ONE pick of the discarded card itself, over every Pokémon Tool and every
      // Special Energy attached to the opponent's Pokémon plus the Stadium in play. No mode, no Pokémon-first step,
      // no stop (the discard is mandatory); one candidate collapses (CF-14).
      const candidates = this.discardCandidates(state, opponent);
      if (candidates.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // We will discard this card after prompt confirmation
      effect.preventDefault = true;
      MOVE_CARDS(store, state, player.hand, player.supporter, { cards: [effect.trainerCard], sourceCard: this });

      store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_DISCARD,
        player.hand,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC, name: 'Fire Energy' },
        { allowCancel: false, min: 1, max: 1 }
      ), cards => {
        cards = cards || [];

        MOVE_CARDS(store, state, player.hand, player.discard, { cards: cards, sourceCard: this });

        const pool = new CardList();
        pool.cards = this.discardCandidates(state, opponent);

        return store.prompt(state, new ChooseCardsPrompt(
          player,
          GameMessage.CHOOSE_CARD_TO_DISCARD,
          pool,
          {},
          { min: 1, max: 1, allowCancel: false }
        ), selected => {
          const chosen = (selected || [])[0];
          if (chosen !== undefined) {
            const slot = StateUtils.findPokemonSlot(state, chosen);
            const from: CardList = slot !== undefined ? slot : StateUtils.findCardList(state, chosen);
            const owner = StateUtils.findOwner(state, from);
            MOVE_CARDS(store, state, from, owner.discard, { cards: [chosen], sourceCard: this });
          }
          MOVE_CARDS(store, state, player.supporter, player.discard, { cards: [this], sourceCard: this });
          return state;
        });
      });
    }
    return state;
  }
}
