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

interface FixEntry { file: string; signatures: string[]; }
interface Manifest { fixes: FixEntry[]; }

const SRC_DIR = path.resolve(__dirname, '../..');
const SETS_DIR = path.join(SRC_DIR, 'sets');
const GAME_DIR = path.join(SRC_DIR, 'game');
const MANIFEST = path.resolve(__dirname, '../fix-signatures.json');

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
const isGameEntry = (file: string): boolean => file.startsWith('game/');

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
      expect(Array.isArray(fix.signatures)).toBe(true);
      expect(fix.signatures.length).toBeGreaterThan(0);
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
      for (const sig of fix.signatures) {
        if (!body.includes(norm(sig))) {
          fail(`${fix.file} lost fixed line: ${sig}\n` +
            `      → restore with: python3 src/conformance/tools/reapply-reverted-fixes.py --apply`);
        }
      }
    });
  }
});
