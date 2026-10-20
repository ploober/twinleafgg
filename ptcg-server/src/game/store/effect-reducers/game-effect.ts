import { GameError } from '../../game-error';
import { GameLog, GameMessage } from '../../game-message';
import { BoardEffect, CardTag, CardType, SpecialCondition, SuperType } from '../card/card-types';
import { PokemonCard, getPrimaryCardType } from '../card/pokemon-card';
import { Power, PowerType, Resistance, Weakness } from '../card/pokemon-types';
import { ApplyWeaknessEffect, DealDamageEffect, DiscardCardsEffect } from '../effects/attack-effects';
import { Player } from '../state/player';
import {
  AddSpecialConditionsPowerEffect,
  CheckAttackCostEffect,
  CheckPokemonStatsEffect,
  CheckPokemonTypeEffect,
  CheckProvidedEnergyEffect,
  CheckSpecialConditionRemovalEffect
} from '../effects/check-effects';
import { Effect } from '../effects/effect';
import {
  AttackEffect,
  EvolveEffect,
  HealEffect, KnockOutEffect,
  PlaceDamageCountersEffect,
  PowerEffect,
  PutDamageCountersEffect,
  TrainerPowerEffect,
  UseAttackEffect,
  UsePowerEffect,
  UseStadiumEffect,
  UseTrainerPowerEffect,
  EffectOfAbilityEffect,
} from '../effects/game-effects';
import { AfterAttackEffect, BeforeDoingDamageEffect, EndTurnEffect } from '../effects/game-phase-effects';
import { reduceDeferredAfterDamage } from './after-damage-drain';
import { CoinFlipPrompt } from '../prompts/coin-flip-prompt';
import { PlayerType, SlotType } from '../actions/play-card-action';
import { StateUtils } from '../state-utils';
import { GamePhase, State } from '../state/state';
import { StoreLike } from '../store-like';
import { MoveCardsEffect } from '../effects/game-effects';
import { runDelegatedCopiedAttackGenerator } from '../prefabs/copy-attack-delegation';
import { GameStatsTracker } from '../game-stats-tracker';
import { PokemonCardList } from '../state/pokemon-card-list';
import { MOVE_CARDS, COIN_FLIP_PROMPT, IS_ABILITY_BLOCKED } from '../prefabs/prefabs';
import { OPPONENT_WEAKNESS_AURA_POWER, STAMP_ABILITY_LOCK_ACTIVATION } from '../prefabs/ability-lock';
import { applyPromotion, choosePromotionPrompt } from './check-effect';
import { RESOLVE_COIN_FLIP_EFFECT, RUN_COIN_FLIP_SEQUENCE } from '../prefabs/attack-coin-reflip';
import { CardList } from '../state/card-list';
import { ConfirmPrompt } from '../prompts/confirm-prompt';
import { checkState } from './check-effect';
import { ChooseAttackPrompt } from '../prompts/choose-attack-prompt';
import { DiscardEnergyPrompt } from '../prompts/discard-energy-prompt';
import { Card } from '../card/card';
import { Attack } from '../card/pokemon-types';
import { WaitPrompt } from '../prompts/wait-prompt';
import { CoinFlipEffect, CoinFlipSequenceEffect } from '../effects/play-card-effects';

/** Keep in sync with ptcg-play-react {@link BOARD3D_ABILITY_ANIMATION_DURATION_SEC} (× 1000). */
const ABILITY_ANIMATION_WAIT_MS = 900;

function emitAbilityAnimationEvent(
  store: StoreLike,
  player: { id: number },
  card: { id: number | string },
  slot: 'active' | 'bench',
  index: number,
  abilityName: string,
): void {
  const game = (store as any).handler;
  if (game && game.core && typeof game.core.emit === 'function') {
    game.core.emit((c: any) => {
      if (typeof c.socket !== 'undefined') {
        c.socket.emit(`game[${game.id}]:ability`, {
          playerId: player.id,
          cardId: card.id,
          slot,
          index,
          abilityName,
        });
      }
    });
  }
}


function applyWeaknessAndResistance(
  damage: number,
  cardTypes: CardType[],
  weakness: Weakness[],
  resistance: Resistance[]
): number {
  let multiply = 1;
  let modifier = 0;

  const allTypes = cardTypes;

  for (const item of weakness) {
    if (allTypes.includes(item.type)) {
      if (item.value === undefined) {
        multiply *= 2;
      } else {
        modifier += item.value;
      }
    }
  }

  for (const item of resistance) {
    if (allTypes.includes(item.type)) {
      modifier += item.value;
    }
  }

  return (damage * multiply) + modifier;
}

/**
 * Fully reset a board slot after its Pokémon leave play.
 * Attachments must already have been moved off the slot before calling this.
 */
function resetEmptyPokemonSlot(slot: PokemonCardList): void {
  slot.removeAttackEffects();
  slot.clearEffects();
  slot.damage = 0;
  slot.attackDamagedOnTurn = -1;
  slot.knockedOutByEffect = false;
  slot.hp = 0;
  slot.specialConditions = [];
  slot.poisonDamage = 10;
  slot.burnDamage = 20;
  slot.confusionDamage = 30;
  slot.marker.markers = [];
  slot.tools = [];
  slot.boardEffect = [];
  slot.abilityLockActivationOrder = 0;
  slot.pokemonPlayedTurn = 0;
  slot.hpBonus = 0;
  slot.attacksThisTurn = undefined;
  slot.stadium = undefined;
  slot.sleepFlips = 1;
  slot.showAllStageAbilities = false;
  slot.triggerEvolutionAnimation = false;
  slot.showBasicAnimation = false;
  slot.triggerAttackAnimation = false;
  slot.isActivatingCard = false;
}

function* useAttack(next: Function, store: StoreLike, state: State, effect: UseAttackEffect | AttackEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  //Skip attack on first turn
  if (state.turn === 1 && effect.attack.canUseOnFirstTurn !== true && state.rules.attackFirstTurn == false) {
    throw new GameError(GameMessage.CANNOT_ATTACK_ON_FIRST_TURN);
  }

  const sp = player.active.specialConditions;
  const ignoreStatusConditions = effect instanceof UseAttackEffect && effect.ignoreStatusConditions;
  if ((sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) && !ignoreStatusConditions) {
    throw new GameError(GameMessage.BLOCKED_BY_SPECIAL_CONDITION);
  }

  const attack = effect.attack;
  let attackingPokemon = player.active;

  // Check for attacks that can be used from bench
  player.bench.forEach(benchSlot => {
    const benchPokemon = benchSlot.getPokemonCard();
    if (benchPokemon && benchPokemon.attacks.some(a => a.name === attack.name && a.useOnBench)) {
      attackingPokemon = benchSlot;
    }
  });

  // Check if Pokemon cannot attack next turn
  if (attackingPokemon.cannotAttackNextTurn) {
    throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
  }

  // Player-wide attack lock (e.g. Steelix Gigaton Shake, Cobalion-GX Iron Rule)
  if (player.cannotAttackTurnsRemaining > 0) {
    throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
  }

  if (player.cannotAttackMaxEnergyTurnsRemaining > 0 && player.cannotAttackMaxEnergy !== null) {
    const checkEnergy = new CheckProvidedEnergyEffect(player, attackingPokemon);
    store.reduceEffect(state, checkEnergy);
    const energyCount = checkEnergy.energyMap.reduce((sum, entry) => sum + entry.provides.length, 0);
    if (energyCount <= player.cannotAttackMaxEnergy) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
  }

  // Check if specific attack cannot be used next turn
  if (attackingPokemon.cannotUseAttacksNextTurn.includes(attack.name)) {
    throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
  }

  // Check if a specific attack was disabled by an opponent's effect
  if (attackingPokemon.blockedAttackNameNextTurn === attack.name) {
    throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
  }
  if (attackingPokemon.onlyAllowedAttackNameNextTurn !== undefined
    && attackingPokemon.onlyAllowedAttackNameNextTurn !== attack.name) {
    throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
  }
  if (attackingPokemon.blockedAttackNameUntilLeavesActive === attack.name) {
    throw new GameError(GameMessage.CANNOT_USE_ATTACK);
  }
  const attackingCard = attackingPokemon.getPokemonCard();
  if (attackingCard?.cannotUseAttackUntilLeavesPlay === attack.name) {
    throw new GameError(
      attack.name === 'Leek Slap'
        ? GameMessage.LEEK_SLAP_CANNOT_BE_USED_AGAIN
        : GameMessage.CANNOT_USE_ATTACK,
    );
  }
  if (player.cannotUseGXAttacks && (attack.gxAttack === true || attack.name.includes('-GX'))) {
    throw new GameError(GameMessage.CANNOT_USE_ATTACK);
  }

  // Smokescreen / Sand-Attack: flip coin(s); any tails cancels the attack
  if (attackingPokemon.coinFlipCancelAttackNextTurn > 0) {
    const flips = attackingPokemon.coinFlipCancelAttackNextTurn;
    let anyTails = false;

    for (let i = 0; i < flips; i++) {
      let heads = false;
      state = COIN_FLIP_PROMPT(store, state, player, result => {
        heads = result;
      });
      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }
      if (!heads) {
        anyTails = true;
      }
    }

    if (anyTails) {
      state = store.reduceEffect(state, new EndTurnEffect(player));
      return state;
    }
  }

  // Get the actual PokemonCard for power checks
  const attackingPokemonCard = attackingPokemon.getPokemonCard();
  // Check for barrage on powers (and not blocked)
  let hasBarragePower = false;
  if (attackingPokemonCard) {
    hasBarragePower = attackingPokemonCard.powers.some(
      power => power.barrage
    );
  }

  const checkAttackCost = new CheckAttackCostEffect(player, attack);
  state = store.reduceEffect(state, checkAttackCost);

  const checkProvidedEnergy = new CheckProvidedEnergyEffect(player, attackingPokemon);
  state = store.reduceEffect(state, checkProvidedEnergy);

  if (StateUtils.checkEnoughEnergy(checkProvidedEnergy.energyMap, checkAttackCost.cost as CardType[]) === false) {
    throw new GameError(GameMessage.NOT_ENOUGH_ENERGY);
  }

  if (sp.includes(SpecialCondition.CONFUSED)) {
    let flip = false;

    store.log(state, GameLog.LOG_FLIP_CONFUSION, { name: player.name });
    yield store.prompt(state, new CoinFlipPrompt(
      player.id,
      GameMessage.FLIP_CONFUSION),
      result => {
        flip = result;
        next();
      });

    if (flip === false) {
      store.log(state, GameLog.LOG_HURTS_ITSELF);
      player.active.damage += player.active.confusionDamage;
      state = store.reduceEffect(state, new EndTurnEffect(player));
      return state;
    }
  }

  store.log(state, GameLog.LOG_PLAYER_USES_ATTACK, { name: player.name, attack: attack.name });
  state.phase = GamePhase.ATTACK;

  // At the start of the attack, initialize pendingAttackTargets
  //  (attackingPokemon as any).pendingAttackTargets = [];

  const attackEffect = (effect instanceof AttackEffect) ? effect : new AttackEffect(player, opponent, attack);
  attackEffect.source = attackingPokemon;
  if (attackingPokemon === player.active && attackingPokemon.whileActiveAttackDamageBonus > 0) {
    attackEffect.damage += attackingPokemon.whileActiveAttackDamageBonus;
  }

  const copycatCard = attackingPokemon.getPokemonCard();
  const delegateFrom = effect instanceof UseAttackEffect ? effect.delegateFrom : undefined;
  let attackDeferPrev = state.deferAfterDamage;
  let attackDrainStart = state.pendingAfterDamage.length;

  if (delegateFrom && copycatCard) {
    state = yield* runDelegatedCopiedAttackGenerator(next, {
      store,
      state,
      player,
      opponent,
      copycatCard,
      sourceCard: delegateFrom,
      selectedAttack: attack,
      sourceSlot: attackingPokemon,
      skipLog: true,
      skipAfterAttack: false,
    });
  } else {
    const prevPreDamage = state.preDamageAttack;
    state.preDamageAttack = attackEffect;   // B.82: until the damage step starts (below)
    // TA-562 / §B.53: arm the damage-response deferral BEFORE the attack's own effect runs, not only for the damage step
    // below. An attack that deals its damage inline from inside its effect (APPLY_ATTACK_DAMAGE_BEFORE_EFFECTS, or a
    // hand-rolled DealDamageEffect before its prompt: Crunch twm-094 and ~40 in-pool printings) otherwise raised its
    // AfterDamageEffect while the flag was still off, so "when damaged by an attack" reactions (Needly Armor, Automated
    // Combat, Spiky Energy...) resolved before the attack's remaining effects (#2172, E-03). The queue it fills is the
    // same one the damage step fills; both are drained together after AfterAttackEffect.
    attackDeferPrev = state.deferAfterDamage;
    attackDrainStart = state.pendingAfterDamage.length;
    state.deferAfterDamage = true;
    try {
      state = store.reduceEffect(state, attackEffect);
    } catch (error) {
      state.deferAfterDamage = attackDeferPrev;
      state.pendingAfterDamage.splice(attackDrainStart);
      state.preDamageAttack = prevPreDamage;
      throw error;
    }

    if (store.hasPrompts()) {
      yield store.waitPrompt(state, () => next());
    }
    state.preDamageAttack = prevPreDamage;
  }

  // TA-399: record the attack as the player's LAST ATTACK here — after the Smokescreen/Sand-Attack and
  // Confusion checks AND after the attack's own effect has resolved. It used to be written in
  // player-turn-reducer right after the dispatch, before the Confusion flip resolved (#2087: "A failed
  // attack attempt while Confused does not count as an attack"; #851). The first correction wrote it
  // just before the attack effect, which broke every card that reads the record DURING its own
  // resolution to test "used this attack during your last turn" (Angelite's lockout, TA-231): it saw
  // the current attack and never blocked. The record is the PREVIOUS attack until this one is done.
  if (effect instanceof UseAttackEffect) {
    // TA-421: the SOURCE of the record is the card that DECLARED the attack (`copycatCard`, read
    // above before the attack effect ran), not whatever the attacking slot holds now. An attack that
    // discards its own attacker (Shattering Speed sfa-015) empties the slot — and the post-KO promote
    // SWAPS the list references (`switchPokemon`), leaving `attackingPokemon` pointing at an empty
    // bench list — so re-reading the slot here dropped the record entirely. The record is the
    // PLAYER's and survives the source leaving play (CF-65; effects that end on leaving the Active
    // Spot are explicitly worded, #6929). The WRITE POINT stays here, after the Confusion/Smokescreen
    // checks and the attack's own resolution (TA-399/TA-231) — only the card capture moves earlier.
    const lastAttackSource = copycatCard;
    if (lastAttackSource !== undefined) {
      if (!state.playerLastAttack) {
        state.playerLastAttack = {};
      }
      state.playerLastAttack[player.id] = { attack, sourceCard: lastAttackSource, turn: state.turn };
    }
  }

  // --- Attack Animation Trigger ---
  // Set triggerAttackAnimation on the attacking Pokemon
  attackingPokemon.triggerAttackAnimation = true;

  // Find slot and index for the attackingPokemon
  let slot: string | undefined = undefined;
  let index: number | undefined = undefined;
  if (player.active === attackingPokemon) {
    slot = 'active';
    index = 0;
  } else {
    slot = 'bench';
    index = player.bench.indexOf(attackingPokemon);
  }
  const card = attackingPokemon.getPokemonCard();
  const cardId = card ? card.id : undefined;
  const cardType = card ? getPrimaryCardType(card) : undefined;

  // Emit attack animation event
  const game = (store as any).handler;
  if (game && game.core && typeof game.core.emit === 'function') {
    game.core.emit((c: any) => {
      if (typeof c.socket !== 'undefined') {
        c.socket.emit(`game[${game.id}]:attack`, {
          playerId: player.id,
          cardId,
          slot,
          index,
          cardType,
          damage: attackEffect.damage,
          opponentId: opponent.id
        });
      }
    });
  }

  // Yield a wait prompt for the animation (1 second)
  yield store.prompt(state, new WaitPrompt(player.id, 1000, 'Attack animation'), () => {
    // After wait, clear the animation flag
    attackingPokemon.triggerAttackAnimation = false;
    next();
  });
  // --- End Attack Animation Trigger ---

  if (!delegateFrom) {
    // CF-74 / §B.53: arm the damage-response deferral for THIS attack. Damage dealt by the attack
    // (and by its AfterAttackEffect) queues each "when damaged by an attack" AfterDamageEffect on
    // `state.pendingAfterDamage` instead of resolving it mid-damage; the queue is drained below, after
    // AfterAttackEffect and before the Knock Out check. Rulebook order: damage → the attack's own
    // effects (e.g. Strafe's "you may switch") → damage-response Abilities (Shell Spikes) → KO
    // (Advanced Rulebook II E-03, #2172). `drainStart`/`prevDefer` make it nesting-safe: a copied
    // attack re-entering an attack pipeline drains only what it queued and restores the outer flag.
    // TA-562: armed above, before the attack's own effect (attackDeferPrev / attackDrainStart).
    const prevDefer = attackDeferPrev;
    const drainStart = attackDrainStart;
    state.deferAfterDamage = true;

    const beforeDoingDamageEffect = new BeforeDoingDamageEffect(attackEffect);
    state = store.reduceEffect(state, beforeDoingDamageEffect);

    if (attackEffect.damage > 0) {
      const dealDamage = new DealDamageEffect(attackEffect, attackEffect.damage);
      state = store.reduceEffect(state, dealDamage);

      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }
    }

    // B.82: the cards the attack's text chose before its damage move now, after it.
    for (const move of attackEffect.afterDamageMoves.splice(0)) {
      move();
    }
    if (store.hasPrompts()) {
      yield store.waitPrompt(state, () => next());
    }

    const afterAttackEffect = new AfterAttackEffect(effect.player, opponent, attack, attackEffect);
    state = store.reduceEffect(state, afterAttackEffect);

    if (store.hasPrompts()) {
      yield store.waitPrompt(state, () => next());
    }

    // Drain the deferred damage-response window. Each queued AfterDamageEffect is dispatched exactly
    // as it would have been mid-damage, so its `resolveSimultaneous` batch (B.40 / TA-292 ordering)
    // moves intact. Restore the flag first so any sub-damage a response deals (e.g. Shell Trap's
    // retaliation) fires its own AfterDamage immediately, exactly as before.
    state.deferAfterDamage = prevDefer;
    const deferredAfterDamage = state.pendingAfterDamage.splice(drainStart);
    for (const afterDamageEffect of deferredAfterDamage) {
      // TA-460: a response that afflicts "the Attacking Pokémon" finds it possibly already on the Bench
      // (Strafe resolved first, per B.53) — Special Conditions cannot follow it there (#891).
      state = reduceDeferredAfterDamage(store, state, afterDamageEffect);
      if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
      }
    }
  }

  // TA-282 / §B.42 / compendium #479: if the attack's own EFFECT removed the attacker from play
  // ("Put this Pokémon and all attached cards into your hand", "Shuffle this Pokémon … into your
  // deck"), the ATTACKING player replaces it here — before any Knock Out is checked. #479, on this
  // exact shape: "Greninja GX is shuffled back in as an effect of the attack before KO's are
  // checked, so it must be replaced before either player checks for KO's."
  //
  // Without this the empty Active spot falls into the same `checkState` sweep as the defender's KO,
  // where the sweep's own (correct, #817/#815) order — prizes, then the next player's promote — puts
  // the prize and the DEFENDER's replacement ahead of the attacker's. The rule here is not an
  // exception to that order; it is that this replacement happens BEFORE the sweep begins.
  //
  // Deliberately placed in the attack pipeline rather than in the self-removal prefabs: several
  // printings hand-roll the removal instead of calling one (`por-062` Meowth ex is written out in
  // full in its own file), so a prefab-level fix would miss them by construction.
  //
  // ⚠️ Gated on the attacker NOT having been Knocked Out. `ssp-100` Annihilape *Destined Fight*
  // ("Both Active Pokémon are Knocked Out") empties the attacker's Active spot too — but by a KO,
  // which owes a prize and therefore belongs to the checkState sweep, where #817's prizes-first and
  // #815's turn-next ordering apply. An "Active spot is empty" test alone cannot tell the two apart
  // and regressed the RE-124 / TA-296 double-KO cells the first time this was written. Every direct
  // KO records its owed prize on `state.pendingDirectKoPrizes` keyed by the KO'd Pokémon's OWNER, so
  // an entry for the attacking player is exactly "the attacker left play by being Knocked Out".
  // (A damage KO cannot reach here at all: the Pokémon is still on the board until checkState
  // discards it, so the Active spot is not empty.)
  const attackerWasKnockedOut = state.pendingDirectKoPrizes
    .some(owed => owed.playerNum === state.players.indexOf(player));
  const attackerPromotion = attackerWasKnockedOut ? null : choosePromotionPrompt(player);
  if (attackerPromotion !== null) {
    yield store.prompt(state, attackerPromotion, result => {
      applyPromotion(store, state, player, result);
      next();
    });
  }

  if ((attack.barrage || hasBarragePower) && !(effect as any)._barrageUsed) {
    state = checkState(store, state);
    if (store.hasPrompts()) {
      yield store.waitPrompt(state, () => next());
    }
    state = checkState(store, state);
    if (store.hasPrompts()) {
      yield store.waitPrompt(state, () => next());
    }
    let wantToUse: boolean | undefined = undefined;
    yield store.prompt(state, new ConfirmPrompt(
      player.id,
      GameMessage.WANT_TO_USE_ABILITY
    ), result => {
      wantToUse = result;
      next();
    });

    if (wantToUse) {
      // If barrage is from a power, prompt for attack choice
      if (!attack.barrage && hasBarragePower) {
        // Gather all attackable cards: the actual Pokemon and any attached tool with attacks
        const attackableCards: Card[] = [];
        const mainPokemon = attackingPokemon.getPokemonCard();
        if (mainPokemon) {
          attackableCards.push(mainPokemon);
        }
        if (attackingPokemon.tools.length > 0) {
          attackableCards.push(attackingPokemon.tools[0]);
        }
        yield store.prompt(state, new ChooseAttackPrompt(
          player.id,
          GameMessage.CHOOSE_ATTACK_TO_COPY,
          attackableCards,
          { allowCancel: false }
        ), (selectedAttack: Attack | null) => {
          if (selectedAttack) {
            const newEffect = new AttackEffect(player, opponent, selectedAttack);
            (newEffect as any)._barrageUsed = true;
            const generator = useAttack(() => generator.next(), store, state, newEffect);
            state = generator.next().value;
          } else {
            state = store.reduceEffect(state, new EndTurnEffect(player));
          }
          next();
        });
        return state;
      } else {
        // Default: use the same attack again
        const newEffect = new UseAttackEffect(player, attack);
        (newEffect as any)._barrageUsed = true;
        const generator = useAttack(() => generator.next(), store, state, newEffect);
        return generator.next().value;
      }
    }
    return store.reduceEffect(state, new EndTurnEffect(player));
  }

  // TA-519: the attack's Knock Outs (Prize cards, then the new Active) resolve BEFORE the turn ends. Rulebook, attack
  // steps: "Your attack is complete, so check to see if any Pokémon were Knocked Out by the attack", then Prizes and
  // the replacement, and only then "Your turn is over." EndTurnEffect is what every "at the end of your turn" effect
  // listens to (Great Tusk ex Quaking Demolition: "Once at the end of your turn (after your attack)"), and the KO
  // sweep used to run only inside its handler -- AFTER all of those cards had already acted. The sweep below is the
  // same `checkState` the EndTurnEffect handler runs; when that one gets there it finds nothing left to do.
  //
  // `onComplete` may fire synchronously (nothing to sweep) or later from a prompt callback; only the latter may
  // resume this generator. (A bare `waitPrompt` cannot be used: waitItems is a LIFO stack, so this generator's wait
  // would run before the sweep's own continuation after the first Prize prompt.)
  let swept = false;
  let suspended = false;
  state = checkState(store, state, () => {
    swept = true;
    if (suspended) {
      next();
    }
  });
  if (!swept) {
    suspended = true;
    yield state;
  }
  if (state.phase === GamePhase.FINISHED) {
    return state;
  }

  return store.reduceEffect(state, new EndTurnEffect(player));
}

/**
 * Probe ability/Poké-Power locks before the real PowerEffect runs.
 *
 * Locker cards (Mesprit, Hex Maniac, etc.) and ability owners both handle the same
 * PowerEffect in one propagateEffect pass. If the owner runs first, side effects
 * (draw, damage, markers) can apply before the locker throws — with no rollback.
 * This probe uses a distinct Power object so WAS_POWER_USED never matches, while
 * still carrying the real power's lock-relevant flags.
 */
function assertActivatedPowerNotLocked(
  store: StoreLike,
  state: State,
  player: Player,
  card: PokemonCard,
  power: Power,
): void {
  try {
    store.reduceEffect(
      state,
      new PowerEffect(
        player,
        {
          name: 'test',
          powerType: power.powerType,
          text: '',
          exemptFromAbilityLock: power.exemptFromAbilityLock,
          exemptFromInitialize: power.exemptFromInitialize,
          knocksOutSelf: power.knocksOutSelf,
          useFromHand: power.useFromHand,
          useFromDiscard: power.useFromDiscard,
        },
        card,
      ),
    );
  } catch {
    throw new GameError(GameMessage.CANNOT_USE_POWER);
  }
}

function* usePower(next: Function, store: StoreLike, state: State, effect: UsePowerEffect): IterableIterator<State> {
  const player = effect.player;
  const power = effect.power;
  const card = effect.card;

  // G-59: an imported (wire-ingested) once-per-turn label is enforced here, so a state round-tripped
  // through the conformance adapter cannot re-fire an Ability the export said had already fired. The
  // engine's own per-card markers stay the enforcement for a use made in THIS process; this list only
  // carries what the wire brought in (PokemonCardList.abilitiesUsedThisTurn), cleared at the turn end.
  const usedList = StateUtils.findCardList(state, card);
  if (usedList instanceof PokemonCardList && usedList.abilitiesUsedThisTurn.includes(power.name)) {
    throw new GameError(GameMessage.POWER_ALREADY_USED);
  }
  // TA-452: `BoardEffect.ABILITY_USED` — the flag ABILITY_USED(player, card) sets when a once-per-turn
  // Ability is used (cleared at EndTurnEffect and on evolution) — was honoured only by the MENUS
  // (the client's and the conformance adapter's abilityMenu), never by the reducer. A card whose only
  // once-per-turn state is this flag (Pidove tef-133 Emergency Evolution; 168 such cards outside the
  // pool) accepted a second use in the same turn from any caller that bypasses the menu — the
  // conformance driver does, so the wire let the Ability fire twice. The flag means exactly "an Ability
  // on this Pokémon has been used this turn" (the menu's reading), so refuse here, before the card's
  // own preconditions, with the message every marker-keeping card uses. No in-pool card carries two
  // activated Abilities (census 2026-09-19), so the slot-level flag cannot block a sibling Ability.
  if (usedList instanceof PokemonCardList && usedList.boardEffect.includes(BoardEffect.ABILITY_USED)) {
    throw new GameError(GameMessage.POWER_ALREADY_USED);
  }

  // Reject locked powers before animation / owner side effects.
  assertActivatedPowerNotLocked(store, state, player, card, power);

  store.log(state, GameLog.LOG_PLAYER_USES_ABILITY, { name: player.name, ability: power.name });

  const targetSlot = effect.target.slot;
  if (targetSlot === SlotType.ACTIVE || targetSlot === SlotType.BENCH) {
    const slot = targetSlot === SlotType.ACTIVE ? 'active' : 'bench';
    const index = targetSlot === SlotType.BENCH ? effect.target.index : 0;
    emitAbilityAnimationEvent(store, player, card, slot, index, power.name);
    yield store.prompt(state, new WaitPrompt(player.id, ABILITY_ANIMATION_WAIT_MS, 'Ability animation'), () => next());
    state = (store as StoreLike & { state: State }).state;
  }

  // Run after the board animation so ability prompts are not shown on top of the overlay.
  // Validation errors (e.g. POWER_ALREADY_USED) are raised here; store.reducePrompt cleans up
  // any open prompts when those errors propagate.
  const lastLogId = state.logs.length > 0 ? state.logs[state.logs.length - 1].id : 0;
  state = store.reduceEffect(state, new PowerEffect(player, power, card, effect.benchTarget));
  // TA-453 / B.57 (a): "Once during your turn" is used at the ANNOUNCEMENT. The card's PowerEffect has
  // returned without throwing — its preconditions passed and its body is either done or pending a
  // prompt — so the use is counted NOW, not when the pick callback runs (15 in-pool cards committed
  // there and read [] on the wire at their pick; a state exported at that pick re-offered the Ability
  // on re-import). One text-keyed line instead of 28 card edits: the flag is the same one the menus,
  // the TA-452 reducer check and the G-59 label derivation already read; cards that set it (or a
  // marker) themselves are unaffected (addBoardEffect dedups). Text-keyed like the TA-280 empty-deck
  // gate: powers without the once-per-turn wording (as often as you like) are not touched.
  // TA-718 / B.92: an Ability whose body ends the turn ("If you use this Ability, your turn ends": Dino Cry) has already
  // run the end-of-turn clear (EndTurnEffect logs LOG_PLAYER_ENDS_TURN first); the turn number advances only once its
  // prompt resolves. The use belonged to the turn that ended, so nothing is marked.
  const turnEnded = state.logs.some(l => l.id > lastLogId && l.message === GameLog.LOG_PLAYER_ENDS_TURN);
  if (/once during your turn/i.test(power.text ?? '') && !turnEnded) {
    const slot = StateUtils.findCardList(state, card);
    if (slot instanceof PokemonCardList) {
      slot.addBoardEffect(BoardEffect.ABILITY_USED);
      // TA-460 / B.58: the use is remembered BY NAME on the in-play Pokémon and survives evolution and
      // devolution (#798 — the evolved Pokémon "still remembers that it has already used up its
      // once-per-turn Ability"). The slot flag is coarse (cleared on evolution so the evolved form's
      // own Ability stays usable); this list is what refuses the same Ability after a same-turn
      // devolve and what the wire label reads (abilitiesUsedLabels). Cleared at the turn end.
      if (!slot.abilitiesUsedThisTurn.includes(power.name)) {
        slot.abilitiesUsedThisTurn.push(power.name);
      }
    }
  }
  return state;
}

export function gameReducer(store: StoreLike, state: State, effect: Effect): State {

  if (effect instanceof KnockOutEffect) {
    const card = effect.target.getPokemonCard();
    if (card !== undefined) {

      // Pokemon ex rule
      if (card.tags.includes(CardTag.POKEMON_EX) || card.tags.includes(CardTag.POKEMON_V) || card.tags.includes(CardTag.POKEMON_VSTAR) || card.tags.includes(CardTag.POKEMON_ex) || card.tags.includes(CardTag.POKEMON_GX)) {
        effect.prizeCount += 1;
      }
      if (card.tags.includes(CardTag.POKEMON_SV_MEGA) || card.tags.includes(CardTag.TAG_TEAM) || card.tags.includes(CardTag.DUAL_LEGEND)) {
        effect.prizeCount += 1;
      }

      if (card.tags.includes(CardTag.POKEMON_VMAX) || card.tags.includes(CardTag.POKEMON_VUNION)) {
        effect.prizeCount += 2;
      }

      // Attack-armed prize denial / extra prizes (slot fields)
      if (effect.target.denyPrizesIfKnockedOutNextTurn
        && !effect.target.denyPrizesIfKnockedOutNextTurnPending) {
        effect.prizeCount = 0;
      } else if (
        effect.target.extraPrizesIfKnockedOutNextTurn > 0
        && !effect.target.extraPrizesIfKnockedOutNextTurnPending
        && state.phase === GamePhase.ATTACK
        && effect.prizeCount > 0
      ) {
        effect.prizeCount += effect.target.extraPrizesIfKnockedOutNextTurn;
      }

      // Little Grudge: Mist-blockable DiscardCardsEffect attributed to the arming attack
      if (effect.target.discardAttackerEnergyIfKnockedOutNextTurn
        && !effect.target.discardAttackerEnergyIfKnockedOutNextTurnPending
        && effect.player.marker.hasMarker(effect.player.DAMAGE_DEALT_MARKER)
        && effect.target.discardAttackerEnergyIfKnockedOutNextTurnAttack
        && effect.target.discardAttackerEnergyIfKnockedOutNextTurnSourceCard
        && effect.target.discardAttackerEnergyIfKnockedOutNextTurnAttackerId !== undefined) {
        const prizeTaker = StateUtils.getOpponent(state, effect.player);
        const attackerEnergy = prizeTaker.active.cards.filter(c => c.superType === SuperType.ENERGY);
        const grudgeAttack = effect.target.discardAttackerEnergyIfKnockedOutNextTurnAttack;
        const grudgeSourceCard = effect.target.discardAttackerEnergyIfKnockedOutNextTurnSourceCard;
        const grudgeAttackerId = effect.target.discardAttackerEnergyIfKnockedOutNextTurnAttackerId;

        const discardSelected = (cards: Card[]) => {
          if (cards.length === 0) {
            return;
          }
          const grudgeOwner = state.players.find(p => p.id === grudgeAttackerId);
          if (!grudgeOwner) {
            return;
          }
          let sourceList = grudgeOwner.active;
          grudgeOwner.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card) => {
            if (card === grudgeSourceCard) {
              sourceList = cardList;
            }
          });
          const base = new AttackEffect(grudgeOwner, prizeTaker, grudgeAttack);
          base.source = sourceList;
          const discard = new DiscardCardsEffect(base, cards);
          discard.target = prizeTaker.active;
          store.reduceEffect(state, discard);
        };

        if (attackerEnergy.length === 1) {
          discardSelected(attackerEnergy);
        } else if (attackerEnergy.length > 1) {
          state = store.prompt(state, new DiscardEnergyPrompt(
            effect.player.id,
            GameMessage.CHOOSE_ENERGIES_TO_DISCARD,
            PlayerType.TOP_PLAYER,
            [SlotType.ACTIVE],
            { superType: SuperType.ENERGY },
            { allowCancel: false, min: 1, max: 1 }
          ), transfers => {
            if (!transfers || transfers.length === 0) {
              return;
            }
            discardSelected(transfers.map(t => t.card));
          });
        }
      }

      // TA-264 / TA-495: `damage` = the Knocked Out Pokemon's damage at its Knock Out, so the conformance event
      // derivation can emit the lethal placement's `damaged` whatever wrote it (a card's raw counter placement, the
      // Confusion self-damage), not only the sources that log an amount.
      store.log(state, GameLog.LOG_POKEMON_KO, { name: card.name, damage: effect.target.damage });

      const knockedOutOwner = effect.player;
      const attacker = StateUtils.getOpponent(state, knockedOutOwner);
      const duringOpponentsTurn = [GamePhase.PLAYER_TURN, GamePhase.ATTACK].includes(state.phase)
        && state.players[state.activePlayer] === attacker;

      // TA-573: "Knocked Out by damage from an attack" is a fact about THIS Pokémon — it took the attack's damage this
      // turn — not the player-level "an attack did damage to one of your Pokémon" marker, which paired a counter-KO'd
      // Ethan's Pokémon with another Pokémon's damage KO.
      const byAttackDamage = state.phase === GamePhase.ATTACK
        && state.players[state.activePlayer] === attacker
        && effect.target.attackDamagedOnTurn === state.turn;
      if (duringOpponentsTurn) {
        knockedOutOwner.pokemonKnockedOutDuringOpponentsLastTurn = true;
        knockedOutOwner.pokemonKnockedOutLastTurnEntries.push({ tags: [...(card.tags || [])] as CardTag[], byAttackDamage });
      }

      if (byAttackDamage) {
        knockedOutOwner.pokemonKnockedOutByAttackDuringOpponentsLastTurn = true;
      }

      // Handle Lost City marker or PRISM_STAR cards
      if (effect.target.marker.hasMarker('LOST_CITY_MARKER') || card.tags.includes(CardTag.PRISM_STAR)) {
        const lostZoned = new CardList();
        const attachedCards = new CardList();

        // Clear damage and effects before splitting cards
        effect.target.damage = 0;
        effect.target.clearEffects();

        // Splice in reverse so indices remain valid; do NOT pre-move tools/energies
        // or effect.target.cards shrinks and later splice(indices[i], 1) can be out of bounds
        while (effect.target.cards.length > 0) {
          const removedCard = effect.target.cards.splice(effect.target.cards.length - 1, 1)[0];

          // Handle cardlist cards (energy, tools, etc.)
          if (removedCard.cards) {
            const cards = removedCard.cards;
            while (cards.cards.length > 0) {
              const card = cards.cards[0];
              attachedCards.cards.push(card);
              cards.cards.splice(0, 1);
            }
          }

          // Handle the main card
          if (removedCard.superType === SuperType.POKEMON || removedCard.tags.includes(CardTag.PRISM_STAR)) {
            lostZoned.cards.push(removedCard);
          } else {
            attachedCards.cards.push(removedCard);
          }
        }

        // Clear refs so the slot is fully emptied
        effect.target.tools = [];
        effect.target.energies.cards = [];

        // Move attached cards to discard
        if (attachedCards.cards.length > 0) {
          state = MOVE_CARDS(store, state, attachedCards, effect.player.discard);
        }

        // Move Pokémon to lost zone
        if (lostZoned.cards.length > 0) {
          state = MOVE_CARDS(store, state, lostZoned, effect.player.lostzone);
        }
      } else {
        // Default behavior - move to discard
        const tools = [...effect.target.tools];
        // Move tools to discard BEFORE clearing effects (directly)
        for (const tool of tools) {
          effect.target.moveCardTo(tool, effect.player.discard);
        }
        effect.target.clearEffects();
        state = MOVE_CARDS(store, state, effect.target, effect.player.discard);
      }

      // A KO dispatched directly by a card effect bypasses the checkState sweep's
      // prize accounting (findKoPokemons no longer sees the discarded target) —
      // record the owed prize so the next sweep awards it (compendium #2026:
      // prizes are taken before the replacement Active is chosen).
      if (!effect.viaCheckState && effect.preventDefault === false) {
        const playerNum = state.players.findIndex(p => p.id === effect.player.id);
        if (playerNum !== -1) {
          state.pendingDirectKoPrizes.push({ playerNum, count: effect.prizeCount });
        }
      }
    }
  }

  if (effect instanceof CheckPokemonStatsEffect) {
    if (effect.target.noWeaknessNextTurn) {
      effect.weakness = [];
    } else if (effect.target.weaknessOverrideType !== undefined) {
      effect.weakness = [{ type: effect.target.weaknessOverrideType }];
    } else {
      applyWhileInPlayOpponentWeakness(store, state, effect);
    }
    return state;
  }

  if (effect instanceof ApplyWeaknessEffect) {
    const checkPokemonType = new CheckPokemonTypeEffect(effect.source);
    state = store.reduceEffect(state, checkPokemonType);
    const checkPokemonStats = new CheckPokemonStatsEffect(effect.target);
    state = store.reduceEffect(state, checkPokemonStats);

    const cardTypes = checkPokemonType.cardTypes;
    const weakness = effect.ignoreWeakness ? [] : checkPokemonStats.weakness;
    const resistance = effect.ignoreResistance ? [] : checkPokemonStats.resistance;
    effect.damage = applyWeaknessAndResistance(effect.damage, cardTypes, weakness, resistance);
    return state;
  }

  if (effect instanceof UseAttackEffect) {
    const generator = useAttack(() => generator.next(), store, state, effect);
    return generator.next().value;
  }

  if (effect instanceof UsePowerEffect) {
    const generator = usePower(() => generator.next(), store, state, effect);
    return generator.next().value;
  }

  if (effect instanceof UseTrainerPowerEffect) {
    const player = effect.player;
    const power = effect.power;
    const card = effect.card;

    store.log(state, GameLog.LOG_PLAYER_USES_ABILITY, { name: player.name, ability: power.name });
    state = store.reduceEffect(state, new TrainerPowerEffect(player, power, card));
    return state;
  }

  if (effect instanceof AddSpecialConditionsPowerEffect) {
    const target = effect.target;
    effect.specialConditions.forEach(sp => {
      target.addSpecialCondition(sp);
    });
    if (effect.poisonDamage !== undefined) {
      target.poisonDamage = effect.poisonDamage;
    }
    if (effect.burnDamage !== undefined) {
      target.burnDamage = effect.burnDamage;
    }
    if (effect.confusionDamage !== undefined) {
      target.confusionDamage = effect.confusionDamage;
    }
    if (effect.sleepFlips !== undefined) {
      target.sleepFlips = effect.sleepFlips;
    }
    return state;
  }

  if (effect instanceof UseStadiumEffect) {
    if (state.players.some(p => p.stadiumAndToolHaveNoEffectTurnsRemaining > 0)) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    const player = effect.player;
    store.log(state, GameLog.LOG_PLAYER_USES_STADIUM, { name: player.name, stadium: effect.stadium.name });
    player.stadiumUsedTurn = state.turn;
  }

  // if (effect instanceof TrainerEffect && effect.trainerCard.trainerType === TrainerType.SUPPORTER) {
  //   const player = effect.player;
  //   store.log(state, GameLog.LOG_PLAYER_PLAYS_SUPPORTER, { name: player.name, stadium: effect.trainerCard.name });
  // }

  if (effect instanceof HealEffect) {
    if (effect.preventDefault || effect.target.cannotBeHealedNextTurn) {
      effect.preventDefault = true;
      return state;
    }
    if (effect.damage > 0 && effect.target.damage > 0) {
      effect.target.healedThisTurn = true;
    }
    effect.target.damage = Math.max(0, effect.target.damage - effect.damage);
    return state;
  }

  if (effect instanceof PutDamageCountersEffect) {
    // First process the EffectOfAbilityEffect
    state = store.reduceEffect(state, effect.effectOfAbility);

    // Then apply the damage if the effect wasn't prevented
    if (effect.effectOfAbility.target) {
      const damage = Math.max(0, effect.damage);
      effect.effectOfAbility.target.damage += damage;

      if (damage > 0) {
        const targetCard = effect.effectOfAbility.target.getPokemonCard();
        if (targetCard) {
          store.log(state, GameLog.LOG_PLAYER_PLACES_DAMAGE_COUNTERS, {
            name: effect.player.name,
            damage: damage,
            target: targetCard.name,
            effect: effect.power.name,
          });
        }
      }
    }
    return state;
  }

  if (effect instanceof PlaceDamageCountersEffect) {
    if (effect.preventDefault) {
      return state;
    }

    const target = effect.target;
    const targetCard = target.getPokemonCard();
    if (targetCard === undefined) {
      throw new GameError(GameMessage.ILLEGAL_ACTION);
    }

    const damage = Math.max(0, effect.damage);
    target.damage += damage;

    if (damage > 0) {
      const effectName = effect.source ? effect.source.name : '';
      store.log(state, GameLog.LOG_PLAYER_PLACES_DAMAGE_COUNTERS, {
        name: effect.player.name,
        damage: damage,
        target: targetCard.name,
        effect: effectName,
      });

      // Track damage dealt if source is provided
      if (effect.source) {
        const sourceCardList = StateUtils.findPokemonSlot(state, effect.source);
        if (sourceCardList) {
          GameStatsTracker.trackDamageDealt(effect.player, sourceCardList, damage);
        }
      }
    }
    return state;
  }

  if (effect instanceof EvolveEffect) {
    if (effect.player.cannotPlayPokemonCards) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    if (effect.player.cannotEvolvePokemonCards) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    if (effect.target.cannotEvolveNextTurn) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    if (effect.player.cannotPlayPokemonWithAbilities
      && effect.pokemonCard.powers.some(power => power.powerType === PowerType.ABILITY)) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    const pokemonCard = effect.target.getPokemonCard();

    if (pokemonCard === undefined) {
      throw new GameError(GameMessage.INVALID_TARGET);
    }

    // Track Pokemon evolution for damage continuity
    GameStatsTracker.handlePokemonEvolution(
      effect.player,
      effect.target,
      pokemonCard,
      effect.pokemonCard
    );

    store.log(state, GameLog.LOG_PLAYER_EVOLVES_POKEMON, {
      name: effect.player.name,
      pokemon: pokemonCard.name,
      card: effect.pokemonCard.name
    });
    effect.player.hand.moveCardTo(effect.pokemonCard, effect.target);
    effect.target.pokemonPlayedTurn = state.turn;
    effect.target.marker.markers = [];

    // Evolving the Active Pokemon can bring a new ability lock online (e.g. Lazy).
    if (effect.player.active === effect.target) {
      effect.target.abilityLockActivationOrder = 0;
      STAMP_ABILITY_LOCK_ACTIVATION(state, effect.target, effect.pokemonCard);
    }

    APPLY_EVOLUTION_CLEANUP(store, state, effect);
  }

  if (effect instanceof MoveCardsEffect) {
    const source = effect.source;
    const destination = effect.destination;
    const isPartialMove = effect.cards !== undefined || effect.count !== undefined;

    // moveTo() does not move tools; attach them before a full-stack move.
    if (source instanceof PokemonCardList && !effect.skipCleanup && !isPartialMove) {
      const tools = [...source.tools];
      for (const tool of tools) {
        source.moveCardTo(tool, destination);
      }
    }

    // Helper to get owner of a CardList
    const getOwner = (cardList: CardList) => {
      try {
        return StateUtils.findOwner(state, cardList);
      } catch {
        return undefined;
      }
    };

    // Helper to check if a CardList is a player's discard
    const isDiscardPile = (cardList: CardList) => {
      const owner = getOwner(cardList);
      return owner && owner.discard === cardList;
    };

    // Move logic for Prism Star cards
    const moveWithPrismStarCheck = (cardsToMove: any[], src: CardList, dest: CardList) => {
      if (isDiscardPile(dest)) {
        const owner = getOwner(dest);
        const toLostZone = cardsToMove.filter(card => card.tags && card.tags.includes(CardTag.PRISM_STAR));
        const toDiscard = cardsToMove.filter(card => !(card.tags && card.tags.includes(CardTag.PRISM_STAR)));
        if (toLostZone.length > 0 && owner) {
          src.moveCardsTo(toLostZone, owner.lostzone);
        }
        if (toDiscard.length > 0) {
          src.moveCardsTo(toDiscard, dest);
        }
      } else {
        src.moveCardsTo(cardsToMove, dest);
      }
    };

    // moveCardsTo already appends the moved cards to the bottom of the destination,
    // so toBottom needs nothing further. For toTop, lift the moved cards to the front.
    const liftToTop = (moved: Card[]) => {
      const landed = moved.filter(card => destination.cards.includes(card));
      destination.cards = [...landed, ...destination.cards.filter(card => !landed.includes(card))];
      if (landed.length > 0 && destination.zoneTag === 'deck') { CardList.deckPut?.(destination, landed, 'top'); }   // TA-698 (conformance; inert)
    };
    // TA-704 (conformance; inert for gameplay): a card placed in a deck remembers the end the effect declared.
    const destinationOwner = getOwner(destination);
    const stampDeckEnd = (moved: Card[]) => {
      if (destinationOwner === undefined || destinationOwner.deck !== destination) {
        return;
      }
      for (const card of moved) {
        if (effect.toBottom) {
          CardList.deckEnd.set(card, 'bottom');
        } else if (effect.toTop) {
          CardList.deckEnd.set(card, 'top');
        } else {
          CardList.deckEnd.delete(card);
        }
      }
    };

    if (effect.cards) {
      moveWithPrismStarCheck(effect.cards, source, destination);
      if (effect.toTop) {
        liftToTop(effect.cards);
      }
      stampDeckEnd(effect.cards);
    }
    else if (effect.count !== undefined) {
      const cards = source.cards.slice(0, effect.count);
      moveWithPrismStarCheck(cards, source, destination);
      if (cards.length > 0) {
        CardList.topTake?.(source, destination, cards.length);   // TA-593 (conformance; inert for gameplay)
      }
      if (effect.toTop) {
        liftToTop(cards);
      }
      stampDeckEnd(cards);
    }
    // Move all cards
    else {
      // For move all, check for Prism Star cards
      if (isDiscardPile(destination)) {
        const owner = getOwner(destination);
        const toLostZone = source.cards.filter(card => card.tags && card.tags.includes(CardTag.PRISM_STAR));
        const toDiscard = source.cards.filter(card => !(card.tags && card.tags.includes(CardTag.PRISM_STAR)));
        if (toLostZone.length > 0 && owner) {
          source.moveCardsTo(toLostZone, owner.lostzone);
        }
        if (toDiscard.length > 0) {
          source.moveCardsTo(toDiscard, destination);
        }
      } else {
        if (effect.toTop) {
          source.moveToTopOfDestination(destination);
        } else {
          source.moveTo(destination);
        }
      }
    }

    // Salvage orphan attachments when no Pokemon remain in the slot.
    // Tools live in tools[] (not cards[]), so they must be moved explicitly
    // before resetEmptyPokemonSlot wipes the array.
    if (source instanceof PokemonCardList && source.getPokemons().length === 0) {
      const player = StateUtils.findOwner(state, source);

      // Remaining cards/energies → discard (Prism Star → lost zone)
      if (source.cards.length > 0) {
        const toLostZone = source.cards.filter(card => card.tags && card.tags.includes(CardTag.PRISM_STAR));
        const toDiscard = source.cards.filter(card => !(card.tags && card.tags.includes(CardTag.PRISM_STAR)));
        if (toLostZone.length > 0) {
          source.moveCardsTo(toLostZone, player.lostzone);
        }
        if (toDiscard.length > 0) {
          source.moveCardsTo(toDiscard, player.discard);
        }
      }
      if (source.energies && source.energies.cards.length > 0) {
        source.energies.cards = [];
      }

      // Remaining tools → discard (Prism Star → lost zone)
      for (const tool of [...source.tools]) {
        if (tool.tags && tool.tags.includes(CardTag.PRISM_STAR)) {
          source.moveCardTo(tool, player.lostzone);
        } else {
          source.moveCardTo(tool, player.discard);
        }
      }
    }

    // In-play state (damage, special conditions, etc.) lives on the slot, not on cards.
    // Reset whenever a slot is vacated — including after partial card moves.
    if (source instanceof PokemonCardList && !effect.skipCleanup && source.getPokemons().length === 0) {
      resetEmptyPokemonSlot(source);
    }

    return state;
  }

  if (effect instanceof CoinFlipSequenceEffect) {
    return RUN_COIN_FLIP_SEQUENCE(store, state, effect);
  }

  if (effect instanceof CoinFlipEffect) {
    return RESOLVE_COIN_FLIP_EFFECT(store, state, effect);
  }

  return state;
}

function applyWhileInPlayOpponentWeakness(
  store: StoreLike,
  state: State,
  effect: CheckPokemonStatsEffect,
): void {
  const owner = StateUtils.findOwner(state, effect.target);
  const opponent = StateUtils.getOpponent(state, owner);
  let source: PokemonCard | undefined;
  opponent.forEachPokemon(PlayerType.TOP_PLAYER, (_cardList, card) => {
    if (card.whileInPlayOpponentWeakness !== undefined) {
      source = card;
    }
  });
  if (!source || source.whileInPlayOpponentWeakness === undefined) {
    return;
  }
  if (IS_ABILITY_BLOCKED(store, state, opponent, source)) {
    return;
  }
  const canApply = new EffectOfAbilityEffect(
    opponent,
    OPPONENT_WEAKNESS_AURA_POWER(source.whileInPlayOpponentWeakness),
    source,
    effect.target,
  );
  store.reduceEffect(state, canApply);
  if (canApply.target) {
    effect.weakness = [{ type: source.whileInPlayOpponentWeakness }];
  }
}

/**
 * TA-620: what evolving does to the evolved Pokemon, applied at the EvolveEffect choke point so EVERY evolution gets
 * it, not only the drag-from-hand path. Rare Candy svi-191 (and every card that dispatches an EvolveEffect itself)
 * used to skip it, so the Stage 2 stayed Asleep. Compendium #1132: "This counts as evolving that Pokémon" means it
 * "counts towards the one evolution per turn for that Pokémon ... and removes Special Conditions on that Pokémon";
 * #287: the phrase "refers to evolution rules that remove Special Conditions on that Pokémon".
 *
 * This is the block that play-pokemon-effect.ts ran after its own EvolveEffect, moved here verbatim and in the same
 * order (it now runs inside the reduce, after the card moves and the ability-lock stamp, exactly where drag-evolve ran
 * it); drag-evolve no longer runs it, so nothing is applied twice. Damage counters stay. Conditions a card preserves
 * through evolution (CheckSpecialConditionRemovalEffect: Full Flame, Muk, Sea of Nothingness) are honoured on every
 * path.
 */
function APPLY_EVOLUTION_CLEANUP(store: StoreLike, state: State, effect: EvolveEffect): void {
  const evolved = effect.pokemonCard;
  evolved.cannotUseAttackUntilLeavesPlay = undefined;
  evolved.whileInPlayOpponentWeakness = undefined;
  evolved.marker.markers = [];

  const checkRemovalEffect = new CheckSpecialConditionRemovalEffect(effect.player, effect.target);
  store.reduceEffect(state, checkRemovalEffect);
  effect.target._preservedConditionsDuringEvolution = checkRemovalEffect.preservedConditions;
  effect.player.removePokemonEffects(effect.target);
  effect.target._preservedConditionsDuringEvolution = undefined;

  effect.target.marker.markers = [];
  effect.target.showBasicAnimation = false;
  effect.target.triggerEvolutionAnimation = true;
  if (effect.target.boardEffect.includes(BoardEffect.ABILITY_USED)) {
    effect.target.removeBoardEffect(BoardEffect.ABILITY_USED);
  }
}
