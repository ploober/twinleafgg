// @ts-nocheck
// Three-way card-data comparison: for every printed field, compare THREE sources and, when they
// disagree, name the outlier — using the independent reference as a tiebreaker.
//
//   (A) the implemented card CLASS              (what the engine actually plays)
//   (B) our per-set card-data.json              (pokemontcg.io — what the stubs were generated from)
//   (C) the pmtcg-conformance reference         (limitlesstcg.com — an INDEPENDENT second source)
//
// The audit of check-card-data.ts left "direction undetermined" for many class-vs-(B) discrepancies:
// when a class disagrees with our card-data.json, we couldn't tell which was wrong. (C) breaks the tie:
//   • class-wrong    — B and C agree, the CLASS is the outlier            → fix the card class
//   • ourdata-wrong  — class and C agree, our card-data.json is the outlier → our reference is stale
//   • ref-outlier    — class and B agree, the REFERENCE differs            → likely a reference quirk
//   • three-way-split— all three differ (or a source is missing the field) → needs a human
//
// Usage (from ptcg-server/, node v12):
//   node_modules/.bin/ts-node src/sets/check-card-data-3way.ts                 # all sets, summary
//   node_modules/.bin/ts-node src/sets/check-card-data-3way.ts set-base-set    # one set, detailed
//   node_modules/.bin/ts-node src/sets/check-card-data-3way.ts --verdict=class-wrong   # filter
//   node_modules/.bin/ts-node src/sets/check-card-data-3way.ts --json
//
// Override the reference location with REF_DIR=/path env var (default ~/projects/pmtcg-conformance-tests/card-data).

const fs = require('fs');
const path = require('path');
const os = require('os');
// Force any src/sets *.js with a sibling *.ts to resolve to the .ts — a stale committed compiled
// artifact otherwise breaks loading for several sets (see check-card-data.ts for the full story).
const Module = require('module');
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: any[]) {
  const r = _origResolve.call(this, request, ...rest);
  if (typeof r === 'string' && r.endsWith('.js') && r.includes(`${path.sep}sets${path.sep}`)
      && fs.existsSync(r.slice(0, -3) + '.ts')) { return r.slice(0, -3) + '.ts'; }
  return r;
};
import { Card } from '../game/store/card/card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { CardType } from '../game/store/card/card-types';

const REF_DIR = process.env.REF_DIR || path.join(os.homedir(), 'projects/pmtcg-conformance-tests/card-data');

// ── type / cost normalization ─────────────────────────────────────────────────────────────────────
const TYPE_TO_CARDTYPE: Record<string, CardType> = {
  Grass: CardType.GRASS, Fire: CardType.FIRE, Water: CardType.WATER, Lightning: CardType.LIGHTNING,
  Psychic: CardType.PSYCHIC, Fighting: CardType.FIGHTING, Darkness: CardType.DARK, Metal: CardType.METAL,
  Colorless: CardType.COLORLESS, Fairy: CardType.FAIRY, Dragon: CardType.DRAGON,
};
const CARDTYPE_TO_NAME: Record<number, string> = {};
for (const [name, ct] of Object.entries(TYPE_TO_CARDTYPE)) {
  if (CARDTYPE_TO_NAME[ct] === undefined) CARDTYPE_TO_NAME[ct] = name;
}
// Reference attack costs are single-letter codes (R=Fire, etc. — the standard TCG energy abbreviations).
const COST_LETTER: Record<string, string> = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting',
  D: 'Darkness', M: 'Metal', C: 'Colorless', Y: 'Fairy', N: 'Dragon',
};

function ctName(ct: CardType): string { return CARDTYPE_TO_NAME[ct] ?? String(ct); }
function multiset(names: string[]): string { return names.filter(Boolean).slice().sort().join(','); }
function classTypeMultiset(types: CardType[]): string { return multiset((types || []).map(ctName)); }
function nameTypeMultiset(names: string[]): string { return multiset(names || []); }              // already type-name strings
// The reference adds bookkeeping tokens to costs that class/our-data don't carry: "0" for a FREE attack
// ([] for us) and a "+" marker on Tag Team GX attacks. Drop both so the energy cost compares cleanly.
function letterCostMultiset(letters: string[]): string {
  return multiset((letters || []).filter(l => l !== '0' && l !== '+').map(l => COST_LETTER[l] ?? l));
}

// The project standard for inline energy in CLASS text is the [X] bracket (per README). Class text is
// therefore compared BYTE-FOR-BYTE (rawText) — accents (é !== e), quotes, dashes, whitespace all matter.
// The data sources only differ on the inline-symbol STANDARD: limitless already uses [X]; pokemontcg.io
// spells it out ("Grass Energy"). canonText canonicalizes the data TO [X], so a pure representation
// difference is a match — while any class that DEVIATES from the [X] standard (spells energy out, or uses
// <span> markup) no longer matches the canonical [X] and is flagged.
const ENERGY_WORD: Record<string, string> = {
  Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F',
  Darkness: 'D', Metal: 'M', Fairy: 'Y', Dragon: 'N', Colorless: 'C',
};
function rawText(s: any): string { return s === null || s === undefined ? '' : String(s); }
function canonText(s: any): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\b(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)\b/g,
    m => `[${ENERGY_WORD[m]}]`);
}
function dataDamage(s: any): number { const d = String(s ?? '').replace(/[^0-9]/g, ''); return d ? parseInt(d, 10) : 0; }

// Reference weakness/resistance/types is a string, an array, or null — and joins MULTIPLE types with
// "/" ("Fire/Fighting", delta-species "Fighting/Metal"). Normalize to a flat list of type names.
function refTypeList(v: any): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .flatMap(x => String(typeof x === 'string' ? x : (x && x.type) || '').split('/'))
    .map(s => s.trim())
    .filter(Boolean);
}

// Pair cards across sources by normalized name (immune to LV.X / "-GX"↔"GX" / Prism Star / accents).
function normName(n: string): string {
  return (n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[★δ]/g, '').replace(/\b(star|prism|lv\.?x)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function collectClassCards(setDir: string): Card[] {
  const mod = require(path.join(__dirname, setDir));
  const cards: Card[] = [];
  for (const value of Object.values(mod)) {
    if (Array.isArray(value) && value.length > 0 && value[0] instanceof Card) {
      for (const c of value as Card[]) cards.push(c);
    }
  }
  return cards;
}

// ── reference index: match our set dir to a reference file by ptcgoCode, then by set name ───────────
interface RefSet { file: string; cards: any[]; }
function buildRefIndex(): { byCode: Map<string, string>; byName: Map<string, string> } {
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  if (!fs.existsSync(REF_DIR)) return { byCode, byName };
  for (const f of fs.readdirSync(REF_DIR)) {
    if (!f.endsWith('.json')) continue;
    let j: any;
    try { j = JSON.parse(fs.readFileSync(path.join(REF_DIR, f), 'utf8')); } catch (e) { continue; }
    const set = j && j.set;
    if (set && set.code) byCode.set(String(set.code).toUpperCase(), f);
    if (set && set.name) byName.set(normName(set.name), f);
  }
  return { byCode, byName };
}

function loadRefForSet(ourData: any[], refIdx: { byCode: Map<string, string>; byName: Map<string, string> }): RefSet | undefined {
  const meta = (ourData.find((d: any) => d.set) || {}).set || {};
  const code = meta.ptcgoCode ? String(meta.ptcgoCode).toUpperCase() : undefined;
  let file = (code && refIdx.byCode.get(code)) || (meta.name && refIdx.byName.get(normName(meta.name)));
  if (!file) return undefined;
  const j = JSON.parse(fs.readFileSync(path.join(REF_DIR, file), 'utf8'));
  return { file, cards: (j && j.cards) || [] };
}

// ── per-card field comparison ───────────────────────────────────────────────────────────────────────
interface Triple { set: string; card: string; field: string; cls: string; ours: string; ref: string; verdict: string; }
const MISSING = '∅';
function val(v: any): string { return v === undefined || v === null ? MISSING : String(v); }

// a=class, b= our card-data, c=reference. Decide which source is the odd one out.
function verdictOf(a: string, b: string, c: string): string {
  if (a === b && b === c) return 'agree';
  if (c === MISSING) return 'no-ref';                 // reference lacks this card/field — can't tiebreak
  if (a === MISSING) return 'no-class';               // not implemented as a class
  if (b === MISSING) return 'no-ourdata';
  if (b === c && a !== b) return 'class-wrong';       // both data sources agree → the class is the outlier
  if (a === c && a !== b) return 'ourdata-wrong';     // class confirmed by independent ref → our data is stale
  if (a === b && a !== c) return 'ref-outlier';       // our pipeline agrees → the reference is the outlier
  return 'three-way-split';                            // all three differ
}

function compareCard(set: string, cardName: string, cls: any, ours: any, ref: any, out: Triple[]): void {
  const add = (field: string, a: any, b: any, c: any) => {
    const av = val(a), bv = val(b), cv = val(c);
    const verdict = verdictOf(av, bv, cv);
    if (verdict !== 'agree') out.push({ set, card: cardName, field, cls: av, ours: bv, ref: cv, verdict });
  };

  // hp
  add('hp',
    cls ? cls.hp : undefined,
    ours && ours.hp !== undefined ? parseInt(ours.hp, 10) : undefined,
    ref ? ref.hp : undefined);
  // primary type
  add('type',
    cls ? ctName(cls.cardType) : undefined,
    ours && ours.types && ours.types.length ? ours.types[0] : undefined,
    ref ? (refTypeList(ref.types)[0] ?? undefined) : undefined);
  // weakness / resistance — types only (the reference carries no ×2 / -20 value)
  add('weakness',
    cls ? classTypeMultiset((cls.weakness || []).map((w: any) => w.type)) : undefined,
    ours ? nameTypeMultiset((ours.weaknesses || []).map((w: any) => w.type)) : undefined,
    ref ? nameTypeMultiset(refTypeList(ref.weakness)) : undefined);
  add('resistance',
    cls ? classTypeMultiset((cls.resistance || []).map((r: any) => r.type)) : undefined,
    ours ? nameTypeMultiset((ours.resistances || []).map((r: any) => r.type)) : undefined,
    ref ? nameTypeMultiset(refTypeList(ref.resistance)) : undefined);
  // retreat cost — compare the COUNT (reference stores it as a number)
  add('retreat',
    cls ? (cls.retreat || []).length : undefined,
    ours ? (ours.retreatCost || []).length : undefined,
    ref && ref.retreat !== undefined ? ref.retreat : undefined);

  // attacks — paired by position (all sources list them top-to-bottom as printed)
  const ca = (cls && cls.attacks) || [], oa = (ours && ours.attacks) || [], ra = (ref && ref.attacks) || [];
  const n = Math.max(ca.length, oa.length, ra.length);
  if (new Set([cls && ca.length, ours && oa.length, ref && ra.length].filter(x => x !== undefined && x !== null)).size > 1) {
    add('attack-count', cls ? ca.length : undefined, ours ? oa.length : undefined, ref ? ra.length : undefined);
  }
  for (let i = 0; i < n; i++) {
    const c0 = ca[i], o0 = oa[i], r0 = ra[i];
    add(`attack[${i}].name`, c0 && c0.name, o0 && o0.name, r0 && r0.name);
    add(`attack[${i}].cost`,
      c0 ? (classTypeMultiset(c0.cost || []) || '(none)') : undefined,
      o0 ? (nameTypeMultiset(o0.cost || []) || '(none)') : undefined,
      r0 ? (letterCostMultiset(r0.cost || []) || '(none)') : undefined);
    add(`attack[${i}].damage`,
      c0 ? (c0.damage || 0) : undefined,
      o0 ? dataDamage(o0.damage) : undefined,
      r0 ? dataDamage(r0.damage) : undefined);
    add(`attack[${i}].text`,
      c0 ? rawText(c0.text) : undefined,
      o0 ? canonText(o0.text) : undefined,
      r0 ? canonText(r0.text) : undefined);
  }

  // abilities / Poké-Powers / Poké-Bodies — name + rules text, paired by position
  const cp = (cls && cls.powers) || [], op = (ours && ours.abilities) || [], rp = (ref && ref.abilities) || [];
  const m = Math.max(cp.length, op.length, rp.length);
  if (new Set([cls && cp.length, ours && op.length, ref && rp.length].filter(x => x !== undefined && x !== null)).size > 1) {
    add('ability-count', cls ? cp.length : undefined, ours ? op.length : undefined, ref ? rp.length : undefined);
  }
  for (let i = 0; i < m; i++) {
    const c1 = cp[i], o1 = op[i], r1 = rp[i];
    add(`ability[${i}].name`, c1 && c1.name, o1 && o1.name, r1 && r1.name);
    add(`ability[${i}].text`,
      c1 ? rawText(c1.text) : undefined,
      o1 ? canonText(o1.text) : undefined,
      r1 ? canonText(r1.text) : undefined);
  }
}

function checkSet(setDir: string, refIdx: any): { triples: Triple[]; refFile?: string; noRef?: boolean } {
  const dataPath = path.join(__dirname, setDir, 'card-data.json');
  if (!fs.existsSync(dataPath)) return { triples: [] };
  const ourData: any[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const refSet = loadRefForSet(ourData, refIdx);
  if (!refSet) return { triples: [], noRef: true };

  // Index our card-data and the reference's Pokémon by normalized name (keep alt-art prints together).
  const indexBy = (arr: any[], pred: (d: any) => boolean) => {
    const m = new Map<string, any[]>();
    for (const d of arr) { if (!pred(d)) continue; const k = normName(d.name); (m.get(k) ?? m.set(k, []).get(k)!).push(d); }
    return m;
  };
  const ourIdx = indexBy(ourData, d => d.supertype === 'Pokémon');
  const refIdxByName = indexBy(refSet.cards, d => d.supertype === 'Pokémon');
  const pick = (cands: any[] | undefined, num: any) =>
    cands ? (cands.find(c => String(c.number) === String(num)) ?? cands[0]) : undefined;

  const triples: Triple[] = [];
  for (const card of collectClassCards(setDir)) {
    if (!(card instanceof PokemonCard)) continue;
    const key = normName(card.name);
    const ours = pick(ourIdx.get(key), card.setNumber);
    const ref = pick(refIdxByName.get(key), card.setNumber);
    if (!ours && !ref) continue;                       // gallery/promo subset with no data either side
    compareCard(setDir, `${card.fullName} (#${card.setNumber})`, card, ours, ref, triples);
  }
  return { triples, refFile: refSet.file };
}

// ── reporting ─────────────────────────────────────────────────────────────────────────────────────
const VERDICT_ORDER = ['class-wrong', 'ourdata-wrong', 'three-way-split', 'ref-outlier', 'no-ref', 'no-ourdata', 'no-class'];
function fieldCat(f: string): string { return f.replace(/\[\d+\]/, ''); }

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const summary = args.includes('--summary');
  const verdictArg = (args.find(a => a.startsWith('--verdict=')) || '').split('=')[1];
  const setArgs = args.filter(a => !a.startsWith('--'));

  const refIdx = buildRefIndex();
  if (refIdx.byCode.size === 0) {
    console.error(`No reference files found at ${REF_DIR} — set REF_DIR or check the path.`);
    process.exit(1);
  }

  const setsDir = __dirname;
  const sets = setArgs.length
    ? setArgs
    : fs.readdirSync(setsDir).filter((d: string) => d.startsWith('set-') && fs.existsSync(path.join(setsDir, d, 'card-data.json')));

  const all: Record<string, Triple[]> = {};
  const noRef: string[] = [];
  const loadErr: { set: string; error: string }[] = [];
  for (const s of sets) {
    try {
      const r = checkSet(s, refIdx);
      if (r.noRef) { noRef.push(s); continue; }
      all[s] = r.triples;
    } catch (e: any) {
      if (fs.existsSync(path.join(setsDir, s, 'index.ts'))) loadErr.push({ set: s, error: e.message });
    }
  }

  let triples: Triple[] = [];
  for (const s of Object.keys(all)) triples = triples.concat(all[s]);
  if (verdictArg) triples = triples.filter(t => t.verdict === verdictArg);

  if (json) { process.stdout.write(JSON.stringify({ triples, noRef, loadErr }, null, 1) + '\n'); return; }

  // Tallies
  const byVerdict: Record<string, number> = {};
  const byVerdictField: Record<string, Record<string, number>> = {};
  for (const t of triples) {
    byVerdict[t.verdict] = (byVerdict[t.verdict] || 0) + 1;
    (byVerdictField[t.verdict] = byVerdictField[t.verdict] || {});
    const c = fieldCat(t.field); byVerdictField[t.verdict][c] = (byVerdictField[t.verdict][c] || 0) + 1;
  }

  console.log('\n════════ THREE-WAY CARD-DATA COMPARISON ════════');
  console.log('class = implemented card  |  ours = card-data.json  |  ref = pmtcg-conformance (limitlesstcg)\n');
  for (const v of VERDICT_ORDER) {
    if (!byVerdict[v]) continue;
    console.log(`  ${v.padEnd(16)} ${String(byVerdict[v]).padStart(5)}   ${JSON.stringify(byVerdictField[v])}`);
  }
  console.log(`  ${'TOTAL'.padEnd(16)} ${String(triples.length).padStart(5)}   (across ${Object.keys(all).filter(s => all[s].length).length} sets)`);
  if (noRef.length) console.log(`\n  ${noRef.length} set(s) had NO reference file (not compared): ${noRef.map(s => s.replace('set-', '')).join(', ')}`);
  if (loadErr.length) console.log(`\n  ⚠️  ${loadErr.length} set(s) failed to load: ${loadErr.map(s => s.set).join(', ')}`);

  // Detail: the two actionable verdicts (or whatever --verdict / a single set selected). Per-set detail
  // when a single set is named; otherwise list the class-wrong + ourdata-wrong findings (the tiebreaks).
  const show = verdictArg ? triples
    : setArgs.length === 1 ? triples
      : triples.filter(t => t.verdict === 'class-wrong' || t.verdict === 'ourdata-wrong');
  if (!summary && show.length) {
    console.log(`\n──────── detail (${show.length}) ────────`);
    const bySet = new Map<string, Triple[]>();
    for (const t of show) (bySet.get(t.set) ?? bySet.set(t.set, []).get(t.set)!).push(t);
    for (const [s, list] of bySet) {
      console.log(`\n${s}:`);
      for (const t of list) {
        console.log(`   • ${t.card} — ${t.field} [${t.verdict}]  class="${t.cls}" ours="${t.ours}" ref="${t.ref}"`);
      }
    }
  }
}

main();
