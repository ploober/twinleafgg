import { getCardBySetAndNumber } from '../test-helpers';
import { CardType } from '../../../game/store/card/card-types';

/** Maps a Rotomancer energy/cost type name to a Twinleaf CardType (for attack costs). */
export const COST_TO_CARDTYPE: Record<string, CardType> = {
  GRASS: CardType.GRASS,
  FIRE: CardType.FIRE,
  WATER: CardType.WATER,
  LIGHTNING: CardType.LIGHTNING,
  PSYCHIC: CardType.PSYCHIC,
  FIGHTING: CardType.FIGHTING,
  DARKNESS: CardType.DARK,
  METAL: CardType.METAL,
  DRAGON: CardType.DRAGON,
  FAIRY: CardType.FAIRY,
  COLORLESS: CardType.COLORLESS,
};

export function costToCardType(cost: string): CardType {
  const t = COST_TO_CARDTYPE[cost.toUpperCase()];
  if (t === undefined) {
    throw new Error(`[rotomancer-bridge] No CardType mapped for cost "${cost}"`);
  }
  return t;
}

/**
 * Maps a Rotomancer printingId prefix (e.g. "sv8") to the Twinleaf set code (e.g. "SSP").
 *
 * - sv-era prefixes are confirmed: same card, same collector number in both projects.
 * - zsv/rsv (Black Bolt / White Flare) are speculative: the Twinleaf set exists (SV11B/SV11W)
 *   but collector numbers do NOT reliably align (e.g. Terrakion is rsv10pt5-135 vs SV11W-54).
 *   They are mapped anyway because resolvePrinting() name-validates every hit, so a misaligned
 *   number safely resolves to `mismatch` (a skip) rather than a false match.
 * - Mega-Evolution block: me1 → MEG (Mega Evolution) and me2 → PFL (Phantasmal Flames) are mapped
 *   and collector numbers align (e.g. Mega Venusaur ex me1-3 = MEG-3, Mega Heracross ex me2-4 =
 *   PFL-4). me2pt5 (Erika's-prefixed cards) and me3 have no implemented Twinleaf printing yet, so
 *   they stay UNMAPPED (→ `unmapped` skip). As always, resolvePrinting() name-validates every hit,
 *   so any misaligned/unimplemented me1/me2 number degrades to a safe `mismatch` skip.
 */
export const PREFIX_TO_SETCODE: Record<string, string> = {
  sv5: 'TEF',
  sv6: 'TWM',
  sv6pt5: 'SFA',
  sv7: 'SCR',
  sv8: 'SSP',
  sv8pt5: 'PRE',
  sv9: 'JTG',
  sv10: 'DRI',
  svp: 'SVP',
  zsv10pt5: 'SV11B',
  rsv10pt5: 'SV11W',
  me1: 'MEG',
  me2: 'PFL',
};

/** Maps a Rotomancer EnergyType to a Twinleaf basic energy card. Colorless cost is paid with any basic. */
export const ENERGY_TO_CARD: Record<string, string> = {
  GRASS: 'Grass Energy SVE',
  FIRE: 'Fire Energy SVE',
  WATER: 'Water Energy SVE',
  LIGHTNING: 'Lightning Energy SVE',
  PSYCHIC: 'Psychic Energy SVE',
  FIGHTING: 'Fighting Energy SVE',
  DARKNESS: 'Darkness Energy SVE',
  METAL: 'Metal Energy SVE',
  COLORLESS: 'Water Energy SVE',
};

export type ResolutionStatus =
  | 'exact'      // mapped set + number resolves to a card whose name matches
  | 'mismatch'   // mapped set, but no card at that number, or a different card (e.g. number drift)
  | 'unmapped';  // no Twinleaf set code mapped for this prefix

export interface PrintingResolution {
  printingId: string;
  status: ResolutionStatus;
  setCode?: string;
  number?: string;
  fullName?: string;   // present iff status === 'exact'
  note?: string;
}

/** Normalize a card name for cross-project comparison (case, punctuation, accents, "ex"/"v" casing). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Resolves a Rotomancer printingId to a Twinleaf card, name-validating the hit for
 * printing precision. Never throws — callers branch on `status`. When `expectedName`
 * is given (the Rotomancer card name), a hit only counts as `exact` if the names match;
 * this is what makes a misaligned set/number map degrade to a safe skip.
 */
export function resolvePrinting(printingId: string, expectedName?: string): PrintingResolution {
  const dash = printingId.indexOf('-');
  if (dash === -1) {
    return { printingId, status: 'mismatch', note: `malformed printingId` };
  }
  const prefix = printingId.slice(0, dash);
  const number = printingId.slice(dash + 1);
  const setCode = PREFIX_TO_SETCODE[prefix];
  if (!setCode) {
    return { printingId, status: 'unmapped', number, note: `no set code for prefix "${prefix}"` };
  }

  const card = getCardBySetAndNumber(setCode, number);
  if (!card) {
    return { printingId, status: 'mismatch', setCode, number, note: `no card at ${setCode}-${number}` };
  }
  if (expectedName !== undefined && normalizeName(card.name) !== normalizeName(expectedName)) {
    return {
      printingId, status: 'mismatch', setCode, number,
      note: `name drift: ${setCode}-${number} is "${card.name}", expected "${expectedName}"`,
    };
  }
  return { printingId, status: 'exact', setCode, number, fullName: card.fullName };
}

export interface ResolvedPrinting {
  printingId: string;
  fullName: string;
}

/** Convenience for tests that require an exact match; throws otherwise. */
export function resolvePrintingId(printingId: string, expectedName?: string): ResolvedPrinting {
  const r = resolvePrinting(printingId, expectedName);
  if (r.status !== 'exact') {
    throw new Error(`[rotomancer-bridge] ${printingId} did not resolve exactly (${r.status}: ${r.note})`);
  }
  return { printingId, fullName: r.fullName! };
}

/** Maps a Rotomancer EnergyType name to a Twinleaf basic energy card fullName. */
export function energyToCard(energyType: string): string {
  const name = ENERGY_TO_CARD[energyType.toUpperCase()];
  if (!name) {
    throw new Error(`[rotomancer-bridge] No basic energy mapped for energy type "${energyType}"`);
  }
  return name;
}
