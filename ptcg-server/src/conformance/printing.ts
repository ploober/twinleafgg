import { Card } from '../game/store/card/card';

/**
 * The conformance card identity (`printing`, OpenAPI `Printing`): the cross-engine comparison key.
 * It is the CANONICAL cross-engine id — the printed/limitless set code (lowercased) plus a 3-digit
 * zero-padded collector number (`Drowzee SIT #60` -> `sit-060`, `Beldum TEF #113` -> `tef-113`) —
 * which is exactly the id `card-data/final/` keys on and the id rotomancer emits (design §6.1: both
 * engines emit the canonical id EXCLUSIVELY; there is no crosswalk / alias table).
 *
 * twinleaf's own `Card.set` / `Card.setNumber` already carry this form, so the `printing` is a
 * direct projection of `(set, setNumber)` and an incoming `printing` parses straight back to a
 * `(set, setNumber)` lookup — no registry indirection. `iid` carries instance identity; `printing`
 * is identity only.
 */

function pad3(setNumber: string): string {
  return /^\d+$/.test(setNumber) ? setNumber.padStart(3, '0') : setNumber.toLowerCase();
}

/** twinleaf's canonical set-number form for a card, e.g. `Beldum TEF #113` -> `tef-113`. */
function twinleafForm(set: string, setNumber: string): string {
  return `${set.toLowerCase()}-${pad3(setNumber)}`;
}

/** twinleaf `Card` -> its cross-engine canonical `printing` id. */
export function toPrinting(card: Card): string {
  return twinleafForm(card.set, card.setNumber);
}

/** A fullName printing ("Drowzee SIT") — accepted on input for in-process boards (carries a space). */
export function isFullName(printing: string): boolean {
  return printing.includes(' ');
}

function parseForm(s: string): { set: string; setNumber: string } | null {
  const dash = s.lastIndexOf('-');
  if (dash <= 0 || dash === s.length - 1) {
    return null;
  }
  // Case is NOT restored here, and does not need to be: the canonical printing id is all lowercase
  // (`pad3` above), a card declares its setNumber in printed case (`SV1`, `RC20`, `73A`), and
  // `CardManager`'s set-number index case-folds its key on both sides. Trying to restore case here
  // instead would be guesswork -- 234 classes want `SV1` from `sv1` while 12 (`bus-105a`,
  // `fco-043a`, ...) genuinely are lowercase, and no transform gets both.
  const set = s.slice(0, dash);
  const raw = s.slice(dash + 1);
  const setNumber = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw; // strip zero-padding for lookup
  return { set, setNumber };
}

/**
 * The twinleaf `(set, setNumber)` candidate for an incoming canonical `printing`. Since twinleaf's
 * own form IS the canonical id, this is a direct parse (`sit-060` -> `{ SIT, 60 }`), with the
 * zero-padding stripped for the lookup. Empty for a fullName (the caller resolves those by name).
 */
export function printingCandidates(printing: string): { set: string; setNumber: string }[] {
  if (isFullName(printing)) {
    return [];
  }
  const self = parseForm(printing);
  return self ? [self] : [];
}
