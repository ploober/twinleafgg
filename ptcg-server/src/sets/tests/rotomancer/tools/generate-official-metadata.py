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


# Official printing-id prefixes for the sets Twinleaf carries (same prefixes as the bridge map).
PREFIXES = {"sv5", "sv6", "sv6pt5", "sv7", "sv8", "sv8pt5", "sv9", "sv10", "svp", "zsv10pt5", "rsv10pt5"}


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROOT

    # Index official Pokémon card files (sv-era prefixes) by printingId.
    entries = []
    for f in glob.glob(os.path.join(root, CARDS, "**", "*.json"), recursive=True):
        try:
            c = json.load(open(f))
        except Exception:
            continue
        pid = c.get("printingId") or ""
        if pid.split("-")[0] not in PREFIXES or c.get("supertype") != "Pokémon":
            continue
        attacks = []
        for a in (c.get("attacks") or []):
            # Only compare flat damage; "20×" / "120+" / "" are computed and not directly comparable.
            raw = str(a.get("damage") or "").strip()
            attacks.append({
                "name": a.get("name"),
                "damage": int(raw) if raw.isdigit() else None,
                "cost": a.get("cost") or [],
            })
        entries.append({
            "printingId": pid,
            "name": c.get("name"),
            "hp": int(c["hp"]) if str(c.get("hp", "")).isdigit() else None,
            "types": c.get("types") or [],
            "weaknesses": [w.get("type") for w in (c.get("weaknesses") or [])],
            "resistances": [r.get("type") for r in (c.get("resistances") or [])],
            "retreat": len(c.get("retreatCost") or []),
            "evolvesFrom": c.get("evolvesFrom"),
            "attacks": attacks,
        })
    entries.sort(key=lambda e: e["printingId"])
    json.dump({
        "meta": {"source": CARDS, "count": len(entries)},
        "cards": entries,
    }, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
