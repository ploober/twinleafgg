#!/usr/bin/env python3
"""
Vendor authoritative card metadata (HP, weakness, resistance, retreat, evolvesFrom) for the
printings in Rotomancer's IR corpus, from the snapshot's official card data. Drives a static
Twinleaf-vs-official cross-check (rotomancer-official.spec.ts) — HP/weakness/retreat data errors
in Twinleaf surface as mismatches, with no execution needed.

Usage:
  python3 generate-official-metadata.py [ROTOMANCER_DIR] > ../fixtures/official-metadata.json
"""
import json
import glob
import os
import sys

DEFAULT_ROOT = os.path.expanduser("~/projects/pokemon-cards")
SNAPSHOT = "ir/2026-05-17/effect-programs"
CARDS = "data/snapshots/standard-2026-05-17/cards"


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROOT

    # printingIds we have IR for (the corpus).
    wanted = set()
    for f in glob.glob(os.path.join(root, SNAPSHOT, "*.json")):
        try:
            wanted.add(json.load(open(f))["program"]["printingId"])
        except Exception:
            pass

    # Index official card files by printingId.
    entries = []
    for f in glob.glob(os.path.join(root, CARDS, "**", "*.json"), recursive=True):
        try:
            c = json.load(open(f))
        except Exception:
            continue
        pid = c.get("printingId")
        if pid not in wanted or c.get("supertype") != "Pokémon":
            continue
        entries.append({
            "printingId": pid,
            "name": c.get("name"),
            "hp": int(c["hp"]) if str(c.get("hp", "")).isdigit() else None,
            "weaknesses": [w.get("type") for w in (c.get("weaknesses") or [])],
            "resistances": [r.get("type") for r in (c.get("resistances") or [])],
            "retreat": len(c.get("retreatCost") or []),
            "evolvesFrom": c.get("evolvesFrom"),
        })
    entries.sort(key=lambda e: e["printingId"])
    json.dump({
        "meta": {"source": CARDS, "count": len(entries)},
        "cards": entries,
    }, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
