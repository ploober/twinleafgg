#!/usr/bin/env python3
"""
Re-apply src/sets AND src/game fixes that an origin/main merge (or any commit) silently reverted.

Companion to the DETECTION guard (`conformance-fix-signatures.spec.ts` + `fix-signatures.json`).
The guard fails the suite loudly and names each card whose fixed line vanished; this tool does the
REMEDIATION automatically, turning "an upstream merge reverted N card fixes → re-apply each by hand"
(which cost hours across the 2026-07-06 and 07-07 merges) into one command.

How it works — for every entry in fix-signatures.json:
  1. Resolve the file the same way the guard does: `game/`-prefixed entries by exact src-relative
     path (engine files), everything else by reorg-independent `set-<name>/<base>.ts` suffix.
  2. Check whether all of the fix's signature lines are present (whitespace-normalized, same as guard).
  3. If any signature is MISSING (= reverted), walk the file's git history newest-first and find the
     most recent commit whose version of the file still carried ALL signatures — that is the last
     good version (post-reorg, correct import depth, including any later legit edits up to the revert).
  4. Restore that version to the working tree (`--apply`), then re-verify the signatures.

Default is a DRY RUN: it prints a plan and, per reverted file, the source commit and a diff summary vs
the current (reverted) file so you can eyeball whether the merge also made *legitimate* changes to that
card (in which case restore-then-reconcile-by-hand is safer). Nothing is written without `--apply`.

Usage:
  python3 src/conformance/tools/reapply-reverted-fixes.py            # dry run (plan); exit 1 if any reverted
  python3 src/conformance/tools/reapply-reverted-fixes.py --apply    # restore reverted files
  python3 src/conformance/tools/reapply-reverted-fixes.py --show-diff # dry run + full unified diff

After --apply: run `tsc --noEmit` and the conformance suite, then commit (mention the merge SHA).
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def git(root, *args):
    """Run a git command at `root`; return (rc, stdout). Never raises on non-zero."""
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    return r.returncode, r.stdout


def git_root():
    r = subprocess.run(["git", "-C", HERE, "rev-parse", "--show-toplevel"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("error: not inside a git repository")
    return r.stdout.strip()


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def index_by_suffix(sets_dir):
    """Map every non-spec card file's `set-<name>/<base>.ts` suffix -> [abspaths] (mirrors the guard)."""
    idx = {}
    for d, dirs, files in os.walk(sets_dir):
        if os.path.basename(d) == "tests":
            dirs[:] = []
            continue
        for name in files:
            if not name.endswith(".ts") or name.endswith(".spec.ts"):
                continue
            p = os.path.join(d, name)
            suffix = "/".join(p.split(os.sep)[-2:])
            idx.setdefault(suffix, []).append(p)
    return idx


def newest_good_version(root, gitpath, norm_sigs, cap=400):
    """Newest commit whose blob at `gitpath` contains ALL signatures. Returns (sha, subject, blob) or None."""
    rc, out = git(root, "rev-list", f"--max-count={cap}", "HEAD", "--", gitpath)
    if rc != 0:
        return None
    for sha in out.split():
        rc2, blob = git(root, "show", f"{sha}:{gitpath}")
        if rc2 != 0:
            continue  # path didn't exist at this commit (pre-rename)
        body = norm(blob)
        if all(s in body for s in norm_sigs):
            _, subj = git(root, "log", "-1", "--format=%h %s", sha)
            return sha, subj.strip(), blob
    return None


def diff_summary(root, current_text, good_blob, gitpath, show_full):
    """Diff between the current (reverted) working file and the good blob, via git diff --no-index."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".cur", delete=False) as a, \
         tempfile.NamedTemporaryFile("w", suffix=".good", delete=False) as b:
        a.write(current_text); b.write(good_blob)
        ap, bp = a.name, b.name
    try:
        fmt = [] if show_full else ["--stat"]
        rc, out = git(root, "diff", "--no-index", *fmt, ap, bp)
        return out.rstrip()
    finally:
        os.unlink(ap); os.unlink(bp)


def main():
    ap = argparse.ArgumentParser(description="Re-apply merge-reverted src/sets and src/game fixes from fix-signatures.json")
    ap.add_argument("--apply", action="store_true", help="write the restored files (default: dry run)")
    ap.add_argument("--show-diff", action="store_true", help="show full unified diff per reverted file")
    args = ap.parse_args()

    root = git_root()
    src_dir = os.path.join(root, "ptcg-server", "src")
    sets_dir = os.path.join(src_dir, "sets")
    game_dir = os.path.join(src_dir, "game")
    manifest_path = os.path.join(root, "ptcg-server", "src", "conformance", "fix-signatures.json")
    manifest = json.load(open(manifest_path))["fixes"]
    index = index_by_suffix(sets_dir)
    game_index = index_by_suffix(game_dir)

    def resolve(entry):
        """Mirror the guard's resolution exactly (see conformance-fix-signatures.spec.ts).

        A `game/`-prefixed entry is an ENGINE file: resolve by exact src-relative path, falling back to a
        last-two-components suffix search so an upstream move relocates rather than un-guards it. Anything
        else keeps the card `set-<name>/<base>.ts` suffix lookup. Without this the guard would name an
        engine revert and then point at a tool that could not resolve it -- the error message told you to
        run something that would have reported the entry as unresolvable.
        """
        if entry.startswith("game/"):
            direct = os.path.join(src_dir, entry)
            if os.path.exists(direct):
                return [direct]
            return game_index.get("/".join(entry.split("/")[-2:]), [])
        return index.get(entry, [])

    reverted, unresolved, restored, failed = [], [], [], []

    for fix in manifest:
        suffix = fix["file"]
        norm_sigs = [norm(s) for s in fix["signatures"]]
        paths = resolve(suffix)
        if len(paths) != 1:
            unresolved.append((suffix, f"expected exactly one file, found {len(paths)}"))
            continue
        abspath = paths[0]
        cur = open(abspath).read()
        missing = [s for s, ns in zip(fix["signatures"], norm_sigs) if ns not in norm(cur)]
        if not missing:
            continue  # fix present — nothing to do
        gitpath = os.path.relpath(abspath, root)
        good = newest_good_version(root, gitpath, norm_sigs)
        reverted.append((suffix, abspath, gitpath, missing, good, cur))

    n_game = sum(1 for f in manifest if f["file"].startswith("game/"))
    print(f"Scanned {len(manifest)} fix entries under {os.path.relpath(src_dir, root)} ({n_game} engine, {len(manifest) - n_game} card)")
    if unresolved:
        print(f"\n⚠ {len(unresolved)} entr(y/ies) could not be resolved (fix the manifest):")
        for suffix, why in unresolved:
            print(f"   - {suffix}: {why}")
    if not reverted:
        print("\n✓ All fixes present — nothing reverted.")
        return 0 if not unresolved else 2

    print(f"\n✗ {len(reverted)} fix(es) REVERTED:\n")
    for suffix, abspath, gitpath, missing, good, cur in reverted:
        print(f"  ● {suffix}")
        print(f"      missing signature(s): {len(missing)} (e.g. {missing[0][:70]!r})")
        if good is None:
            print("      ✗ no prior commit carries these signatures — RESTORE MANUALLY (new/uncommitted fix?)")
            failed.append(suffix)
            continue
        sha, subj, blob = good
        print(f"      restore source: {subj}")
        ds = diff_summary(root, cur, blob, gitpath, args.show_diff)
        if ds:
            tail = ds if args.show_diff else ds.splitlines()[-1] if ds.splitlines() else ds
            print(f"      diff vs current: {tail.strip()}")
        if args.apply:
            open(abspath, "w").write(blob)
            after = norm(open(abspath).read())
            if all(s in after for s in [norm(m) for m in missing]):
                print("      ✓ restored + signatures verified")
                restored.append(suffix)
            else:
                print("      ✗ restored but signatures STILL missing — review manually")
                failed.append(suffix)

    if not args.apply:
        print(f"\nDRY RUN — {len(reverted)} file(s) would be restored. Re-run with --apply to write them.")
        print("Review any 'diff vs current' that changes more than the fix lines (the merge may have")
        print("made legitimate edits to that card too — restore then reconcile those by hand).")
        return 1

    print(f"\nApplied: {len(restored)} restored, {len(failed)} need manual attention.")
    if restored:
        print("Next: `tsc --noEmit`, run the conformance suite, then commit (reference the merge SHA).")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
