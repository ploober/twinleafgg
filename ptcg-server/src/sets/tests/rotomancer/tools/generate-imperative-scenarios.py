#!/usr/bin/env python3
"""
Generate the vendored imperative-attack scenario corpus from Rotomancer's committed IR.

Emits one scenario per ATTACK fragment whose body is fully within the interpreter's imperative
core — ops in {damage.deal, condition.apply, heal, damage.placeCounters}, const counts, and
direct selectors {self, ownActive, opponentActive, defendingPokemon} — and which is more than a
single plain damage.deal (those live in plain-attack-scenarios.json). These drive the
native-vs-interpreted differential at scale.

Usage:
  python3 generate-imperative-scenarios.py [ROTOMANCER_DIR] > ../fixtures/imperative-scenarios.json
"""
import json
import glob
import os
import sys

DEFAULT_ROOT = os.path.expanduser("~/projects/pokemon-cards")
SNAPSHOT = "ir/2026-05-17/effect-programs"

OPS = {"damage.deal", "condition.apply", "heal", "damage.placeCounters"}
SELECTORS = {"self", "ownActive", "opponentActive", "defendingPokemon", None}
NOOP_MODIFIERS = {"applyWeakness:false", "applyResistance:false"}


def supported(op):
    if op.get("kind") not in OPS:
        return False
    if not all(m in NOOP_MODIFIERS for m in (op.get("modifiers") or [])):
        return False
    if op.get("removeMode"):
        return False
    if op.get("target", {}).get("selector") not in SELECTORS:
        return False
    amt = op.get("amount")
    if amt is not None and amt.get("kind") != "const":
        return False
    cnt = op.get("count")
    if isinstance(cnt, dict) and cnt.get("kind") != "const":
        return False
    return True


def is_plain_damage(body):
    return (len(body) == 1 and body[0].get("kind") == "damage.deal"
            and body[0].get("target", {}).get("selector") == "opponentActive")


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
            if not body or not all(supported(op) for op in body):
                continue
            if is_plain_damage(body):
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
                 "shape": "imperative-core body (damage/condition/heal/counters), >1 op or non-opponent damage",
                 "count": len(scenarios)},
        "scenarios": scenarios,
    }, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
