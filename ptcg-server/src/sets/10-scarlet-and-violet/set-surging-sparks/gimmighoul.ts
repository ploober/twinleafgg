import { CardType, ChooseCardsPrompt, EnergyType, GameMessage, PokemonCard, Stage, State, StoreLike, SuperType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MOVE_CARDS, SHOW_CARDS_TO_PLAYER, SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Gimmighoul extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 70;
  public cardType: CardType[] = [P];
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Minor Errand-Running',
    cost: [C],
    damage: 0,
    text: 'Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  },
  {
    name: 'Tackle',
    cost: [C, C, C],
    damage: 50,
    text: '',
  }];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber = '97';
  public name: string = 'Gimmighoul';
  public fullName: string = 'Gimmighoul SSP';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Minor Errand-Running
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const opponent = effect.opponent;

      if (player.deck.cards.length === 0) {
        // TA-250 / B.33: the search whiffs on an empty deck, but *"Then, shuffle your deck"* is a
        // separate printed instruction whose object survives — so the shuffle is still owed.
        return SHUFFLE_DECK(store, state, player);
      }

      return store.prompt(state, new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck,
        { superType: SuperType.ENERGY, energyType: EnergyType.BASIC },
        { min: 0, max: 2, allowCancel: false }
      ), selected => {
        const cards = selected || [];
        // The reveal comes before the cards change zones (TA-265 / B.34).
        SHOW_CARDS_TO_PLAYER(store, state, opponent, cards);
        MOVE_CARDS(store, state, player.deck, player.hand, { cards, sourceCard: this });
        SHUFFLE_DECK(store, state, player);
      });
    }

    return state;
  }
}
