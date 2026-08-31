import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, EnergyType, TrainerType, SuperType } from '../../../game/store/card/card-types';
import { EnergyCard, Player, PokemonCardList, State, StateUtils, StoreLike } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { TrainerEffect } from '../../../game/store/effects/play-card-effects';
import { MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

export class MegatonBlower extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;

  protected _tags = [CardTag.ACE_SPEC];

  public set: string = 'SSP';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '182';

  public regulationMark = 'H';

  public name: string = 'Megaton Blower';

  public fullName: string = 'Megaton Blower SSP';

  public text: string =
    "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon, and discard a Stadium in play.";

  public canPlay(store: StoreLike, state: State, player: Player): boolean {
    // TA-154 / compendium #2064 (this exact card): "You can't play the card for no effect, but if
    // there is at least one of those types of cards in play you do as much as you can." Playable iff
    // ANY of its three targets exists: a Stadium in play (either owner's), or a Tool / Special Energy
    // on any of the OPPONENT'S Pokémon — our own board deliberately doesn't count (the discard halves
    // read the opponent only). Was `return true`, offering a no-effect play that rotomancer correctly
    // refuses; #2064 adjudicates that against the offering engine.
    if (StateUtils.getStadiumCard(state) !== undefined) {
      return true;
    }
    const opponent = StateUtils.getOpponent(state, player);
    const hasTarget = (list: PokemonCardList): boolean =>
      list.tools.length > 0 ||
      list.cards.some(card =>
        card.superType === SuperType.ENERGY && (card as EnergyCard).energyType === EnergyType.SPECIAL);
    return hasTarget(opponent.active) || opponent.bench.some(b => hasTarget(b));
  }

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;
      effect.preventDefault = true;

      // Handle stadium discard if one is in play
      const stadiumCard = StateUtils.getStadiumCard(state);
      if (stadiumCard) {
        const cardList = StateUtils.findCardList(state, stadiumCard);
        if (cardList) {
          const stadiumOwner = StateUtils.findOwner(state, cardList);
          state = MOVE_CARDS(store, state, cardList, stadiumOwner.discard, {
            cards: [stadiumCard],
            sourceCard: this,
          });
        }
      }

      const opponent = StateUtils.getOpponent(state, player);

      // Function to discard special energy and tools from a PokemonCardList
      const discardSpecialEnergyAndTools = (pokemonCardList: PokemonCardList) => {
        // TA-125 family: an ATTACHED Tool lives in `cardList.tools`, never in `cardList.cards` —
        // AttachPokemonToolEffect splices it out of `cards` before pushing to `tools`. Filtering
        // `cards` for a Tool therefore always matches nothing, so the Tool half of this card's
        // effect was a silent no-op; only the Special Energy half ever fired.
        const cardsToDiscard = [
          ...pokemonCardList.cards.filter(card =>
            card.superType === SuperType.ENERGY && (card as EnergyCard).energyType === EnergyType.SPECIAL
          ),
          ...pokemonCardList.tools.filter(card =>
            card instanceof TrainerCard && card.trainerType === TrainerType.TOOL
          )
        ];
        if (cardsToDiscard.length > 0) {
          state = MOVE_CARDS(store, state, pokemonCardList, opponent.discard, {
            cards: cardsToDiscard,
          });
        }
      };

      // Discard from active Pokémon
      discardSpecialEnergyAndTools(opponent.active);

      // Discard from bench Pokémon
      opponent.bench.forEach((benchPokemon) => {
        discardSpecialEnergyAndTools(benchPokemon);
      });

      // Move this card to discard pile
      state = MOVE_CARDS(store, state, player.supporter, player.discard, { cards: [this] });
    }
    return state;
  }
}
