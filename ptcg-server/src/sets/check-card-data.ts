// @ts-nocheck
// Card-data integrity checker: compares each implemented card STUB against the set's card-data.json
// (the pokemontcg.io source the stubs were generated from). Mismatches mean a stub's stats drifted
// from its source — almost always because the stub was generated from a preliminary card-data.json
// and never regenerated after the data was corrected. Reads the REAL card objects (no TS parsing).
//
// Usage:
//   npx ts-node src/sets/check-card-data.ts                 # all sets with a card-data.json
//   npx ts-node src/sets/check-card-data.ts set-destined-rivals   # one set
//   npx ts-node src/sets/check-card-data.ts --summary        # counts only, no per-card list
//   npx ts-node src/sets/check-card-data.ts --json           # machine-readable

const fs = require('fs');
const path = require('path');
import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { CardType, SuperType } from '../game/store/card/card-types';

const TYPE_TO_CARDTYPE: Record<string, CardType> = {
  Grass: CardType.GRASS, Fire: CardType.FIRE, Water: CardType.WATER, Lightning: CardType.LIGHTNING,
  Psychic: CardType.PSYCHIC, Fighting: CardType.FIGHTING, Darkness: CardType.DARK, Metal: CardType.METAL,
  Colorless: CardType.COLORLESS, Fairy: CardType.FAIRY, Dragon: CardType.DRAGON,
};
const CARDTYPE_TO_NAME: Record<number, string> = {};
for (const [name, ct] of Object.entries(TYPE_TO_CARDTYPE)) {
  if (CARDTYPE_TO_NAME[ct] === undefined) CARDTYPE_TO_NAME[ct] = name;
}

function ctName(ct: CardType): string { return CARDTYPE_TO_NAME[ct] ?? String(ct); }
function typeMultiset(types: CardType[]): string { return types.slice().sort((a, b) => a - b).map(ctName).join(','); }
function dataTypeMultiset(names: string[]): string {
  return names.map(n => TYPE_TO_CARDTYPE[n]).sort((a, b) => a - b).map(ctName).join(',');
}
function dataDamage(s: string): number {
  const digits = String(s || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

interface Mismatch { card: string; field: string; stub: string; data: string; }

// Normalize a card name for pairing: strip accents/punctuation and the suffix conventions where
// Twinleaf and the dataset differ (LV.X, Prism Star ↔ ◇, "-GX" ↔ "GX"). Pairing by name (not by
// collector number) avoids false positives where a set's setNumbers don't align with the dataset.
function normName(n: string): string {
  return (n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[★δ]/g, '')                       // star/delta symbols
    .replace(/\b(star|prism|lv\.?x)\b/g, '')    // "X Star" ↔ "X ★", Prism Star, LV.X (NOT VSTAR)
    .replace(/[^a-z0-9]/g, '');
}

function collectCards(setDir: string): Card[] {
  const mod = require(path.join(__dirname, setDir));
  const cards: Card[] = [];
  for (const value of Object.values(mod)) {
    if (Array.isArray(value) && value.length > 0 && value[0] instanceof Card) {
      for (const c of value as Card[]) cards.push(c);
    }
  }
  return cards;
}

function checkSet(setDir: string): Mismatch[] {
  const dataPath = path.join(__dirname, setDir, 'card-data.json');
  if (!fs.existsSync(dataPath)) return [];
  const data: any[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // Index dataset Pokémon by normalized name (a name may have alt-art prints — keep them all).
  const byName = new Map<string, any[]>();
  for (const d of data) {
    if (d.supertype !== 'Pokémon') continue;
    const k = normName(d.name);
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(d);
  }

  const mismatches: Mismatch[] = [];
  const unpaired: string[] = [];
  for (const card of collectCards(setDir)) {
    if (!(card instanceof PokemonCard)) continue;
    const candidates = byName.get(normName(card.name));
    if (!candidates) {
      // Gallery/promo subset cards (non-numeric numbers like GG2/TG4) aren't in card-data.json —
      // that's a reference gap, not a Twinleaf bug. Only flag unpaired cards with a real number.
      if (/^\d+$/.test(String(card.setNumber))) unpaired.push(`${card.fullName} (#${card.setNumber})`);
      continue;
    }
    // Prefer the print at the same collector number; else any (alt-art prints share stats).
    const d = candidates.find(c => String(c.number) === String(card.setNumber)) ?? candidates[0];
    const tag = `${card.fullName} (#${card.setNumber})`;
    const push = (field: string, stub: any, dataVal: any) => mismatches.push({ card: tag, field, stub: String(stub), data: String(dataVal) });

    const dHp = parseInt(d.hp, 10);
    if (!isNaN(dHp) && card.hp !== dHp) push('hp', card.hp, dHp);
    if (d.types && d.types.length && ctName(card.cardType) !== d.types[0]) push('type', ctName(card.cardType), d.types[0]);

    const dWeak = dataTypeMultiset((d.weaknesses || []).map((w: any) => w.type));
    if (typeMultiset(card.weakness.map(w => w.type)) !== dWeak) push('weakness', typeMultiset(card.weakness.map(w => w.type)), dWeak);
    const dRes = dataTypeMultiset((d.resistances || []).map((r: any) => r.type));
    if (typeMultiset((card.resistance || []).map(r => r.type)) !== dRes) push('resistance', typeMultiset((card.resistance || []).map(r => r.type)), dRes);
    if (card.retreat.length !== (d.retreatCost || []).length) push('retreat', card.retreat.length, (d.retreatCost || []).length);

    const stubAttacks = card.attacks || [];
    const dataAttacks = d.attacks || [];
    if (stubAttacks.length !== dataAttacks.length) {
      push('attack-count', stubAttacks.map(a => a.name).join('|'), dataAttacks.map((a: any) => a.name).join('|'));
    } else {
      for (let i = 0; i < stubAttacks.length; i++) {
        const sa = stubAttacks[i], da = dataAttacks[i];
        if (sa.name !== da.name) push(`attack[${i}].name`, sa.name, da.name);
        const sc = typeMultiset(sa.cost || []), dc = dataTypeMultiset(da.cost || []);
        if (sc !== dc) push(`attack[${i}].cost (${sa.name})`, sc || '(none)', dc || '(none)');
        if (dataDamage(da.damage) !== (sa.damage || 0)) push(`attack[${i}].damage (${sa.name})`, sa.damage || 0, dataDamage(da.damage));
      }
    }
  }
  for (const u of unpaired) mismatches.push({ card: u, field: 'name-unpaired', stub: u.split(' (#')[0], data: '(no name match in card-data)' });
  return mismatches;
}

function fieldCat(f: string): string {
  return f.replace(/\[\d+\]/, '').replace(/ \(.*\)$/, '');
}

// Sets backfilled in Jan 2026 with NO source data (LLM from memory → wrong-printing hallucinations).
// Detected by high per-card error density; this is just a heuristic label for the report.
function severity(mismatches: Mismatch[], cards: number): string {
  const avg = cards ? mismatches.length / cards : 0;
  return avg >= 2.5 ? ' — ⚠️ severe (cards wrong in many fields; likely no-source backfill)' : '';
}

function emitReport(all: Record<string, Mismatch[]>) {
  const sets = Object.keys(all).filter(s => all[s].length).sort((a, b) => all[b].length - all[a].length);
  const total = sets.reduce((n, s) => n + all[s].length, 0);
  const byField: Record<string, number> = {};
  for (const s of sets) for (const m of all[s]) byField[fieldCat(m.field)] = (byField[fieldCat(m.field)] ?? 0) + 1;

  const out: string[] = [];
  out.push('# Card-data discrepancy report');
  out.push('');
  out.push('Auto-generated by `ptcg-server/src/sets/check-card-data.ts --report`. It compares every');
  out.push('implemented card **stub** against its set\'s `card-data.json` (the pokemontcg.io source the');
  out.push('stubs should match). Cards are paired by **normalized name** (not collector number), so this');
  out.push('is immune to setNumber drift and naming conventions (LV.X / "-GX"↔"GX" / "Prism Star"↔"◇").');
  out.push('Each line is `field: <stub value> → should be <card-data value>`.');
  out.push('');
  out.push('**How to read this:** two distinct causes produced these. Sets generated *at release* from');
  out.push('fetched data (SV-era) are mostly **one wrong attack name** per card (provisional English');
  out.push('localization); the data is otherwise correct. Sets **backfilled with no source data** (the');
  out.push('Jan-2026 "Implement complete X set" burst — BLW/EPO/NXD/NVI and similar) are wrong in many');
  out.push('fields per card because the cards were hallucinated from the *wrong printing* — those are');
  out.push('flagged ⚠️ severe below.');
  out.push('');
  out.push('**Caveats:** gallery/promo subset cards (non-numeric numbers like `GG2`/`TG4`) are skipped —');
  out.push('`card-data.json` does not include those subsets, so it is a reference gap, not a bug. Naming');
  out.push('conventions (Star↔★, LV.X, Prism Star, "-GX"↔"GX") are normalized away. So the few remaining');
  out.push('`name-unpaired` rows are real: a typo, or a card placed at the wrong collector number /');
  out.push('invented by the no-source backfill. Attack damage compares the leading integer, so `20×`/');
  out.push('`120+` computed attacks are not flagged.');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push(`- **${total} discrepancies across ${sets.length} sets**`);
  out.push(`- By field: ${Object.entries(byField).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ')}`);
  out.push('');
  out.push('| set | discrepancies | cards |');
  out.push('|---|---|---|');
  for (const s of sets) {
    const cards = new Set(all[s].map(m => m.card)).size;
    out.push(`| ${s} | ${all[s].length} | ${cards} |`);
  }
  out.push('');

  for (const s of sets) {
    const byCard = new Map<string, Mismatch[]>();
    for (const m of all[s]) (byCard.get(m.card) ?? byCard.set(m.card, []).get(m.card)!).push(m);
    out.push(`## ${s} — ${all[s].length} discrepancies across ${byCard.size} cards${severity(all[s], byCard.size)}`);
    out.push('');
    for (const [card, list] of byCard) {
      out.push(`**${card}**`);
      for (const m of list) {
        out.push(m.field === 'name-unpaired'
          ? `- name: \`${m.stub}\` has no matching card in card-data.json (typo / invented / source gap)`
          : `- ${m.field}: \`${m.stub}\` → should be \`${m.data}\``);
      }
      out.push('');
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}

function main() {
  const args = process.argv.slice(2);
  const summary = args.includes('--summary');
  const json = args.includes('--json');
  const report = args.includes('--report');
  const setArg = args.find(a => !a.startsWith('--'));

  const setsDir = __dirname;
  const sets = setArg
    ? [setArg]
    : fs.readdirSync(setsDir).filter((d: string) =>
        d.startsWith('set-') && fs.existsSync(path.join(setsDir, d, 'card-data.json')));

  const all: Record<string, Mismatch[]> = {};
  for (const s of sets) {
    try { all[s] = checkSet(s); } catch (e: any) { all[s] = []; console.error(`  [skip ${s}] ${e.message}`); }
  }

  if (json) { process.stdout.write(JSON.stringify(all, null, 1) + '\n'); return; }
  if (report) { emitReport(all); return; }

  const tally: Record<string, number> = {};
  let total = 0;
  const setsSorted = Object.keys(all).sort((a, b) => all[b].length - all[a].length);
  for (const s of setsSorted) {
    const ms = all[s];
    if (ms.length === 0) continue;
    total += ms.length;
    const byField: Record<string, number> = {};
    for (const m of ms) {
      const cat = m.field.replace(/\[\d+\]/, '').replace(/ \(.*\)$/, '');
      byField[cat] = (byField[cat] ?? 0) + 1;
      tally[cat] = (tally[cat] ?? 0) + 1;
    }
    console.log(`\n${s}: ${ms.length} mismatches  ${JSON.stringify(byField)}`);
    if (!summary) {
      for (const m of ms) console.log(`   • ${m.card} — ${m.field}: stub "${m.stub}" vs data "${m.data}"`);
    }
  }
  console.log(`\n──────── TOTAL: ${total} stat mismatches across ${setsSorted.filter(s => all[s].length).length} sets ────────`);
  console.log('by field:', JSON.stringify(tally));
}

main();
