import * as fs from 'fs';
import * as path from 'path';
import { Card } from '../game/store/card/card';

/**
 * The conformance card identity (`printing`, OpenAPI `Printing`): the cross-engine comparison key.
 * It is a pokemontcg.io id, at the strongest available granularity:
 *
 *   - the rotomancer canonical IDENTITY `cid` (e.g. `sve-3`) for cards in rotomancer's universe —
 *     every physical printing of a functionally-identical card collapses to one id, so two engines
 *     that loaded different printings still compare equal (reprint-safe); else
 *   - the card's own pokemontcg.io PRINTING id (e.g. `sv4-93`) for cards outside that universe —
 *     never cross-compared, so printing-level is harmless and still a stable canonical id.
 *
 * The mapping lives in `printing-registry.json` (generated; see the harness
 * `tools/gen_printing_registry.py`), keyed by twinleaf's own set form (lowercased set code + '-' +
 * zero-padded collector number). `iid` carries instance identity; `printing` is identity only.
 */
interface Registry {
  byPrinting: Record<string, string>;     // "sit-060" (twinleaf form) -> cross-engine id
  byId: Record<string, string[]>;         // id -> twinleaf-form printings of that identity
}

const REGISTRY: Registry = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'printing-registry.json'), 'utf8'));

function pad3(setNumber: string): string {
  return /^\d+$/.test(setNumber) ? setNumber.padStart(3, '0') : setNumber.toLowerCase();
}

/** twinleaf's current set-number form for a card, e.g. `Groudon PAR #93` -> `par-093`. */
function twinleafForm(set: string, setNumber: string): string {
  return `${set.toLowerCase()}-${pad3(setNumber)}`;
}

/** twinleaf `Card` -> its cross-engine `printing` id (registry); falls back to the set-number form
 *  for cards the registry doesn't cover (old sets without pokemontcg.io data). */
export function toPrinting(card: Card): string {
  const form = twinleafForm(card.set, card.setNumber);
  return REGISTRY.byPrinting[form] ?? form;
}

/** A fullName printing ("Ralts SIT") — accepted on input for in-process boards (carries a space). */
export function isFullName(printing: string): boolean {
  return printing.includes(' ');
}

function parseForm(s: string): { set: string; setNumber: string } | null {
  const dash = s.lastIndexOf('-');
  if (dash <= 0 || dash === s.length - 1) {
    return null;
  }
  const set = s.slice(0, dash).toUpperCase();
  const raw = s.slice(dash + 1);
  const setNumber = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw; // strip zero-padding for lookup
  return { set, setNumber };
}

/**
 * The twinleaf `(set, setNumber)` candidates to try for an incoming `printing`, in order:
 *   1. an identity/printing id -> every twinleaf-form printing of that identity (so an engine that
 *      implements a *different* printing of the card than the registry's representative still loads);
 *   2. otherwise parse the string itself (back-compat: an old set-number form, or a pokemontcg.io id
 *      whose set code happens to match twinleaf's).
 * Empty for a fullName (the caller resolves those by name).
 */
export function printingCandidates(printing: string): { set: string; setNumber: string }[] {
  if (isFullName(printing)) {
    return [];
  }
  const out: { set: string; setNumber: string }[] = [];
  for (const form of REGISTRY.byId[printing] ?? []) {
    const p = parseForm(form);
    if (p) {
      out.push(p);
    }
  }
  const self = parseForm(printing);
  if (self && !out.some(p => p.set === self.set && p.setNumber === self.setNumber)) {
    out.push(self);
  }
  return out;
}
