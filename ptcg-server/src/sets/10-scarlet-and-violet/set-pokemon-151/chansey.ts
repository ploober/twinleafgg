import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../../game/store/card/card-types';
import { StoreLike, State, GameMessage, PowerType } from '../../../game';
import { Effect } from '../../../game/store/effects/effect';
import { DrawPrizesEffect } from '../../../game/store/effects/game-effects';
import { CoinFlipEffect } from '../../../game/store/effects/play-card-effects';
import {CONFIRMATION_PROMPT, GET_PLAYER_BENCH_SLOTS, IS_ABILITY_BLOCKED, TAKE_SPECIFIC_PRIZES, TAKE_X_PRIZES, MOVE_CARDS } from '../../../game/store/prefabs/prefabs';
import { CardList } from '../../../game/store/state/card-list';
import { GameStatsTracker } from '../../../game/store/game-stats-tracker';

export class Chansey extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType[] = [C];
  public hp: number = 110;
  public weakness = [{ type: F }];
  public retreat = [C, C];

  public powers = [{
    name: 'Lucky Bonus',
    powerType: PowerType.ABILITY,
    exemptFromAbilityLock: true,
    text: 'If you took this Pokémon as a face-down Prize card during your turn and your Bench isn\'t full, ' +
      'before you put it into your hand, you may put it onto your Bench. If you put this Pokémon onto your ' +
      'Bench in this way, flip a coin. If heads, take 1 more Prize card.'
  }];

  public attacks = [{
    name: 'Gentle Slap',
    cost: [C, C, C],
    damage: 70,
    text: ''
  }];

  public set: string = 'MEW';
  public setNumber: string = '113';
  public cardImage: string = 'assets/cardback.png';
  public name: string = 'Chansey';
  public regulationMark = 'G';
  public fullName: string = 'Chansey MEW';

  public abilityUsed = false;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof DrawPrizesEffect) {
      const generator = this.handlePrizeEffect(
        () => generator.next(),
        store,
        state,
        effect
      );
      return generator.next().value;
    }
    return state;
  }

  private *handlePrizeEffect(next: Function, store: StoreLike, state: State, effect: DrawPrizesEffect): IterableIterator<State> {
    const player = effect.player;
    const prizeCard = effect.prizes.find(cardList => cardList.cards.includes(this));

    // Check if ability conditions are met
    if (!prizeCard || GET_PLAYER_BENCH_SLOTS(player).length === 0 || !prizeCard.isSecret || effect.destination !== player.hand) {
      return state;
    }

    // Prevent unintended multiple uses
    if (this.abilityUsed) {
      return state;
    }

    // Check if ability is blocked
    if (IS_ABILITY_BLOCKED(store, state, player, this)) {
      return state;
    }

    // Prevent prize card from going to hand until we complete the ability flow
    effect.preventDefault = true;

    // Any other Prize cards taken together with this one (a KO worth 2+) are not this ability's to hold: they go
    // to the hand now. Preventing the whole effect used to leave them on the Prize row (TA-592).
    const others = effect.prizes.filter(p => p !== prizeCard);
    if (others.length > 0) {
      TAKE_SPECIFIC_PRIZES(store, state, player, others, { skipReduce: true });
    }

    // The Prize has been TAKEN — lifted off the row and seen by its taker; only where it goes (hand or Bench) is
    // open. It counts as taken now, once, whichever way the reaction goes (the card: "this still counts as a
    // Prize card taken"). It used to be counted only when it landed, so the open reaction read 0 taken (TA-592).
    player.prizesTaken += 1;
    player.prizesTakenThisTurn += 1;
    GameStatsTracker.trackPrizeTaken(player, 1);

    // Ask player if they want to use the ability
    let wantToUse = false;
    // B.80 / B.81 (conformance projection; inert for gameplay). The engine keeps the taken Prize in its pile until
    // the flow completes. Stamp it as in transit {prizes, owner} so the wire shows where it physically is (its
    // destination, hand or Bench, is this very decision); the stamp is cleared the moment the flow moves it.
    CardList.transit.set(this, { origin: 'prizes', visibility: 'owner' });
    yield CONFIRMATION_PROMPT(store, state, player, result => {
      wantToUse = result;
      next();
    }, GameMessage.WANT_TO_USE_ABILITY_FROM_PRIZES);
    CardList.transit.delete(this);

    // Declined (or the Bench filled up meanwhile — the generator pattern lets the board change while the prompt is
    // open): the taken Prize goes to the hand. Already counted above.
    const pile = player.prizes.find(prize => prize.cards.includes(this));
    const emptyBenchSlots = GET_PLAYER_BENCH_SLOTS(player);
    if (!wantToUse || emptyBenchSlots.length === 0) {
      pile?.moveTo(player.hand);
      return state;
    }

    this.abilityUsed = true;
    const targetSlot = emptyBenchSlots[0];
    if (pile !== undefined) {
      MOVE_CARDS(store, state, pile, targetSlot, { sourceCard: this });
      targetSlot.pokemonPlayedTurn = state.turn;
    }

    // Flip a coin; if heads, take 1 more Prize card — any remaining one (the other Prizes taken with this card are
    // already in the hand, so nothing is blocked; `blocked` indexes the NON-EMPTY piles, and the full-array index
    // this used to pass blocked the wrong card). The result is read in the CALLBACK: an inline read of
    // `coinFlip.result` is undefined while an unscripted flip is paused, and read as heads (TA-592). Nothing is
    // yielded after it: when the extra pick is forced (the last Prize) TAKE_X_PRIZES resolves synchronously, and a
    // `() => next()` would re-enter this still-running generator ("Generator is already running", TA-592).
    const coinFlip = new CoinFlipEffect(player, heads => {
      if (heads) {
        TAKE_X_PRIZES(store, state, player, 1);
      }
    });
    return store.reduceEffect(state, coinFlip);
  }
} 