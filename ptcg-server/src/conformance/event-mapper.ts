import { GameLog } from '../game/game-message';
import { StateLog } from '../game/store/state/state-log';
import { NeutralEvent, NeutralPlayerId } from './neutral-types';

/**
 * Translate twinleaf StateLog entries (GameLog + params) into the SHARED-OBSERVED + informational
 * neutral event vocabulary (the divergence-report trace, pinned but NOT diffed cross-engine). The
 * COMPARED vocabulary (draw/damaged/ko/healed/turnStarted/turnEnded/shuffled/gameOver) is derived
 * separately in events.ts from a before/after state diff + the raw log, because it must be
 * iid/player/count-tagged and twinleaf logs carry only display-name strings.
 *
 * Field name: every event uses `player` (the schema's PlayerRef field), NOT the native `actor`
 * spelling — the 2026-09-02 event-vocabulary standardization canonicalized on `player` (rotomancer
 * and the openapi schema already use it). The local `actor()` helper still resolves params.name → a
 * neutral id; only the emitted field name is `player`. `card`/`pokemon`/`stadium`/`ability` carry the
 * card's display NAME here (like every informational event in this file); the observed tier is pinned
 * but not diffed, so the name-vs-iid difference with rotomancer is tolerated until it is promoted.
 *
 * Closed vocabulary: a GameLog with no mapping returns `undefined` and is filtered out, so an
 * unexpected log surfaces in a test rather than passing silently.
 *
 * Determinism: `Store.log` injects a wall-clock `timestamp` into every log's params (store.ts). This
 * mapper reads only named fields and never passes `params` through, so events are reproducible.
 *
 * One exception to "carries the display name": `pokemon` on `energyAttached`/`toolAttached`/`evolved` is
 * emitted here as a name (all a log carries) but REWRITTEN to the receiving Pokemon's basic iid by
 * `resolvePokemonIids` in events.ts (CF-60 — `pokemon` is an iid everywhere on the wire; a name collides
 * across same-name copies). `card`/`stadium`/`ability` stay display names — they name card types / printed
 * names, not in-play instances.
 */

function str(log: StateLog, key: string): string {
  const value = log.params?.[key];
  if (typeof value !== 'string') {
    throw new Error(`[conformance] log ${String(log.message)} missing string param "${key}"`);
  }
  return value;
}

/** A `params.name` that is a player's name resolves to a neutral actor; anything else is a bug. */
function actor(log: StateLog): NeutralPlayerId {
  const name = str(log, 'name');
  if (name !== 'A' && name !== 'B') {
    throw new Error(`[conformance] log ${String(log.message)} actor name "${name}" is not a neutral player id`);
  }
  return name;
}

export function mapLog(log: StateLog): NeutralEvent | undefined {
  switch (log.message) {
    case GameLog.LOG_PLAYER_PLAYS_BASIC_POKEMON:
      return { kind: 'benchedBasic', player: actor(log), card: str(log, 'card') };
    case GameLog.LOG_PLAYER_EVOLVES_POKEMON:
      return { kind: 'evolved', player: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_ATTACHES_CARD:
      return { kind: 'energyAttached', player: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_PLAYS_TOOL:
      return { kind: 'toolAttached', player: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    // The played-from-hand family (event-vocabulary standardization 2026-09-02). Each is an existing
    // engine log carrying {name, card}; the specific kind carries more than the retired generic
    // `cardPlayed`. Observed tier — pinned, not diffed — so `card` stays the display name here.
    case GameLog.LOG_PLAYER_PLAYS_ITEM:
      return { kind: 'itemPlayed', player: actor(log), card: str(log, 'card') };
    case GameLog.LOG_PLAYER_PLAYS_SUPPORTER:
      return { kind: 'supporterPlayed', player: actor(log), card: str(log, 'card') };
    case GameLog.LOG_PLAYER_PLAYS_STADIUM:
      // Placing a Stadium (≠ activating it — that is `stadiumUsed`/LOG_PLAYER_USES_STADIUM below).
      // Previously left unmapped ("placing is visible in the projection"); the standardization wants
      // the event for symmetry with rotomancer and the rest of the played-from-hand family.
      return { kind: 'stadiumPlayed', player: actor(log), card: str(log, 'card') };
    case GameLog.LOG_PLAYER_USES_ATTACK:
      // CF-57: `attackUsed` is the one PINNED member of this group (`player` + a required `attack`),
      // because it is the only wire fact that says WHICH ATTACK resolved.
      return { kind: 'attackUsed', player: actor(log), attack: str(log, 'attack') };
    case GameLog.LOG_PLAYER_RETREATS:
      // Aligned to {player, to} — `to` is the newly-promoted Active (the benched Pokémon that came up);
      // the old `from` (the retreating Active) is dropped, it is visible in the projection.
      return { kind: 'retreated', player: actor(log), to: str(log, 'benched') };
    case GameLog.LOG_PLAYER_USES_ABILITY:
      return { kind: 'abilityUsed', player: actor(log), ability: str(log, 'ability') };
    // CF-37. The activated-Stadium analog of `abilityUsed` — an activated effect fired, so the trace
    // names it. (LOG_PLAYER_PLAYS_STADIUM is now `stadiumPlayed` above — placing ≠ activating.)
    case GameLog.LOG_PLAYER_USES_STADIUM:
      return { kind: 'stadiumUsed', player: actor(log), stadium: str(log, 'stadium') };
    // LOG_PLAYER_NO_CARDS_IN_DECK: no longer a standalone `deckedOut` event — the fact folds into
    // `gameOver.cause = deckOut`, derived in events.ts at the terminal step.
    default:
      return undefined; // draw/damage/ko/healed/turn/shuffle/gameOver are compared — see events.ts
  }
}

/** Map a per-dispatch log delta to the neutral events it represents, in order. */
export function mapDelta(logs: StateLog[]): NeutralEvent[] {
  const events: NeutralEvent[] = [];
  for (const log of logs) {
    const event = mapLog(log);
    if (event !== undefined) {
      events.push(event);
    }
  }
  return events;
}
