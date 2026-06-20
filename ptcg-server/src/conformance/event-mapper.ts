import { GameLog } from '../game/game-message';
import { StateLog } from '../game/store/state/state-log';
import { NeutralEvent, NeutralPlayerId } from './neutral-types';

/**
 * Translate twinleaf StateLog entries (GameLog + params) into the neutral event vocabulary.
 *
 * Closed vocabulary: a GameLog with no mapping returns `undefined` and is filtered out, so a
 * mis-built M1 board that emits an unexpected log (e.g. a special-condition flip) surfaces in the
 * test rather than passing silently.
 *
 * Determinism: `Store.log` injects a wall-clock `timestamp` into every log's params (store.ts).
 * This mapper reads only named fields and never passes `params` through, so events are
 * reproducible across identical replays.
 *
 * Actor: twinleaf logs identify the acting player only by `params.name` (a display string). Import
 * sets each player's name to its neutral id ('A'/'B') so this is recoverable here. Card references
 * are display names (logs carry no card id), so events are not iid-tagged in this first pass.
 */

function str(log: StateLog, key: string): string {
  const value = log.params?.[key];
  if (typeof value !== 'string') {
    throw new Error(`[conformance] log ${String(log.message)} missing string param "${key}"`);
  }
  return value;
}

function num(log: StateLog, key: string): number {
  const value = log.params?.[key];
  if (typeof value !== 'number') {
    throw new Error(`[conformance] log ${String(log.message)} missing numeric param "${key}"`);
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
      return { kind: 'benchedBasic', actor: actor(log), card: str(log, 'card') };
    case GameLog.LOG_PLAYER_EVOLVES_POKEMON:
      return { kind: 'evolved', actor: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_ATTACHES_CARD:
      return { kind: 'attachedEnergy', actor: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_PLAYS_TOOL:
      return { kind: 'attachedTool', actor: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_DRAWS_CARD:
      return { kind: 'drew', actor: actor(log) };
    case GameLog.LOG_PLAYER_USES_ATTACK:
      return { kind: 'usedAttack', actor: actor(log), attack: str(log, 'attack') };
    case GameLog.LOG_PLAYER_DEALS_DAMAGE:
      return { kind: 'dealtDamage', actor: actor(log), damage: num(log, 'damage'), target: str(log, 'target') };
    case GameLog.LOG_PLAYER_PLACES_DAMAGE_COUNTERS:
      return { kind: 'placedDamage', actor: actor(log), damage: num(log, 'damage'), target: str(log, 'target') };
    case GameLog.LOG_POKEMON_KO:
      return { kind: 'ko', target: str(log, 'name') };
    case GameLog.LOG_PLAYER_RETREATS:
      return { kind: 'retreated', actor: actor(log), from: str(log, 'active'), to: str(log, 'benched') };
    case GameLog.LOG_PLAYER_ENDS_TURN:
      return { kind: 'turnEnded', actor: actor(log) };
    case GameLog.LOG_TURN:
      return { kind: 'turnStarted', turn: num(log, 'turn') };
    case GameLog.LOG_PLAYER_NO_CARDS_IN_DECK:
      return { kind: 'deckedOut', actor: actor(log) };
    case GameLog.LOG_PLAYER_USES_ABILITY:
      return { kind: 'usedAbility', actor: actor(log), ability: str(log, 'ability') };
    default:
      return undefined;
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
