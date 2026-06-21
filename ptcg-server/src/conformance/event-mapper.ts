import { GameLog } from '../game/game-message';
import { StateLog } from '../game/store/state/state-log';
import { NeutralEvent, NeutralPlayerId } from './neutral-types';

/**
 * Translate twinleaf StateLog entries (GameLog + params) into the INFORMATIONAL neutral event
 * vocabulary (the divergence-report trace, never compared). The SIGNIFICANT vocabulary
 * (draw/damaged/ko/turnStarted/turnEnded/shuffled/gameOver) is derived separately in events.ts from a
 * before/after state diff + the raw log, because it must be iid/player/count-tagged and twinleaf logs
 * carry only display-name strings.
 *
 * Closed vocabulary: a GameLog with no mapping returns `undefined` and is filtered out, so an
 * unexpected log surfaces in a test rather than passing silently.
 *
 * Determinism: `Store.log` injects a wall-clock `timestamp` into every log's params (store.ts). This
 * mapper reads only named fields and never passes `params` through, so events are reproducible.
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
      return { kind: 'benchedBasic', actor: actor(log), card: str(log, 'card') };
    case GameLog.LOG_PLAYER_EVOLVES_POKEMON:
      return { kind: 'evolved', actor: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_ATTACHES_CARD:
      return { kind: 'attachedEnergy', actor: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_PLAYS_TOOL:
      return { kind: 'attachedTool', actor: actor(log), card: str(log, 'card'), pokemon: str(log, 'pokemon') };
    case GameLog.LOG_PLAYER_USES_ATTACK:
      return { kind: 'usedAttack', actor: actor(log), attack: str(log, 'attack') };
    case GameLog.LOG_PLAYER_RETREATS:
      return { kind: 'retreated', actor: actor(log), from: str(log, 'active'), to: str(log, 'benched') };
    case GameLog.LOG_PLAYER_NO_CARDS_IN_DECK:
      return { kind: 'deckedOut', actor: actor(log) };
    case GameLog.LOG_PLAYER_USES_ABILITY:
      return { kind: 'usedAbility', actor: actor(log), ability: str(log, 'ability') };
    default:
      return undefined; // draw/damage/ko/turn/shuffle/gameOver are significant — see events.ts
  }
}

/** Map a per-dispatch log delta to the informational neutral events it represents, in order. */
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
