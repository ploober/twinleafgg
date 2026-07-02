import { GameLog } from '../game/game-message';
import { StateLog } from '../game/store/state/state-log';
import { NeutralState, NeutralEvent, NeutralPlayerId, PokemonInPlay } from './neutral-types';
import { mapDelta } from './event-mapper';

/**
 * Derive the SIGNIFICANT event vocabulary (OpenAPI `Event`, design §10.4) for one dispatch, from a
 * before/after neutral-state diff plus the raw twinleaf log delta. State-diff is the load-bearing
 * trick: the projection carries stable basic `iid`s, so `damaged`/`ko` are detected by diffing them,
 * then `identify`d to a `player` (owner) + `target` (basic printing/cid) — comparable across engines,
 * unlike the engine-private iid — without resolving twinleaf's ambiguous display-name log params.
 *
 *  - `damaged{player, target, hp}` — a Pokemon whose `damage` rose (net HP this step); for the (single)
 *    target KO'd in this dispatch, the lethal hit is attributed from the deals-damage log delta.
 *  - `ko{player, target}` — a basic iid present before the dispatch and gone after, identified in `before`.
 *  - `draw{player, count}` — aggregated `LOG_PLAYER_DRAWS_CARD` per player.
 *  - `turnStarted{player}` / `turnEnded{player}` — the turn boundary (player resolved from the log /
 *    the after-state's active player).
 *  - `gameOver{outcome}` — the outcome transitioning to terminal.
 *
 * `shuffled{player}` is emitted by the driver at shuffle-pending resolution (no deck-shuffle GameLog).
 * The informational trace (event-mapper) rides along ahead of the significant events.
 */

const PLAYERS: NeutralPlayerId[] = ['A', 'B'];

/** basic iid → damage (HP) for every in-play Pokemon (active + bench) across both players. */
function damageByIid(state: NeutralState): Map<string, number> {
  const byIid = new Map<string, number>();
  for (const p of PLAYERS) {
    const side = state.players[p];
    const pokemons: (PokemonInPlay | null)[] = [side.active, ...side.bench];
    for (const poke of pokemons) {
      if (poke && poke.stack.length > 0) {
        byIid.set(poke.stack[0].iid, poke.damage);
      }
    }
  }
  return byIid;
}

/**
 * Owner + basic printing of an in-play Pokemon (by basic `iid`). Significant events identify the
 * affected Pokemon by `player` (owner) + `target` (its basic printing/cid) — both comparable across
 * engines and available even after the Pokemon leaves play (a KO), unlike the engine-private `iid`
 * (§6.1). Throws if the iid is not in play in the given state; callers only `identify` an iid the
 * matching state's `damageByIid` just found.
 */
function identify(state: NeutralState, iid: string): { player: NeutralPlayerId; printing: string } {
  for (const p of PLAYERS) {
    const side = state.players[p];
    for (const poke of [side.active, ...side.bench]) {
      if (poke && poke.stack[0]?.iid === iid) {
        return { player: p, printing: poke.stack[0].printing };
      }
    }
  }
  throw new Error(`[conformance] cannot identify iid "${iid}" for an event target`);
}

function logActor(log: StateLog): NeutralPlayerId | undefined {
  const name = log.params?.['name'];
  return name === 'A' || name === 'B' ? name : undefined;
}

function logNum(log: StateLog, key: string): number {
  const value = log.params?.[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * Cross-batch turn-boundary memory, owned by one replay loop (driver) and threaded through every
 * deriveEvents call. The native LOG_PLAYER_ENDS_TURN lands in the batch that processes the end-turn
 * action, but the deferred `turnEnded` (TA-2) may only become emittable batches later — when the
 * turn actually advances or the game goes terminal mid-checkup (TA-8: e.g. endTurn → flip → checkup
 * KO → takePrize → gameOver, where the terminal batch no longer contains the ENDS_TURN log).
 */
export interface TurnCarry {
  /** The player whose end-turn is processed but whose `turnEnded` is not yet emitted. */
  endedBy?: NeutralPlayerId;
}

export function deriveEvents(before: NeutralState, after: NeutralState, logs: StateLog[],
  carry?: TurnCarry): NeutralEvent[] {
  const informational = mapDelta(logs);
  const significant: NeutralEvent[] = [];

  const beforeDmg = damageByIid(before);
  const afterDmg = damageByIid(after);

  // damaged — survivors with a positive net damage delta.
  let survivorDamage = 0;
  for (const [iid, dmgBefore] of beforeDmg) {
    const dmgAfter = afterDmg.get(iid);
    if (dmgAfter !== undefined && dmgAfter > dmgBefore) {
      const hp = dmgAfter - dmgBefore;
      survivorDamage += hp;
      const at = identify(after, iid); // survivor: still in `after`
      significant.push({ kind: 'damaged', player: at.player, target: at.printing, hp });
    }
  }

  // ko — a basic iid present before, gone after. For a single KO, attribute the lethal hit (the
  // dealt-damage delta not accounted for by survivors) as its `damaged` before the `ko`. Damage
  // sources: attack damage (LOG_PLAYER_DEALS_DAMAGE) and checkup condition ticks (poison/burn),
  // which can KO within the same dispatch (TA-13: a lethal poison tick emitted no `damaged`).
  const DAMAGE_LOGS = new Set<string>([
    GameLog.LOG_PLAYER_DEALS_DAMAGE,
    GameLog.LOG_POKEMON_TAKES_POISON_DAMAGE,
    GameLog.LOG_POKEMON_TAKES_BURN_DAMAGE,
  ]);
  const koList = [...beforeDmg.keys()].filter(iid => !afterDmg.has(iid));
  if (koList.length === 1) {
    const dealt = logs
      .filter(l => DAMAGE_LOGS.has(l.message))
      .reduce((sum, l) => sum + logNum(l, 'damage'), 0);
    const lethal = dealt - survivorDamage;
    if (lethal > 0) {
      const koHit = identify(before, koList[0]); // KO'd: gone from `after`, identify in `before`
      significant.push({ kind: 'damaged', player: koHit.player, target: koHit.printing, hp: lethal });
    }
  }
  for (const iid of koList) {
    const at = identify(before, iid); // KO'd: identify where it was, in `before`
    significant.push({ kind: 'ko', player: at.player, target: at.printing });
  }

  // turn boundary — `turnEnded` carries the ending player; `turnStarted` the new active player.
  // The native log writes LOG_PLAYER_ENDS_TURN as soon as the end-turn action processes — BEFORE
  // the between-turns Checkup resolves, whose coin flips can pause the replay. The turn is not
  // observably over at such a pause (the projection still shows the old turn/activePlayer and
  // phase=checkup), so emitting `turnEnded` there would contradict the state (TA-2). Defer: emit
  // `turnEnded` only in the batch where the turn actually advances (LOG_TURN, placed before
  // `turnStarted`) or where the game reaches a terminal outcome (no LOG_TURN follows). The deferral
  // spans batches via `carry` (TA-8): the ENDS_TURN log and the terminal/advance batch need not be
  // the same dispatch (e.g. endTurn → flip answered → checkup KO → takePrize → gameOver).
  const turnAdvanced = logs.some(l => l.message === GameLog.LOG_TURN);
  const endsTurnLog = logs.find(l => l.message === GameLog.LOG_PLAYER_ENDS_TURN);
  const wentTerminal = before.outcome === 'ongoing' && after.outcome !== 'ongoing';
  const endedBy = (endsTurnLog && logActor(endsTurnLog)) ?? carry?.endedBy;
  if (carry !== undefined) {
    carry.endedBy = endedBy;
  }
  if (turnAdvanced || (endedBy !== undefined && wentTerminal)) {
    // Deferred across batches, the ENDS_TURN log may be in an earlier batch: the ending player is
    // then the one whose turn is NOT starting.
    const a = endedBy ?? (after.activePlayer === 'A' ? 'B' : 'A');
    significant.push({ kind: 'turnEnded', player: a });
    if (carry !== undefined) {
      carry.endedBy = undefined;
    }
  }
  if (turnAdvanced) {
    significant.push({ kind: 'turnStarted', player: after.activePlayer });
  }

  // draw — aggregate consecutive draws per player into one count (after the turn boundary, so the
  // start-of-turn draw lands in causal order).
  const drawCount = new Map<NeutralPlayerId, number>();
  for (const log of logs) {
    if (log.message === GameLog.LOG_PLAYER_DRAWS_CARD) {
      const a = logActor(log);
      if (a) { drawCount.set(a, (drawCount.get(a) ?? 0) + 1); }
    }
  }
  for (const [player, count] of drawCount) {
    significant.push({ kind: 'draw', player, count });
  }

  // gameOver — the outcome reaching a terminal value this step.
  if (before.outcome === 'ongoing' && after.outcome !== 'ongoing') {
    significant.push({ kind: 'gameOver', outcome: after.outcome });
  }

  return [...informational, ...significant];
}
