import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardType, EnergyType, Stage } from '../../../game/store/card/card-types';
import { ChooseCardsPrompt, EnergyCard, GameMessage, State, StateUtils, StoreLike, pokemonHasCardType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { MOVE_CARDS, SHOW_CARDS_TO_PLAYER, SHUFFLE_DECK, WAS_ATTACK_USED } from '../../../game/store/prefabs/prefabs';

export class Heatmor extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public hp: number = 120;
  public cardType: CardType[] = [R];
  public weakness = [{ type: W }];
  public retreat = [C, C];

  public attacks = [{
    name: 'Licking Catch',
    cost: [R],
    damage: 0,
    text: 'Search your deck for up to 3 in any combination of Fire Pokémon and Basic Fire Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  }, {
    name: 'Fire Claws',
    cost: [R, R],
    damage: 60,
    text: '',
  }];

  public regulationMark = 'I';
  public set: string = 'WHT';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '19';
  public name: string = 'Heatmor';
  public fullName: string = 'Heatmor WHT';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Licking Catch
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const player = effect.player;
      const blocked: number[] = [];
      player.deck.cards.forEach((c, index) => {
        const isFirePokemon = c instanceof PokemonCard && pokemonHasCardType(c, CardType.FIRE);
        const isBasicFireEnergy =
          c instanceof EnergyCard &&
          c.energyType === EnergyType.BASIC &&
          c.provides.includes(CardType.FIRE);
        if (!isFirePokemon && !isBasicFireEnergy) {
          blocked.push(index);
        }
      });
      // TA-801: the union filter is expressed by blocked indices, but the printed
      // reveal is still mandatory even though the prompt's field filter is empty.
      if (player.deck.cards.length === 0) {
        SHUFFLE_DECK(store, state, player);
        return state;
      }
      return store.prompt(state, new ChooseCardsPrompt(player, GameMessage.CHOOSE_CARD_TO_HAND,
        player.deck, {}, { min: 0, max: 3, allowCancel: false, blocked }), selected => {
        const cards = selected || [];
        SHOW_CARDS_TO_PLAYER(store, state, StateUtils.getOpponent(state, player), cards);
        MOVE_CARDS(store, state, player.deck, player.hand, { cards, sourceCard: this, sourceEffect: this.attacks[0] });
        SHUFFLE_DECK(store, state, player);
      });
    }

    return state;
  }
}
