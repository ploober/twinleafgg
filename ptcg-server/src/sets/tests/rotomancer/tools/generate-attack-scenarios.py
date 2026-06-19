#!/usr/bin/env python3
"""
Generate the unified attack-scenario corpus from Rotomancer's committed IR.

Emits one scenario per ATTACK fragment with its full body — no shape filtering. The
native-vs-interpreted differential runs each exact-printing card and lets the interpreter's
try/catch decide support at runtime: bodies with an op/predicate the interpreter doesn't
handle simply raise and are skipped. This makes coverage drift-free — the corpus grows
automatically as the interpreter learns new ops.

Usage:
  python3 generate-attack-scenarios.py [ROTOMANCER_DIR] > ../fixtures/attack-scenarios.json
"""
import json
import glob
import os
import sys

DEFAULT_ROOT = os.path.expanduser("~/projects/pokemon-cards")
SNAPSHOT = "tools/template-parser-probe/peg-emit"


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
            if not body:
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
                 "shape": "every ATTACK fragment body (support decided at runtime)",
                 "count": len(scenarios)},
        "scenarios": scenarios,
    }, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
