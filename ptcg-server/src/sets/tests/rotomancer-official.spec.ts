import * as fs from 'fs';
import * as path from 'path';
import { getCardByName } from './test-helpers';
import { resolvePrinting } from './rotomancer/bridge';
import { PokemonCard } from '../../game/store/card/pokemon-card';
import { CardType } from '../../game/store/card/card-types';

/**
 * Static cross-check of Twinleaf card data against the snapshot's authoritative card metadata
 * (HP / weakness / retreat / evolvesFrom), for every exact-printing card in the IR corpus. No
 * execution — pure data comparison, so mismatches are clean Twinleaf data bugs. Known ones are
 * allow-listed (see FINDINGS.md); a new one fails.
 */

interface OfficialCard {
  printingId: string; name: string; hp: number | null;
  weaknesses: string[]; resistances: string[]; retreat: number; evolvesFrom: string | null;
}

const TYPE: Record<string, CardType> = {
  Grass: CardType.GRASS, Fire: CardType.FIRE, Water: CardType.WATER, Lightning: CardType.LIGHTNING,
  Psychic: CardType.PSYCHIC, Fighting: CardType.FIGHTING, Darkness: CardType.DARK, Metal: CardType.METAL,
  Dragon: CardType.DRAGON, Colorless: CardType.COLORLESS, Fairy: CardType.FAIRY,
};

// "printingId:axis" -> reason. Clean Twinleaf data bugs vs authoritative official data; the fix
// is to correct the Twinleaf card, deferred to the user. See FINDINGS.md.
const KNOWN: Record<string, string> = {
  'sv8-145:hp': 'Slakoth SSP: Twinleaf HP 90, official 60',
  'sv9-86:hp': "Hop's Silicobra JTG: Twinleaf HP 60, official 80",
  'sv10-219:retreat': "Team Rocket's Persian ex DRI: Twinleaf retreat 1, official 2",
};

function typeSet(names: string[]): string {
  return names.map(n => TYPE[n]).sort((a, b) => a - b).join(',');
}

describe('Twinleaf vs official card data — HP / weakness / retreat / evolvesFrom', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'official-metadata.json');
  const cards = JSON.parse(fs.readFileSync(file, 'utf8')).cards as OfficialCard[];

  const hp: string[] = [], weakness: string[] = [], retreat: string[] = [], evo: string[] = [];
  let checked = 0;

  for (const o of cards) {
    const res = resolvePrinting(o.printingId, o.name);
    if (res.status !== 'exact') continue;
    const card = getCardByName(res.fullName!);
    if (!(card instanceof PokemonCard)) continue;
    checked++;
    const allowed = (axis: string) => KNOWN[`${o.printingId}:${axis}`] !== undefined;

    if (!allowed('hp') && o.hp !== null && card.hp !== o.hp) {
      hp.push(`${o.printingId} ${o.name}: official ${o.hp} vs Twinleaf ${card.hp}`);
    }
    const officialWeak = typeSet(o.weaknesses);
    const twinWeak = card.weakness.map(w => w.type).sort((a, b) => a - b).join(',');
    if (!allowed('weakness') && officialWeak !== twinWeak) {
      weakness.push(`${o.printingId} ${o.name}: official [${o.weaknesses.join(',')}] vs Twinleaf [${card.weakness.map(w => w.type).join(',')}]`);
    }
    if (!allowed('retreat') && card.retreat.length !== o.retreat) {
      retreat.push(`${o.printingId} ${o.name}: official ${o.retreat} vs Twinleaf ${card.retreat.length}`);
    }
    const officialEvo = o.evolvesFrom ?? '';
    const twinEvo = card.evolvesFrom ?? '';
    if (!allowed('evolvesFrom') && officialEvo !== twinEvo) {
      evo.push(`${o.printingId} ${o.name}: official "${officialEvo}" vs Twinleaf "${twinEvo}"`);
    }
  }

  /* eslint-disable no-console */
  it('reports the data cross-check scorecard', () => {
    console.log(`\n  official data cross-check: checked ${checked}, hp ${hp.length}, weakness ${weakness.length}, retreat ${retreat.length}, evolvesFrom ${evo.length}`);
    [...hp.map(m => `HP ${m}`), ...weakness.map(m => `WEAK ${m}`), ...retreat.map(m => `RETREAT ${m}`), ...evo.map(m => `EVO ${m}`)]
      .forEach(m => console.log(`   • ${m}`));
    expect(checked).toBeGreaterThan(20);
  });
  /* eslint-enable no-console */

  it('HP matches official', () => expect(hp).toEqual([]));
  it('weakness matches official', () => expect(weakness).toEqual([]));
  it('retreat cost matches official', () => expect(retreat).toEqual([]));
  it('evolvesFrom matches official', () => expect(evo).toEqual([]));
});
