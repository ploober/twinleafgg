import { Card } from '../game/store/card/card';
import { CardManager } from '../game/cards/card-manager';
import { loadAllSets } from '../sets/tests/test-helpers';
import { SCHEMA_VERSION } from './neutral-types';
import { EXCLUDED_RANDOM_CARDS } from './excluded-random-cards';
import { toPrinting } from './printing';

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
}

const ENGINE_NAME = 'twinleaf';
const ENGINE_VERSION: string = (require('../../package.json') as { version: string }).version;

/**
 * Every card this engine "supports" for conformance: the full registry MINUS the inline-`Math.random`
 * cards (and their subclass reprints). Shared by capabilities.ts and cards.ts so the `sets` counts
 * and the `/v1/cards` listings are guaranteed consistent (every counted card is enumerable and
 * vice-versa). Idempotent `loadAllSets()` is a no-op in production where start.js pre-loads them; a
 * load-failing set's cards simply never enter the registry, so they are naturally excluded.
 */
let supportedCardsCache: Card[] | undefined;

export function supportedCards(): Card[] {
  // The registry is static after loadAllSets(), so memoize: capabilities + every /v1/cards/{set}
  // request would otherwise re-scan the whole registry (and re-run the O(cards) instanceof filter).
  if (supportedCardsCache !== undefined) {
    return supportedCardsCache;
  }
  loadAllSets();

  const excludedRandom = new Set(EXCLUDED_RANDOM_CARDS);
  const allCards = CardManager.getInstance().getAllCards();
  // EXCLUDED_RANDOM_CARDS is text-derived: it lists the fullNames found in files that literally call
  // Math.random. Reprints defined as subclasses in `other-prints.ts` (e.g. `TeamRocketsMeowthASC
  // extends TeamRocketsMeowth`) inherit the nondeterministic reduceEffect but carry a fullName the
  // scanner never sees, so they escape the list. Close the gap by inheritance: any card that is an
  // instanceof a directly-excluded card's class is nondeterministic too. Constructors collected are
  // leaf card classes, so `instanceof` only ever matches that card and its reprints — never unrelated
  // cards (which don't share a leaf class). Over-exclusion is limited to a hypothetical reprint that
  // overrides the attack to be deterministic — conservative-safe (lost coverage, never wrong).
  const excludedCtors = allCards.filter(c => excludedRandom.has(c.fullName)).map(c => c.constructor);
  const isExcluded = (c: { fullName: string }): boolean =>
    excludedRandom.has(c.fullName) || excludedCtors.some(ctor => c instanceof (ctor as new () => unknown));
  supportedCardsCache = allCards.filter(c => !isExcluded(c));
  return supportedCardsCache;
}

export function buildCapabilities(): CapabilitiesResponse {
  // Count DISTINCT printings per set so each count === the length of `GET /v1/cards/{code}` (which
  // also dedupes by printing) — a printing can back more than one registry Card object.
  const perSet: { [setCode: string]: Set<string> } = {};
  for (const card of supportedCards()) {
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
    schemaVersion: SCHEMA_VERSION,
    sets,
  };
}
