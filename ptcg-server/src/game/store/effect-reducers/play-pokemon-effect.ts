import { PlayPokemonEffect } from '../effects/play-card-effects';
import { GameError } from '../../game-error';
import { GameMessage, GameLog } from '../../game-message';
import { Effect } from '../effects/effect';
import { CardTag, Stage, SuperType } from '../card/card-types';
import { State } from '../state/state';
import { StoreLike } from '../store-like';
import { CheckPokemonPlayedTurnEffect } from '../effects/check-effects';
import { EvolveEffect } from '../effects/game-effects';
import { PowerType } from '../card/pokemon-types';

/**
 * Helper function to emit animation events
 * @param store - The store instance
 * @param eventName - The name of the animation event
 * @param data - The data to send with the event
 */
function emitAnimationEvent(store: StoreLike, eventName: string, data: {
  playerId: number;
  cardId: number | string;
  slot?: string;
  index?: number;
}): void {
  const game = (store as any).handler;
  if (game && game.core && typeof game.core.emit === 'function') {
    game.core.emit((c: any) => {
      if (typeof c.socket !== 'undefined') {
        c.socket.emit(`game[${game.id}]:${eventName}`, data);
      }
    });
  }
}

export function playPokemonReducer(store: StoreLike, state: State, effect: Effect): State {

  /* Play pokemon card */
  if (effect instanceof PlayPokemonEffect) {
    // TA-272 / B.37: the lock reads *"your opponent can't play any Pokemon that has an Ability FROM
    // THEIR HAND"*. A FOSSIL in hand is an ITEM, not a Pokemon — settled as B.37 — and it reaches this
    // reducer only because the Fossil's own `PlayItemEffect` handler raises a `PlayPokemonEffect` for
    // itself, casting `this as unknown as PokemonCard`. So the card being "played as a Pokemon" here
    // is a `TrainerCard`, and an Item ban is what should reach it (`cannotPlayItemCards` still does),
    // not a Pokemon ban.
    //
    // Keying on `superType` rather than on the Fossil tag or on a card list: the property that decides
    // the ruling is what the card IS IN HAND, and superType is that fact rather than a proxy for it.
    // Measured cast when filed: 6 in-pool Fossils x 1 lock. ⚠️ That is ONE lock measured six times,
    // not six independent tests — a second in-pool lock is still the first real test of this rule.
    const playedFromHandAsAPokemon = effect.pokemonCard.superType === SuperType.POKEMON;
    // upstream `cannotPlayPokemonCards` lock — scoped by the same B.37 reasoning as the ability lock
    // below: a Fossil played from hand is an Item, so a Pokemon ban must not reach it.
    if (effect.player.cannotPlayPokemonCards && playedFromHandAsAPokemon) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    if (effect.player.cannotPlayPokemonWithAbilities
      && playedFromHandAsAPokemon
      && effect.pokemonCard.powers.some(power => power.powerType === PowerType.ABILITY)) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }
    const stage = effect.pokemonCard.stage;
    const sandboxAllBasic = Boolean(state.gameSettings?.sandboxMode && state.gameSettings?.sandboxAllPokemonBasic);
    const isBasic = stage === Stage.BASIC || sandboxAllBasic;

    if (isBasic && effect.target.cards.length === 0) {
      clearUntilLeavesPlay(effect.pokemonCard);
      store.log(state, GameLog.LOG_PLAYER_PLAYS_BASIC_POKEMON, {
        name: effect.player.name,
        card: effect.pokemonCard.name
      });
      effect.player.hand.moveCardTo(effect.pokemonCard, effect.target);
      effect.target.pokemonPlayedTurn = state.turn;

      // Emit basic animation event
      emitAnimationEvent(store, 'playBasicAnimation', {
        playerId: effect.player.id,
        cardId: effect.pokemonCard.id,
        slot: effect.slot ? String(effect.slot) : undefined,
        index: effect.index
      });

      return state;
    }
    const player = effect.player;
    // Include LV_X / BREAK / VMAX / etc. — previously `|| Stage.STAGE_2` was always true
    // (missing `stage ===`), which accidentally allowed Level-Up; keep that behavior explicitly.
    const isEvolved =
      stage === Stage.STAGE_1 ||
      stage === Stage.STAGE_2 ||
      stage === Stage.VMAX ||
      stage === Stage.VSTAR ||
      stage === Stage.MEGA ||
      stage === Stage.BREAK ||
      stage === Stage.LV_X;
    const isLvX =
      stage === Stage.LV_X || effect.pokemonCard.hasTag(CardTag.POKEMON_LV_X);
    // Level-Up Rule: put LV.X only onto the Active Pokémon
    if (isLvX && effect.target !== player.active) {
      throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
    }
    const evolvesFrom = effect.pokemonCard.evolvesFrom;
    const pokemonCard = effect.target.getPokemonCard();
    if (pokemonCard === undefined) {
      throw new GameError(GameMessage.INVALID_TARGET);
    }

    // Check if evolution is valid using either evolvesFrom, evolvesTo, evolvesToStage, or evolvesFromBase
    const isValidEvolution = (isEvolved && pokemonCard.stage < stage && pokemonCard.name === evolvesFrom) ||
      (isEvolved && pokemonCard.evolvesTo.includes(effect.pokemonCard.name)) ||
      (isEvolved && pokemonCard.evolvesToStage.includes(effect.pokemonCard.stage)) ||
      (isEvolved && Array.isArray(pokemonCard.evolvesFromBase) && pokemonCard.evolvesFromBase.length > 0 && pokemonCard.evolvesFromBase.includes(effect.pokemonCard.evolvesFrom));

    if (isValidEvolution) {
      if (player.cannotEvolvePokemonCards || effect.target.cannotEvolveNextTurn) {
        throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
      }

      const playedTurnEffect = new CheckPokemonPlayedTurnEffect(effect.player, effect.target);
      store.reduceEffect(state, playedTurnEffect);

      if (state.turn == 0 && player.canEvolve === false) {
        throw new GameError(GameMessage.CANNOT_EVOLVE_ON_YOUR_FIRST_TURN);
      }

      if (state.turn == 1 && player.canEvolve === false) {
        throw new GameError(GameMessage.CANNOT_EVOLVE_ON_YOUR_FIRST_TURN);
      }
      if (state.turn == 2 && player.canEvolve === false) {
        throw new GameError(GameMessage.CANNOT_EVOLVE_ON_YOUR_FIRST_TURN);
      }

      if (playedTurnEffect.pokemonPlayedTurn >= state.turn && !effect.target.canEvolveThisTurn) {
        throw new GameError(GameMessage.POKEMON_CANT_EVOLVE_THIS_TURN);
      }

      // Preserve same-turn evolve (Forest of Vitality, etc.) across clearEffects so
      // playableCardIds still includes the next evolution (React gates on that list).
      const canEvolveThisTurn = effect.target.canEvolveThisTurn;

      const evolveEffect = new EvolveEffect(effect.player, effect.target, effect.pokemonCard);
      store.reduceEffect(state, evolveEffect);
      // TA-620: the evolve-time clean-up (untilLeavesPlay fields, markers, Special Conditions via
      // CheckSpecialConditionRemovalEffect + removePokemonEffects, animation flags, ABILITY_USED) now runs inside the
      // EvolveEffect reduce (game-effect.ts APPLY_EVOLUTION_CLEANUP), so Rare Candy and every direct EvolveEffect
      // site gets it too. It is not repeated here. (Upstream: restore the same-turn evolve flag that clean-up clears.)
      effect.target.canEvolveThisTurn = canEvolveThisTurn;

      // Emit evolution animation event
      emitAnimationEvent(store, 'evolution', {
        playerId: effect.player.id,
        cardId: effect.pokemonCard.id,
        slot: effect.slot ? String(effect.slot) : undefined,
        index: effect.index
      });

      return state;
    }

    throw new GameError(GameMessage.INVALID_TARGET);
  }

  return state;
}

function clearUntilLeavesPlay(card: { cannotUseAttackUntilLeavesPlay?: string; whileInPlayOpponentWeakness?: unknown }): void {
  card.cannotUseAttackUntilLeavesPlay = undefined;
  card.whileInPlayOpponentWeakness = undefined;
}
