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
// A stale compiled artifact (a *.js committed next to its *.ts source) shadows the TypeScript when
// node resolves an extensionless import, and the ES-emitted class then can't extend the ts-node
// runtime base class ("Class constructor TrainerCard cannot be invoked without 'new'") — which made
// 6 sets (battle-styles, primal-clash, sun-and-moon, next-destinies, scarlet-and-violet, dragon-vault)
// silently fail to load and report 0 mismatches. Force any src/sets *.js that has a sibling *.ts to
// resolve to the .ts, so source always wins. (Self-contained; touches no repo files.)
const Module = require('module');
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: any[]) {
  const resolved = _origResolve.call(this, request, ...rest);
  if (typeof resolved === 'string' && resolved.endsWith('.js')
      && resolved.includes(`${path.sep}sets${path.sep}`)
      && fs.existsSync(resolved.slice(0, -3) + '.ts')) {
    return resolved.slice(0, -3) + '.ts';
  }
  return resolved;
};
import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { TrainerCard } from '../game/store/card/trainer-card';
import { EnergyCard } from '../game/store/card/energy-card';
import { CardType, SuperType, TrainerType, EnergyType } from '../game/store/card/card-types';

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

// Trainer / Energy classification. card-data tags a Trainer's *primary* role as one of these subtypes
// (the rest — Single Strike, ACE SPEC, Team Plasma … — are orthogonal tags); the engine stores it as
// TrainerType. Energy is Basic vs Special.
const TRAINER_TYPE_NAME: Record<number, string> = {
  [TrainerType.ITEM]: 'Item', [TrainerType.SUPPORTER]: 'Supporter',
  [TrainerType.STADIUM]: 'Stadium', [TrainerType.TOOL]: 'Tool',
};
// Resolve a Trainer's primary role from card-data subtypes, MOST-SPECIFIC first: a "Pokémon Tool" is
// also tagged "Item" in the dataset, but the engine models it as the distinct TOOL type, so Tool must
// win over Item (else every Tool reads as a false Tool-vs-Item mismatch).
function dataTrainerType(subtypes: string[]): TrainerType | undefined {
  const subs = subtypes || [];
  if (subs.includes('Pokémon Tool') || subs.includes('Pokémon Tool F')) return TrainerType.TOOL;
  if (subs.includes('Stadium')) return TrainerType.STADIUM;
  if (subs.includes('Supporter')) return TrainerType.SUPPORTER;
  if (subs.includes('Item')) return TrainerType.ITEM;
  return undefined;
}

// Trainer names carry a parenthetical subtitle in card-data ("Boss's Orders (Ghetsis)") and a trailing
// gear tag ("Head Ringer Team Flare Hyper Gear") that the stub drops; Energy names carry a "Basic"
// qualifier ("Basic Lightning Energy") and spell multi-type codes out ("Unit Energy GrassFireWater"
// where the stub writes "Unit Energy GRW"). Normalize those away so cards pair on their base identity.
function normTrainer(n: string): string {
  return normName(String(n || '').replace(/\([^)]*\)/g, '').replace(/team flare( hyper)? gear/gi, ''));
}
const ENERGY_CODE: Record<string, string> = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting',
  D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless',
};
function normEnergy(n: string): string {
  // Expand an all-caps type code (GRW → GrassFireWater) before lowercasing, so the stub's coded name
  // matches card-data's spelled-out one. Only all-uppercase runs of code letters are treated as codes.
  const expanded = String(n || '').replace(/\b([GRWLPFDMYNC]{2,5})\b/g,
    m => [...m].every(ch => ENERGY_CODE[ch]) ? [...m].map(ch => ENERGY_CODE[ch]).join('') : m);
  return normName(expanded.replace(/\bbasic\b/gi, ''));
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

// Validate a Trainer or Energy card against its card-data entry. Pokémon are handled inline in checkSet
// (they carry the rich stat/attack surface); Trainer/Energy expose far less in the engine, so we check
// the structural classification (Item/Supporter/Stadium/Tool, Basic/Special) plus name pairing — which
// is what catches an invented or mis-typed name, or a Supporter implemented as an Item.
function checkNonPokemon(card: Card, trainerByName: Map<string, any[]>, energyByName: Map<string, any[]>,
  mismatches: Mismatch[], unpaired: string[], setCode?: string): void {
  const tag = `${card.fullName} (#${card.setNumber})`;
  const push = (field: string, stub: any, dataVal: any) => mismatches.push({ card: tag, field, stub: String(stub), data: String(dataVal) });
  const pick = (candidates: any[]) => candidates.find(c => String(c.number) === String(card.setNumber)) ?? candidates[0];
  // Only flag an unpaired card as a discrepancy if it actually BELONGS to this set. A set index re-exports
  // reprints from other sets (other-prints.ts); those are validated against their own set's data, so
  // skip them here to avoid a false "not in card-data" (e.g. Welder UNB re-exported into Sword & Shield).
  const reportUnpaired = () => { if (/^\d+$/.test(String(card.setNumber)) && (!setCode || card.set === setCode)) unpaired.push(tag); };

  if (card instanceof TrainerCard) {
    const candidates = trainerByName.get(normTrainer(card.name));
    if (!candidates) { reportUnpaired(); return; }
    const d = pick(candidates);
    const dt = dataTrainerType(d.subtypes);
    if (dt !== undefined && card.trainerType !== dt) {
      push('trainer-type', TRAINER_TYPE_NAME[card.trainerType] ?? card.trainerType, TRAINER_TYPE_NAME[dt]);
    }
  } else if (card instanceof EnergyCard) {
    const candidates = energyByName.get(normEnergy(card.name));
    if (!candidates) { reportUnpaired(); return; }
    const d = pick(candidates);
    const subs: string[] = d.subtypes || [];
    const de = subs.includes('Basic') ? EnergyType.BASIC : subs.includes('Special') ? EnergyType.SPECIAL : undefined;
    if (de !== undefined && card.energyType !== de) {
      const nm = (e: EnergyType) => e === EnergyType.BASIC ? 'Basic' : 'Special';
      push('energy-type', nm(card.energyType), nm(de));
    }
  }
}

function checkSet(setDir: string): Mismatch[] {
  const dataPath = path.join(__dirname, setDir, 'card-data.json');
  if (!fs.existsSync(dataPath)) return [];
  const data: any[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // Index the dataset by normalized name, per supertype (a name may have alt-art prints — keep them all).
  const indexBy = (norm: (s: string) => string, supertype: string) => {
    const m = new Map<string, any[]>();
    for (const d of data) {
      if (d.supertype !== supertype) continue;
      const k = norm(d.name);
      (m.get(k) ?? m.set(k, []).get(k)!).push(d);
    }
    return m;
  };
  const byName = indexBy(normName, 'Pokémon');
  const trainerByName = indexBy(normTrainer, 'Trainer');
  const energyByName = indexBy(normEnergy, 'Energy');
  // This set's collector code (ptcgoCode), used to tell own-set cards from reprints a set index
  // re-exports from other sets (those are checked when their own set runs).
  const setEntry = data.find((d: any) => d.set && d.set.ptcgoCode);
  const setCode: string | undefined = setEntry ? setEntry.set.ptcgoCode : undefined;

  const mismatches: Mismatch[] = [];
  const unpaired: string[] = [];
  for (const card of collectCards(setDir)) {
    if (!(card instanceof PokemonCard)) { checkNonPokemon(card, trainerByName, energyByName, mismatches, unpaired, setCode); continue; }
    const candidates = byName.get(normName(card.name));
    if (!candidates) {
      // Gallery/promo subset cards (non-numeric numbers like GG2/TG4) aren't in card-data.json —
      // that's a reference gap, not a Twinleaf bug. Only flag unpaired cards with a real number that
      // actually belong to this set (not a reprint re-exported from another set).
      if (/^\d+$/.test(String(card.setNumber)) && (!setCode || card.set === setCode)) {
        unpaired.push(`${card.fullName} (#${card.setNumber})`);
      }
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

function emitReport(all: Record<string, Mismatch[]>, skipped: { set: string; error: string }[] = []) {
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
  out.push('conventions (Star↔★, LV.X, Prism Star, "-GX"↔"GX") are normalized away *for pairing only* —');
  out.push('a name typo or attack-name spacing/case difference (e.g. `Bubble Beam` vs `Bubblebeam`) is a');
  out.push('real discrepancy and IS flagged. So the remaining `name-unpaired` rows are real: a typo, or a');
  out.push('card placed at the wrong collector number / invented by the no-source backfill. Attack damage');
  out.push('compares the printed base value, so a stub storing `0` for a `40×`/`120+` attack IS flagged as');
  out.push('an inconsistency. Trainer (Item/Supporter/Stadium/Tool) and Energy (Basic/Special) cards are');
  out.push('classified too; their full rules text is not compared.');
  out.push('');
  if (skipped.length) {
    out.push(`> ⚠️ **${skipped.length} set(s) failed to load and were NOT checked** (their cards are absent below): `
      + skipped.map(s => s.set).join(', ') + '.');
    out.push('');
  }
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
  const setArgs = args.filter(a => !a.startsWith('--'));

  const setsDir = __dirname;
  const sets = setArgs.length
    ? setArgs
    : fs.readdirSync(setsDir).filter((d: string) =>
        d.startsWith('set-') && fs.existsSync(path.join(setsDir, d, 'card-data.json')));

  const all: Record<string, Mismatch[]> = {};
  const skipped: { set: string; error: string }[] = [];
  for (const s of sets) {
    try { all[s] = checkSet(s); }
    catch (e: any) {
      all[s] = [];
      // A set with card-data.json but no index.ts is data-only (nothing to validate) — not a real
      // skip. A set WITH an index that throws is a genuine load failure that would otherwise hide all
      // its cards behind a silent 0, so surface it loudly.
      if (fs.existsSync(path.join(setsDir, s, 'index.ts'))) skipped.push({ set: s, error: e.message });
    }
  }

  if (json) { process.stdout.write(JSON.stringify({ mismatches: all, skipped }, null, 1) + '\n'); return; }
  if (report) { emitReport(all, skipped); return; }

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
  if (skipped.length) {
    console.log(`\n⚠️  ${skipped.length} set(s) FAILED TO LOAD and were NOT checked (their cards are invisible above):`);
    for (const s of skipped) console.log(`   • ${s.set} — ${s.error}`);
  }
}

main();
