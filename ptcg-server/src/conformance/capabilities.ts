import { CardManager } from '../game/cards/card-manager';
import { loadAllSets } from '../sets/tests/test-helpers';
import { SCHEMA_VERSION } from './neutral-types';
import { EXCLUDED_RANDOM_CARDS } from './excluded-random-cards';

/**
 * The `GET /v1/capabilities` payload (design §4.9, M6): the cards this engine supports, plus the
 * engine/schema versions. "Supported" = every loadable card MINUS the inline-`Math.random` set
 * (out of scope, §9) MINUS cards in sets that fail to load headlessly (a load-time exclusion, §8).
 * The conformance harness intersects `cards` with the other engine's list.
 */
export interface CapabilitiesResponse {
  engineVersion: string;
  schemaVersion: string;
  /** Supported card `fullName`s, sorted. */
  cards: string[];
  /** How many registered cards were dropped for using inline `Math.random`. */
  excludedRandomCount: number;
  /** Set codes whose modules failed to load headlessly (their cards are unsupported here). */
  excludedSets: string[];
}

const ENGINE_VERSION: string = (require('../../package.json') as { version: string }).version;

export function buildCapabilities(): CapabilitiesResponse {
  // Force-load all loadable sets (no-op in production where start.js pre-loads them), recording
  // load-failing set codes. A failed set's cards simply never enter the registry below.
  const { failedModules } = loadAllSets();
  const excludedSets = Array.from(
    new Set(failedModules.map(f => f.setCode).filter((c): c is string => c !== undefined))
  ).sort();

  const excludedRandom = new Set(EXCLUDED_RANDOM_CARDS);
  const all = CardManager.getInstance().getAllCards();
  const excludedRandomCount = all.reduce((n, c) => n + (excludedRandom.has(c.fullName) ? 1 : 0), 0);
  const cards = all
    .map(c => c.fullName)
    .filter(fullName => !excludedRandom.has(fullName))
    .sort();

  return {
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    cards,
    excludedRandomCount,
    excludedSets,
  };
}
