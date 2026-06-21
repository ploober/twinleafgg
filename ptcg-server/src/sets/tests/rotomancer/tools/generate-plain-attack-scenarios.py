#!/usr/bin/env python3
"""
Generate the vendored plain-attack scenario corpus from Rotomancer's committed IR.

Reads every effect-program and emits one scenario per ATTACK fragment whose body is a
single pure `damage.deal { const } -> opponentActive` op (no modifiers, no extra ops).
These are the "deal N damage" attacks — the cleanest cross-engine oracle: the IR's const
value is the expected damage, and a mirror-match defender (same species) avoids weakness.

The output is committed so the Twinleaf test suite is hermetic (no cross-repo dependency
at test time). Re-run when the Rotomancer snapshot changes.

Usage:
  python3 generate-plain-attack-scenarios.py [ROTOMANCER_DIR] > ../fixtures/plain-attack-scenarios.json
"""
import json
import glob
import os
import sys

DEFAULT_ROOT = os.path.expanduser("~/projects/pokemon-cards")
SNAPSHOT = "tools/template-parser-probe/peg-emit-v2"

# v2 damage-application ignores that are no-ops in a mirror match (weakness/resistance never apply).
NOOP_IGNORES = {"weakness", "resistance"}


def modifiers_ok(op):
    return all(m in NOOP_IGNORES for m in (op.get("ignore") or []))


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROOT
    scenarios = []
    for f in glob.glob(os.path.join(root, SNAPSHOT, "*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        p = d.get("program", {})
        pid, name = p.get("printingId"), p.get("name")
        for fr in p.get("fragments", []):
            if fr.get("origin") != "ATTACK":
                continue
            body = fr.get("body", [])
            if len(body) != 1:
                continue
            op = body[0]
            if op.get("kind") != "damage.deal":
                continue
            amt = op.get("amount", {})
            if amt.get("kind") != "const" or not modifiers_ok(op):
                continue
            of = op.get("target", {}).get("of", {})
            if of.get("side") != "opponent" or of.get("spot") != "active":
                continue
            scenarios.append({
                "printingId": pid,
                "name": name,
                "attackLabel": fr.get("label"),
                "cost": fr.get("cost", []),
                "expectedDamage": amt.get("value"),
            })
    scenarios.sort(key=lambda r: (r["printingId"], r["attackLabel"]))
    out = {
        "meta": {
            "source": "rotomancer effect-programs",
            "snapshot": SNAPSHOT,
            "shape": "single damage.deal const -> opponentActive (pure printed damage)",
            "count": len(scenarios),
        },
        "scenarios": scenarios,
    }
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
