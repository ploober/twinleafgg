import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';

/**
 * Resolves a Rotomancer IR **v2** selector to concrete Twinleaf targets.
 *
 * v2 replaced the 15 flat selector strings (`opponentActive`, `eachOwnBench`, …) with a
 * compositional object on two axes:
 *   - spatial:   { side: self|opponent|both, spot: active|bench|anywhere, quantity?: one|each|all }
 *   - relational:{ role: self|defending|attacking|eventSubject, bind?: now|atInstall }
 * plus an optional `chooser` (player choice) and `where` (predicate filter, applied by the caller).
 *
 * Only the deterministic shapes are resolved here. A `quantity: "one"` or a `chooser` means a
 * player picks a single Pokémon — non-deterministic in a differential, so it throws (the card is
 * then skipped, exactly as the v1 `anyOpponentPokemon`/single-bench selectors did).
 */

export interface Target { player: Player; list: PokemonCardList; }

export function benched(p: Player): Target[] {
  return p.bench.filter(b => b.getPokemonCard() !== undefined).map(list => ({ player: p, list }));
}

export interface V2Selector {
  side?: string;      // self | opponent | both
  spot?: string;      // active | bench | anywhere
  role?: string;      // self | attacking | defending | eventSubject
  quantity?: string;  // one | each | all
  chooser?: string;   // player | opponent | auto  → a choice, unsupported
  bind?: string;      // now | atInstall (snapshot timing — inert for our purposes)
}

function sideOf(effect: AttackEffect, side?: string): Player[] {
  switch (side) {
    case 'self': return [effect.player];
    case 'opponent': return [effect.opponent];
    case 'both': return [effect.player, effect.opponent];
    default: throw new Error(`[ir-selectors] unsupported side "${side}"`);
  }
}

export function resolveV2Selector(effect: AttackEffect, sel?: V2Selector): Target[] {
  if (!sel) {
    // bare/absent selector → the attacker's own active (the op's implicit source)
    return [{ player: effect.player, list: effect.player.active }];
  }

  // Relational selectors (role). `bind: atInstall` (defendingPokemonAtTriggerTime) is the same
  // Pokémon in a single-turn differential, so the snapshot timing is inert.
  if (sel.role !== undefined) {
    switch (sel.role) {
      case 'self':
      case 'attacking': return [{ player: effect.player, list: effect.player.active }];
      case 'defending': return [{ player: effect.opponent, list: effect.opponent.active }];
      default: throw new Error(`[ir-selectors] unsupported role "${sel.role}"`);
    }
  }

  // Spatial selectors (side × spot × quantity). A single-pick (`quantity: one`) or any explicit
  // chooser is a player choice — unsupported (skip rather than guess a target).
  if (sel.chooser !== undefined || sel.quantity === 'one') {
    throw new Error(`[ir-selectors] player-choice selector (chooser/quantity:one) not supported`);
  }
  const players = sideOf(effect, sel.side);
  const out: Target[] = [];
  for (const p of players) {
    switch (sel.spot) {
      case 'active': out.push({ player: p, list: p.active }); break;
      case 'bench': out.push(...benched(p)); break;
      case 'anywhere': out.push({ player: p, list: p.active }, ...benched(p)); break;
      default: throw new Error(`[ir-selectors] unsupported spot "${sel.spot}"`);
    }
  }
  return out;
}

/** Resolve a selector that is expected to denote a single Pokémon list (predicate subjects). */
export function resolveV2Single(effect: AttackEffect, sel?: V2Selector): PokemonCardList {
  const targets = resolveV2Selector(effect, sel);
  return targets[0].list;
}
