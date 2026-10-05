import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType } from '../../../game/store/card/card-types';
import { Card, CardTarget, ChooseCardsPrompt, ChoosePokemonPrompt, GameLog, GameMessage, PlayerType, PokemonCardList, SlotType, State, StoreLike, pokemonHasCardTypeOptional } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import {SHUFFLE_DECK, WAS_ATTACK_USED, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { AttackEffect } from '../../../game/store/effects/game-effects';

function* useDarkAwakening(
  next: Function,
  store: StoreLike,
  state: State,
  effect: AttackEffect,
): IterableIterator<State> {
  const player = effect.player;

  // TA-250 / B.33: the search whiffs on an empty deck, but *"Then, shuffle your deck"* is a
  // separate printed instruction whose object survives — so the shuffle is still owed.
  if (player.deck.cards.length === 0) {
    return SHUFFLE_DECK(store, state, player);
  }

  // TA-574: "Choose up to 2 of your [D] Pokémon" — the [D] is on the Pokémon in play; the card that evolves from it
  // may be any type (Morpeko V -> Lightning Morpeko VMAX). The old gate required a Darkness EVOLUTION and skipped the
  // pick, the search and the shuffle otherwise. Nothing to choose only when no [D] Pokémon is in play.
  let anyDark = false;
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list) => {
    if (pokemonHasCardTypeOptional(list.getPokemonCard(), CardType.DARK)) {
      anyDark = true;
    }
  });
  if (!anyDark) {
    return state;
  }

  const blocked2: CardTarget[] = [];
  player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card, target) => {
    if (!pokemonHasCardTypeOptional(list.getPokemonCard(), CardType.DARK)) {
      blocked2.push(target);
    }
  });

  let targets: PokemonCardList[] = [];
  yield store.prompt(
    state,
    new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_EVOLVE,
      PlayerType.BOTTOM_PLAYER,
      [SlotType.ACTIVE, SlotType.BENCH],
      // "Choose UP TO 2 of your [D] Pokémon" — zero is a legal count, so min is 0 (TA-136): the
      // player may decline (choosing none evolves nothing and, having searched nothing, does not shuffle).
      { min: 0, max: 2, allowCancel: false, blocked: blocked2 },
    ),
    (selection) => {
      targets = selection || [];
      next();
    },
  );

  if (targets.length === 0) {
    return state; // canceled by user
  }

  // Log the selected Pokémon targets
  const targetNames = targets.map((target) => target.getPokemonCard()?.name).filter(Boolean);
  store.log(state, GameLog.LOG_TEXT, {
    text: `${player.name} chooses to evolve ${targetNames.join(' and ')}`,
  });

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
    yield store.prompt(
      state,
      new ChooseCardsPrompt(
        player,
        GameMessage.CHOOSE_CARD_TO_EVOLVE,
        player.deck,
        { superType: SuperType.POKEMON },
        { min: 0, max: 1, allowCancel: false, blocked },
      ),
      (selected) => {
        cards = selected || [];
        next();
      },
    );

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

  SHUFFLE_DECK(store, state, player);
}

export class TeamRocketsNidorina extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  // TA-261: matches the corrected unspaced printed name on team-rockets-nidoran-female.ts.
  public evolvesFrom = "Team Rocket's Nidoran♀";
  protected _tags = [CardTag.TEAM_ROCKET];
  public cardType: CardType[] = [D];
  public hp: number = 90;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public attacks = [
    {
      name: 'Dark Awakening',
      cost: [D],
      damage: 0,
      text: 'Choose up to 2 of your [D] Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.',
    },
    {
      name: 'Scratch',
      cost: [D, D],
      damage: 50,
      text: '',
    },
  ];

  public regulationMark = 'I';
  public set: string = 'DRI';
  public setNumber: string = '115';
  public cardImage: string = 'assets/cardback.png';
  public name: string = "Team Rocket's Nidorina";
  public fullName: string = "Team Rocket's Nidorina DRI";

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (WAS_ATTACK_USED(effect, 0, this)) {
      const generator = useDarkAwakening(() => generator.next(), store, state, effect);
      return generator.next().value;
    }

    return state;
  }
}
