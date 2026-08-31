import { pokemonHasCardType } from '../../../game';
import { CardType, EnergyType, Stage } from '../../../game/store/card/card-types';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { Effect } from '../../../game/store/effects/effect';
import { AttachEnergyEffect } from '../../../game/store/effects/play-card-effects';
import {
  GET_PLAYER_BENCH_SLOTS,
  IS_SPECIAL_ENERGY_BLOCKED,
  SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH,
} from '../../../game/store/prefabs/prefabs';
import { State } from '../../../game/store/state/state';
import { StoreLike } from '../../../game/store/store-like';
import {
  CheckPokemonTypeEffect,
  CheckProvidedEnergyEffect,
} from '../../../game/store/effects/check-effects';
import { PokemonCard } from '../../../game/store/card/pokemon-card';

export class TelepathPsychicEnergy extends EnergyCard {
  public provides: CardType[] = [CardType.PSYCHIC];
  public energyType = EnergyType.SPECIAL;
  public regulationMark = 'J';
  public set: string = 'POR';
  public name = 'Telepathic Psychic Energy';
  public fullName = 'Telepath [P] Energy M3';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '88';
  public text =
    'As long as this card is attached to a Pokémon, it provides [P] Energy.\n\nWhen you attach this card from your hand to a [P] Pokémon, search your deck for up to 2 Basic [P] Pokémon and put them onto your Bench. Then, shuffle your deck.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Provide [P] Energy
    if (effect instanceof CheckProvidedEnergyEffect && effect.source.cards.includes(this)) {
      effect.energyMap.push({ card: this, provides: [CardType.PSYCHIC] });
    }

    // When attached, search for 2 Basic Psychic Pokemon
    if (effect instanceof AttachEnergyEffect && effect.energyCard === this) {
      const player = effect.player;

      if (IS_SPECIAL_ENERGY_BLOCKED(store, state, player, this, effect.target)) {
        return state;
      }

      // Check if target is a Psychic Pokemon
      const checkType = new CheckPokemonTypeEffect(effect.target);
      store.reduceEffect(state, checkType);
      if (!checkType.cardTypes.includes(CardType.PSYCHIC)) {
        return state;
      }

      if (GET_PLAYER_BENCH_SLOTS(player).length === 0) {
        return state;
      }

      // Search for Basic Psychic Pokemon
      const basicPsychicPokemon = player.deck.cards.filter(
        (card) => card instanceof PokemonCard && card.stage === Stage.BASIC,
      );

      // Filter for Psychic type
      const validPokemon: any[] = [];
      for (const card of basicPsychicPokemon) {
        if (card instanceof PokemonCard && pokemonHasCardType(card, CardType.PSYCHIC)) {
          validPokemon.push(card);
        }
      }

      // TA-324: the owed "Then, shuffle your deck" fires even when the deck holds no Basic Psychic
      // Pokemon to find — a zero-take still SEARCHED the deck (B.33/#2171; family of TA-320/TA-322).
      // Skip only when the search cannot EXECUTE: an empty deck (#840, here) or a full Bench (the
      // GET_PLAYER_BENCH_SLOTS === 0 guard above, #1108/RE-38). Otherwise fall through: maxToPut
      // computes to 0 and the prefab whiffs to its unconditional SHUFFLE_DECK. Pre-fix this
      // early-returned on any zero-FIND, dropping the shuffle (rotomancer shuffled).
      if (player.deck.cards.length === 0) {
        return state;
      }

      const maxToPut = Math.min(2, validPokemon.length, GET_PLAYER_BENCH_SLOTS(player).length);

      SEARCH_YOUR_DECK_FOR_POKEMON_AND_PUT_ONTO_BENCH(
        store,
        state,
        player,
        {
          stage: Stage.BASIC,
          cardType: [CardType.PSYCHIC],
        },
        { min: 0, max: maxToPut },
      );
    }

    return state;
  }
}
