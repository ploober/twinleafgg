import { AttackEffect } from '../../../game/store/effects/game-effects';
import { Player } from '../../../game/store/state/player';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { PlayerType, SlotType, CardTarget } from '../../../game/store/actions/play-card-action';

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

  // Spatial selectors (side × spot × quantity), built active-before-bench / low-index — the same
  // order the harness's resolveChoosePokemonRaw enumerates candidates.
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

  // A single-pick (`quantity: one`) or explicit chooser is a player choice. For ops that *affect*
  // the chosen target (damage/condition/heal), native distributes via a prompt the test harness
  // resolves unreliably (often to nothing on a bare board) — so aligning these needs the prompt-
  // emitting Stage B, not a first-eligible guess. Left unsupported → the attack is skipped.
  if (sel.chooser !== undefined || sel.quantity === 'one') {
    throw new Error('[ir-selectors] player-choice affect-target needs choice-alignment (Stage B)');
  }
  return out;
}

/** Resolve a selector that is expected to denote a single Pokémon list (predicate subjects). */
export function resolveV2Single(effect: AttackEffect, sel?: V2Selector): PokemonCardList {
  const targets = resolveV2Selector(effect, sel);
  if (targets.length === 0) {
    // e.g. a bench selector on an empty bench — the predicate/attr can't be evaluated. Throw a
    // clean error (→ the card is skipped) rather than dereferencing undefined.
    throw new Error('[ir-selectors] selector resolved to no Pokémon');
  }
  return targets[0].list;
}

// ── Stage B: prompt-emitting choice alignment (IR-SUPPORT-DESIGN §12.5) ──────────────────────────
// A single player-choice affect-target ("deal 70 to 1 of your opponent's Pokémon") is resolved by
// emitting the SAME ChoosePokemonPrompt native emits — geometry derived from the selector — so the
// test harness resolves both runs first-eligible to the identical target. The differential then
// tests whether the IR's choice geometry matches the printed card (agreement when right, a real
// mismatch when wrong), instead of skipping the attack.

export interface ChoiceCandidate { target: CardTarget; list: PokemonCardList; player: Player; }
export interface ChoiceTarget {
  playerType: PlayerType;
  slots: SlotType[];
  candidates: ChoiceCandidate[];   // how many to choose comes from the op (op.targetCount), not the selector
}

/**
 * True when a selector denotes a single player-PICKED Pokémon to AFFECT (vs. a forced set or a
 * predicate subject). `quantity:'one'`, or a bare `chooser` (default single pick); a `chooser` with
 * `quantity:'each'|'all'` is not a single pick and stays a counted skip (deterministic path throws).
 * `role` selectors are deterministic (they short-circuit in resolveV2Selector) → not a choice.
 */
export function isSingleChoiceTarget(sel?: V2Selector): boolean {
  if (!sel || sel.role !== undefined) { return false; }
  if (sel.quantity === 'one') { return true; }
  return sel.chooser !== undefined && sel.quantity === undefined;
}

function playerTypeOf(side?: string): PlayerType {
  switch (side) {
    case 'self': return PlayerType.BOTTOM_PLAYER;       // the attacker owns the prompt (BOTTOM)
    case 'opponent': return PlayerType.TOP_PLAYER;
    case 'both': return PlayerType.ANY;
    default: throw new Error(`[ir-selectors] choice target unsupported side "${side}"`);
  }
}

function slotsOf(spot?: string): SlotType[] {
  switch (spot) {
    case 'active': return [SlotType.ACTIVE];
    case 'bench': return [SlotType.BENCH];
    case 'anywhere': return [SlotType.ACTIVE, SlotType.BENCH];
    default: throw new Error(`[ir-selectors] choice target unsupported spot "${spot}"`);
  }
}

/**
 * Expand a single-pick choice selector into (a) the prompt geometry and (b) the concrete candidate
 * set — each with its CardTarget coordinate so the caller can mark `where`-failing ones `blocked`.
 * Enumerated in the SAME order the harness's resolveChoosePokemonRaw walks (BOTTOM before TOP, active
 * before bench, low bench index first), and skipping empty slots exactly as it does, so the emitted
 * prompt resolves to the candidate the IR intends.
 */
export function resolveChoiceTarget(effect: AttackEffect, sel: V2Selector): ChoiceTarget {
  const playerType = playerTypeOf(sel.side);
  const slots = slotsOf(sel.spot);
  const sides: Array<[PlayerType, Player]> = [];
  if (sel.side === 'self' || sel.side === 'both') { sides.push([PlayerType.BOTTOM_PLAYER, effect.player]); }
  if (sel.side === 'opponent' || sel.side === 'both') { sides.push([PlayerType.TOP_PLAYER, effect.opponent]); }
  const candidates: ChoiceCandidate[] = [];
  for (const [pt, p] of sides) {
    if (slots.indexOf(SlotType.ACTIVE) !== -1 && p.active.getPokemonCard() !== undefined) {
      candidates.push({ target: { player: pt, slot: SlotType.ACTIVE, index: 0 }, list: p.active, player: p });
    }
    if (slots.indexOf(SlotType.BENCH) !== -1) {
      for (let i = 0; i < p.bench.length; i++) {
        if (p.bench[i].getPokemonCard() !== undefined) {
          candidates.push({ target: { player: pt, slot: SlotType.BENCH, index: i }, list: p.bench[i], player: p });
        }
      }
    }
  }
  return { playerType, slots, candidates };
}
