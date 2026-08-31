import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import { AttackEffect } from '../../../game/store/effects/game-effects';
import { GameMessage } from '../../../game/game-message';
import { Card, CardManager, CardTarget, ChooseCardsPrompt, ChoosePokemonPrompt, PlayerType, PokemonCardList, ShuffleDeckPrompt, SlotType } from '../../../game';
import { WAS_ATTACK_USED, SHUFFLE_DECK} from '../../../game/store/prefabs/prefabs';

function* useCellularAwakening(next: Function, store: StoreLike, state: State,
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

  // TA-131: an empty deck makes the search a no-op, not an illegal attack (rulebook p.20, TA-19 family).
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

  // TA-125/TA-131 (rulebook p.20, TA-19 family): an attack may be USED even when its effect can do
  // nothing. Nothing to evolve (e.g. an empty Bench) is a no-op, NOT a refusal — throwing here made
  // the whole attack `invalidAction`, which the cross-engine differential caught against rotomancer.
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
    player.deck.moveCardTo(evolution, target);
    target.clearEffects();
    target.pokemonPlayedTurn = state.turn;
  }

  return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
  });
}


export class Reuniclus extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Duosion';
  public cardType: CardType[] = [P];
  public hp: number = 140;
  public weakness = [{ type: D }];
  public resistance = [{ type: F, value: -30 }];
  public retreat = [C];

  public attacks = [{
    name: 'Cellular Ascension',
    cost: [C],
    damage: 0,
    text: 'For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.'
  },
  {
    name: 'Evo-Lariat',
    cost: [C],
    damage: 40,
    damageCalculation: '+',
    text: 'This attack does 40 more damage for each of your Evolution Pokémon in play.'
  }];

  public regulationMark = 'I';
  public set: string = 'BLK';
  public setNumber: string = '39';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Reuniclus';
  public fullName: string = 'Reuniclus SV11B';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Cellular Awakening
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useCellularAwakening(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    // Evo Lariat
    if (WAS_ATTACK_USED(effect, 1, this)) {
      const player = effect.player;
      let evolutions = 0;

      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, card => {
        if (card.getPokemonCard()?.stage !== Stage.BASIC
          && card.getPokemonCard()?.stage !== Stage.LEGEND
          && card.getPokemonCard()?.stage !== Stage.VUNION
          && card.getPokemonCard()?.stage !== Stage.RESTORED) {
          evolutions++;
        }
      });

      effect.damage += evolutions * 40;
    }

    return state;
  }

}