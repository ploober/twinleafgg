#!/usr/bin/env python3
"""
Generate the vendored conditional-damage scenario corpus from Rotomancer's committed IR.

Emits one scenario per ATTACK fragment whose body is a single damage.deal -> opponentActive
with a conditional/scaling amount (plusIf or perCount) and only no-op modifiers. These drive a
native-vs-interpreted differential for predicate- and count-gated damage. Unsupported predicates
simply throw in the interpreter and are skipped by the differential.

Usage:
  python3 generate-conditional-scenarios.py [ROTOMANCER_DIR] > ../fixtures/conditional-scenarios.json
"""
import json
import glob
import os
import sys

DEFAULT_ROOT = os.path.expanduser("~/projects/pokemon-cards")
SNAPSHOT = "ir/2026-05-17/effect-programs"
NOOP_MODIFIERS = {"applyWeakness:false", "applyResistance:false"}


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
            if op.get("target", {}).get("selector") != "opponentActive":
                continue
            if not all(m in NOOP_MODIFIERS for m in (op.get("modifiers") or [])):
                continue
            amt = op.get("amount", {})
            if amt.get("kind") not in ("plusIf", "perCount"):
                continue
            scenarios.append({
                "printingId": pid,
                "name": name,
                "attackLabel": fr.get("label"),
                "cost": fr.get("cost", []),
                "body": body,
            })
    scenarios.sort(key=lambda r: (r["printingId"], r["attackLabel"]))
    json.dump({
        "meta": {"source": "rotomancer effect-programs", "snapshot": SNAPSHOT,
                 "shape": "single damage.deal -> opponentActive with plusIf/perCount amount",
                 "count": len(scenarios)},
        "scenarios": scenarios,
    }, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
