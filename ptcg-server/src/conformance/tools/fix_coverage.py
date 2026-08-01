#!/usr/bin/env python3
"""fix_coverage.py — the ratchet that keeps the anti-revert guard's coverage from silently rotting.

WHY THIS EXISTS
---------------
`fix-signatures.json` answers "is what I registered still there?".  It cannot answer "did I forget to
register something?" — and that second question is the one that actually bit us.  On 2026-08-01 an
upstream merge reverted dri-208's attack-name line while the guard stayed GREEN, because the card's
existing signature covered a *different* line in the same file (its Flame Screen behavior), which
survived.  The card was half-guarded and nothing said so.  The guard's value is bounded by its
coverage, and coverage was purely manual.

WHAT THIS DOES
--------------
Derives the coverage question from **git**, not from a doc someone has to remember to update:

    changed = files this branch modified under src/sets and src/game vs the merge-base with origin/main
    covered = files that at least one fix-signature entry resolves to
    gap     = changed - covered

Every file in the gap must be listed in `fix-coverage-baseline.json` with a stated reason.  The
baseline is seeded from today's state so the check starts GREEN, and the invariant is a RATCHET: the
waived list may shrink but never grow.  A newly-changed file must be registered in the manifest or
explicitly waived — either way, someone made a decision and wrote down why.

DELIBERATELY NOT DONE: auto-generating signatures from the diff.  An auto-picked line is usually
incidental, so it breaks on legitimate refactors, and a guard that cries wolf gets ignored — which is
strictly worse than no guard, because it still looks like coverage.  Signatures are hand-picked to be
semantically load-bearing (`base, [SpecialCondition.POISONED]` *is* the TA-167 fix).

USAGE
    python3 src/conformance/tools/fix_coverage.py            # check (exit 1 on new unprotected files)
    python3 src/conformance/tools/fix_coverage.py --report   # full breakdown, never fails
    python3 src/conformance/tools/fix_coverage.py --seed     # (re)write the baseline from current state
    python3 src/conformance/tools/fix_coverage.py --prune    # drop waivers for files now covered/unchanged
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONF_DIR = os.path.dirname(HERE)                 # src/conformance
SRC_DIR = os.path.dirname(CONF_DIR)              # src
PKG_DIR = os.path.dirname(SRC_DIR)               # ptcg-server
REPO_DIR = os.path.dirname(PKG_DIR)              # twinleafgg
MANIFEST = os.path.join(CONF_DIR, 'fix-signatures.json')
BASELINE = os.path.join(CONF_DIR, 'fix-coverage-baseline.json')

SETS_DIR = os.path.join(SRC_DIR, 'sets')
GAME_DIR = os.path.join(SRC_DIR, 'game')

# Paths whose changes are structurally not "fixes worth protecting".  Kept tiny and explicit — this is
# not a place to hide debt; anything genuinely unprotected belongs in the baseline with a reason.
EXCLUDE_SUFFIXES = ('.spec.ts',)
EXCLUDE_PARTS = ('/tests/',)


def run_git(*args):
    return subprocess.run(
        ['git', '-C', REPO_DIR, *args],
        capture_output=True, text=True, check=False)


def index_by_suffix(root):
    """Index every non-spec .ts by its `<parent>/<base>.ts` suffix — mirrors the spec's resolver."""
    idx = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != 'tests']
        for name in filenames:
            if not name.endswith('.ts') or name.endswith('.spec.ts'):
                continue
            p = os.path.join(dirpath, name)
            suffix = '/'.join(p.split(os.sep)[-2:])
            idx.setdefault(suffix, []).append(p)
    return idx


def resolve_entry(entry_file, sets_idx, game_idx):
    """Resolve a manifest entry to the file(s) carrying it. Mirrors conformance-fix-signatures.spec.ts."""
    if not entry_file.startswith('game/'):
        return sets_idx.get(entry_file, [])
    direct = os.path.join(SRC_DIR, entry_file)
    if os.path.exists(direct):
        return [direct]
    return game_idx.get('/'.join(entry_file.split('/')[-2:]), [])


def rel_to_pkg(abs_path):
    """Absolute path -> repo-relative (e.g. ptcg-server/src/sets/set-x/y.ts)."""
    return os.path.relpath(abs_path, REPO_DIR).replace(os.sep, '/')


def is_trackable(rel):
    if not rel.endswith('.ts'):
        return False
    if rel.endswith(EXCLUDE_SUFFIXES):
        return False
    if any(part in rel for part in EXCLUDE_PARTS):
        return False
    return True


def changed_files():
    """Files this branch changed under src/sets + src/game, vs the merge-base with origin/main.

    Returns (base_sha, sorted_rel_paths).  Returns (None, []) when the comparison cannot be made
    (no git, no origin/main) so callers can skip rather than fail on an environment problem.
    """
    base = run_git('merge-base', 'origin/main', 'HEAD')
    if base.returncode != 0:
        return None, []
    base_sha = base.stdout.strip()
    diff = run_git('diff', '--name-only', '--diff-filter=d', base_sha, 'HEAD', '--',
                   'ptcg-server/src/sets', 'ptcg-server/src/game')
    if diff.returncode != 0:
        return None, []
    files = [f for f in diff.stdout.split('\n') if f and is_trackable(f)]
    return base_sha, sorted(set(files))


def compute():
    manifest = json.load(open(MANIFEST, encoding='utf8'))
    sets_idx = index_by_suffix(SETS_DIR)
    game_idx = index_by_suffix(GAME_DIR)

    covered = set()
    unresolved = []
    for fix in manifest['fixes']:
        paths = resolve_entry(fix['file'], sets_idx, game_idx)
        if len(paths) != 1:
            unresolved.append((fix['file'], len(paths)))
        for p in paths:
            covered.add(rel_to_pkg(p))

    base_sha, changed = changed_files()
    gap = [f for f in changed if f not in covered]
    return {
        'base_sha': base_sha,
        'changed': changed,
        'covered': covered,
        'gap': gap,
        'unresolved': unresolved,
        'manifest_count': len(manifest['fixes']),
    }


def load_baseline():
    if not os.path.exists(BASELINE):
        return {'waived': {}}
    return json.load(open(BASELINE, encoding='utf8'))


def tier(rel):
    return 'game' if '/src/game/' in rel else 'sets'


def cmd_report(c):
    if c['base_sha'] is None:
        print('SKIP: cannot compare against origin/main (no git history or no origin/main ref).')
        return 0
    base = load_baseline()
    waived = base.get('waived', {})
    print(f"merge-base with origin/main: {c['base_sha']}")
    print(f"manifest entries: {c['manifest_count']}")
    for t in ('sets', 'game'):
        ch = [f for f in c['changed'] if tier(f) == t]
        gp = [f for f in c['gap'] if tier(f) == t]
        wv = [f for f in gp if f in waived]
        print(f"  src/{t:5s}: {len(ch):4d} changed | {len(ch) - len(gp):4d} covered | "
              f"{len(gp):4d} unprotected ({len(wv)} waived, {len(gp) - len(wv)} UNACCOUNTED)")
    stale = [f for f in waived if f not in c['gap']]
    if stale:
        print(f"  stale waivers (now covered or no longer changed): {len(stale)} — run --prune")
    if c['unresolved']:
        print(f"  manifest entries not resolving to exactly one file: {len(c['unresolved'])}")
        for f, n in c['unresolved'][:10]:
            print(f"    {f} -> {n} paths")
    return 0


def cmd_check(c):
    if c['base_sha'] is None:
        print('SKIP: cannot compare against origin/main; coverage ratchet not enforced here.')
        return 0
    waived = load_baseline().get('waived', {})
    unaccounted = [f for f in c['gap'] if f not in waived]
    if not unaccounted:
        print(f"OK: {len(c['changed'])} changed files, {len(c['gap'])} unprotected, all accounted for "
              f"({len(waived)} waived).")
        return 0
    print(f"FAIL: {len(unaccounted)} changed file(s) are neither signature-protected nor waived.\n")
    for f in unaccounted[:50]:
        print(f"  {f}")
    if len(unaccounted) > 50:
        print(f"  ... and {len(unaccounted) - 50} more")
    print("\nEach of these was modified on this branch and would be silently reverted by a"
          "\n'take-upstream' merge with nothing to detect it. For each, either:"
          "\n  (a) add an entry to src/conformance/fix-signatures.json naming a load-bearing line"
          "\n      the change introduced (preferred — this is what makes the revert detectable), or"
          "\n  (b) waive it in src/conformance/fix-coverage-baseline.json with a real reason"
          "\n      (pure reorg / upstream-owned / no fix content).")
    return 1


def cmd_seed(c):
    if c['base_sha'] is None:
        print('cannot seed: no comparison base.')
        return 1
    base = load_baseline()
    waived = dict(base.get('waived', {}))
    added = 0
    for f in c['gap']:
        if f not in waived:
            waived[f] = 'seeded 2026-08-01: pre-existing unprotected change, reason not yet audited'
            added += 1
    out = {
        'comment': base.get('comment', BASELINE_COMMENT),
        'seededFrom': c['base_sha'],
        'waived': dict(sorted(waived.items())),
    }
    json.dump(out, open(BASELINE, 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    open(BASELINE, 'a', encoding='utf8').write('\n')
    print(f"seeded {added} new waiver(s); baseline now holds {len(waived)}.")
    return 0


def cmd_prune(c):
    if c['base_sha'] is None:
        print('cannot prune: no comparison base.')
        return 1
    base = load_baseline()
    waived = base.get('waived', {})
    gap = set(c['gap'])
    kept = {k: v for k, v in waived.items() if k in gap}
    removed = len(waived) - len(kept)
    out = {
        'comment': base.get('comment', BASELINE_COMMENT),
        'seededFrom': base.get('seededFrom', c['base_sha']),
        'waived': dict(sorted(kept.items())),
    }
    json.dump(out, open(BASELINE, 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    open(BASELINE, 'a', encoding='utf8').write('\n')
    print(f"pruned {removed} stale waiver(s); baseline now holds {len(kept)}.")
    return 0


BASELINE_COMMENT = (
    'Ratchet baseline for the anti-revert guard. Every file listed here was modified on this branch '
    'under src/sets or src/game but has NO fix-signature protecting it, so an upstream take-upstream '
    'merge could revert it silently. The list may SHRINK but never GROW: a newly-changed unprotected '
    'file fails conformance-fix-coverage.spec.ts until it is either registered in fix-signatures.json '
    '(preferred) or waived here with a real reason. Paying this down means moving entries OUT.'
)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--report', action='store_true', help='full breakdown, never fails')
    ap.add_argument('--seed', action='store_true', help='(re)write the baseline from current state')
    ap.add_argument('--prune', action='store_true', help='drop waivers no longer needed')
    args = ap.parse_args()

    c = compute()
    if args.report:
        return cmd_report(c)
    if args.seed:
        return cmd_seed(c)
    if args.prune:
        return cmd_prune(c)
    return cmd_check(c)


if __name__ == '__main__':
    sys.exit(main())
