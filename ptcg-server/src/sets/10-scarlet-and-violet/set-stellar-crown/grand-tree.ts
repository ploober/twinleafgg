import { TrainerCard } from '../../../game/store/card/trainer-card';
import { CardTag, Stage, SuperType, TrainerType } from '../../../game/store/card/card-types';
import { StoreLike } from '../../../game/store/store-like';
import { State } from '../../../game/store/state/state';
import { Effect } from '../../../game/store/effects/effect';
import {
  GameError,
  GameMessage,
  CardManager,
  PokemonCard,
  PlayerType,
  CardTarget,
  PokemonCardList,
  ChoosePokemonPrompt,
  SlotType,
  Card,
  ChooseCardsPrompt,
  StateUtils,
} from '../../../game';
import { UseStadiumEffect } from '../../../game/store/effects/game-effects';
import { CheckPokemonPlayedTurnEffect } from '../../../game/store/effects/check-effects';
import {SHUFFLE_DECK, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { IS_STADIUM_EFFECT_BLOCKED } from '../../../game/store/prefabs/stadium-effect';

function* useStadium(
  next: Function,
  store: StoreLike,
  state: State,
  effect: UseStadiumEffect,
): IterableIterator<State> {
  const player = effect.player;

  if (player.deck.cards.length === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  // Look through all known cards to find out if Pokemon can evolve
  const cm = CardManager.getInstance();
  const evolutions = cm.getAllCards().filter((c) => {
    return c instanceof PokemonCard && c.stage !== Stage.BASIC;
  }) as PokemonCard[];

  // TA-479 / TA-480: a target is a Basic, not put into play this turn, that a known Stage 1 evolves from
  // (#2030: a known valid evolution path is required), and whose Stadium effects are not prevented (New Moon,
  // B.70: a protected Basic is out of reach). With no target left the use is refused.
  const evolutionNames: string[] = [];
  const blocked2: CardTarget[] = [];
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
    const playedTurnEffect = new CheckPokemonPlayedTurnEffect(player, list);
    store.reduceEffect(state, playedTurnEffect);
    const valid = evolutions.filter((e) => e.stage === Stage.STAGE_1 && e.evolvesFrom === card.name);
    if (card.stage !== Stage.BASIC || playedTurnEffect.pokemonPlayedTurn === state.turn || valid.length === 0
      || IS_STADIUM_EFFECT_BLOCKED(store, state, player, list, effect.stadium as TrainerCard)) {
      blocked2.push(target);
      return;
    }
    valid.forEach((c) => {
      if (!evolutionNames.includes(c.name)) {
        evolutionNames.push(c.name);
      }
    });
  });

  // There is nothing that can evolve
  if (evolutionNames.length === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  // TA-781 (B.128, owner 2026-10-25): the search comes first and may find nothing; the Pokémon to evolve is asked after
  // the card is found, and only when more than one of the player's Pokémon can take it.
  const eligible: PokemonCardList[] = [];
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
    if (!blocked2.some(b => b.player === target.player && b.slot === target.slot && b.index === target.index)) {
      eligible.push(list);
    }
  });
  const eligibleNames = eligible.map(list => list.getPokemonCard()!.name);

  // Blocking pokemon cards, that cannot be valid evolutions
  const blocked: number[] = [];
  player.deck.cards.forEach((card, index) => {
    if (card instanceof PokemonCard && (card.stage !== Stage.STAGE_1 || !eligibleNames.includes(card.evolvesFrom))) {
      blocked.push(index);
    }
  });

  let cards: Card[] = [];
  yield store.prompt(
    state,
    new ChooseCardsPrompt(
      player,
      GameMessage.CHOOSE_CARD_TO_EVOLVE,
      player.deck,
      { superType: SuperType.POKEMON, stage: Stage.STAGE_1 },
      { min: 0, max: 1, allowCancel: false, blocked },
    ),
    (selected) => {
      cards = selected || [];
      next();
    },
  );

  // Canceled by user, he didn't find the card in the deck
  if (cards.length === 0) {
    SHUFFLE_DECK(store, state, player);
    return state;
  }

  const found = cards[0] as PokemonCard;
  const takers = eligible.filter(list => list.getPokemonCard()!.name === found.evolvesFrom);
  let target = takers[0];
  if (takers.length > 1) {
    const notTakers: CardTarget[] = [];
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, t) => {
      if (!takers.includes(list)) {
        notTakers.push(t);
      }
    });
    let targets: PokemonCardList[] = [];
    yield store.prompt(
      state,
      new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_EVOLVE,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH, SlotType.ACTIVE],
        { min: 1, max: 1, allowCancel: false, blocked: notTakers },
      ),
      (selection) => {
        targets = selection || [];
        next();
      },
    );
    target = targets[0] || takers[0];
  }

  const evolution = cards[0] as PokemonCard;

  // Evolve Pokemon
  MOVE_CARDS(store, state, player.deck, target, { cards: [evolution], sourceCard: effect.stadium });
  target.clearEffects();
  target.pokemonPlayedTurn = state.turn;

  // Check if there's a Stage 2 evolution available
  const stage2Evolutions = evolutions.filter((e) => e.evolvesFrom === evolution.name);
  if (stage2Evolutions.length > 0) {
    // Blocking pokemon cards, that cannot be valid evolutions
    const blockedStage2: number[] = [];
    player.deck.cards.forEach((card, index) => {
      if (card instanceof PokemonCard && card.evolvesFrom !== evolution.name) {
        blockedStage2.push(index);
      }
    });

    let stage2Cards: Card[] = [];
    yield store.prompt(
      state,
      new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_EVOLVE,
        player.deck,
        { superType: SuperType.POKEMON, stage: Stage.STAGE_2, evolvesFrom: evolution.name },
        { min: 0, max: 1, allowCancel: false, blocked: blockedStage2 },
      ),
      (selected) => {
        stage2Cards = selected || [];
        next();
      },
    );

    if (stage2Cards.length > 0) {
      const stage2Evolution = stage2Cards[0] as PokemonCard;
      MOVE_CARDS(store, state, player.deck, target, { cards: [stage2Evolution], sourceCard: effect.stadium });
      target.clearEffects();
      target.pokemonPlayedTurn = state.turn;
    }
  }

  SHUFFLE_DECK(store, state, player);
}

export class GreatTree extends TrainerCard {
  protected _trainerType = TrainerType.STADIUM;

  protected _tags = [CardTag.ACE_SPEC];

  public set = 'SCR';

  public cardImage: string = 'assets/cardback.png';

  public setNumber: string = '136';

  public regulationMark = 'H';

  public name = 'Grand Tree';

  public fullName = 'Great Tree SCR';

  public text =
    "Once during each player's turn, that player may search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon and put it onto that Pokémon to evolve it.If that Pokémon was evolved in this way, that player may search their deck for a Stage 2 Pokémon that evolves from that Pokémon and put it onto that Pokémon to evolve it.Then, that player shuffles their deck. (Players can't evolve a Basic Pokémon during their first turn or a Basic Pokémon that was put into play this turn.)";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      const generator = useStadium(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }
}
