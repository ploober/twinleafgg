import { Card } from '../game/store/card/card';
import { Player } from '../game/store/state/player';
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import { ImportedGame, IidContext, projectState, actorIndex } from './state-adapter';
import { NeutralState, NeutralAction, AttachEnergyAction } from './neutral-types';

/**
 * M0 driver slice.
 *
 * The full driver (impl doc §4.1) is a replay loop: import -> for each action either dispatch a
 * top-level action, feed a prompt decomposer, or answer a `system` decision -> project. M0
 * implements only the no-prompt portion: import, dispatch top-level actions that raise no prompt
 * (here: `attachEnergy`), and project. Prompt decomposition (M2), the `system` actor (M3), turn
 * boundaries (M4), legalActions (M5) and the HTTP layer (M6) are out of scope.
 */

function lookupCard(ctx: IidContext, iid: string, role: string): Card {
  const card = ctx.iidToCard.get(iid);
  if (card === undefined) {
    throw new Error(`[conformance] ${role} iid "${iid}" not found in this game`);
  }
  return card;
}

/** Find the CardTarget for a Pokemon-in-play the acting player owns, identified by any card in its stack. */
function resolveOwnPokemonTarget(player: Player, stackCard: Card): CardTarget {
  if (player.active.cards.includes(stackCard)) {
    return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  }
  for (let i = 0; i < player.bench.length; i++) {
    if (player.bench[i].cards.includes(stackCard)) {
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: i };
    }
  }
  throw new Error('[conformance] attachEnergy target is not a Pokemon in the acting player\'s play area');
}

function dispatchAttachEnergy(game: ImportedGame, action: AttachEnergyAction): void {
  const player = game.state.players[actorIndex(action.actor)];

  const energyCard = lookupCard(game.ctx, action.card, 'attachEnergy.card');
  const handIndex = player.hand.cards.indexOf(energyCard);
  if (handIndex === -1) {
    throw new Error(`[conformance] attachEnergy.card "${action.card}" is not in ${action.actor}'s hand`);
  }

  const targetCard = lookupCard(game.ctx, action.target, 'attachEnergy.target');
  const target = resolveOwnPokemonTarget(player, targetCard);

  game.store.dispatch(new PlayCardAction(player.id, handIndex, target));
}

/** Map and dispatch a single neutral action. M0 supports `attachEnergy` only. */
export function dispatchAction(game: ImportedGame, action: NeutralAction): void {
  switch (action.type) {
    case 'attachEnergy':
      dispatchAttachEnergy(game, action as AttachEnergyAction);
      return;
    default:
      throw new Error(`[conformance] action "${action.type}" not implemented in M0`);
  }
}

/** Replay no-prompt actions in order. Throws if the engine blocks on a prompt (M0 can't answer). */
export function applyActions(game: ImportedGame, actions: NeutralAction[]): void {
  for (const action of actions) {
    if (game.handler.isBlocked()) {
      throw new Error('[conformance] M0 driver reached a pending prompt it cannot answer (needs M2+)');
    }
    dispatchAction(game, action);
  }
}

/** Project the current twinleaf state of an imported game to the neutral observable schema. */
export function projectGame(game: ImportedGame): NeutralState {
  return projectState(game.state, game.ctx);
}
