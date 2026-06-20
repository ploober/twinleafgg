import {
  SCHEMA_VERSION, NeutralState, NeutralAction, PlayerState, PlayerFlags, PokemonInPlay, PokemonMarkers,
  CardRef, Actor, LegalAction
} from '../../neutral-types';
import { importState } from '../../state-adapter';
import { replay } from '../../driver';

/**
 * Tier 3 — seeded property/fuzz generators (testing design doc §6). A deterministic PRNG drives both
 * board generation and menu-driven random play, so any failure replays from its seed. Never uses
 * `Math.random` (which `withNoRandomness` stubs to throw); the seed is the only entropy.
 *
 * The action generator uses the adapter's OWN menu as the legal-move oracle: `replay(game, logSoFar)`
 * surfaces the current frontier (top-level menu, decomposer pick, or system flip/shuffle) as
 * `pending.legalActions`; we pick one, append, and re-derive. Curated in-scope printings only, so a
 * failure is a real adapter bug, not an unsupported card.
 */

// ── PRNG (mulberry32 — pure, deterministic) ──

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pickFrom = <T>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const intIn = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
function permute<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// ── curated in-scope pool (every attack/ability raises only supported or system prompts) ──

const BASIC = [
  { p: 'Ralts SIT', name: 'Ralts' },
  { p: 'Rufflet SIT', name: 'Rufflet' },
  { p: 'Pikachu LOR', name: 'Pikachu' },
];
const EVO = [
  { p: 'Kirlia SIT', from: 'Ralts' },
  { p: 'Gardevoir SIT', from: 'Kirlia' },
  { p: 'Raichu SIT', from: 'Pikachu' },
];
const ENERGY = ['Water Energy SVE', 'Psychic Energy SVE', 'Lightning Energy SVE'];
const STADIUM = 'Primordial Altar SIT';
const PRIZE_FILLER = 'Water Energy SVE'; // == native DEFAULT_FILLER

// NOTE: Pokémon Tools are deliberately excluded from the fuzz pool. The engine's runtime tool-play
// (PlayCardAction) attaches a played Tool to `slot.tools` but NOT `slot.cards`, while `collectAllCardIds`
// (and setup-placed tools) only/also track `.cards` — so a played tool reads as a lost card to the
// conservation invariant. That is a pre-existing engine/helper data-model quirk, not adapter fidelity;
// the fuzz stays in-scope by avoiding it (documented in the impl doc §8).

const basicName = (printing: string): string | undefined => BASIC.find(b => b.p === printing)?.name;

function defaultMarkers(): PokemonMarkers {
  return { playedOnTurn: 0, movedToActiveOnTurn: -1, damageTakenThisTurn: 0, abilitiesUsedThisTurn: [], cannotAttackNextTurn: false };
}
function defaultFlags(): PlayerFlags {
  return {
    supporterPlayedThisTurn: false, energyAttachedThisTurn: false, stadiumPlayedThisTurn: false,
    retreatedThisTurn: false, cardsPlayedThisTurn: 0, prizesTakenThisTurn: 0, prizesTakenLastTurn: 0, vstarUsed: false,
  };
}

// ── board generator ──

export function genBoard(rng: Rng): NeutralState {
  let n = 0;
  const ref = (printing: string): CardRef => ({ iid: `c${n++}`, printing });
  const randEnergy = (lo: number, hi: number): CardRef[] =>
    Array.from({ length: intIn(rng, lo, hi) }, () => ref(pickFrom(rng, ENERGY)));

  const mkPip = (printing: string, energyLo: number, energyHi: number, damage: number): PokemonInPlay => ({
    stack: [ref(printing)],
    energy: randEnergy(energyLo, energyHi),
    tools: [],
    damage,
    conditions: [],
    markers: defaultMarkers(),
  });

  const genSide = (): PlayerState => {
    const activePrinting = pickFrom(rng, BASIC).p;
    const active = mkPip(activePrinting, 0, 2, pickFrom(rng, [0, 0, 10, 20]));

    const benchPrintings = Array.from({ length: intIn(rng, 0, 3) }, () => pickFrom(rng, BASIC).p);
    const bench = benchPrintings.map(p => mkPip(p, 0, 2, 0));

    const inPlayNames = [activePrinting, ...benchPrintings].map(basicName);
    const hand: string[] = [];
    for (const e of EVO) {
      if (inPlayNames.includes(e.from) && rng() < 0.5) { hand.push(e.p); }
    }
    for (let i = 0, extra = intIn(rng, 1, 3); i < extra; i++) {
      hand.push(pickFrom(rng, [...BASIC.map(b => b.p), ...ENERGY]));
    }
    if (rng() < 0.2) { hand.push(STADIUM); }

    const deck = Array.from({ length: intIn(rng, 2, 4) }, () => ref(pickFrom(rng, ENERGY)));

    return {
      active,
      bench,
      hand: hand.map(ref),
      deck,
      discard: [],
      lostZone: [],
      prizes: Array.from({ length: intIn(rng, 1, 6) }, () => ({ ...ref(PRIZE_FILLER), faceUp: false })),
      flags: defaultFlags(),
    };
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    turn: intIn(rng, 3, 8), // >= 3 clears the first-turn evolve/attack gates
    activePlayer: 'A',
    firstPlayer: 'A',
    phase: 'main',
    outcome: 'ongoing',
    stadium: null,
    players: { A: genSide(), B: genSide() },
  };
}

// ── LegalAction -> NeutralAction ──

/** Attach the acting `actor` to an enumerated legal move; `shuffle` becomes a PRNG permutation. */
export function legalToNeutral(legal: LegalAction, actor: Actor, rng: Rng): NeutralAction {
  if (legal.type === 'shuffle') {
    return { actor: 'system', type: 'shuffle', order: permute(legal.deck, rng) };
  }
  return { ...legal, actor } as NeutralAction;
}

// ── menu-driven random play ──

export interface GeneratedGame {
  log: NeutralAction[];
  /** Set only if a dispatch THREW (e.g. an unsupported prompt) — a hard out-of-seam failure. */
  error?: Error;
  /** Count of menu candidates the engine rejected (over-reported legality) and we backed out of. */
  backedOut: number;
}

/**
 * Walk the adapter's menu, committing a random *accepted* legal action each step, to a bounded depth.
 *
 * The menu (the engine's own `Check*` effects) is **best-effort**: it can over-report attack/ability
 * legality for cards whose deeper logic has internal preconditions (e.g. a "discard a card" ability
 * with an empty hand → `cannotUseAbility`). So we trial each candidate and commit the first the engine
 * accepts, backing out of rejections — the menu is a candidate set, not a guarantee. `endTurn` is
 * always legal and never rejects, so a frontier is never fully dead.
 *
 * Re-imports and re-replays the whole log each step (cheap at this depth) so the system flip-provider
 * stays fed from the full log (driver.ts:221) and follow-up candidates are re-derived fresh.
 */
interface TrialResult {
  /** The action plus any inline-flip follow-ups to append, when the engine accepts it. */
  append?: NeutralAction[];
  /** The engine rejected the candidate (menu over-reported its legality). */
  rejected?: boolean;
  /** A genuine throw (unsupported prompt / adapter bug). */
  error?: Error;
}

/**
 * Trial-dispatch one candidate on top of `log`. An inline `CoinFlipEffect` (e.g. Pikachu's "Whimsy
 * Tackle") consumes its flip from the log DURING dispatch (driver.ts:221), so the candidate can't be
 * generated alone — on the "coin flip needed" signal we append a PRNG flip and retry until it resolves.
 * (A `CoinFlipPrompt` instead surfaces as a system pending and is handled by the normal frontier loop.)
 */
function trialCommit(initial: NeutralState, log: NeutralAction[], action: NeutralAction, rng: Rng): TrialResult {
  const flips: NeutralAction[] = [];
  for (let guard = 0; guard < 12; guard++) {
    let r;
    try {
      r = replay(importState(initial), [...log, action, ...flips]);
    } catch (err) {
      if ((err as Error).message.includes('coin flip needed')) {
        flips.push({ actor: 'system', type: 'flip', face: rng() < 0.5 ? 'heads' : 'tails' });
        continue;
      }
      return { error: err as Error };
    }
    if (r.rejection !== undefined) {
      return { rejected: true };
    }
    return { append: [action, ...flips] };
  }
  return { error: new Error('[fuzz] inline coin flips did not converge') };
}

export function playRandomGame(initial: NeutralState, rng: Rng, maxActions: number): GeneratedGame {
  const log: NeutralAction[] = [];
  let backedOut = 0;

  for (let i = 0; i < maxActions; i++) {
    let pending;
    try {
      pending = replay(importState(initial), log).pending;
    } catch (err) {
      return { log, error: err as Error, backedOut };
    }
    if (pending === null || pending.legalActions.length === 0) {
      break; // gameOver or a non-main quiescent boundary — nothing to choose
    }

    let committed = false;
    for (const legal of permute(pending.legalActions, rng)) {
      const action = legalToNeutral(legal, pending.actor, rng);
      const res = trialCommit(initial, log, action, rng);
      if (res.error !== undefined) {
        return { log: [...log, action], error: res.error, backedOut };
      }
      if (res.rejected) {
        backedOut++; // the menu over-reported this candidate's legality — try another
        continue;
      }
      log.push(...res.append!);
      committed = true;
      break;
    }
    if (!committed) {
      break; // every candidate rejected (should not happen — endTurn never rejects)
    }
  }

  return { log, backedOut };
}
