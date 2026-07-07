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
// Maintenance: when you land a new src/sets fix worth protecting, add an entry. When you intentionally
// refactor a fix (changing the lines), update its signatures here in the same commit.

interface FixEntry { file: string; signatures: string[]; }
interface Manifest { fixes: FixEntry[]; }

const SETS_DIR = path.resolve(__dirname, '../../sets');
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

describe('Conformance — fix-signature anti-revert guard', () => {
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const index = indexBySuffix(SETS_DIR);
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

  for (const fix of manifest.fixes) {
    it(`fix survives in ${fix.file}`, () => {
      const paths = index.get(fix.file) ?? [];
      // Exactly one file must carry this suffix — a reorg that duplicates or removes it is itself a red flag.
      if (paths.length !== 1) {
        fail(`expected exactly one ${fix.file} under src/sets, found ${paths.length}`);
        return;
      }
      const body = bodyOf(paths[0]);
      for (const sig of fix.signatures) {
        if (!body.includes(norm(sig))) {
          fail(`${fix.file} lost fixed line: ${sig}`);
        }
      }
    });
  }
});
