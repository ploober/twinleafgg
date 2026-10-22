import { Effect } from '../effects/effect';
import { AfterAttackEffect, EndTurnEffect, BetweenTurnsEffect, BeginTurnEffect, DrawCardForTurnEffect, DrewTopdeckEffect } from '../effects/game-phase-effects';
import { GameError } from '../../game-error';
import { GameMessage, GameLog } from '../../game-message';
import { Player } from '../state/player';
import { BoardEffect, CardTag, SpecialCondition } from '../card/card-types';
import { State, GamePhase, GameWinner } from '../state/state';
import { StoreLike } from '../store-like';
import { checkState, endGame } from './check-effect';
import { WaitPrompt } from '../prompts/wait-prompt';
import { PlayerType } from '../actions/play-card-action';
import { StateUtils } from '../state-utils';
import { RESOLVE_PENDING_END_OF_OPPONENTS_NEXT_TURN_EFFECTS } from '../prefabs/attack-effects';
import { MOVE_CARDS, COIN_FLIP_PROMPT, MULTIPLE_COIN_FLIPS_PROMPT } from '../prefabs/prefabs';

/** Silent hold so clients (and admin phase HUD) can show automatic phase transitions. */
const PHASE_TRANSITION_WAIT_MS = 500;

function getActivePlayer(state: State): Player {
  return state.players[state.activePlayer];
}

function runBetweenTurnsEffects(store: StoreLike, state: State, onComplete: () => void): State {
  for (const player of state.players) {
    store.reduceEffect(state, new BetweenTurnsEffect(player));
  }

  if (store.hasPrompts()) {
    return store.waitPrompt(state, () => {
      checkState(store, state, () => onComplete());
    });
  }
  return checkState(store, state, () => onComplete());
}

export function betweenTurns(store: StoreLike, state: State, onComplete: () => void): State {
  const enteredBetweenTurns =
    state.phase === GamePhase.PLAYER_TURN || state.phase === GamePhase.ATTACK;

  if (enteredBetweenTurns) {
    state.phase = GamePhase.BETWEEN_TURNS;
    const player = getActivePlayer(state);
    return store.prompt(
      state,
      new WaitPrompt(player.id, PHASE_TRANSITION_WAIT_MS, undefined, false),
      () => {
        runBetweenTurnsEffects(store, state, onComplete);
      },
    );
  }

  return runBetweenTurnsEffects(store, state, onComplete);
}

export function initNextTurn(store: StoreLike, state: State): State {
  if ([GamePhase.SETUP, GamePhase.BETWEEN_TURNS].indexOf(state.phase) === -1) {
    return state;
  }

  let player: Player = getActivePlayer(state);

  if (state.phase === GamePhase.BETWEEN_TURNS) {
    // Rotate the ENDING player's prize tally atomically with the turn advance.
    // Doing this in the EndTurnEffect handler is too early: an attack-KO's
    // prize choice resolves via prompts AFTER that handler runs, so the take
    // was credited to an already-rotated counter and lingered a full turn.
    player.prizesTakenLastTurn = player.prizesTakenThisTurn;
    player.prizesTakenThisTurn = 0;
    // TA-471: "played a Supporter this turn" holds through the KO window and checkup.
    player.supporterTurn = 0;
  }

  if (state.phase === GamePhase.BETWEEN_TURNS) {
    if (player.usedTurnSkip) {
      // eslint-disable-next-line no-self-assign
      state.activePlayer = state.activePlayer;
    } else {
      state.activePlayer = state.activePlayer ? 0 : 1;
    }
    player = getActivePlayer(state);
  }

  state.turn++;
  store.log(state, GameLog.LOG_TURN, { turn: state.turn });

  // Clear movement tracking for the new turn
  player.movedToActiveThisTurn = [];
  player.movedFromActiveToBenchThisTurn = [];

  // Skip draw card on first turn
  if (state.turn === 1 && !state.rules.firstTurnDrawCard) {
    state.phase = GamePhase.PLAYER_TURN;
    return state;
  }

  state.phase = GamePhase.DRAW;

  // Draw card at the beginning
  if (player.deck.cards.length === 0) {
    store.log(state, GameLog.LOG_PLAYER_NO_CARDS_IN_DECK, { name: player.name });
    const winner = state.activePlayer ? GameWinner.PLAYER_1 : GameWinner.PLAYER_2;
    state = endGame(store, state, winner);
    return state;
  }

  // Signal beginning of turn (for cards like Slumbering Forest, Oran Berry, etc.)
  const beginTurn = new BeginTurnEffect(player);
  store.reduceEffect(state, beginTurn);

  // Draw card for turn (can be blocked by effects like Luvdisc's Heart Wink)
  let drawCardForTurn: DrawCardForTurnEffect;
  try {
    drawCardForTurn = new DrawCardForTurnEffect(player);
    if (player.cannotDrawAtStartOfTurn) {
      player.cannotDrawAtStartOfTurn = false;
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    store.reduceEffect(state, drawCardForTurn);
  } catch {
    return store.prompt(
      state,
      new WaitPrompt(player.id, PHASE_TRANSITION_WAIT_MS, undefined, false),
      () => {
        state.phase = GamePhase.PLAYER_TURN;
      },
    );
  }

  // Logged only once the draw actually happens: a deck-out or a blocked draw moves no card, so
  // logging earlier would record a draw that never occurred (phantom `draw` event downstream).
  store.log(state, GameLog.LOG_PLAYER_DRAWS_CARD, { name: player.name });
  const handStartLength = player.hand.cards.length;
  state = MOVE_CARDS(store, state, player.deck, player.hand, { count: drawCardForTurn.drawCount });

  // Check each drawn card (for cards like Metagross Emergency Entry, Nugget, etc.)
  const drawnCount = player.hand.cards.length - handStartLength;
  for (let i = 0; i < drawnCount; i++) {
    const drawnCard = player.hand.cards[handStartLength + i];
    try {
      const drewTopdeck = new DrewTopdeckEffect(player, drawnCard);
      store.reduceEffect(state, drewTopdeck);
    } catch {
      return store.prompt(
        state,
        new WaitPrompt(player.id, PHASE_TRANSITION_WAIT_MS, undefined, false),
        () => {
          state.phase = GamePhase.PLAYER_TURN;
        },
      );
    }
  }

  return store.prompt(
    state,
    new WaitPrompt(player.id, PHASE_TRANSITION_WAIT_MS, undefined, false),
    () => {
      state.phase = GamePhase.PLAYER_TURN;
    },
  );
}

function startNextTurn(store: StoreLike, state: State): State {
  const player = state.players[state.activePlayer];

  // Remove Paralyzed at the end of the turn
  player.active.removeSpecialCondition(SpecialCondition.PARALYZED);

  // Move supporter cards to discard
  player.supporter.moveTo(player.discard);

  return betweenTurns(store, state, () => {
    if (state.phase !== GamePhase.FINISHED) {
      return initNextTurn(store, state);
    }
  });
}

function handleSpecialConditions(store: StoreLike, state: State, effect: BetweenTurnsEffect) {
  const player = effect.player;
  for (const sp of player.active.specialConditions) {
    switch (sp) {
      case SpecialCondition.POISONED:
        player.active.damage += effect.poisonDamage;
        store.log(state, GameLog.LOG_POKEMON_TAKES_POISON_DAMAGE,
          { name: player.name, damage: effect.poisonDamage });
        break;
      case SpecialCondition.BURNED:
        player.active.damage += effect.burnDamage;
        store.log(state, GameLog.LOG_POKEMON_TAKES_BURN_DAMAGE,
          { name: player.name, damage: effect.burnDamage });

        if (effect.burnFlipResult === true) {
          break;
        }
        if (effect.burnFlipResult === false) {
          player.active.damage += effect.burnDamage;
          store.log(state, GameLog.LOG_POKEMON_TAKES_BURN_DAMAGE,
            { name: player.name, damage: effect.burnDamage });
          break;
        }
        COIN_FLIP_PROMPT(store, state, player, result => {
          if (result === true) {
            player.active.removeSpecialCondition(SpecialCondition.BURNED);
          }
        });
        break;
      case SpecialCondition.ASLEEP:
        if (effect.asleepFlipResult === true) {
          player.active.removeSpecialCondition(SpecialCondition.ASLEEP);
          break;
        }
        if (effect.asleepFlipResult === false) {
          break;
        }

        if (effect.player.active.sleepFlips > 0) {
          store.log(state, GameLog.LOG_FLIP_ASLEEP, { name: player.name });
          MULTIPLE_COIN_FLIPS_PROMPT(store, state, player, effect.player.active.sleepFlips, results => {
            if (results.every(r => r)) {
              player.active.removeSpecialCondition(SpecialCondition.ASLEEP);
            }
          });
        } else {
          player.active.removeSpecialCondition(SpecialCondition.ASLEEP);
        }
        break;
    }
  }
}

export function gamePhaseReducer(store: StoreLike, state: State, effect: Effect): State {

  if (effect instanceof AfterAttackEffect) {
    effect.opponent.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      if (cardList.defendingPokemonExtraDamageRearmAfterAttack) {
        cardList.defendingPokemonExtraDamageRearmAfterAttack = false;
        cardList.defendingPokemonExtraDamagePending = true;
      }
    });
  }

  if (effect instanceof EndTurnEffect) {
    const player = effect.player;
    const opponent = StateUtils.getOpponent(state, player);
    // TA-694: the turn ends HERE, before its end-of-turn effects run. This log used to be written by startNextTurn,
    // after the "at the end of your opponent's next turn" effects (Intense Kiss pbl-032 discards the Defending
    // Pokemon) and the Knock Out check: when that discard left the player with no Pokemon the game ended inside this
    // handler, startNextTurn never ran, and the turn that had ended was never logged (the conformance wire derives its
    // deferred `turnEnded` from this log and emitted gameOver with no turnEnded). The log's reader (the adapter, TA-2)
    // still defers the event until the turn advances or the game ends, so logging at the top changes no wire order.
    store.log(state, GameLog.LOG_PLAYER_ENDS_TURN, { name: player.name });
    const lastAttack = state.playerLastAttack?.[player.id];
    player.ancientPokemonAttackedLastTurn = lastAttack?.sourceCard.tags.includes(CardTag.ANCIENT) ?? false;

    if (player.usedTurnSkipClearArmed) {
      player.usedTurnSkip = false;
      player.usedTurnSkipClearArmed = false;
    } else if (player.usedTurnSkip) {
      player.usedTurnSkipClearArmed = true;
    }

    state = RESOLVE_PENDING_END_OF_OPPONENTS_NEXT_TURN_EFFECTS(store, state, effect);

    player.canEvolve = false;

    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
      cardList.removeBoardEffect(BoardEffect.ABILITY_USED);
      cardList.healedThisTurn = false;
      if (card.damageTakenLastTurn !== undefined) {
        card.damageTakenLastTurn = 0;
      }
    });

    effect.player.marker.removeMarker(effect.player.DAMAGE_DEALT_MARKER);
    if (!player.usedTurnSkip) {
      player.pokemonKnockedOutDuringOpponentsLastTurn = false;
      player.pokemonKnockedOutByAttackDuringOpponentsLastTurn = false;
      player.pokemonKnockedOutLastTurnEntries = [];
    }

    // Clear damage reduction / self-protect / revenge effects on the opponent when
    // this player ends their turn (those effects were active during this player's turn).
    // denyPrizes / discardAttackerEnergy-on-KO clear after checkState (KO resolution).
    opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
      cardList.damageReductionNextTurn = 0;
      cardList.damageReductionNextTurnFilter = null;
      cardList.damageReductionBeforeWeaknessNextTurn = 0;
      cardList.preventDamageNextTurn = null;
      cardList.preventDamageNextTurnPending = null;
      cardList.preventEffectsOfAttacksNextTurn = null;
      cardList.preventEffectsOfAttacksNextTurnPending = null;
      cardList.coinFlipPreventAttackDamageNextTurn = false;
      cardList.coinFlipPreventAttackDamageNextTurnPending = false;
      cardList.cannotBeSpecialConditionedNextTurn = false;
      cardList.cannotBeSpecialConditionedNextTurnPending = false;
      cardList.surviveOnTenHpNextTurn = null;
      cardList.retaliateOnDamageNextTurn = null;
      cardList.noWeaknessNextTurn = false;
    });

    // Activate pending prevent-damage / revenge / survive on this player's Pokémon
    // (armed last turn → active during opponent's upcoming turn).
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      if (cardList.preventDamageNextTurnPending !== null) {
        cardList.preventDamageNextTurn = cardList.preventDamageNextTurnPending;
        cardList.preventDamageNextTurnPending = null;
      }
      if (cardList.preventEffectsOfAttacksNextTurnPending !== null) {
        cardList.preventEffectsOfAttacksNextTurn = cardList.preventEffectsOfAttacksNextTurnPending;
        cardList.preventEffectsOfAttacksNextTurnPending = null;
      }
      if (cardList.surviveOnTenHpNextTurnPending !== null) {
        cardList.surviveOnTenHpNextTurn = cardList.surviveOnTenHpNextTurnPending;
        cardList.surviveOnTenHpNextTurnPending = null;
      }
      if (cardList.retaliateOnDamageNextTurnPending !== null) {
        cardList.retaliateOnDamageNextTurn = cardList.retaliateOnDamageNextTurnPending;
        cardList.retaliateOnDamageNextTurnPending = null;
      }
      if (cardList.coinFlipPreventAttackDamageNextTurnPending) {
        cardList.coinFlipPreventAttackDamageNextTurn = true;
        cardList.coinFlipPreventAttackDamageNextTurnPending = false;
      }
      if (cardList.cannotBeSpecialConditionedNextTurnPending) {
        cardList.cannotBeSpecialConditionedNextTurn = true;
        cardList.cannotBeSpecialConditionedNextTurnPending = false;
      }
      if (cardList.noWeaknessNextTurnPending) {
        cardList.noWeaknessNextTurn = true;
        cardList.noWeaknessNextTurnPending = false;
      }
      if (cardList.denyPrizesIfKnockedOutNextTurnPending) {
        cardList.denyPrizesIfKnockedOutNextTurn = true;
        cardList.denyPrizesIfKnockedOutNextTurnPending = false;
      }
      if (cardList.discardAttackerEnergyIfKnockedOutNextTurnPending) {
        cardList.discardAttackerEnergyIfKnockedOutNextTurn = true;
        cardList.discardAttackerEnergyIfKnockedOutNextTurnPending = false;
      }
    });

    // TA-86: clear the attacker-side reduction on the turn-ending player's OWN Pokémon — they have now had
    // their "attacks do N less damage" turn (Growl set it on them the turn before), so it expires here.
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      cardList.attacksDamageReductionNextTurn = 0;
    });

    // Activate pending extra damage at end of the defending player's turn (not the attacker's).
    // The effect is armed by the attacker on the opponent's Active; it becomes active once
    // that opponent finishes their next turn, before the attacker's following turn.
    [player, opponent].forEach(p => {
      p.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        // TA-236: these two riders read "during your OPPONENT'S next turn" — the window is the turn
        // that begins when the ATTACKER's turn ends. The previous gate (`!== player.id`) was copied
        // from the extra-damage arming above, whose text is "during YOUR next turn" — the OPPOSITE
        // window — so the increase became active only after the defender's turn had already passed,
        // and no attack was ever priced with it. Promote when the attacker's own turn ends.
        if (cardList.attackCostIncreaseNextTurnPending
          && cardList.attackCostIncreaseNextTurnAttackerId === player.id) {
          cardList.attackCostIncreaseNextTurn = cardList.attackCostIncreaseNextTurnPending;
          cardList.attackCostIncreaseNextTurnPending = 0;
        }
        if (cardList.retreatCostIncreaseNextTurnPending
          && cardList.retreatCostIncreaseNextTurnAttackerId === player.id) {
          cardList.retreatCostIncreaseNextTurn = cardList.retreatCostIncreaseNextTurnPending;
          cardList.retreatCostIncreaseNextTurnPending = 0;
        }
        if (cardList.defendingPokemonExtraDamagePending
          && cardList.defendingPokemonExtraDamageAttackerId !== player.id) {
          cardList.defendingPokemonExtraDamagePending = false;
        }

        // Hangman KO / extra prizes: same "your next turn" arming as extra damage
        if (cardList.knockOutIfDamagedNextTurnPending
          && cardList.knockOutIfDamagedNextTurnAttackerId !== player.id) {
          cardList.knockOutIfDamagedNextTurnPending = false;
        }
        if (cardList.extraPrizesIfKnockedOutNextTurnPending
          && cardList.extraPrizesIfKnockedOutNextTurnAttackerId !== player.id) {
          cardList.extraPrizesIfKnockedOutNextTurnPending = false;
        }
      });
    });

    [player, opponent].forEach(p => {
      p.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        // TA-236 (same window fix): the rider expires when the DEFENDER's turn ends — the turn it
        // was live for. The old gate (`=== player.id`) expired it at the attacker's next end-of-turn
        // instead, one full turn late (and, combined with the inverted promote above, meant the
        // rider's whole lifetime sat in the wrong turn).
        if (cardList.attackCostIncreaseNextTurnAttackerId !== undefined
          && cardList.attackCostIncreaseNextTurnAttackerId !== player.id
          && !cardList.attackCostIncreaseNextTurnPending
          && cardList.attackCostIncreaseNextTurn > 0
        ) {
          cardList.attackCostIncreaseNextTurn = 0;
          cardList.attackCostIncreaseNextTurnAttackerId = undefined;
        }
        if (cardList.retreatCostIncreaseNextTurnAttackerId !== undefined
          && cardList.retreatCostIncreaseNextTurnAttackerId !== player.id
          && !cardList.retreatCostIncreaseNextTurnPending
          && cardList.retreatCostIncreaseNextTurn > 0
        ) {
          cardList.retreatCostIncreaseNextTurn = 0;
          cardList.retreatCostIncreaseNextTurnAttackerId = undefined;
        }
      });
    });

    // Replace the previous bonus with one armed during this turn, or clear it.
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      cardList.nextTurnAttackDamageBonus = cardList.nextTurnAttackDamageBonusPending;
      cardList.nextTurnAttackDamageBonusPending = null;
      cardList.nextTurnAttackBaseDamage = cardList.nextTurnAttackBaseDamagePending;
      cardList.nextTurnAttackBaseDamagePending = null;
      cardList.outgoingAttackDamageBonusNextTurn = cardList.outgoingAttackDamageBonusNextTurnPending;
      cardList.outgoingAttackDamageBonusNextTurnPending = 0;
      cardList.nextTurnCoinFlipCount = cardList.nextTurnCoinFlipCountPending;
      cardList.nextTurnCoinFlipCountPending = null;
    });

    // Clear active defending Pokemon extra damage at end of the attacking player's turn
    [player, opponent].forEach(p => {
      p.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        if (cardList.defendingPokemonExtraDamageAttackerId === player.id
          && !cardList.defendingPokemonExtraDamagePending
          && cardList.defendingPokemonExtraDamageNextTurn > 0) {
          cardList.defendingPokemonExtraDamageNextTurn = 0;
          cardList.defendingPokemonExtraDamageAttackerId = undefined;
        }

        if (cardList.knockOutIfDamagedNextTurnAttackerId === player.id
          && !cardList.knockOutIfDamagedNextTurnPending
          && cardList.knockOutIfDamagedNextTurn) {
          cardList.knockOutIfDamagedNextTurn = false;
          cardList.knockOutIfDamagedNextTurnAttackerId = undefined;
          cardList.knockOutIfDamagedNextTurnFilter = null;
          cardList.knockOutIfDamagedNextTurnAttack = undefined;
          cardList.knockOutIfDamagedNextTurnSourceCard = undefined;
        }

        if (cardList.extraPrizesIfKnockedOutNextTurnAttackerId === player.id
          && !cardList.extraPrizesIfKnockedOutNextTurnPending
          && cardList.extraPrizesIfKnockedOutNextTurn > 0) {
          cardList.extraPrizesIfKnockedOutNextTurn = 0;
          cardList.extraPrizesIfKnockedOutNextTurnAttackerId = undefined;
        }
      });
    });

    // Weakness override lasting until end of attacker's next turn (2 EndTurns of the attacker)
    [player, opponent].forEach(p => {
      p.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        if (cardList.weaknessOverrideAttackerId !== player.id
          || cardList.weaknessOverrideType === undefined) {
          return;
        }
        if (cardList.weaknessOverrideClearArmed) {
          cardList.weaknessOverrideType = undefined;
          cardList.weaknessOverrideAttackerId = undefined;
          cardList.weaknessOverrideClearArmed = false;
        } else {
          cardList.weaknessOverrideClearArmed = true;
        }
      });
    });

    // Handle "cannot attack next turn" restrictions with two-stage cleanup
    player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
      // First, clear active restrictions (they blocked this turn, now clear them)
      if (cardList.cannotAttackNextTurn) {
        cardList.cannotAttackNextTurn = false;
      }
      if (cardList.cannotUseAttacksNextTurn.length > 0) {
        cardList.cannotUseAttacksNextTurn = [];
      }

      // Then, activate pending restrictions (set active for next turn, clear pending)
      if (cardList.cannotAttackNextTurnPending) {
        cardList.cannotAttackNextTurn = true;
        cardList.cannotAttackNextTurnPending = false;
      }
      if (cardList.cannotUseAttacksNextTurnPending.length > 0) {
        cardList.cannotUseAttacksNextTurn = [...cardList.cannotUseAttacksNextTurnPending];
        cardList.cannotUseAttacksNextTurnPending = [];
      }

      if (cardList.coinFlipCancelAttackNextTurn > 0) {
        cardList.coinFlipCancelAttackNextTurn = 0;
      }

      if (cardList.attackDamageReductionNextTurn > 0) {
        cardList.attackDamageReductionNextTurn = 0;
      }

      if (cardList.attackDamageReductionAfterWeaknessNextTurn > 0) {
        cardList.attackDamageReductionAfterWeaknessNextTurn = 0;
      }

      if (cardList.cannotRetreatNextTurn) {
        cardList.cannotRetreatNextTurn = false;
      }
      if (cardList.cannotRetreatNextTurnPending) {
        cardList.cannotRetreatNextTurn = true;
        cardList.cannotRetreatNextTurnPending = false;
      }
      if (cardList.zeroRetreatCostNextTurn) {
        cardList.zeroRetreatCostNextTurn = false;
      }
      if (cardList.zeroRetreatCostNextTurnPending) {
        cardList.zeroRetreatCostNextTurn = true;
        cardList.zeroRetreatCostNextTurnPending = false;
      }
      if (cardList.pendingEnergyAttachDamageCounters) {
        cardList.pendingEnergyAttachDamageCounters = null;
      }
      if (cardList.cannotAttachEnergyFromHandNextTurn) {
        cardList.cannotAttachEnergyFromHandNextTurn = false;
      }
      if (cardList.pendingEnergyAttachFromHandConsequence) {
        cardList.pendingEnergyAttachFromHandConsequence = null;
      }
      if (cardList.blockedAttackNameNextTurn !== undefined) {
        cardList.blockedAttackNameNextTurn = undefined;
      }
      if (cardList.onlyAllowedAttackNameNextTurn !== undefined) {
        cardList.onlyAllowedAttackNameNextTurn = undefined;
      }
      if (cardList.cannotEvolveNextTurn) {
        cardList.cannotEvolveNextTurn = false;
      }
      if (cardList.canEvolveThisTurn) {
        cardList.canEvolveThisTurn = false;
      }
      if (cardList.cannotBeHealedNextTurn) {
        cardList.cannotBeHealedNextTurn = false;
      }
      // G-59: clear the once-per-turn Ability-use labels for the ending player's Pokemon (mirrors
      // attacksThisTurn). "This turn" is over, so next turn's projection starts empty.
      if (cardList.abilitiesUsedThisTurn.length > 0) {
        cardList.abilitiesUsedThisTurn = [];
      }
    });

    // Gastro Acid: no Abilities until end of attacker's next turn (2 EndTurns of attacker)
    [player, opponent].forEach(p => {
      p.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList) => {
        if (cardList.noAbilitiesAttackerId !== player.id || !cardList.noAbilities) {
          return;
        }
        if (cardList.noAbilitiesClearArmed) {
          cardList.noAbilities = false;
          cardList.noAbilitiesAttackerId = undefined;
          cardList.noAbilitiesClearArmed = false;
        } else {
          cardList.noAbilitiesClearArmed = true;
        }
      });
    });

    // Clear attack-sourced play locks after the locked player's turn(s)
    player.tickPlayLocksAtEndOfTurn();

    player.active.attacksThisTurn = 0;

    // NOTE: the prizesTaken tally rotation AND the supporterTurn reset happen in
    // `initNextTurn`, atomic with the turn advance — an attack-KO's prize prompts
    // resolve after this handler, and that KO window is still this turn (TA-471:
    // zeroing supporterTurn here projected "no Supporter played this turn" while
    // the attacking player was still taking Prizes).

    if (player === undefined) {
      throw new GameError(GameMessage.NOT_YOUR_TURN);
    }

    state = checkState(store, state, () => {
      // Expire KO-time effects after KO resolution for this turn.
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList) => {
        cardList.denyPrizesIfKnockedOutNextTurn = false;
        cardList.denyPrizesIfKnockedOutNextTurnPending = false;
        cardList.discardAttackerEnergyIfKnockedOutNextTurn = false;
        cardList.discardAttackerEnergyIfKnockedOutNextTurnPending = false;
        cardList.discardAttackerEnergyIfKnockedOutNextTurnAttack = undefined;
        cardList.discardAttackerEnergyIfKnockedOutNextTurnSourceCard = undefined;
        cardList.discardAttackerEnergyIfKnockedOutNextTurnAttackerId = undefined;
      });

      if (state.phase === GamePhase.FINISHED) {
        return;
      }
      // TA-549: the end-of-turn steps queued for after the Knock Out check (#1869), one at a time, each waiting for
      // its own prompts; the turn passes only after the last of them.
      const afterKnockOuts = effect.afterKnockOuts.splice(0);
      const runAfterKnockOuts = (i: number): State => {
        if (i >= afterKnockOuts.length || state.phase === GamePhase.FINISHED) {
          return state.phase === GamePhase.FINISHED ? state : startNextTurn(store, state);
        }
        afterKnockOuts[i]();
        if (store.hasPrompts()) {
          return store.waitPrompt(state, () => runAfterKnockOuts(i + 1));
        }
        return runAfterKnockOuts(i + 1);
      };
      return runAfterKnockOuts(0);
    });
    return state;
  }
  if (effect instanceof BetweenTurnsEffect) {
    handleSpecialConditions(store, state, effect);
  }
  return state;
}
