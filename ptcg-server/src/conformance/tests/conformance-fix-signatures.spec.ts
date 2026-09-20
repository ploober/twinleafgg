import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ── Anti-revert guard (the durable fix for the "silent merge revert" failure mode) ──
//
// On 2026-07-06 the origin/main "set reorg + cards" merge (2c14bc21d) moved every card file into
// numbered generation dirs AND, in the move, silently reverted ~21 previously-fixed src/sets cards
// back to origin/main's unpatched versions. The framework-level conformance suite stayed green because
// nothing in it exercised those specific cards — so the regressions were invisible until a differential
// fuzz run surfaced them days later.
//
// This spec closes that gap cheaply and comprehensively. `fix-signatures.json` records, per fixed card,
// one or two distinctive CODE lines that the fix introduced. Here we assert every one of those lines is
// still present in its file. A future merge that reverts a fix drops the line and fails THIS spec loudly,
// naming the exact card — no behavioral test per card required.
//
// Maintenance: when you land a new src/sets or src/game fix worth protecting, add an entry. When you
// intentionally refactor a fix (changing the lines), update its signatures here in the same commit.
//
// Remediation: when this spec fails after a merge, run the companion re-apply tool instead of hand-
// restoring each card — `python3 src/conformance/tools/reapply-reverted-fixes.py` (dry run) then
// `--apply`. It restores every reverted file from the newest commit that still carried its signatures.
//
// ── 2026-08-01: extended to src/game (the ENGINE), which was outside the guard entirely ──
//
// The manifest protected 237 signatures and every one resolved under src/sets, because the incident that
// prompted it was a card reorg. But this branch has modified 48 distinct files under src/game —
// prefabs.ts, the effect-reducers, pokemon-card-list.ts, store.ts, the turn reducer — and a silent revert
// there is strictly WORSE than a card revert: a reverted card breaks one card, a reverted prefab or
// reducer breaks a whole family at once. TA-167 alone spans 35 attacks across 33 cards, and TA-178's
// prefab has 28 call sites. Such a revert surfaces as a scatter of unrelated-looking divergences, which is
// the shape that is most expensive to attribute.
//
// Found the hole by landing TA-178 in `src/game/store/prefabs/prefabs.ts` and discovering the fix could
// not be registered at all — the ledger entry had to say so in prose.
//
// Entry shape: a `game/`-prefixed entry is resolved as a path relative to `src/` (engine files are not
// subject to the card generation-dir reorg, so the exact path is meaningful), with a last-two-components
// suffix search under src/game as the fallback if an upstream refactor moves the file. Anything else
// keeps the original `set-<name>/<base>.ts` suffix lookup under src/sets, unchanged.

// ── 2026-08-01 (later): `absentSignatures`, for fixes whose content is a DELETION ──
//
// Some fixes remove a line rather than add one — five Basics (unown-p, slugma, aipom, dondozo, meltan)
// each declared `evolvesFrom` pointing at THEMSELVES, and the fix is to delete that line. There is no
// added line to sign, so the convention until now was to sign an explanatory comment instead. That is
// weak coverage in the one direction that matters: an upstream revert that restores the bad line while
// leaving the comment in place passes the guard. `absentSignatures` inverts the assertion — the line
// MUST NOT be present — which is what a deletion-type fix actually claims.

interface FixEntry { file: string; signatures?: string[]; absentSignatures?: string[]; }
interface Manifest { fixes: FixEntry[]; }

const SRC_DIR = path.resolve(__dirname, '../..');
const SETS_DIR = path.join(SRC_DIR, 'sets');
const GAME_DIR = path.join(SRC_DIR, 'game');
const MANIFEST = path.resolve(__dirname, '../fix-signatures.json');
const BASELINE = path.resolve(__dirname, '../fix-coverage-baseline.json');
const REPO_DIR = path.resolve(SRC_DIR, '../..');   // twinleafgg root (src -> ptcg-server -> repo)

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Index every non-spec card file by its `set-<name>/<base>.ts` suffix (reorg-independent). */
function indexBySuffix(dir: string): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'tests') { walk(p); } continue; }
      if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts')) { continue; }
      const suffix = p.split(path.sep).slice(-2).join('/');
      (idx.get(suffix) ?? idx.set(suffix, []).get(suffix)!).push(p);
    }
  };
  walk(dir);
  return idx;
}

/** Is this entry an engine (src/game) entry rather than a card (src/sets) one? */
// An entry under src/game OR src/conformance names an exact src-relative path (the adapter is engine
// code for this purpose); only card-file entries resolve by suffix under src/sets. The locator used to
// send `conformance/...` entries to the sets index, where they resolved to 0 files and every such
// guard (choose-energy.ts, legal-actions.ts) failed for a reason unrelated to its fix.
const isGameEntry = (file: string): boolean => file.startsWith('game/') || file.startsWith('conformance/');

describe('Conformance — fix-signature anti-revert guard', () => {
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const index = indexBySuffix(SETS_DIR);
  const gameIndex = indexBySuffix(GAME_DIR);

  /**
   * Resolve an entry to the file(s) carrying it. Engine entries resolve by EXACT src-relative path
   * first — that path is stable and meaningful for engine code — and fall back to a suffix search so an
   * upstream move relocates rather than silently un-guards the fix. Returning 0 or >1 paths is itself a
   * finding and the caller fails on it.
   */
  const resolveEntry = (file: string): string[] => {
    if (!isGameEntry(file)) {
      return index.get(file) ?? [];
    }
    const direct = path.join(SRC_DIR, file);
    if (fs.existsSync(direct)) {
      return [direct];
    }
    return gameIndex.get(file.split('/').slice(-2).join('/')) ?? [];
  };
  // whitespace-normalized file bodies, cached by resolved path
  const bodies = new Map<string, string>();
  const bodyOf = (p: string): string => {
    if (!bodies.has(p)) { bodies.set(p, norm(fs.readFileSync(p, 'utf8'))); }
    return bodies.get(p)!;
  };

  it('the manifest is non-empty and well-formed', () => {
    expect(manifest.fixes.length).toBeGreaterThan(40);
    for (const fix of manifest.fixes) {
      expect(typeof fix.file).toBe('string');
      // Every entry must assert SOMETHING — a present line, an absent line, or both. An entry with
      // neither is a file that looks registered in the coverage report while guarding nothing.
      const present = fix.signatures ?? [];
      const absent = fix.absentSignatures ?? [];
      expect(present.length + absent.length).toBeGreaterThan(0);
    }
  });

  it('the engine (src/game) tier is populated — the guard must not silently regress to sets-only', () => {
    // This assertion exists because the hole it closes was invisible for a month: the manifest looked
    // healthy at 237 entries while protecting exactly zero engine files. A count that can only be read
    // in aggregate hides a whole missing tier, so the tier is asserted on its own.
    const gameFixes = manifest.fixes.filter(f => isGameEntry(f.file));
    expect(gameFixes.length).toBeGreaterThan(0);
    for (const fix of gameFixes) {
      expect(resolveEntry(fix.file).length).toBe(1);
    }
  });

  // ── Coverage ratchet ────────────────────────────────────────────────────────────────────────────
  //
  // Everything above answers "is what I registered still there?". It cannot answer "did I forget to
  // register something?" — and that is the question that actually bit us. On 2026-08-01 an upstream
  // merge reverted dri-208's attack-name line while this spec stayed GREEN, because the card's one
  // existing signature covered a different line in the same file (its Flame Screen behavior) which
  // survived. The card was half-guarded and nothing said so. The guard's value is bounded by its
  // coverage, and coverage was purely manual.
  //
  // So derive the question from GIT rather than from a doc someone must remember to update: every file
  // this branch changed under src/sets or src/game must be covered by some manifest entry, or be listed
  // in fix-coverage-baseline.json with a stated reason. The baseline ships EMPTY — the 468-file debt it
  // was designed to absorb was paid down instead (455 card files + 13 engine files registered on
  // 2026-08-01) — so this is currently a strict assertion, and any waiver added later is visible debt.
  //
  // Skips rather than fails when the comparison cannot be made (no git, no origin/main), because that
  // is an environment problem, not a coverage problem.
  it('every branch-changed src/sets and src/game file is signature-covered or explicitly waived', () => {
    const git = (...args: string[]): string | null => {
      try {
        return execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
      } catch {
        return null;
      }
    };
    const base = git('merge-base', 'origin/main', 'HEAD')?.trim();
    if (!base) {
      pending('no merge-base with origin/main here — coverage ratchet not enforced in this environment');
      return;
    }
    const diff = git('diff', '--name-only', '--diff-filter=d', base, 'HEAD', '--',
      'ptcg-server/src/sets', 'ptcg-server/src/game');
    if (diff === null) {
      pending('git diff unavailable — coverage ratchet not enforced in this environment');
      return;
    }
    const changed = diff.split('\n')
      .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.includes('/tests/'));

    const covered = new Set<string>();
    for (const fix of manifest.fixes) {
      for (const p of resolveEntry(fix.file)) {
        covered.add(path.relative(REPO_DIR, p).split(path.sep).join('/'));
      }
    }
    const waived: Record<string, string> = fs.existsSync(BASELINE)
      ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).waived ?? {}
      : {};

    const unaccounted = changed.filter(f => !covered.has(f) && !(f in waived));
    if (unaccounted.length > 0) {
      fail(
        `${unaccounted.length} file(s) changed on this branch are neither signature-protected nor waived.\n` +
        `      A 'take-upstream' merge would revert them with nothing to detect it.\n` +
        unaccounted.slice(0, 25).map(f => `        ${f}`).join('\n') +
        (unaccounted.length > 25 ? `\n        ... and ${unaccounted.length - 25} more` : '') +
        `\n      Fix by either:\n` +
        `        (a) registering a load-bearing line in fix-signatures.json — preferred; the bulk tool\n` +
        `            python3 src/conformance/tools/register_fix_signatures.py validates that each\n` +
        `            candidate is present at HEAD and ABSENT at the merge-base, i.e. that it can\n` +
        `            actually detect the revert, or\n` +
        `        (b) waiving it in fix-coverage-baseline.json with a real reason.`);
    }
  });

  // ── Ledger cross-check: every fix we WROTE DOWN must also be detectable when reverted ───────────
  //
  // The standing mandate is that a fix outside src/conformance gets an entry in the conformance
  // project's fix-ledger.md the same session. Nothing checked that it also got a signature. This is the
  // narrow, zero-false-alarm half of the enforcement story — the ratchet above is the broad half.
  //
  // Note what this does NOT enforce: "changed ⇒ ledgered". A fix can land with no ledger entry and this
  // stays quiet. That gap is deliberate — the coverage ratchet already makes every changed file
  // revert-detectable regardless of whether anyone wrote it down, so the ledger's job is provenance,
  // not protection.
  //
  // Lives in the conformance project (which owns the ledger), so it is invoked rather than reimplemented
  // and the two can never drift. Skips when that checkout or python is absent.
  it('every fix named in the conformance project fix-ledger is signature-protected', () => {
    const checker = path.resolve(REPO_DIR, '../pmtcg-conformance-tests/tools/check_ledger_signatures.py');
    if (!fs.existsSync(checker)) {
      pending('conformance project checkout not found beside twinleafgg — ledger cross-check skipped');
      return;
    }
    let out: string;
    try {
      out = execFileSync('python3', [checker], { encoding: 'utf8', maxBuffer: 16 << 20 });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      if (err.status === undefined) {
        pending('python3 unavailable — ledger cross-check skipped');
        return;
      }
      fail(`ledgered fixes are missing anti-revert signatures:\n${err.stdout ?? ''}`);
      return;
    }
    expect(out).toContain('0 UNPROTECTED');
  });

  for (const fix of manifest.fixes) {
    it(`fix survives in ${fix.file}`, () => {
      const paths = resolveEntry(fix.file);
      // Exactly one file must carry this entry — a reorg that duplicates or removes it is itself a red flag.
      if (paths.length !== 1) {
        const where = isGameEntry(fix.file) ? 'src/' : 'src/sets';
        fail(`expected exactly one ${fix.file} under ${where}, found ${paths.length}`);
        return;
      }
      const body = bodyOf(paths[0]);
      for (const sig of fix.signatures ?? []) {
        if (!body.includes(norm(sig))) {
          fail(`${fix.file} lost fixed line: ${sig}\n` +
            `      → restore with: python3 src/conformance/tools/reapply-reverted-fixes.py --apply`);
        }
      }
      for (const sig of fix.absentSignatures ?? []) {
        if (body.includes(norm(sig))) {
          fail(`${fix.file} REGAINED a line the fix deleted: ${sig}\n` +
            `      → a merge re-introduced it; delete it again (this fix removes the line, it does not add one)`);
        }
      }
    });
  }
});
