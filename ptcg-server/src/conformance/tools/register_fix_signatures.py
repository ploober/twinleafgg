#!/usr/bin/env python3
"""register_fix_signatures.py — bulk-register anti-revert signatures for already-landed card fixes.

THE PROBLEM THIS SOLVES
-----------------------
455 files under src/sets were modified on this branch with no fix-signature protecting them. That is
the population a 'take-upstream' merge reverts silently — dri-208 was in it, and the guard stayed green
through its revert because the card's one existing signature covered a different line that survived.
Registering them by hand is ~455 judgement calls; registering them blindly is worse than not
registering them, because a signature that survives its own revert is coverage that isn't there.

THE METHOD
----------
For each unprotected changed file, take the added lines of each diff hunk as a candidate signature
(contiguous lines joined — whitespace-normalized, so `name: 'X', damage: 20,` is a single specific
string rather than the generic `damage: 20,` on its own), then **prove the candidate discriminates**:

    present in the file at HEAD          — otherwise it is not a signature at all
    ABSENT in the file at the merge-base — otherwise a revert to upstream leaves it intact and the
                                           guard would stay green through exactly the event it exists
                                           to catch

Only candidates passing BOTH gates are registered. Everything else is reported and left for the
coverage baseline to waive with a reason. This is the difference between auto-generating signatures
(which I refused — an incidental line breaks on legitimate refactors and trains people to ignore the
guard) and auto-*validating* hand-shaped ones: the absent-at-base gate is the test that a human doing
this by hand is supposed to be performing anyway, applied uniformly.

USAGE
    python3 src/conformance/tools/register_fix_signatures.py           # dry run: what would register
    python3 src/conformance/tools/register_fix_signatures.py --apply   # write fix-signatures.json
"""

import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fix_coverage as fc  # noqa: E402  (shares the resolver so coverage and registration agree)

MAX_SIG_CHARS = 300
MIN_SIG_CHARS = 12

# Lines that are never a fix on their own: imports move under refactor, and a bare brace/paren says
# nothing about behavior. Comments ARE allowed — a deletion-type fix is often guarded by its own
# explanatory comment, which is the established convention in this manifest.
NOISE = re.compile(r"^\s*(import\s|export\s+\{|\}|\)|\{|;)\s*$")


def norm(s):
    return ' '.join(s.split())


def file_at(rev, rel):
    r = fc.run_git('show', f'{rev}:{rel}')
    return None if r.returncode != 0 else r.stdout


def hunks_added(base, rel):
    """Added-line blocks for one file, newest diff, as lists of contiguous lines."""
    d = fc.run_git('diff', '--unified=0', base, 'HEAD', '--', rel).stdout
    blocks, cur = [], []
    for line in d.split('\n'):
        if line.startswith('+++') or line.startswith('---'):
            continue
        if line.startswith('+'):
            cur.append(line[1:])
        else:
            if cur:
                blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    return blocks


def widened(head_lines, line, radius):
    """Anchor `line` in the HEAD file and return the contiguous window around it, joined.

    A one-line card-data fix like `damage: 20,` is too generic to stand alone — the card's other attack
    may deal 20 too, in which case the string survives its own revert. Widening to the neighbouring
    printed lines (`name: 'Razor Leaf', cost: [G], damage: 20,`) makes it specific to the site that
    actually changed, which is what the absent-at-base gate then verifies.
    """
    target = norm(line)
    out = []
    for i, l in enumerate(head_lines):
        if norm(l) != target:
            continue
        lo, hi = max(0, i - radius), min(len(head_lines), i + radius + 1)
        s = norm(' '.join(head_lines[lo:hi]))
        if MIN_SIG_CHARS <= len(s) <= MAX_SIG_CHARS:
            out.append(s)
    return out


def candidates(blocks, head_lines):
    """Signature candidates, most-specific first: whole block, shorter prefixes, then context-widened."""
    out, short = [], []
    for b in blocks:
        lines = [ln for ln in b if ln.strip() and not NOISE.match(ln)]
        if not lines:
            continue
        for take in (len(lines), 3, 2, 1):
            if take > len(lines):
                continue
            s = norm(' '.join(lines[:take]))
            if len(s) > MAX_SIG_CHARS:
                continue
            if len(s) < MIN_SIG_CHARS:
                short.append(lines[0])
                continue
            if s not in out:
                out.append(s)
    # Widen the too-short ones against the real file rather than discarding them: these are the
    # single-value card-data fixes, which are the largest and most revert-prone population there is.
    for line in short:
        for radius in (1, 2, 3):
            for s in widened(head_lines, line, radius):
                if s not in out:
                    out.append(s)
    # Last resort, for the case where every plain candidate ALSO exists at the merge-base (a duplicated
    # line elsewhere in the file): widen those too, so the signature pins the changed site specifically.
    for b in blocks:
        for line in [ln for ln in b if ln.strip() and not NOISE.match(ln)][:2]:
            for radius in (2, 3):
                for s in widened(head_lines, line, radius):
                    if s not in out:
                        out.append(s)
    return out


def pick(rel, base):
    """Return (signature, reason) — the first candidate present at HEAD and absent at the merge-base."""
    head_body = file_at('HEAD', rel)
    base_body = file_at(base, rel)
    if head_body is None:
        return None, 'file not readable at HEAD'
    head_n = norm(head_body)
    base_n = norm(base_body) if base_body is not None else ''
    blocks = hunks_added(base, rel)
    head_lines = head_body.split('\n')
    # A whole-file rewrite makes the entire file one added block, and block PREFIXES are then just the
    # imports and the class header — lines that trivially also exist at the merge-base. The genuinely
    # new line can sit anywhere inside. So look first at added lines that are individually absent from
    # the base file: those ARE the change, wherever they landed.
    novel = []
    for b in blocks:
        for ln in b:
            s = norm(ln)
            if not s or NOISE.match(ln) or (base_body is not None and s in base_n):
                continue
            for radius in (0, 1, 2):
                for w in (widened(head_lines, ln, radius) if radius else
                          ([s] if MIN_SIG_CHARS <= len(s) <= MAX_SIG_CHARS else [])):
                    if w not in novel:
                        novel.append(w)
    cands = novel + [c for c in candidates(blocks, head_lines) if c not in novel]
    if not cands:
        return None, 'no signable added line (deletion-type, import-only, or unanchorable change)'
    saw_present = False
    for s in cands:
        if s not in head_n:
            continue
        saw_present = True
        if base_body is not None and s in base_n:
            continue  # survives its own revert — worthless as a signature
        return s, 'ok'
    if not saw_present:
        return None, 'no candidate resolves in the current file (later edits moved the lines)'
    return None, 'every candidate is ALSO present at the merge-base — cannot discriminate a revert'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--apply', action='store_true', help='write the new entries into fix-signatures.json')
    ap.add_argument('--tier', choices=['sets', 'game', 'all'], default='sets')
    args = ap.parse_args()

    c = fc.compute()
    if c['base_sha'] is None:
        print('cannot run: no merge-base with origin/main.')
        return 1
    base = c['base_sha']
    gap = [f for f in c['gap']
           if args.tier == 'all' or f'/src/{args.tier}/' in f]
    print(f'merge-base {base} — {len(gap)} unprotected file(s) in tier {args.tier}\n')

    registered, rejected = [], []
    for rel in gap:
        sig, why = pick(rel, base)
        if sig is None:
            rejected.append((rel, why))
            continue
        # manifest key: `set-<name>/<base>.ts` for cards, `game/...` src-relative for engine
        parts = rel.split('/')
        key = '/'.join(parts[-2:]) if '/src/sets/' in rel else '/'.join(parts[parts.index('game'):])
        registered.append({'file': key, 'signatures': [sig],
                           'note': 'bulk-registered 2026-08-01; validated present@HEAD absent@merge-base'})

    print(f'REGISTERABLE: {len(registered)}')
    for e in registered[:5]:
        print(f"  {e['file']}\n      {e['signatures'][0][:110]}")
    print(f'\nNOT REGISTERABLE: {len(rejected)}')
    byreason = {}
    for rel, why in rejected:
        byreason.setdefault(why, []).append(rel)
    for why, files in sorted(byreason.items(), key=lambda kv: -len(kv[1])):
        print(f'  {len(files):4d}  {why}')
        for f in files[:3]:
            print(f'          {f.split("/")[-1]}')

    if not args.apply:
        print('\n(dry run — pass --apply to write)')
        return 0

    manifest = json.load(open(fc.MANIFEST, encoding='utf8'))
    # A handful of entries are `absentSignatures` waivers (a file whose fix is a DELETION, so there
    # is no added line to anchor on). They carry no `signatures` key, and assuming one crashed this
    # tool's own --apply path.
    have = {(f['file'], tuple(f.get('signatures', ()))) for f in manifest['fixes']}
    added = 0
    for e in registered:
        if (e['file'], tuple(e['signatures'])) in have:
            continue
        manifest['fixes'].append(e)
        added += 1
    json.dump(manifest, open(fc.MANIFEST, 'w', encoding='utf8'), indent=2, ensure_ascii=False)
    open(fc.MANIFEST, 'a', encoding='utf8').write('\n')
    print(f'\nwrote {added} new entries; manifest now holds {len(manifest["fixes"])}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
