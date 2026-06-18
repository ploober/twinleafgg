import { getCardBySetAndNumber } from '../test-helpers';

/**
 * Maps a Rotomancer printingId prefix (e.g. "sv8") to the Twinleaf set code (e.g. "SSP").
 * Only the sv-era sets confirmed present in Twinleaf are mapped here; the Mega-Evolution
 * block (me1/me2/me2pt5/me3) and promos are deferred until their code mapping is pinned.
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

export interface ResolvedPrinting {
  printingId: string;
  fullName: string;
}

/** Resolves a Rotomancer printingId (e.g. "sv8-116") to the matching Twinleaf card's fullName. */
export function resolvePrintingId(printingId: string): ResolvedPrinting {
  const dash = printingId.indexOf('-');
  if (dash === -1) {
    throw new Error(`[rotomancer-bridge] Malformed printingId "${printingId}"`);
  }
  const prefix = printingId.slice(0, dash);
  const number = printingId.slice(dash + 1);
  const setCode = PREFIX_TO_SETCODE[prefix];
  if (!setCode) {
    throw new Error(`[rotomancer-bridge] No Twinleaf set code mapped for prefix "${prefix}" (${printingId})`);
  }
  const card = getCardBySetAndNumber(setCode, number);
  if (!card) {
    throw new Error(`[rotomancer-bridge] No Twinleaf card found for ${printingId} (${setCode}-${number})`);
  }
  return { printingId, fullName: card.fullName };
}

/** Maps a Rotomancer EnergyType name to a Twinleaf basic energy card fullName. */
export function energyToCard(energyType: string): string {
  const name = ENERGY_TO_CARD[energyType.toUpperCase()];
  if (!name) {
    throw new Error(`[rotomancer-bridge] No basic energy mapped for energy type "${energyType}"`);
  }
  return name;
}
