import { Card } from '../game/store/card/card';

/**
 * The conformance card identity (`printing`, OpenAPI `Printing`): the cross-engine comparison key.
 * Form: lowercased twinleaf 3-letter set code + '-' + zero-padded collector number — e.g.
 * `Ralts SIT` → `sit-060`, `Water Energy SVE` → `sve-002`. Both engines share the standard 3-letter
 * set abbreviations, so no official sv-numbering map is needed; the `iid` carries instance identity.
 */

/** twinleaf `Card` → its set-number printing. */
export function toPrinting(card: Card): string {
  return `${card.set.toLowerCase()}-${padNumber(card.setNumber)}`;
}

function padNumber(setNumber: string): string {
  // Standard collector numbers are numeric → zero-pad to 3. Alpha promo numbers pass through lowercased.
  return /^\d+$/.test(setNumber) ? setNumber.padStart(3, '0') : setNumber.toLowerCase();
}

/**
 * Parse a set-number printing back to twinleaf's (UPPER-case set code, unpadded collector number), or
 * `null` when the string is a `fullName` instead (back-compat: fullNames carry a space — "Ralts SIT" —
 * which a set-number printing never does).
 */
export function resolvePrinting(printing: string): { set: string; setNumber: string } | null {
  if (printing.includes(' ')) { return null; }
  const dash = printing.lastIndexOf('-');
  if (dash <= 0 || dash === printing.length - 1) { return null; }
  const set = printing.slice(0, dash).toUpperCase();
  const raw = printing.slice(dash + 1);
  const setNumber = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw; // strip the zero-padding for lookup
  return { set, setNumber };
}
