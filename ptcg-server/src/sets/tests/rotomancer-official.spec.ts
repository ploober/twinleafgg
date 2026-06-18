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
  attacks: Array<{ name: string; damage: number | null }>;
}

const TYPE: Record<string, CardType> = {
  Grass: CardType.GRASS, Fire: CardType.FIRE, Water: CardType.WATER, Lightning: CardType.LIGHTNING,
  Psychic: CardType.PSYCHIC, Fighting: CardType.FIGHTING, Darkness: CardType.DARK, Metal: CardType.METAL,
  Dragon: CardType.DRAGON, Colorless: CardType.COLORLESS, Fairy: CardType.FAIRY,
};

// "printingId:axis" -> reason. Clean Twinleaf data bugs vs authoritative official data; the fix
// is to correct the Twinleaf card, deferred to the user. See FINDINGS.md.
const KNOWN: Record<string, string> = {
  // HP errors (official is authoritative):
  'sv8-145:hp': 'Slakoth SSP: Twinleaf 90, official 60',
  'sv9-86:hp': "Hop's Silicobra JTG: Twinleaf 60, official 80",
  'sv10-193:hp': "Misty's Psyduck DRI: Twinleaf 50, official 70",
  'sv10-45:hp': "Misty's Psyduck DRI: Twinleaf 50, official 70",
  'sv5-18:hp': 'Grubbin TEF: Twinleaf 60, official 70',
  'sv5-32:hp': 'Litten TEF: Twinleaf 60, official 70',
  'sv9-104:hp': "N's Klang JTG: Twinleaf 160, official 90",
  'sv9-87:hp': "Hop's Sandaconda JTG: Twinleaf 90, official 140 (also weakness+retreat wrong — likely wrong card data)",
  // Weakness errors — several Grass Pokémon given Fighting instead of Fire:
  'sv10-9:weakness': 'Mow Rotom DRI: Twinleaf Fighting, official Fire',
  'sv5-18:weakness': 'Grubbin TEF: Twinleaf Fighting, official Fire',
  'sv7-17:weakness': 'Toedscool SCR: Twinleaf Fighting, official Fire',
  'sv9-6:weakness': 'Petilil JTG: Twinleaf Fighting, official Fire',
  'sv9-87:weakness': "Hop's Sandaconda JTG: Twinleaf Lightning, official Grass",
  // Retreat-cost errors:
  'sv10-219:retreat': "Team Rocket's Persian ex DRI: Twinleaf 1, official 2",
  'sv10-150:retreat': "Team Rocket's Persian ex DRI: Twinleaf 1, official 2",
  'sv10-137:retreat': "Marnie's Morpeko DRI: Twinleaf 1, official 0",
  'sv7-57:retreat': 'Slowpoke SCR: Twinleaf 1, official 2',
  'sv9-87:retreat': "Hop's Sandaconda JTG: Twinleaf 1, official 3",
  // evolvesFrom:
  'sv7-103:evolvesFrom': 'Meltan: Twinleaf "Meltan" (a Basic should be empty)',
  'sv10-115:evolvesFrom': "Team Rocket's Nidorina: cosmetic — Twinleaf has a space before ♀",
  'sv10-118:evolvesFrom': "Team Rocket's Nidorino: cosmetic — Twinleaf has a space before ♂",
  // Attack damage (flat-damage attacks only):
  'sv10-156:damage:Wing Attack': 'Taillow DRI: Twinleaf 10, official 20',
  'sv10-9:damage:Trimming Mower': 'Mow Rotom DRI: Twinleaf 0 (no damage), official 20',
};

function typeSet(names: string[]): string {
  return names.map(n => TYPE[n]).sort((a, b) => a - b).join(',');
}

describe('Twinleaf vs official card data — HP / weakness / retreat / evolvesFrom', () => {
  const file = path.join(__dirname, 'rotomancer', 'fixtures', 'official-metadata.json');
  const cards = JSON.parse(fs.readFileSync(file, 'utf8')).cards as OfficialCard[];

  const hp: string[] = [], weakness: string[] = [], retreat: string[] = [], evo: string[] = [], damage: string[] = [];
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
    // Attack damage, matched by attack name (name-diff attacks are covered by the structural spec).
    for (const oa of o.attacks) {
      if (oa.damage === null) continue;
      const ta = card.attacks.find(a => a.name === oa.name);
      if (!ta) continue;
      if (!allowed(`damage:${oa.name}`) && ta.damage !== oa.damage) {
        damage.push(`${o.printingId} ${o.name} "${oa.name}": official ${oa.damage} vs Twinleaf ${ta.damage}`);
      }
    }
  }

  /* eslint-disable no-console */
  it('reports the data cross-check scorecard', () => {
    console.log(`\n  official data cross-check: checked ${checked}, hp ${hp.length}, weakness ${weakness.length}, retreat ${retreat.length}, evolvesFrom ${evo.length}, damage ${damage.length}`);
    [...hp.map(m => `HP ${m}`), ...weakness.map(m => `WEAK ${m}`), ...retreat.map(m => `RETREAT ${m}`), ...evo.map(m => `EVO ${m}`), ...damage.map(m => `DMG ${m}`)]
      .forEach(m => console.log(`   • ${m}`));
    expect(checked).toBeGreaterThan(20);
  });
  /* eslint-enable no-console */

  it('HP matches official', () => expect(hp).toEqual([]));
  it('weakness matches official', () => expect(weakness).toEqual([]));
  it('retreat cost matches official', () => expect(retreat).toEqual([]));
  it('evolvesFrom matches official', () => expect(evo).toEqual([]));
  it('attack damage matches official', () => expect(damage).toEqual([]));
});
