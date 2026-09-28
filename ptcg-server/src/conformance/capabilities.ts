import { Card } from '../game/store/card/card';
import { CardManager } from '../game/cards/card-manager';
import { loadAllSets } from '../sets/tests/test-helpers';
import { SCHEMA_VERSION } from './neutral-types';
import { EXCLUDED_RANDOM_CARDS } from './excluded-random-cards';
import { toPrinting } from './printing';
import { CONVENTIONS, Conventions } from './conventions';

/**
 * The `GET /v1/capabilities` payload (OpenAPI `Capabilities`): engine identity + the sets it
 * implements as a `code → card-count` map. "Supported" = every loadable card MINUS the
 * inline-`Math.random` set (out of scope, §9) MINUS cards in sets that fail to load headlessly (a
 * load-time exclusion, §8 — those never enter the registry). The runner takes each set's card ids
 * from `GET /v1/cards/{setCode}` and intersects those across engines by `printing`.
 */
export interface CapabilitiesResponse {
  engine: string;
  version: string;
  schemaVersion: string;
  /** Implemented set code (lowercased, the `printing` set component) → implemented-card count. */
  sets: { [setCode: string]: number };
  /**
   * This engine's declared representational conventions — the choices it makes where the rulebook
   * has no truth. The harness normalizes both engines with their own declarations before diffing
   * (rather than hardcoding one engine's style), AND asserts this engine actually follows each of
   * them across every card: a convention applied inconsistently is a defect, not a convention.
   */
  conventions: Conventions;
  /**
   * The BUILD this process is running, captured ONCE at module load — `<short-sha>` or
   * `<short-sha>-dirty`, or `unknown` off a git checkout.
   *
   * Why it is captured at load and not read per request: it must identify the code the PROCESS is
   * executing, not the state of somebody's working tree. Before this existed the harness inferred
   * twinleaf's commit by shelling `git rev-parse` against the local checkout — so editing a card
   * without restarting the server recorded the NEW commit while the OLD code answered every probe,
   * silently and with a perfectly plausible hash. That is the same shape as RE-129 (a stale
   * rotomancer deployment reporting an unchanged version string).
   *
   * It does NOT replace the behavioural fingerprint (`tools/engine_fingerprint.py`), which fails in
   * the opposite direction: a commit hash moves on a docs-only change (sensitive, not specific)
   * while the fingerprint moves only when PROBED behaviour changes (specific, not sensitive — it
   * missed the TA-309 card fix entirely). Both, or neither answers the question.
   */
  build: string;
  /** CF-84: optional contract features this adapter implements. `setup` = the pre-deal
   *  `initialState` and the setup walk (`driver.ts` `startSetup`). */
  features: string[];
}

const ENGINE_NAME = 'twinleaf';
const ENGINE_VERSION: string = (require('../../package.json') as { version: string }).version;

/** See `CapabilitiesResponse.build`. Resolved once, at module load, so it names the running code. */
const ENGINE_BUILD: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process');
    const opts = { cwd: __dirname, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as const };
    const sha = execSync('git rev-parse --short HEAD', opts).toString().trim();
    // A dirty tree is NOT a build id. Say so rather than reporting a hash that names code nobody ran.
    const dirty = execSync('git status --porcelain', opts).toString().trim().length > 0;
    return sha ? (dirty ? `${sha}-dirty` : sha) : 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * CF-23: every card this engine can INSTANTIATE via `/v1/step` — the full loaded registry. This is
 * the catalog: `capabilities.sets` counts + the `/v1/cards/{code}` listings, guaranteed consistent
 * (every counted card is enumerable and vice-versa). Idempotent `loadAllSets()` is a no-op in
 * production where start.js pre-loads them; a load-failing set's cards never enter the registry, so
 * they are naturally absent. Nondeterministic cards (inline `Math.random`, see `isNondeterministic`)
 * are INCLUDED here — they are fully instantiable and a deterministic scenario over one (asserting
 * before its random branch) is testable — but MARKED on their projected card so a caller can tell the
 * random branch is not cross-engine reproducible. Previously they were dropped from the catalog
 * entirely, which silently SKIPPED every valid scenario referencing them (CF-23; e.g. asr-146).
 */
let catalogCardsCache: Card[] | undefined;

export function catalogCards(): Card[] {
  // The registry is static after loadAllSets(), so memoize: capabilities + every /v1/cards/{set}
  // request would otherwise re-scan the whole registry.
  if (catalogCardsCache !== undefined) {
    return catalogCardsCache;
  }
  loadAllSets();
  catalogCardsCache = CardManager.getInstance().getAllCards();
  return catalogCardsCache;
}

const EXCLUDED_RANDOM_SET = new Set(EXCLUDED_RANDOM_CARDS);
let nondeterministicCtorsCache: Function[] | undefined;

/**
 * CF-23: the leaf constructors of cards with an inline-random (`Math.random`) effect path. `EXCLUDED_
 * RANDOM_CARDS` is text-derived: it lists the fullNames found in files that literally call Math.random.
 * Reprints defined as subclasses in `other-prints.ts` (e.g. `TeamRocketsMeowthASC extends
 * TeamRocketsMeowth`) inherit the nondeterministic reduceEffect but carry a fullName the scanner never
 * sees, so they escape the list. Close the gap by inheritance: any card that is an instanceof a
 * directly-listed card's leaf class is nondeterministic too. Constructors collected are leaf card
 * classes, so `instanceof` only ever matches that card and its reprints — never unrelated cards.
 */
function nondeterministicCtors(): Function[] {
  if (nondeterministicCtorsCache !== undefined) {
    return nondeterministicCtorsCache;
  }
  nondeterministicCtorsCache = catalogCards()
    .filter(c => EXCLUDED_RANDOM_SET.has(c.fullName))
    .map(c => c.constructor);
  return nondeterministicCtorsCache;
}

/**
 * CF-23: does this card have an inline-random effect path (not externalized to the `system` seam)?
 * Such a card is cataloged (instantiable) but its random branch is not cross-engine reproducible, so
 * it is flagged `nondeterministic:true` on its projected printed data.
 */
export function isNondeterministic(card: { fullName: string }): boolean {
  return EXCLUDED_RANDOM_SET.has(card.fullName)
    || nondeterministicCtors().some(ctor => card instanceof (ctor as new () => unknown));
}

export function buildCapabilities(): CapabilitiesResponse {
  // Count DISTINCT printings per set so each count === the length of `GET /v1/cards/{code}` (which
  // also dedupes by printing) — a printing can back more than one registry Card object.
  const perSet: { [setCode: string]: Set<string> } = {};
  for (const card of catalogCards()) {
    const code = card.set.toLowerCase();
    (perSet[code] ?? (perSet[code] = new Set<string>())).add(toPrinting(card));
  }
  const sets: { [setCode: string]: number } = {};
  for (const code of Object.keys(perSet)) {
    sets[code] = perSet[code].size;
  }

  return {
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    build: ENGINE_BUILD,
    schemaVersion: SCHEMA_VERSION,
    sets,
    conventions: CONVENTIONS,
    features: ['setup'],
  };
}
