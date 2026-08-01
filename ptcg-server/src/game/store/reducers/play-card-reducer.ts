import { Action } from '../actions/action';
import {
  AttachEnergyEffect, PlayPokemonEffect, PlayStadiumEffect,
  PlaySupporterEffect, AttachPokemonToolEffect, PlayItemEffect
} from '../effects/play-card-effects';
import { EnergyCard } from '../card/energy-card';
import { GameError } from '../../game-error';
import { GameMessage } from '../../game-message';
import { PlayCardAction, CardTarget, PlayerType, SlotType } from '../actions/play-card-action';
import { PokemonCard } from '../card/pokemon-card';
import { PokemonCardList } from '../state/pokemon-card-list';
import { State, GamePhase } from '../state/state';
import { StoreLike } from '../store-like';
import { TrainerCard } from '../card/trainer-card';
import { TrainerType, CardTag } from '../card/card-types';
import { assembleDualStadiumFromHand } from '../dual-stadium-utils';
import { assembleDualLegendFromHand } from '../dual-legend-utils';
import { Effect } from '../effects/effect';
import { StateUtils } from '../state-utils';
import { Player } from '../state/player';
import { UsePowerEffect } from '../effects/game-effects';
import { CAN_USE_FROM_HAND_TO_BENCH_POWER } from '../prefabs/prefabs';

function findPokemonTarget(state: State, player: Player, target: CardTarget): PokemonCardList | undefined {
  try {
    return StateUtils.getTarget(state, player, target);
  } catch {
    return undefined;
  }
}

export function playCardReducer(store: StoreLike, state: State, action: Action): State {
  const player = state.players[state.activePlayer];

  if (state.phase === GamePhase.PLAYER_TURN) {

    if (action instanceof PlayCardAction) {
      if (player === undefined || player.id !== action.id) {
        throw new GameError(GameMessage.NOT_YOUR_TURN);
      }

      const handCard = player.hand.cards[action.handIndex];

      if (handCard === undefined) {
        throw new GameError(GameMessage.UNKNOWN_CARD);
      }

      if (handCard instanceof EnergyCard) {
        const target = findPokemonTarget(state, player, action.target);
        if (!(target instanceof PokemonCardList) || target.cards.length === 0) {
          throw new GameError(GameMessage.INVALID_TARGET);
        }

        if (player.usedDragonsWish === true || state.rules.unlimitedEnergyAttachments === true) {
          // Allow multiple energy attachments per turn
          const effect = new AttachEnergyEffect(player, handCard, target);
          return store.reduceEffect(state, effect);
        } else {

          if (player.energyPlayedTurn === state.turn) {
            throw new GameError(GameMessage.ENERGY_ALREADY_ATTACHED);
          }
          player.energyPlayedTurn = state.turn;

          const effect = new AttachEnergyEffect(player, handCard, target);
          return store.reduceEffect(state, effect);
        }
      }

      if (handCard instanceof PokemonCard) {
        const target = findPokemonTarget(state, player, action.target);
        if (!(target instanceof PokemonCardList)) {
          throw new GameError(GameMessage.INVALID_TARGET);
        }

        const benchPower = handCard.powers?.find(p => p.useFromHandToBench === true);
        if (
          benchPower &&
          action.target.slot === SlotType.BENCH &&
          target.cards.length === 0 &&
          CAN_USE_FROM_HAND_TO_BENCH_POWER(store, state, player, handCard)
        ) {
          // Only the ability path when still legal — hand ability locks clear this
          // (same gate as playableCardIds). Otherwise fall through (e.g. sandbox all-basic).
          const usePower = new UsePowerEffect(
            player,
            benchPower,
            handCard,
            { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.HAND, index: action.handIndex },
            target,
          );
          return store.reduceEffect(state, usePower);
        }

        if (handCard.tags.includes(CardTag.DUAL_LEGEND)) {
          if (action.target.slot !== SlotType.BENCH || target.cards.length > 0) {
            throw new GameError(GameMessage.INVALID_TARGET);
          }
          return assembleDualLegendFromHand(store, state, player, handCard);
        }

        const effect = new PlayPokemonEffect(player, handCard, target, action.target.slot, action.target.index);
        return store.reduceEffect(state, effect);
      }

      if (handCard instanceof TrainerCard) {
        // TA-177: a Trainer's own no-effect gate has to be enforced HERE, on the play path, or it is
        // not a rule at all — it is a hint. `canPlay` is implemented by ~200 cards, and until now its
        // only two consumers were `Store.calculatePlayability` (which fills `playableCardIds`, a UI
        // hint list) and the conformance harness's legal-action enumeration. Both merely decide what to
        // OFFER. Nothing consulted it when a play action was actually dispatched, so any client that
        // sent the action anyway got the play — the card left the hand, the Supporter slot was spent,
        // and the card did nothing.
        //
        // Surfer `ssp-187` is the measured case: *"Switch your Active Pokémon with 1 of your Benched
        // Pokémon. If you do, draw cards until you have 5 cards in your hand."* Its `canPlay` correctly
        // requires a non-empty Bench (TA-173) and both engines correctly omit it from the menu — yet
        // driving the play still burned the card and the Supporter slot on a guaranteed no-op, while
        // rotomancer answers `invalidAction`.
        //
        // Grounding is card-specific, not just the general principle. Compendium **#2067** (Surging
        // Sparks FAQ): *"If I have no Pokemon on my bench can I play Surfer? — No way, dude! You must
        // be able to switch a Pokemon from the Bench in order to play Surfer."* The general rule is
        // **#925**: *"you cannot play a card if it is obvious that you cannot do what the card is
        // supposed to do at that moment"*, with **#1004** distinguishing a cost from the effect.
        //
        // Scoped deliberately to an EXPLICIT `false`. `canPlay` is declared `boolean | undefined`, and
        // `undefined` means "this card has no opinion" — treating that as a refusal would turn every
        // card that returns nothing on some branch into an unplayable card.
        if (handCard.canPlay && handCard.canPlay(store, state, player) === false) {
          throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
        }
        const target = findPokemonTarget(state, player, action.target);
        let effect: Effect;
        switch (handCard.trainerType) {
          case TrainerType.SUPPORTER:
            if (state.turn === 1 && handCard.firstTurn !== true) {
              throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
            }
            if (player.supporter.cards.length > 0) {
              throw new GameError(GameMessage.SUPPORTER_ALREADY_PLAYED);
            }
            effect = new PlaySupporterEffect(player, handCard, target);
            break;
          case TrainerType.STADIUM: {
            if (handCard.tags.includes(CardTag.DUAL_STADIUM)) {
              return assembleDualStadiumFromHand(store, state, player, handCard);
            }
            const stadium = StateUtils.getStadiumCard(state);
            const isHyperrogueOverPrismTower = handCard.name === 'Hyperrogue Ange Floette' && stadium?.name === 'Prism Tower';
            if (player.stadiumPlayedTurn === state.turn && !isHyperrogueOverPrismTower) {
              throw new GameError(GameMessage.STADIUM_ALREADY_PLAYED);
            }
            if (stadium && stadium.name === handCard.name) {
              throw new GameError(GameMessage.SAME_STADIUM_ALREADY_IN_PLAY);
            }
            player.stadiumPlayedTurn = state.turn;
            effect = new PlayStadiumEffect(player, handCard);
            break;
          }
          case TrainerType.TOOL:
            if (!(target instanceof PokemonCardList)) {
              throw new GameError(GameMessage.INVALID_TARGET);
            }
            effect = new AttachPokemonToolEffect(player, handCard, target);
            break;
          default:
            effect = new PlayItemEffect(player, handCard, target);
            break;
        }
        return store.reduceEffect(state, effect);
      }
      player.hand.moveCardTo(handCard, player.supporter);
    }

  }

  return state;
}
