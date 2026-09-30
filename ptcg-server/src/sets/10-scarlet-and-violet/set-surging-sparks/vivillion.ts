import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { GameMessage } from '../../../game/game-message';
import { Card, CardManager, CardTarget, ChooseCardsPrompt, ChoosePokemonPrompt, PlayerType, PokemonCardList, ShuffleDeckPrompt, SlotType } from '../../../game';
import { WAS_ATTACK_USED, SHUFFLE_DECK, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';

function* useEvolutionPowder(next: Function, store: StoreLike, state: State,
  effect: AttackEffect): IterableIterator<State> {
  const player = effect.player;

  // TA-250 amendment / RE-32 precedence: the DESTINATION test comes FIRST. This attack's effect is
  // "for each of your BENCHED Pokemon" — with no Bench there is no destination, so no search happens
  // and no shuffle is owed (RE-38/RE-32, and rotomancer suppresses it here too). B.33's object test
  // only applies once the effect actually reaches the deck. Getting the order wrong flipped the
  // divergence to the other side instead of closing it, which is what the re-fuzz caught.
  if (!player.bench.some(b => b.cards.length > 0)) {
    return state;
  }

  // TA-97: Evo-Powder is legal to use whenever its cost is met — with an empty deck there is nothing
  // to search, so it simply does nothing. Do NOT block the attack (was: throw CANNOT_PLAY_THIS_CARD).
  // TA-250 / B.33: the search whiffs on an empty deck, but *"Then, shuffle your deck"* is a
  // separate printed instruction whose object survives — so the shuffle is still owed.
  if (player.deck.cards.length === 0) {
    return SHUFFLE_DECK(store, state, player);
  }

  // Look through all known cards to find out if Pokemon can evolve
  const cm = CardManager.getInstance();
  const evolutions = cm.getAllCards().filter(c => {
    return c instanceof PokemonCard && c.stage !== Stage.BASIC;
  }) as PokemonCard[];

  // Build possible evolution card names
  const evolutionNames: string[] = [];
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
    const valid = evolutions.filter(e => e.evolvesFrom === card.name);
    valid.forEach(c => {
      if (!evolutionNames.includes(c.name)) {
        evolutionNames.push(c.name);
      }
    });
  });

  // There is nothing that can evolve — the attack does nothing (declarable no-op), not a block.
  if (evolutionNames.length === 0) {
    return state;
  }

  const blocked2: CardTarget[] = [];
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
  });

  let targets: PokemonCardList[] = [];
  yield store.prompt(state, new ChoosePokemonPrompt(
    player.id,
    GameMessage.CHOOSE_POKEMON_TO_EVOLVE,
    PlayerType.BOTTOM_PLAYER,
    [SlotType.BENCH],
    { min: 1, max: 5, allowCancel: false, blocked: blocked2 }
  ), selection => {
    targets = selection || [];
    next();
  });

  if (targets.length === 0) {
    return state; // canceled by user
  }

  for (const target of targets) {
    const pokemonCard = target.getPokemonCard();
    if (pokemonCard === undefined) {
      return state; // invalid target?
    }

    // Blocking pokemon cards, that cannot be valid evolutions
    const blocked: number[] = [];
    player.deck.cards.forEach((card, index) => {
      if (card instanceof PokemonCard && card.evolvesFrom !== pokemonCard.name) {
        blocked.push(index);
      }
    });

    let cards: Card[] = [];
    yield store.prompt(state, new ChooseCardsPrompt(
      player,
      GameMessage.CHOOSE_CARD_TO_EVOLVE,
      player.deck,
      { superType: SuperType.POKEMON },
      { min: 0, max: 1, allowCancel: false, blocked }
    ), selected => {
      cards = selected || [];
      next();
    });

    // Canceled by user, he didn't found the card in the deck
    if (cards.length === 0) {
      continue;
    }

    const evolution = cards[0] as PokemonCard;

    // Evolve Pokemon
    MOVE_CARDS(store, state, player.deck, target, { cards: [evolution], sourceCard: effect.source.getPokemonCard()! });
    target.clearEffects();
    target.pokemonPlayedTurn = state.turn;
  }

  return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
  });
}

export class Vivillion extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public cardType: CardType[] = [G];
  public hp: number = 120;
  public retreat = [C];
  public weakness = [{ type: R }];
  public evolvesFrom: string = 'Spewpa';

  public attacks = [
    {
      name: 'Evo-Powder',
      cost: [C],
      damage: 0,
      text: 'For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.'
    },
    {
      name: 'Cutting Wind',
      cost: [G],
      damage: 90,
      text: ''
    }
  ];

  public regulationMark = 'H';
  public set: string = 'SSP';
  public name: string = 'Vivillon';
  public fullName: string = 'Vivillion SSP';
  public cardImage: string = 'assets/cardback.png';
  public setNumber: string = '7';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {

    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useEvolutionPowder(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }

}