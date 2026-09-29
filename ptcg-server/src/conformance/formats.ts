import { Card } from '../game/store/card/card';
import { Format } from '../game/store/card/card-types';
import { CardManager } from '../game/cards/card-manager';
import { getValidFormats } from '../backend/controllers/decks';

/**
 * CF-85 — format on the wire. The formats this engine serves are declared by ID only
 * (`capabilities.formats`), every board names one (`GameState.format`, echoed in each response state), and
 * `GET /v1/cards/{set}?format=` lists the cards this engine considers LEGAL in that format — a claim the
 * harness tests against its card oracle.
 *
 * The legality claim is twinleaf's OWN deck validator (`getValidFormats` in the deck controller: release
 * dates, regulation marks, the Expanded ban list, the any-printing reprint rule), not a second copy of it —
 * the point is to test what twinleaf believes, so the adapter must not substitute a belief of its own.
 *
 * Formats (CF-85, contract 0.10.0): `standard` (today's rotation) and `unlimited` (every card, under the engine's
 * ordinary rules — `expanded` was unpinned). A format changes the card-pool claim and the echo, nothing in play.
 */
export const SERVED_FORMATS = ['standard', 'unlimited'] as const;
export type ServedFormat = typeof SERVED_FORMATS[number];

const ENGINE_FORMAT: Record<ServedFormat, Format> = {
  standard: Format.STANDARD,
  unlimited: Format.UNLIMITED,
};

/** A format the engine does not advertise. Maps to HTTP 400 on both endpoints (CF-85). */
export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFormatError';
  }
}

/**
 * The format a request names. ABSENT reads as `standard` — a ROLLOUT BRIDGE only (CF-85): the harness
 * always sends it, but ~50 local tools post boards without it; delete this default with the harness bridge.
 */
export function resolveFormat(f: unknown): ServedFormat {
  if (f === undefined || f === null) {
    return 'standard';
  }
  if (typeof f !== 'string' || !(SERVED_FORMATS as readonly string[]).includes(f)) {
    throw new UnsupportedFormatError(`format ${JSON.stringify(f)} is not served; this engine serves ${JSON.stringify(SERVED_FORMATS)} (CF-85)`);
  }
  return f as ServedFormat;
}

let allCardsCache: Card[] | undefined;

/** Whether twinleaf's own deck validator calls `card` legal in `format` (same-name printings considered). */
export function isLegalIn(card: Card, format: ServedFormat): boolean {
  if (allCardsCache === undefined) {
    allCardsCache = CardManager.getInstance().getAllCards();
  }
  return getValidFormats(card, allCardsCache).includes(ENGINE_FORMAT[format]);
}
