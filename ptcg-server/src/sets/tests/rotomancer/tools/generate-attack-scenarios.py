#!/usr/bin/env python3
"""
Generate the unified attack-scenario corpus from Rotomancer's v2 Effect-IR.

Emits one scenario per ATTACK fragment with its full body — no shape filtering. The
native-vs-interpreted differential runs each exact-printing card and lets the interpreter's
try/catch decide support at runtime: bodies with an op/predicate the interpreter doesn't
handle simply raise and are skipped. This makes coverage drift-free — the corpus grows
automatically as the interpreter learns new ops.

Reads the raw v2 IRs from the vendored (gitignored) in-project copy at rotomancer/ir-v2/ — no
cross-repo dependency. Vendor that copy in once from Rotomancer's peg-emit-v2 snapshot:
  cp ~/projects/pokemon-cards/tools/template-parser-probe/peg-emit-v2/*.json \
     src/sets/tests/rotomancer/ir-v2/
Pass a directory argument to read the v2 IR json from somewhere else instead.

Usage:
  python3 generate-attack-scenarios.py [IR_DIR] > ../fixtures/attack-scenarios.json
"""
import json
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Vendored (gitignored) copy of Rotomancer's peg-emit-v2 v2 IR corpus (a flat dir of *.json).
DEFAULT_IR_DIR = os.path.normpath(os.path.join(HERE, "..", "ir-v2"))
SNAPSHOT = "tools/template-parser-probe/peg-emit-v2"  # provenance: source of the vendored copy


def main():
    ir_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IR_DIR
    files = sorted(glob.glob(os.path.join(ir_dir, "*.json")))
    if not files:
        sys.stderr.write(
            "no v2 IR json in %s\nvendor it first:  "
            "cp ~/projects/pokemon-cards/%s/*.json %s/\n" % (ir_dir, SNAPSHOT, DEFAULT_IR_DIR))
        sys.exit(1)
    scenarios = []
    for f in files:
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
