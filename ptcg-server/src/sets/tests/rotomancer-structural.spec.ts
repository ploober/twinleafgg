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
const KNOWN: Record<string, string> = {
  'sv8-105 Cutting Wind': 'Twinleaf names the attack "Cutter Wind" (typo) vs IR "Cutting Wind"',
  'sv10-82 Headbutt Bounce': 'Twinleaf printing has no attack by that name',
  'sv8-137 Steaming Stomp': 'cost-type mismatch: Twinleaf Fire vs IR Fighting (likely IR error)',
  // Close variants — likely cosmetic naming differences:
  'sv10-219 Haughty Order': 'IR "Haughty Order" vs Twinleaf "Haughty Orders" (plural)',
  'sv10-65 Crushing Press': 'IR "Crushing Press" vs Twinleaf "Crush Press"',
  'sv8-141 Dyna-Blast': 'IR "Dyna-Blast" vs Twinleaf "Dynablast" (hyphen)',
  // Wholly different attack names — one project has the wrong attack for this printing:
  'sv10-199 Explode Together Now': 'IR "Explode Together Now" vs Twinleaf "All-Out Explosion"',
  'sv10-219 Cruel Slash': 'IR "Cruel Slash" vs Twinleaf "Slash and Cash"',
  'sv10-78 Thunder Raid': 'IR "Thunder Raid" vs Twinleaf "Thunder Blitz"',
  'sv10-85 Chiming Commotion': 'IR "Chiming Commotion" vs Twinleaf "Ring Ring Noise"',
  'sv6-110 Ground Crasher': 'IR "Ground Crasher" vs Twinleaf "Ground Crack"',
  'sv8-128 Stick \'n\' Draw': 'IR "Stick \'n\' Draw" vs Twinleaf "Plug and Draw"',
  'sv8-141 World Ender': 'IR "World Ender" vs Twinleaf "World\'s End"',
  'sv9-49 Zapping Short': 'IR "Zapping Short" vs Twinleaf "Crackling Short"',
};

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
    if (KNOWN[`${s.printingId} ${s.attackLabel}`]) continue;

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
