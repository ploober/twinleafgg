import { GameLog } from '../game/game-message';
import { StateLog } from '../game/store/state/state-log';
import { NeutralState, NeutralEvent, NeutralPlayerId, PokemonInPlay } from './neutral-types';
import { mapDelta } from './event-mapper';

/**
 * Derive the SIGNIFICANT event vocabulary (OpenAPI `Event`, design §10.4) for one dispatch, from a
 * before/after neutral-state diff plus the raw twinleaf log delta. State-diff is the load-bearing
 * trick: the projection carries stable basic `iid`s, so `damaged`/`ko` are detected by diffing them
 * and identified by that basic `iid` — the shared, seeded, cross-engine identity (CF-60), which
 * distinguishes two copies of one printing that the old printing key collapsed — without resolving
 * twinleaf's ambiguous display-name log params.
 *
 *  - `damaged{player, target, hp}` — a Pokemon whose `damage` rose (net HP this step); `target` is its
 *    basic iid. For the target KO'd in this dispatch, the lethal hit is attributed from the deals log.
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
 * Owner of an in-play Pokemon found by its basic `iid`. Significant events identify the affected
 * Pokemon by `player` (owner) + `target` (the basic `iid` itself, CF-60 — the shared/seeded identity,
 * so two copies of one printing stay distinct). The basic iid is recoverable after a KO because the
 * harness holds the seed; the event carries it directly. Throws if the iid is not in play in the given
 * state; callers only `identify` an iid the matching state's `damageByIid` just found. (The `printing`
 * is returned too, for callers/logs that want the type; it is no longer the event identity.)
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
  carry?: TurnCarry, displayNames?: Map<string, string>): NeutralEvent[] {
  const informational = mapDelta(logs);
  const significant: NeutralEvent[] = [];

  const beforeDmg = damageByIid(before);
  const afterDmg = damageByIid(after);

  // Checkup condition ticks (poison/burn) logged this batch, per afflicted player. An attack that
  // auto-ends the turn runs the checkup in the SAME dispatch, so a survivor's damage delta can mix
  // attack damage and tick damage — one aggregated `damaged` where the tick is a distinct event
  // (TA-16). The tick logs (TA-13) let us split the delta back into per-source events.
  const ticksByPlayer = new Map<NeutralPlayerId, number[]>();
  for (const log of logs) {
    if (log.message === GameLog.LOG_POKEMON_TAKES_POISON_DAMAGE
      || log.message === GameLog.LOG_POKEMON_TAKES_BURN_DAMAGE) {
      const a = logActor(log);
      if (a) {
        const list = ticksByPlayer.get(a) ?? [];
        list.push(logNum(log, 'damage'));
        ticksByPlayer.set(a, list);
      }
    }
  }

  // TA-318(b): a damage-counter MOVE (Alakazam `twm-082` "Strange Hacking") relocates counters by
  // mutating `.damage` directly with NO damage log, so a state diff sees the recipient's HP rise and
  // would emit a spurious `damaged` — rotomancer, which LOGS damage rather than diffing, emits none
  // (relocating a counter is not damage). Detect a relocation-only dispatch: NO logged damage of any
  // kind (deals / poison / burn / counter placement) AND some Pokemon's damage FELL (the move source,
  // which survives — you cannot move counters off a KO'd Pokemon). A dispatch that dealt any logged
  // damage keeps its normal diff-based emission untouched, so this cannot suppress a real hit. (A
  // compound dispatch that BOTH deals logged damage AND moves counters is a residual: `anyDamageLogged`
  // is true, so a moved rise there is still emitted — vanishingly rare and left as documented residue.)
  const anyDamageLogged = logs.some(l =>
    l.message === GameLog.LOG_PLAYER_DEALS_DAMAGE
    || l.message === GameLog.LOG_POKEMON_TAKES_POISON_DAMAGE
    || l.message === GameLog.LOG_POKEMON_TAKES_BURN_DAMAGE
    || l.message === GameLog.LOG_PLAYER_PLACES_DAMAGE_COUNTERS);
  const anyDamageDropped = [...beforeDmg].some(([iid, b]) => {
    const a = afterDmg.get(iid);
    return a !== undefined && a < b;
  });
  const relocationOnly = !anyDamageLogged && anyDamageDropped;

  // damaged — survivors with a positive net damage delta. The player's ACTIVE splits its delta
  // into the logged condition ticks + the remainder (ticks only ever hit the active).
  let survivorDamage = 0;
  for (const [iid, dmgBefore] of beforeDmg) {
    const dmgAfter = afterDmg.get(iid);
    if (dmgAfter !== undefined && dmgAfter > dmgBefore) {
      if (relocationOnly) { continue; } // TA-318(b): a counter relocation, not damage
      const delta = dmgAfter - dmgBefore;
      survivorDamage += delta;
      const at = identify(after, iid); // survivor: still in `after`
      const isActive = after.players[at.player].active?.stack[0]?.iid === iid;
      const ticks = isActive ? (ticksByPlayer.get(at.player) ?? []) : [];
      const tickSum = ticks.reduce((a, b) => a + b, 0);
      if (tickSum > 0 && tickSum <= delta) {
        for (const t of ticks) {
          significant.push({ kind: 'damaged', player: at.player, target: iid, hp: t });
        }
        if (delta - tickSum > 0) {
          significant.push({ kind: 'damaged', player: at.player, target: iid, hp: delta - tickSum });
        }
      } else {
        significant.push({ kind: 'damaged', player: at.player, target: iid, hp: delta });
      }
    }
  }

  // healed — the inverse of `damaged`: a survivor whose damage counters DECREASED this step. Emit
  // per Pokemon (basic iid target per CF-60), hp = the decrease, mirroring the `damaged` derivation
  // so per-(player,target) sums line up with the CF-51 comparison. The one non-heal way damage falls
  // is a counter RELOCATION (TA-318b, Alakazam "Strange Hacking": counters MOVED with no damage log
  // — a drop accompanied by a matching RISE, conserving total). A heal REMOVES counters (a drop with
  // no accompanying rise), so gate on "not a relocation" rather than on a heal LOG: most heals
  // (Potion, attack self-heals) write no LOG_PLAYER_HEALS_POKEMON, but the state diff shows the drop.
  // A KO'd Pokemon left `afterDmg` (not a decrease here); an undamaged target has no decrease -> no
  // event (matches rotomancer: "a heal that removes nothing is not a heal").
  const anyDamageRose = [...beforeDmg].some(([iid, b]) => {
    const a = afterDmg.get(iid);
    return a !== undefined && a > b;
  });
  const isRelocation = !anyDamageLogged && anyDamageDropped && anyDamageRose;
  if (!isRelocation) {
    for (const [iid, dmgBefore] of beforeDmg) {
      const dmgAfter = afterDmg.get(iid);
      if (dmgAfter !== undefined && dmgAfter < dmgBefore) {
        const at = identify(after, iid); // healed survivor: still in `after`
        significant.push({ kind: 'healed', player: at.player, target: iid, hp: dmgBefore - dmgAfter });
      }
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
    // TA-187 / CF-40: placed damage COUNTERS are a third damage source, and a Pokemon can be
    // Knocked Out by them (Deluxe Bomb `scr-134` puts 12 counters on the attacker). Without this
    // the reconstruction pool came up short and the KO'd Pokemon got a `ko` with no preceding
    // `damaged` — the engine placed and logged the counters correctly, the PROJECTION could not
    // see the log kind. Safe for survivors too: counters landing on a survivor raise `dealt` and
    // `survivorDamage` by the same amount, leaving `pool` unchanged.
    GameLog.LOG_PLAYER_PLACES_DAMAGE_COUNTERS,
  ]);
  // A Pokemon whose basic iid reappears in a player's hand or deck was BOUNCED by an effect
  // ("Put this Pokemon and all attached cards into your hand" — Tuck Tail), not Knocked Out:
  // no `ko`, and its vanished damage is not a damage placement (TL-8/run-6 por-062).
  const bounced = new Set<string>();
  for (const p of PLAYERS) {
    const side = after.players[p];
    for (const ref of [...side.hand, ...side.deck]) {
      if (beforeDmg.has(ref.iid) && !afterDmg.has(ref.iid)) { bounced.add(ref.iid); }
    }
  }
  // TA-344 (2026-09-01): a hand reappearance is NOT proof of a bounce. Gengar's Infinite Shadow is a
  // genuine Knock Out (prize taken, LOG_POKEMON_KO written) whose remains go to the HAND instead of
  // the discard, and the bounce heuristic silently dropped its `ko` and `damaged`. So bounced iids
  // stay CANDIDATES, ranked last: the KO-log cap below decides how many vanishers were real KOs, and
  // a bounce is only ever counted when the logs say more Pokemon were KO'd than went to the discard.
  let koList = [...beforeDmg.keys()].filter(iid => !afterDmg.has(iid));
  // A Pokemon can leave play into the discard by a NON-KO effect ("Discard this Pokemon and all
  // attached cards" — Revavroom ex "Shattering Speed", TA-140). An effect-discard is not a Knock Out:
  // it awards no prize, and the engine never runs a KnockOutEffect (the sole LOG_POKEMON_KO emitter).
  // The state diff can't tell the two apart — both end in the discard — so cap the `ko` count at the
  // KO-log count. When trimming, drop bounced (hand/deck) vanishers first, then the ACTIVE player's
  // own: an attack KOs the DEFENDER (opponent-of-active) while a self-discard/self-bounce removes the
  // attacker's own, so opponent-side discard-vanishers are the real KOs. (Matching KO logs by display
  // NAME is avoided by design — names are ambiguous across identical printings; the count +
  // ownership is unambiguous.)
  const koLogCount = logs.filter(l => l.message === GameLog.LOG_POKEMON_KO).length;
  if (koList.length > koLogCount) {
    const attacker = before.activePlayer;
    const rank = (iid: string): number =>
      (bounced.has(iid) ? 2 : 0) + (identify(before, iid).player === attacker ? 1 : 0);
    koList = [...koList].sort((a, b) => rank(a) - rank(b)).slice(0, koLogCount);
  }
  if (koList.length > 0) {
    // CF-6: one `damaged` event per damage placement, reconstructed for the KO'd (their damage
    // is no longer diffable from state). Conservation: everything dealt this batch that the
    // survivor diff didn't absorb landed on the KO'd. Split that pool per placement:
    //  - each KO'd owner's-active gets its owner's (unconsumed) condition-tick logs, one event per tick;
    //  - the remainder is the attack's single post-calculation placement, attributed to the
    //    attack dealer's opponent-side KO'd active (multi-KO batches: attack + own-tick, e.g.
    //    Vine Slap KOs the defender while the attacker's own poison tick KOs it too).
    const dealt = logs
      .filter(l => DAMAGE_LOGS.has(l.message))
      .reduce((sum, l) => sum + logNum(l, 'damage'), 0);
    let pool = dealt - survivorDamage;
    if (pool > 0) {
      const dealsLogs = logs.filter(l => l.message === GameLog.LOG_PLAYER_DEALS_DAMAGE);
      const dealer = dealsLogs.length > 0 ? logActor(dealsLogs[dealsLogs.length - 1]) : undefined;
      const koHits = koList.map(iid => {
        const hit = identify(before, iid);
        const wasOwnersActive = before.players[hit.player].active?.stack[0]?.iid === iid;
        const afterActive = after.players[hit.player].active;
        const ticksConsumedBySurvivor = afterActive !== null && afterActive.stack.length > 0
          && (afterDmg.get(afterActive.stack[0].iid) ?? 0) > (beforeDmg.get(afterActive.stack[0].iid) ?? Infinity);
        const ticks = wasOwnersActive && !ticksConsumedBySurvivor
          ? (ticksByPlayer.get(hit.player) ?? []) : [];
        return { iid, ...hit, wasOwnersActive, ticks };
      });
      const tickSum = koHits.reduce((s, k) => s + k.ticks.reduce((a, b) => a + b, 0), 0);
      if (tickSum > 0 && tickSum <= pool) {
        for (const k of koHits) {
          for (const t of k.ticks) {
            significant.push({ kind: 'damaged', player: k.player, target: k.iid, hp: t });
            pool -= t;
          }
        }
      }
      // TA-252: placed damage COUNTERS attributed to the KO'd they landed on, BY LOG TARGET NAME.
      // The defender remainder below needs a deals-log to name a dealer — but a Pokemon KO'd by
      // counters alone can die in a batch with NO deals-log at all (Phantom Dive: the defender's
      // lethal 200 was already emitted as a survivor event in the PRIOR batch; the KO batch holds
      // only the placement log and two KO logs, so `dealer` is undefined, the multi-KO fallback
      // yields nothing, and the 60 evaporated — a `ko` with no `damaged` at all). Names are unsafe
      // for KO COUNTING (ambiguous across identical printings) but safe here: a placement is
      // consumed only when its target name matches exactly ONE KO'd hit and NO survivor whose
      // damage rose this batch (a survivor's placement is already in the state diff and netted out
      // of the pool). Anything ambiguous falls through to the old behavior.
      if (pool > 0 && displayNames !== undefined) {
        for (const log of logs) {
          if (log.message !== GameLog.LOG_PLAYER_PLACES_DAMAGE_COUNTERS) { continue; }
          const targetName = log.params?.['target'];
          const amount = logNum(log, 'damage');
          if (typeof targetName !== 'string' || amount <= 0 || amount > pool) { continue; }
          const survivorShares = [...beforeDmg.keys()].some(iid => {
            const afterVal = afterDmg.get(iid);
            return afterVal !== undefined && afterVal > (beforeDmg.get(iid) ?? 0)
              && displayNames.get(iid) === targetName;
          });
          if (survivorShares) { continue; }
          const matches = koHits.filter(k => displayNames.get(k.iid) === targetName);
          if (matches.length === 1) {
            significant.push({ kind: 'damaged', player: matches[0].player, target: matches[0].iid, hp: amount });
            pool -= amount;
          }
        }
      }
      if (pool > 0) {
        // TA-318: attribute the attack placement to the KO'd Pokemon the deals-log NAMED, the same
        // disambiguation the counter branch uses (TA-252). A single resolution can KO more than one
        // Pokemon — Obsidian (`ssp-119`) KOs the Active with its base 130 while the bench-spread rider
        // KOs a Benched Pokemon — and the positional `defender` heuristic below piles BOTH placements
        // onto the opponent's-active KO'd, mis-attributing the bench hit. (The Active's own lethal hit
        // was already emitted as a `damaged` in the PRIOR dispatch, when its damage rose and it was
        // still a survivor; here only the bench-spread deals-log is present.) Aggregate the deals per
        // target NAME first (so multi-hit `30x3` on one target stays ONE aggregate event, not three),
        // then attribute a name-group to the unique KO'd hit it matches and no survivor whose damage
        // rose (a survivor's placement is already in the state diff, netted out of the pool). Names
        // are ambiguous across identical printings, so a name matching 0 or >1 KO'd hits falls through
        // to the positional dump, preserving the prior behavior for the single-defender case.
        const dealtByName = new Map<string, number>();
        if (displayNames !== undefined) {
          for (const log of logs) {
            if (log.message !== GameLog.LOG_PLAYER_DEALS_DAMAGE) { continue; }
            const targetName = log.params?.['target'];
            const amount = logNum(log, 'damage');
            if (typeof targetName !== 'string' || amount <= 0) { continue; }
            dealtByName.set(targetName, (dealtByName.get(targetName) ?? 0) + amount);
          }
          for (const [targetName, amount] of dealtByName) {
            if (amount > pool) { continue; }
            const survivorShares = [...beforeDmg.keys()].some(iid => {
              const afterVal = afterDmg.get(iid);
              return afterVal !== undefined && afterVal > (beforeDmg.get(iid) ?? 0)
                && displayNames.get(iid) === targetName;
            });
            if (survivorShares) { continue; }
            const matches = koHits.filter(k => displayNames.get(k.iid) === targetName);
            if (matches.length === 1) {
              significant.push({ kind: 'damaged', player: matches[0].player, target: matches[0].iid, hp: amount });
              pool -= amount;
            }
          }
        }
        if (pool > 0) {
          // The remaining placement: the dealer's opponent-side KO'd active if identifiable, else
          // (single KO) the sole victim — emitted as one aggregate placement. Reached for the
          // single-defender case (one named target ⇒ the loop above already consumed it and pool is
          // 0, so this only fires when the name was ambiguous or absent) and for tick/counter residue.
          const defender = koHits.find(k => k.wasOwnersActive && dealer !== undefined && k.player !== dealer)
            ?? (koHits.length === 1 ? koHits[0] : undefined);
          if (defender) {
            significant.push({ kind: 'damaged', player: defender.player, target: defender.iid, hp: pool });
          }
        }
      }
    }
  }
  for (const iid of koList) {
    const at = identify(before, iid); // KO'd: identify where it was, in `before`
    significant.push({ kind: 'ko', player: at.player, target: iid });
  }

  // promotedFromBench — a Benched Pokemon FORCED to Active to replace a REMOVED Active (a KO), NOT a
  // voluntary retreat or a switch effect. Derived from the state diff, because our
  // LOG_PLAYER_SWITCHES_POKEMON_TO_ACTIVE fires for voluntary switches (Guzma) too: the Active's
  // basic iid changed AND the old Active is no longer in play (it was KO'd/removed, not sent to the
  // bench by a retreat/switch). Also fires for the deferred promote (a prior-step KO left `active`
  // null, filled this step). Observed tier — pinned, not diffed. pokemon = the promoted basic iid (CF-60).
  for (const p of PLAYERS) {
    const oldActive = before.players[p].active?.stack[0]?.iid;
    const newActive = after.players[p].active?.stack[0]?.iid;
    if (newActive !== undefined && newActive !== oldActive) {
      const playerRetreated = logs.some(l =>
        l.message === GameLog.LOG_PLAYER_RETREATS && logActor(l) === p);
      const oldStillInPlay = oldActive !== undefined
        && after.players[p].bench.some(b => b?.stack?.[0]?.iid === oldActive);
      if (!playerRetreated && !oldStillInPlay) {
        significant.push({ kind: 'promotedFromBench', player: p, pokemon: newActive });
      }
    }
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

  // gameOver — the outcome reaching a terminal value this step. `winner` folds the retired
  // `matchEnded` (null on a tie); `cause` folds the retired `deckedOut`. Pinned cause vocabulary
  // (event-vocabulary standardization): prizesTaken | deckOut | noPokemonInPlay | tie. outcome stays
  // the compared field; winner/cause ride observed until rotomancer also populates them.
  if (before.outcome === 'ongoing' && after.outcome !== 'ongoing') {
    let winner: NeutralPlayerId | null = null;
    let cause = 'prizesTaken';
    if (after.outcome === 'tie') {
      winner = null;
      cause = 'tie';
    } else {
      for (const log of logs) {
        if (log.message === GameLog.LOG_GAME_FINISHED_WINNER) {
          const n = log.params?.['name'];
          if (n === 'A' || n === 'B') { winner = n; }
        } else if (log.message === GameLog.LOG_PLAYER_NO_CARDS_IN_DECK) {
          cause = 'deckOut';
        } else if (log.message === GameLog.LOG_PLAYER_NO_ACTIVE_POKEMON) {
          cause = 'noPokemonInPlay';
        }
      }
      // winner falls back to the surviving side of a decisive outcome if the WINNER log was in an
      // earlier batch (the outcome itself names it).
      if (winner === null) { winner = after.outcome === 'winA' ? 'A' : 'B'; }
    }
    significant.push({ kind: 'gameOver', outcome: after.outcome, winner, cause });
  }

  return [...informational, ...significant];
}
