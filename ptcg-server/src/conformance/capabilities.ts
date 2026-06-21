import { CardManager } from '../game/cards/card-manager';
import { loadAllSets } from '../sets/tests/test-helpers';
import { SCHEMA_VERSION } from './neutral-types';
import { EXCLUDED_RANDOM_CARDS } from './excluded-random-cards';
import { toPrinting } from './printing';

/**
 * The `GET /v1/capabilities` payload (OpenAPI `Capabilities`): engine identity + the testable card/set
 * intersection. "Supported" = every loadable card MINUS the inline-`Math.random` set (out of scope, §9)
 * MINUS cards in sets that fail to load headlessly (a load-time exclusion, §8 — those never enter the
 * registry). The runner intersects `implementedCards`/`supportedSets` across engines by `printing`.
 */
export interface CapabilitiesResponse {
  engine: string;
  version: string;
  schemaVersion: string;
  /** Sets this engine supports — lowercased 3-letter codes (the `printing` set component), sorted. */
  supportedSets: string[];
  /** Implemented card printings (set-number form), sorted. The cross-engine comparison key (§10.6). */
  implementedCards: string[];
}

const ENGINE_NAME = 'twinleaf';
const ENGINE_VERSION: string = (require('../../package.json') as { version: string }).version;

export function buildCapabilities(): CapabilitiesResponse {
  // Force-load all loadable sets (no-op in production where start.js pre-loads them); a load-failing
  // set's cards simply never enter the registry below, so they are naturally excluded.
  loadAllSets();

  const excludedRandom = new Set(EXCLUDED_RANDOM_CARDS);
  const supported = CardManager.getInstance().getAllCards().filter(c => !excludedRandom.has(c.fullName));
  const implementedCards = Array.from(new Set(supported.map(toPrinting))).sort();
  const supportedSets = Array.from(new Set(supported.map(c => c.set.toLowerCase()))).sort();

  return {
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    supportedSets,
    implementedCards,
  };
}
