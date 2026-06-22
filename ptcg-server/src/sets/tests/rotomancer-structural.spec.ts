import * as fs from 'fs';
import * as path from 'path';
import { getCardByName } from './test-helpers';
import { resolvePrinting, costToCardType } from './rotomancer/bridge';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { CardType } from '../../game/store/card/card-types';

/**
 * Static cross-check: for every exact-printing attack in the IR corpus, does the native Twinleaf
 * card have an attack with the same name, and does its energy cost match the IR's? This needs no
 * execution (no choice/timing), so it cleanly surfaces attack-name typos and cost-data divergences
 * across all printings. Genuine discrepancies are allow-listed (see FINDINGS.md); a NEW one fails.
 */

interface Scenario { printingId: string; name: string; attackLabel: string; cost: string[]; }

// printingId + attackLabel -> reason. Real name/cost discrepancies; adjudication deferred. See
// FINDINGS.md. Close variants (spacing/plural/hyphen) are likely cosmetic; wholly different names
// mean one project has the wrong attack for that printing.
// The sv-era entries below were adjudicated against the official card data (rotomancer-official.spec.ts):
// in all cases the IR matches the official attack name, so TWINLEAF has the wrong name/cost. The me3/POR
// entry is a Japan-only Mega-era set whose English attack name isn't yet canonical → adjudication deferred.
const KNOWN: Record<string, string> = {
  'sv8-105 Cutting Wind': 'Twinleaf "Cutter Wind"; official + IR "Cutting Wind" → Twinleaf bug',
  'me3-46 Vengeful Kick': 'Hawlucha (Perfect Order, Japan-only Mega-era set): Twinleaf "Revenge Kick" vs IR/pokemontcg.io "Vengeful Kick" (リベンジキック ≈ "Revenge Kick" literal). Translation discrepancy — English name not yet canonical; adjudication deferred.',
  'sv10-82 Headbutt Bounce': 'Twinleaf printing has no attack by that name → Twinleaf bug',
  'sv8-137 Steaming Stomp': 'Twinleaf cost Fire; pokemontcg.io + IR Fighting; Limitless (independent) confirms FIRE → pokemontcg.io/IR dataset error, Twinleaf correct',
  'sv10-219 Haughty Order': 'Twinleaf "Haughty Orders"; official + IR "Haughty Order" → Twinleaf bug',
  'sv10-65 Crushing Press': 'Twinleaf "Crush Press"; official + IR "Crushing Press" → Twinleaf bug',
  'sv8-141 Dyna-Blast': 'Twinleaf "Dynablast"; official + IR "Dyna-Blast" → Twinleaf bug',
  'sv10-199 Explode Together Now': 'Twinleaf "All-Out Explosion"; official + IR "Explode Together Now" → Twinleaf bug',
  'sv10-219 Cruel Slash': 'Twinleaf "Slash and Cash"; official + IR "Cruel Slash" → Twinleaf bug',
  'sv10-78 Thunder Raid': 'Twinleaf "Thunder Blitz"; official + IR "Thunder Raid" → Twinleaf bug',
  'sv10-85 Chiming Commotion': 'Twinleaf "Ring Ring Noise"; official + IR "Chiming Commotion" → Twinleaf bug',
  'sv6-110 Ground Crasher': 'Twinleaf "Ground Crack"; official + IR "Ground Crasher" → Twinleaf bug',
  'sv8-128 Stick \'n\' Draw': 'Twinleaf "Plug and Draw"; official + IR "Stick \'n\' Draw" → Twinleaf bug',
  'sv8-141 World Ender': 'Twinleaf "World\'s End"; official + IR "World Ender" → Twinleaf bug',
  'sv9-49 Zapping Short': 'Twinleaf "Crackling Short"; official + IR "Zapping Short" → Twinleaf bug',
};

// Bulk attack-name/cost discrepancies surfaced by the larger peg-emit corpus, externalised to a
// fixture (it doubles as report data). Every entry: IR == official name/cost (100%), Twinleaf
// differs; spot-checked against Limitless (independent). Keyed by `printingId attackLabel`.
const KNOWN_BULK: Set<string> = new Set(
  (JSON.parse(fs.readFileSync(path.join(__dirname, 'rotomancer', 'fixtures', 'known-discrepancies.json'), 'utf8'))
    .discrepancies as Array<{ printingId: string; attackLabel: string }>)
    .map(d => `${d.printingId} ${d.attackLabel}`)
);

function sortedCost(types: CardType[]): string {
  return types.slice().sort((a, b) => a - b).join(',');
}

describe('Rotomancer structural cross-check — attack name + cost vs native', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'attack-scenarios.json');
  const scenarios = JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[];

  const nameMismatches: string[] = [];
  const costMismatches: string[] = [];
  let checked = 0;

  for (const s of scenarios) {
    const res = resolvePrinting(s.printingId, s.name);
    if (res.status !== 'exact') continue;
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) continue;
    const key = `${s.printingId} ${s.attackLabel}`;
    if (KNOWN[key] || KNOWN_BULK.has(key)) continue;

    const attack = card.attacks.find(a => a.name === s.attackLabel);
    if (!attack) {
      nameMismatches.push(`${s.printingId} "${s.attackLabel}" (${s.name}): native attacks = [${card.attacks.map(a => a.name).join(', ')}]`);
      continue;
    }
    checked++;
    let irCost: string;
    try {
      irCost = sortedCost(s.cost.map(costToCardType));
    } catch {
      continue; // unmappable cost token — ignore here
    }
    const nativeCost = sortedCost(attack.cost);
    if (irCost !== nativeCost) {
      costMismatches.push(`${s.printingId} "${s.attackLabel}" (${s.name}): IR [${s.cost.join(',')}] vs native [${attack.cost.join(',')}]`);
    }
  }

  /* eslint-disable no-console */
  it('reports the cross-check scorecard', () => {
    console.log(`\n  structural cross-check: checked ${checked}, name-mismatches ${nameMismatches.length}, cost-mismatches ${costMismatches.length}`);
    nameMismatches.forEach(m => console.log(`   • NAME ${m}`));
    costMismatches.forEach(m => console.log(`   • COST ${m}`));
    expect(checked).toBeGreaterThan(20);
  });
  /* eslint-enable no-console */

  it('has no unexpected attack-name mismatches', () => {
    expect(nameMismatches).toEqual([]);
  });

  it('has no unexpected attack-cost mismatches', () => {
    expect(costMismatches).toEqual([]);
  });
});
