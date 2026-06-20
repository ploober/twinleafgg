import { Card } from '../game/store/card/card';
import { State } from '../game/store/state/state';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { StateUtils } from '../game/store/state-utils';
import { PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import { IidContext } from './state-adapter';
import { NeutralPlayerId } from './neutral-types';

/**
 * Shared resolution between iids, twinleaf CardTargets, and neutral player ids — used by the prompt
 * decomposers and the driver's pick mapper. A CardTarget's `player` field is RELATIVE to the
 * prompt's player (BOTTOM = that player, TOP = the opponent); these helpers honor that.
 */

export interface PokemonSlot {
  owner: Player;
  list: PokemonCardList;
  slot: SlotType;
  index: number;
}

/** Find which in-play Pokemon slot (either player's active/bench) holds `card`, or undefined. */
export function findPokemonSlot(state: State, card: Card): PokemonSlot | undefined {
  for (const owner of state.players) {
    if (owner.active.cards.includes(card)) {
      return { owner, list: owner.active, slot: SlotType.ACTIVE, index: 0 };
    }
    for (let i = 0; i < owner.bench.length; i++) {
      if (owner.bench[i].cards.includes(card)) {
        return { owner, list: owner.bench[i], slot: SlotType.BENCH, index: i };
      }
    }
  }
  return undefined;
}

/**
 * A CardTarget for the in-play Pokemon holding `stackCard`, expressed RELATIVE to `promptPlayer`
 * (so it round-trips through prompt.decode / StateUtils.getTarget). Throws if the card isn't in play.
 */
export function resolveAnyPokemonTarget(state: State, promptPlayer: Player, stackCard: Card): CardTarget {
  const found = findPokemonSlot(state, stackCard);
  if (found === undefined) {
    throw new Error('[conformance] pick target is not an in-play Pokemon');
  }
  const player = found.owner === promptPlayer ? PlayerType.BOTTOM_PLAYER : PlayerType.TOP_PLAYER;
  return { player, slot: found.slot, index: found.index };
}

/** The iid identifying the Pokemon-in-play at `target` (its bottom/basic card's iid). */
export function pokemonTargetToIid(state: State, promptPlayer: Player, ctx: IidContext, target: CardTarget): string {
  const list = StateUtils.getTarget(state, promptPlayer, target);
  const basic = list.getPokemons()[0];
  const iid = basic && ctx.cardToIid.get(basic);
  if (iid === undefined) {
    throw new Error('[conformance] no iid for Pokemon-in-play at target');
  }
  return iid;
}

/** Map a twinleaf prompt.playerId to the neutral actor id. */
export function playerIdToActor(state: State, playerId: number): NeutralPlayerId {
  const index = state.players.findIndex(p => p.id === playerId);
  return index === 0 ? 'A' : 'B';
}

/** The prompt's Player object, by playerId. */
export function promptPlayer(state: State, playerId: number): Player {
  const player = state.players.find(p => p.id === playerId);
  if (player === undefined) {
    throw new Error(`[conformance] prompt playerId ${playerId} not found`);
  }
  return player;
}
