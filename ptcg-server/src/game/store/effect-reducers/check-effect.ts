import { GameError } from '../../game-error';
import { GameLog, GameMessage } from '../../game-message';
import { PlayerType, SlotType } from '../actions/play-card-action';
import { EnergyCard } from '../card/energy-card';
import { CardType } from '../card/card-types';
import { PokemonCard } from '../card/pokemon-card';
import { CheckHpEffect, CheckAttackCostEffect, CheckProvidedEnergyEffect, CheckTableStateEffect, CheckRetreatCostEffect, CheckPokemonTypeEffect } from '../effects/check-effects';
import { Effect } from '../effects/effect';
import { KnockOutEffect, MovedToActiveEffect } from '../effects/game-effects';
import { TAKE_SPECIFIC_PRIZES, MOVE_CARDS, COIN_FLIP_PROMPT } from '../prefabs/prefabs';
import { ChoosePokemonPrompt } from '../prompts/choose-pokemon-prompt';
import { ChoosePrizePrompt } from '../prompts/choose-prize-prompt';
import { ChooseCardsPrompt } from '../prompts/choose-cards-prompt';
import { CheckPokemonToolCapacityEffect } from '../effects/check-effects';
import { ShuffleDeckPrompt } from '../prompts/shuffle-prompt';
import { setupGame } from '../reducers/setup-reducer';
import { CardList } from '../state/card-list';
import { PokemonCardList } from '../state/pokemon-card-list';
import { Player } from '../state/player';
import { StateUtils } from '../state-utils';
import { GamePhase, GameWinner, State } from '../state/state';
import { StoreLike } from '../store-like';

interface PokemonItem {
  playerNum: number;
  cardList: PokemonCardList;
}

interface PrizeGroup {
  destination: CardList;
  count: number;
}

function findKoPokemons(store: StoreLike, state: State): PokemonItem[] {
  const pokemons: PokemonItem[] = [];

  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
      const checkHpEffect = new CheckHpEffect(player, cardList);
      store.reduceEffect(state, checkHpEffect);

      // TA-563: a slot a Knock Out reaction Knocked Out by effect belongs to this sweep's group too.
      if (cardList.damage >= checkHpEffect.hp || cardList.knockedOutByEffect) {
        pokemons.push({ playerNum: i, cardList });
      }
    });
  }

  return pokemons;
}

//New, Optimized Code ^^ Test Old Code CPU Usage First
// function findKoPokemons(store: StoreLike, state: State): PokemonItem[] {
//   return state.players.reduce((koPokemons: PokemonItem[], player, playerNum) => {
//     player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
//       const checkHpEffect = new CheckHpEffect(player, cardList);
//       store.reduceEffect(state, checkHpEffect);

//       if (cardList.damage >= checkHpEffect.hp) {
//         koPokemons.push({ playerNum, cardList });
//       }
//     });
//     return koPokemons;
//   }, []);
// }

// function handleMaxToolsChange(store: StoreLike, state: State): State {
//   state.players.forEach((player, index) => {
//     player.forEachPokemon(PlayerType.ANY, (cardList) => {
//       if (cardList.tools.length > cardList.maxTools) {
//         const amount = cardList.tools.length - cardList.maxTools;
//         REMOVE_TOOLS_FROM_POKEMON_PROMPT(store, state, player, cardList, SlotType.DISCARD, amount, amount);
//       }
//     });
//   });
//   return state;
// }

function handleBenchSizeChange(store: StoreLike, state: State, benchSizes: number[]): State {
  // Skip if we've already handled bench size changes in this state check
  if (state.benchSizeChangeHandled) {
    return state;
  }

  state.players.forEach((player, index) => {
    const benchSize = benchSizes[index];
    // Add empty slots if bench is smaller
    while (player.bench.length < benchSize) {
      const bench = new PokemonCardList();
      bench.isPublic = true;
      player.bench.push(bench);
    }

    if (player.bench.length === benchSize) {
      return;
    }

    // Remove empty slots, starting from the right side
    const empty: PokemonCardList[] = [];
    for (let index = player.bench.length - 1; index >= 0; index--) {
      const bench = player.bench[index];
      const isEmpty = bench.cards.length === 0;
      if (player.bench.length - empty.length > benchSize && isEmpty) {
        empty.push(bench);
      }
    }

    if (player.bench.length - empty.length <= benchSize) {
      // Discarding empty slots is enough
      for (let i = player.bench.length - 1; i >= 0; i--) {
        if (empty.includes(player.bench[i])) {
          player.bench.splice(i, 1);
        }
      }
      return;
    }

    // Player has more Pokemons than bench size, discard some
    const count = player.bench.length - empty.length - benchSize;
    store.prompt(state, new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_DISCARD,
      PlayerType.BOTTOM_PLAYER,
      [SlotType.BENCH],
      { min: count, max: count, allowCancel: false }
    ), results => {
      results = results || [];
      const selected = [...empty, ...results];

      // Discard all empty slots and selected Pokemons
      for (let i = player.bench.length - 1; i >= 0; i--) {
        if (selected.includes(player.bench[i])) {
          const cardList = player.bench[i];
          const pokemons = cardList.getPokemons();
          const otherCards = cardList.cards.filter(card =>
            !(card instanceof PokemonCard) &&
            !pokemons.includes(card as PokemonCard) &&
            (!cardList.tools || !cardList.tools.includes(card))
          );
          const tools = [...cardList.tools];

          // Move other cards to discard
          if (otherCards.length > 0) {
            MOVE_CARDS(store, state, cardList, player.discard, { cards: otherCards });
          }

          // Move tools to discard
          for (const tool of tools) {
            cardList.moveCardTo(tool, player.discard);
          }

          // Move Pokémon to discard
          if (pokemons.length > 0) {
            MOVE_CARDS(store, state, cardList, player.discard, { cards: pokemons });
          }
          player.bench.splice(i, 1);
        }
      }
    });
  });
  // Mark that we've handled bench size changes
  state.benchSizeChangeHandled = true;
  return state;
}

/**
 * TA-130 / #815 — player indices in "whose turn would be next" order.
 *
 * > #815 (TPCi Rules Team, 2018-04-05): "In the case where both players have Pokemon Knocked Out
 * > SIMULTANEOUSLY ... The player whose turn would be next takes their prizes first, and then the
 * > other player takes their prizes. Then the player whose turn would be next promotes a new Active
 * > Pokemon if needed, followed by the other player."
 *
 * Restated verbatim in #2239 (2025); #818 (2000) says the same for promotion. Both loops below used
 * SEAT order, which is an internal detail with no rules meaning, and it disagreed with the ruling
 * exactly when the ruling applies.
 *
 * ⚠️ This is a NO-OP unless BOTH players are owed something. With a single Knock Out only one player
 * takes a prize and only one promotes, so the iteration order is unobservable — which is why the
 * change is narrow despite touching a global sequence.
 *
 * "Whose turn would be next" is the player who is NOT the current `activePlayer`: an attack ends the
 * turn, and an Ability-driven KO mid-turn (the #2239 Dusknoir case) still hands the next turn to the
 * opponent. It is deliberately NOT read off any turn-ending flag, which would be undefined for the
 * Ability case.
 */
function turnNextOrder(state: State): number[] {
  const next = 1 - state.activePlayer;
  return [next, state.activePlayer];
}

/**
 * The prompt a player needs when their Active spot is empty and their Bench is not, or `null` when
 * no choice is owed. Shared so that the post-attack replacement (compendium **#479**, §B.42 / TA-282) and the
 * checkState sweep raise the SAME prompt rather than two spellings of it.
 */
export function choosePromotionPrompt(player: Player): ChoosePokemonPrompt | null {
  const hasActive = player.active.cards.length > 0;
  const hasBenched = player.bench.some(bench => bench.cards.length > 0);
  if (hasActive || !hasBenched) {
    return null;
  }
  return new ChoosePokemonPrompt(
    player.id,
    GameMessage.CHOOSE_NEW_ACTIVE_POKEMON,
    PlayerType.BOTTOM_PLAYER,
    [SlotType.BENCH],
    { min: 1, allowCancel: false }
  );
}

/** Apply a `choosePromotionPrompt` answer: swap the chosen Bench slot into the Active spot. */
export function applyPromotion(store: StoreLike, state: State, player: Player, result: unknown): void {
  const selectedPokemon = result as PokemonCardList[];
  if (selectedPokemon.length !== 1) {
    throw new GameError(GameMessage.ILLEGAL_ACTION);
  }
  const benchIndex = player.bench.indexOf(selectedPokemon[0]);
  if (benchIndex === -1 || player.active.cards.length > 0) {
    throw new GameError(GameMessage.ILLEGAL_ACTION);
  }
  const temp = player.active;
  player.active = player.bench[benchIndex];
  player.bench[benchIndex] = temp;
  CardList.legCut?.(player);   // B.81 (conformance; inert for gameplay)
  const newActivePokemon = player.active.getPokemonCard();
  if (newActivePokemon) {
    if (!player.movedToActiveThisTurn.includes(newActivePokemon.id)) {
      player.movedToActiveThisTurn.push(newActivePokemon.id);
    }
    newActivePokemon.movedToActiveThisTurn = true;
    store.reduceEffect(state, new MovedToActiveEffect(player, newActivePokemon));
  }
}

function chooseActivePokemons(state: State): ChoosePokemonPrompt[] {
  const prompts: ChoosePokemonPrompt[] = [];

  for (const idx of turnNextOrder(state)) {
    const player = state.players[idx];
    const hasActive = player.active.cards.length > 0;
    const hasBenched = player.bench.some(bench => bench.cards.length > 0);
    if (!hasActive && hasBenched) {
      const choose = new ChoosePokemonPrompt(
        player.id,
        GameMessage.CHOOSE_NEW_ACTIVE_POKEMON,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.BENCH],
        { min: 1, allowCancel: false }
      );
      prompts.push(choose);
    }
  }
  return prompts;
}

function choosePrizeCards(store: StoreLike, state: State, prizeGroups: PrizeGroup[][]): ChoosePrizePrompt[] {
  const prompts: ChoosePrizePrompt[] = [];

  for (const i of turnNextOrder(state)) {
    const player = state.players[i];
    for (const group of prizeGroups[i]) {
      const prizeLeft = player.getPrizeLeft();
      // In sudden death, taking any prize card means winning
      if (group.count > 0 && state.isSuddenDeath) {
        endGame(store, state, i === 0 ? GameWinner.PLAYER_1 : GameWinner.PLAYER_2);
        return [];
      }

      // Prize-taking is ALWAYS the player's decision — even when it takes the last prize (the win
      // fires in checkWinner after the take) or the opponent has no Pokémon left. The previous
      // auto-take shortcuts here resolved those picks silently AND called endGame() mid-flow, which
      // still raised the promotion prompt afterwards — producing a finished game with an open
      // prompt. Decision granularity is normative for conformance (prompt even forced choices);
      // checkWinner() at the end of this flow handles the prize-out / no-Pokémon outcomes.

      if (group.count > prizeLeft) {
        group.count = prizeLeft;
      }
      if (group.count > 0) {
        let message = GameMessage.CHOOSE_PRIZE_CARD;
        // Choose a custom message based on the destination.
        if (group.destination === player.discard) {
          message = GameMessage.CHOOSE_PRIZE_CARD_TO_DISCARD;
        }

        const prompt = new ChoosePrizePrompt(
          player.id,
          message,
          {
            isSecret: player.prizes[0].isSecret,
            count: group.count,
            destination: group.destination
          }
        );
        prompts.push(prompt);
      }
    }
  }
  return prompts;
}

// function choosePrizeCards(state: State, prizesToTake: [number, number]): ChooseCardsPrompt[] {
//   const prompts: ChooseCardsPrompt[] = [];

//   for (let i = 0; i < state.players.length; i++) {
//     const player = state.players[i];
//     const prizeLeft = player.getPrizeLeft();

//     if (prizesToTake[i] > prizeLeft) {
//       prizesToTake[i] = prizeLeft;
//     }

//     if (prizesToTake[i] > 0) {
//       const allPrizeCards = new CardList();
//       // allPrizeCards.isSecret = true;  // Set the CardList as secret
//       // allPrizeCards.isPublic = false;
//       // allPrizeCards.faceUpPrize = false;
//       player.prizes.forEach(prizeList => {
//         allPrizeCards.cards.push(...prizeList.cards);
//       });

//       const prompt = new ChooseCardsPrompt(
//         player,
//         GameMessage.CHOOSE_PRIZE_CARD,
//         allPrizeCards,
//         {},  // No specific filter needed for prizes
//         { min: prizesToTake[i], max: prizesToTake[i], isSecret: player.prizes[0].isSecret, allowCancel: false }
//       );
//       prompts.push(prompt);
//     }
//   }

//   return prompts;
// }


export function endGame(store: StoreLike, state: State, winner: GameWinner): State {

  if (state.players.length !== 2) {
    return state;
  }

  // Allow ending the game during any phase except FINISHED
  if (state.phase === GamePhase.FINISHED) {
    return state;
  }

  switch (winner) {
    case GameWinner.NONE:
      store.log(state, GameLog.LOG_GAME_FINISHED);
      break;
    case GameWinner.DRAW:
      store.log(state, GameLog.LOG_GAME_FINISHED_DRAW);
      break;
    case GameWinner.PLAYER_1:
    case GameWinner.PLAYER_2: {
      const winnerName = winner === GameWinner.PLAYER_1
        ? state.players[0].name
        : state.players[1].name;
      store.log(state, GameLog.LOG_GAME_FINISHED_WINNER, { name: winnerName });
      break;
    }
  }

  state.winner = winner;
  state.phase = GamePhase.FINISHED;
  return state;
}

export function checkWinner(store: StoreLike, state: State, onComplete?: () => void): State {
  const points: [number, number] = [0, 0];
  const reasons: [string[], string[]] = [[], []];

  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];

    // TA-296 — losing the Active is only a LOSS CONDITION when the Bench cannot replace it.
    // This used to award the opponent a point for a merely EMPTY Active Spot. On a simultaneous
    // double KO both players have an empty Active and a Bench, so both scored a phantom point,
    // both counts were non-zero, and the draw branch below fired before anything was compared —
    // which is why twinleaf's `tie` looked symmetric. The rulebook's condition is "can't do this
    // because their Bench is empty", not "has no Active".
    //
    // ⚠️ `player.bench.length` is NEVER the emptiness test: bench slots are pre-allocated
    // CardLists, so the array is full-length even on an empty Bench. `.some(b => b.cards.length)`
    // is the idiom, and the same one is already used by chooseActivePokemons above.
    const hasBenched = player.bench.some(bench => bench.cards.length > 0);
    if (player.active.cards.length === 0 && !hasBenched) {
      store.log(state, GameLog.LOG_PLAYER_NO_ACTIVE_POKEMON, { name: player.name });
      points[i === 0 ? 1 : 0]++;
      reasons[i === 0 ? 1 : 0].push('no_active');
    }

    if (player.prizes.every(p => p.cards.length === 0)) {
      store.log(state, GameLog.LOG_PLAYER_NO_PRIZE_CARD, { name: player.name });
      points[i]++;
      reasons[i].push('no_prizes');
    }
  }

  // Both players meet an EQUAL NUMBER of win conditions. Rulebook ("What if both players win at the same time?"):
  // "If this happens, play a tiebreaker game." That is the BASE rulebook, not a tournament overlay.
  //
  // TA-561 (2026-10-01): TA-76 had made this a DRAW in every game, because the tiebreaker re-setup (decks and
  // Prize cards reset, re-shuffle, re-flip) left the conformance projection reading `ongoing` with both boards
  // empty, and native rotomancer ends the game `tie`. The contract is right to score the tied game as `tie`: the
  // tiebreaker is a NEW game, outside any scenario. But that is a property of the contract, not of the game, so it
  // is now a rule the conformance importer sets (`Rules.tiebreakerGame = false`); every real game plays the
  // tiebreaker, as upstream does. Inside an already-tiebreaker game an equal count starts another, as before.
  //
  // TA-296 — the guard used to be `points[0] > 0 && points[1] > 0`, which short-circuited to DRAW
  // whenever BOTH sides had any points, WITHOUT EVER COMPARING THEM. The comparison that decides
  // the game is twelve lines below and was correct all along; this branch stopped it running in
  // exactly the case it exists to decide.
  //
  // > #245: "If both players arrived at a win condition at the same time but ONE PLAYER HAS MORE
  // > WIN CONDITIONS THAN THE OTHER (like KO'ing the last Pokemon AND taking their sixth prize),
  // > the player with the most win conditions met wins the game. However, if both players have the
  // > SAME NUMBER of win conditions, the game is unresolved and a Tiebreaker game takes place."
  //
  // Restated by #1832's tail ("they would lose due to 2 win conditions vs. only 1!") and #2036.
  // A tie needs an EQUAL count, never merely a mutual one.
  if (points[0] > 0 && points[0] === points[1]) {
    return state.isSuddenDeath || state.rules.tiebreakerGame
      ? initiateSuddenDeath(store, state)
      : endGame(store, state, GameWinner.DRAW);
  }

  if (points[0] + points[1] === 0) {
    if (onComplete) {
      onComplete();
    }
    return state;
  }

  let winner = GameWinner.DRAW;
  if (points[0] > points[1]) {
    winner = GameWinner.PLAYER_1;
  } else if (points[1] > points[0]) {
    winner = GameWinner.PLAYER_2;
  }

  state = endGame(store, state, winner);
  if (onComplete) {
    onComplete();
  }
  return state;
}

function initiateSuddenDeath(store: StoreLike, state: State): State {
  store.log(state, GameLog.LOG_SUDDEN_DEATH);

  // Reset decks
  state.players.forEach(player => {
    // Collect all cards back to deck including stadium, lost zone and any other zones
    [player.active, ...player.bench, player.discard, ...player.prizes, player.hand, player.lostzone, player.stadium]
      .forEach(cardList => cardList.moveTo(player.deck));

    // Reset VSTAR and GX markers
    player.usedGX = false;
    player.usedVSTAR = false;
    player.cannotUseGXAttacks = false;

    // Shuffle deck
    return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
      player.deck.applyOrder(order);
    });
  });

  // Coin flip for first player
  return COIN_FLIP_PROMPT(store, state, state.players[0], result => {
    const firstPlayer = result ? 0 : 1;
    setupSuddenDeathGame(store, state, firstPlayer);
  });
}

function setupSuddenDeathGame(store: StoreLike, state: State, firstPlayer: number): State {
  state.activePlayer = firstPlayer;
  state.turn = 0;
  state.phase = GamePhase.SETUP;
  state.isSuddenDeath = true;

  const generator = setupGame(() => generator.next(), store, state);
  return generator.next().value;
}

export function* executeCheckState(next: Function, store: StoreLike, state: State, onComplete?: () => void): IterableIterator<State> {
  const prizeGroups: PrizeGroup[][] = state.players.map(() => []);

  // Prizes owed for KOs card effects dispatched directly ("Knock Out each …") — the target
  // is already discarded, so findKoPokemons cannot see it; the KnockOutEffect handler
  // recorded the owed prize instead. Drain it into this sweep's prize choices, so the
  // cascade is prize-first here too (compendium #2026 / CF-7).
  for (const owed of state.pendingDirectKoPrizes.splice(0)) {
    const opponentIndex = owed.playerNum === 0 ? 1 : 0;
    const destination = state.players[opponentIndex].hand;
    let group = prizeGroups[opponentIndex].find(g => g.destination === destination);
    if (!group) {
      group = { destination, count: 0 };
      prizeGroups[opponentIndex].push(group);
    }
    group.count += owed.count;
  }

  // Handle KOs first
  const pokemonsToDiscard: PokemonItem[] = [];
  const knockOutEffects: KnockOutEffect[] = [];
  // CF-38 KO window: every KO in this sweep is simultaneous, so their REACTIONS are one batch across
  // victims — one candidate per (reactor, victim), the victim on the wire as `subject`. Fewer than two
  // reactors: a no-op, and the per-victim dispatch below behaves exactly as it always has.
  // TA-577: a reaction can itself Knock Out a Pokémon (Exploding Needles on the Attacking Pokémon). That Knock Out
  // belongs to the SAME group — all Knocked Out Pokémon are discarded together and both players take Prizes
  // (Advanced Rulebook KO steps 3-4; a race both win ties, B.51) — so the victims are re-collected after the
  // reactions, and the new ones' reactions resolved in turn, until no new victim appears.
  // A discarded HP Tool can cause a further KO. Collect that consequence in
  // this sweep before Prizes/promotions, without processing previous KOs twice.
  let processedKos = 0;
  let toolsDiscarded: boolean;
  let checkTableStateEffect: CheckTableStateEffect;
  do {
    toolsDiscarded = false;
    let fresh = findKoPokemons(store, state).filter(p => !pokemonsToDiscard.some(q => q.cardList === p.cardList));
    while (fresh.length > 0) {
      const effects = fresh.map(p => {
        const knockOutEffect = new KnockOutEffect(state.players[p.playerNum], p.cardList);
        knockOutEffect.viaCheckState = true;
        return knockOutEffect;
      });
      pokemonsToDiscard.push(...fresh);
      knockOutEffects.push(...effects);
      // Only when there IS a KO: a sweep with none must not start waiting on a prompt some earlier step
      // left pending (a retreat's Energy choice, say) — that would be a new sequencing, not a batch.
      // TA-444 (B.51 MERGE): a victim a reaction creates inside the window joins the set being ordered; recorded here so
      // the re-collection below does not take it a second time
      state = store.resolveKnockOutReactions(state, effects, s => {
        const joined = findKoPokemons(store, s).filter(p => !pokemonsToDiscard.some(q => q.cardList === p.cardList));
        const joinedEffects = joined.map(p => {
          const knockOutEffect = new KnockOutEffect(s.players[p.playerNum], p.cardList);
          knockOutEffect.viaCheckState = true;
          return knockOutEffect;
        });
        pokemonsToDiscard.push(...joined);
        knockOutEffects.push(...joinedEffects);
        return joinedEffects;
      });
      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }
      fresh = findKoPokemons(store, state).filter(p => !pokemonsToDiscard.some(q => q.cardList === p.cardList));
    }
    for (; processedKos < pokemonsToDiscard.length; processedKos++) {
      const pokemonToDiscard = pokemonsToDiscard[processedKos];
      const knockOutEffect = knockOutEffects[processedKos];
      pokemonToDiscard.cardList.knockedOutByEffect = false;
      state = store.reduceEffect(state, knockOutEffect);

      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }

      if (knockOutEffect.preventDefault === false) {
        const opponentIndex = pokemonToDiscard.playerNum === 0 ? 1 : 0;
        const defaultDestination = state.players[opponentIndex].hand;
        const destination = knockOutEffect.prizeDestination || defaultDestination;

        let group = prizeGroups[opponentIndex].find(g => g.destination === destination);
        if (!group) {
          group = { destination, count: 0 };
          prizeGroups[opponentIndex].push(group);
        }
        group.count += knockOutEffect.prizeCount;
      }
    }

    // Check table state and handle bench size after KOs
    checkTableStateEffect = new CheckTableStateEffect([5, 5]);
    store.reduceEffect(state, checkTableStateEffect);
    state.players.forEach(player => {
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, cardList => {
        if (cardList.cannotBeSpecialConditionedNextTurn && cardList.specialConditions.length > 0) {
          cardList.clearAllSpecialConditions();
        }
      });
    });
    // TA-804: the last Multi Adapter provider may have left play or become
    // suppressed. The owner chooses the excess Tools before play resumes.
    for (const player of state.players) {
      for (const target of [player.active, ...player.bench]) {
        if (!target.getPokemonCard()?.name.includes('Rotom')) { continue; }
        const capacity = new CheckPokemonToolCapacityEffect(player, target);
        store.reduceEffect(state, capacity);
        const excess = target.tools.length - capacity.capacity;
        if (excess <= 0) { continue; }
        const tools = new CardList();
        tools.cards = target.tools.slice();
        tools.isPublic = true;
        state = store.prompt(state, new ChooseCardsPrompt(
          player, GameMessage.CHOOSE_CARD_TO_DISCARD, tools, {},
          { min: excess, max: excess, allowCancel: false }
        ), selected => {
          target.moveCardsTo(selected || [], player.discard);
          toolsDiscarded = true;
        });
        if (store.hasPrompts()) {
          yield store.waitPrompt(state, () => next());
        }
      }
    }
  } while (toolsDiscarded && findKoPokemons(store, state)
    .some(p => !pokemonsToDiscard.some(q => q.cardList === p.cardList)));
  handleBenchSizeChange(store, state, checkTableStateEffect.benchSizes);
  if (store.hasPrompts()) {
    yield store.waitPrompt(state, () => next());
  }

  // Check if the game has ended before proceeding with prompts
  if (state.phase === GamePhase.FINISHED) {
    return state;
  }

  // Handle prize selection first - opponent then player
  const prizePrompts = choosePrizeCards(store, state, prizeGroups);
  for (const group of prizePrompts) {
    const player = state.players.find(p => p.id === group.playerId);
    if (!player) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);
    }

    // Prizes are taken ONE AT A TIME (compendium #809, TPCi 2020-01-09: "Whenever you take more than one prize
    // in a single action, each prize can be taken one at a time"): each pick is its own take, so a reaction to a
    // taken Prize (Chansey mew-113 Lucky Bonus) resolves before the next pick, and a card that empties the row
    // meanwhile (Lucky Bonus heads) ends the remaining picks. TA-592: one prompt for the whole group resolved
    // every pick at once, so the reaction opened only after all of them.
    for (let k = 0; k < group.options.count; k++) {
      if (player.getPrizeLeft() === 0 || state.phase === GamePhase.FINISHED) {
        break;
      }
      const prompt = new ChoosePrizePrompt(group.playerId, group.message, { ...group.options, count: 1 });
      state = store.prompt(state, prompt, (result) => {
        const destination: CardList = prompt.options.destination || player.hand;
        TAKE_SPECIFIC_PRIZES(store, state, player, result, { destination });
      });

      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }
    }
  }

  // Last-prize auto-win (or TAKE_X_PRIZES during an attack) must not open Choose Active
  if (state.phase === GamePhase.FINISHED) {
    if (onComplete) {
      onComplete();
    }
    return state;
  }

  const prizesAlreadyTaken = state.players.some(p => p.prizes.every(pr => pr.cards.length === 0));
  // TA-382 / §B.16 (adjudicated 2026-09-07) — a player with NO Pokémon in play has lost the moment
  // the effect that emptied their board has FULLY resolved (KOs discarded, prizes taken). The
  // survivor's replacement is never owed: rulebook play.turn.attack.c.p5 "If your opponent can't
  // do this because their Bench is empty (or for any other reason), you win the game!", zones
  // .active-spot; compendium #1832 ("everything has to be resolved before you check for win
  // conditions"), #882. The prize-out short-circuit above already ran checkWinner BEFORE the
  // promotion prompts; the no-Pokémon condition takes the same exit, so a finished game never opens
  // a pointless decision for the survivor (CF-33). Same emptiness idiom as checkWinner — never
  // `bench.length` (slots are pre-allocated).
  const noPokemonInPlay = state.players.some(p =>
    p.active.cards.length === 0 && !p.bench.some(b => b.cards.length > 0));
  // TA-782 (B.127, owner 2026-10-25: "always promote"; #2036 "All effects have to finish resolving before the winner is
  // determined"): when BOTH players took their last Prize in this window, every owed promotion is asked first (the
  // non-turn player, then the turn player), so an effect a promotion triggers can still change the result.
  const everyonePrizedOut = state.players.every(p => p.prizes.every(pr => pr.cards.length === 0));
  if ((prizesAlreadyTaken && !everyonePrizedOut) || noPokemonInPlay) {
    return checkWinner(store, state, onComplete);
  }

  // Then handle new active Pokemon selection - opponent then player
  const activePrompts = chooseActivePokemons(state);
  for (const prompt of activePrompts) {
    const player = state.players.find(p => p.id === prompt.playerId);
    if (!player) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);
    }

    state = store.prompt(state, prompt, (result) => {
      applyPromotion(store, state, player, result);
    });

    if (store.hasPrompts()) {
      yield store.waitPrompt(state, () => next());
    }
  }

  checkWinner(store, state, onComplete);

  // Reset the bench size change handled flag after all effects are resolved
  state.benchSizeChangeHandled = false;

  return state;
}

export function checkState(store: StoreLike, state: State, onComplete?: () => void): State {
  if ([GamePhase.PLAYER_TURN, GamePhase.ATTACK, GamePhase.BETWEEN_TURNS].includes(state.phase) === false) {
    if (onComplete !== undefined) {
      onComplete();
    }
    return state;
  }
  const generator = executeCheckState(() => generator.next(), store, state, onComplete);
  return generator.next().value;
}

export function checkStateReducer(store: StoreLike, state: State, effect: Effect): State {

  if (effect instanceof CheckAttackCostEffect) {
    const active = effect.player.active;
    const sourceCard = active.attackCostIncreaseWhileActiveSourceCard;
    const sourceOwner = StateUtils.getOpponent(state, effect.player);

    if (sourceCard && sourceOwner.active.getPokemonCard() === sourceCard) {
      const attackCostIncrease = active.attackCostIncreaseWhileActive;
      for (let i = 0; i < attackCostIncrease; i++) {
        effect.cost.push(CardType.COLORLESS);
      }
    } else {
      active.attackCostIncreaseWhileActive = 0;
      active.attackCostIncreaseWhileActiveSourceCard = undefined;
    }

    // TA-236: the NEXT-TURN variant (DEFENDING_POKEMON_ATTACKS_COST_MORE — Drum Beating) had
    // pending/promote/expire plumbing but NO consumer: nothing ever read the promoted value into a
    // cost, so the defender attacked at printed price. The while-active variant above was the only
    // branch. (Rillaboom carried card-local consumers, cross-wired attack<->retreat; removed there.)
    for (let i = 0; i < active.attackCostIncreaseNextTurn; i++) {
      effect.cost.push(CardType.COLORLESS);
    }
    // upstream (Sunflora): ignore attack costs for matching types during your next turn — applied
    // after the TA-236 increase so an ignore beats an increase.
    const ignoreTypes = effect.player.ignoreAttackCostCardTypes;
    if (ignoreTypes !== null && effect.player.ignoreAttackCostTurnsRemaining > 0) {
      const checkType = new CheckPokemonTypeEffect(active);
      store.reduceEffect(state, checkType);
      if (ignoreTypes.some(t => checkType.cardTypes.includes(t))) {
        effect.cost = [];
      }
    }
    return state;
  }

  if (effect instanceof CheckRetreatCostEffect) {
    // TA-236: retreat half of the same rider ("its Retreat Cost is [C] more") — same missing
    // consumer as the attack half above.
    const active = effect.player.active;
    for (let i = 0; i < active.retreatCostIncreaseNextTurn; i++) {
      effect.cost.push(CardType.COLORLESS);
    }
    // upstream: zero retreat cost next turn — applied after the TA-236 increase (an ignore beats an increase).
    if (effect.player.active.zeroRetreatCostNextTurn) {
      effect.cost = [];
    }
    return state;
  }

  if (effect instanceof CheckProvidedEnergyEffect) {
    // Check regular energy cards in main cards array
    effect.source.cards.forEach(c => {
      if (c instanceof EnergyCard && !effect.energyMap.some(e => e.card === c)) {
        effect.energyMap.push({ card: c, provides: c.provides });
      }
    });
    // Check Pokemon-as-energy cards in energies CardList
    if (effect.source instanceof PokemonCardList) {
      effect.source.energies.cards.forEach(c => {
        if (!effect.energyMap.some(e => e.card === c)) {
          // For Pokemon-as-energy, the provides property is set by the card itself
          const provides = (c as any).provides || [];
          if (provides.length > 0) {
            effect.energyMap.push({ card: c, provides });
          }
        }
      });
    }
    return state;
  }
  return state;
}
