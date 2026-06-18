# Cross-engine findings — Rotomancer IR vs native Twinleaf vs official data

Discrepancies surfaced by cross-checks over the 2026-05-17 snapshot: the **corpus replay**
(native vs IR-declared damage), the **native-vs-interpreted differential** (bare + primed
boards), the **structural cross-check** (attack name + cost vs IR), and the **data cross-check**
(Twinleaf vs the **pokemontcg.io** card dataset). Each is allow-listed so the suite stays green
and *new* discrepancies still fail.

> ⚠️ **Reference caveat.** The "data" reference is the **pokemontcg.io** community dataset (the
> Rotomancer snapshot is built from it), **not** first-party data — and it is **not infallible**.
> The Rotomancer IR is compiled from the *same* dataset, so "IR + dataset agree" is one source,
> not two. See the **independent spot-check** section below: of 8 findings checked against
> Limitless TCG (independent), **7 confirmed real Twinleaf bugs and 1 (Turtonator) was a dataset
> error where Twinleaf was correct**. Ground-truth before fixing, especially attack *costs*.

## Summary (~50 discrepancies; ~7/8 verified as Twinleaf bugs in spot-check)

| bucket | count | who's wrong |
|---|---|---|
| Attack names wrong (sv10-heavy) | 11 | **Twinleaf** (Zeraora spot-checked ✓) |
| Card HP / weakness / resistance / type / retreat | ~20 | **Twinleaf** (Slakoth/Grubbin/Petilil/Gastrodon/Sandaconda ✓) |
| Attack cost wrong | ~10 | **Twinleaf** (Mankey ✓) — but verify each; Turtonator was a dataset error |
| Attack damage wrong (Taillow, Mow Rotom) | 2 | **Twinleaf** |
| Engine/wiring bugs (Minccino errors, Mow Rotom no-damage) | 2 | **Twinleaf** |
| IR count drops a predicate (Aggron, Zoroark, Iono's Voltorb) | 3 | **Rotomancer** (IR faithfulness) |
| IR drops a conditional rider (Decidueye) | 1 | **Rotomancer** (IR faithfulness) |
| **Turtonator cost (Steaming Stomp)** | 1 | **pokemontcg.io dataset** — Twinleaf correct (Fire) |
| Cosmetic (Nidoran ♀/♂ spacing) | 2 | neither (formatting) |

**Headline:** the overwhelming majority are **Twinleaf data/wiring bugs**, concentrated in recent
sets (esp. **sv10 Destined Rivals**); the Rotomancer IR is mostly faithful, its few gaps all the
same shape (a predicate-filtered count flattened to an unfiltered one). One "finding" (Turtonator)
turned out to be a **dataset** error — caught only by checking an independent source.

Scorecard (snapshot 2026-05-17): **19 agree · 1 disagree · 4 error · 54 skip**
(skip = 29 unmapped `me*` + 25 number-drift / not-in-Twinleaf).

| printing | attack | finding | likely owner |
|---|---|---|---|
| sv8-105 | Vibrava — "Cutting Wind" | Twinleaf names the attack **"Cutter Wind"**; IR (and the real card) use **"Cutting Wind"**. | **Twinleaf** (data typo) |
| sv8-137 | Turtonator — Steaming Stomp | Cost differs: Twinleaf **Fire**, IR/pokemontcg.io **Fighting**. ⚠️ **NOT a Twinleaf bug.** Limitless TCG (independent) confirms the cost is **Fire** — the pokemontcg.io dataset (and the IR derived from it) are wrong; Twinleaf is correct. | **pokemontcg.io dataset** |
| sv6pt5-5 | Decidueye — Power Shot | IR encodes a flat **170**; the real attack is *"discard a Grass Energy from your hand; if you do, 170, else nothing."* Twinleaf implements the rider. | **Rotomancer** (IR faithfulness) |
| sv10-82 | T.R.'s Wobbuffet — Headbutt Bounce | Twinleaf printing has no attack by that name (`UNKNOWN_ATTACK`). Needs printing/name check. | investigate |
| sv5-136 | Minccino — Beat | Twinleaf's Beat throws `CANNOT_PLAY_THIS_CARD` when used. | **Twinleaf** (attack wiring) |

### Additional findings (interpreter / count work)

| printing | attack | finding | likely owner |
|---|---|---|---|
| sv6-122 | Aggron — Angry Slam | IR encodes `forEach pokemonInPlay` (all your Pokémon); the real attack (and Twinleaf) counts only Pokémon **with damage on them** — a `countOf` with a predicate flattened to a plain `forEach`. | **Rotomancer** (IR drops the predicate) |
| sv6pt5-32 | Zoroark — Illusory Hijacking | IR `forEach pokemonInPlay/opponent`; real attack does 60 **for each opponent's Pokémon ex and Pokémon V** in play. Predicate dropped. | **Rotomancer** (IR drops the predicate) |
| sv9-47 | Iono's Voltorb — Voltaic Chain | IR `perCount energyAttached/self`; real attack is +20 **per [L] Energy on all your Iono's Pokémon** — the IR drops both the Lightning-type filter and the multi-Pokémon scope. | **Rotomancer** (IR over-broad count) |

**Pattern:** the recurring `forEach`/`perCount` finding is the same shape every time — the IR flattens a *predicate-filtered* count (`countOf`) into a plain `forEach` over an unfiltered set, so the interpreted damage is too high. Surfaced automatically by the conditional differential.

### Attack-name discrepancies (structural cross-check)

`rotomancer-structural.spec.ts` statically compares every IR attack's name + cost against the
native card's attack definition (101 attacks cross-checked). Each row was then **adjudicated
against the official data** — and in every case the **IR matches the official, so Twinleaf has the
wrong name**. All 11 are Twinleaf data bugs:

| printing | official + IR name | Twinleaf name (wrong) | kind |
|---|---|---|---|
| sv10-219 | Haughty Order | Haughty Orders | spelling |
| sv10-65 | Crushing Press | Crush Press | spelling |
| sv8-141 | Dyna-Blast | Dynablast | spelling |
| sv10-199 | Explode Together Now | All-Out Explosion | wrong attack |
| sv10-219 | Cruel Slash | Slash and Cash | wrong attack |
| sv10-78 | Thunder Raid | Thunder Blitz | wrong attack |
| sv10-85 | Chiming Commotion | Ring Ring Noise | wrong attack |
| sv6-110 | Ground Crasher | Ground Crack | wrong attack |
| sv8-128 | Stick 'n' Draw | Plug and Draw | wrong attack |
| sv8-141 | World Ender | World's End | wrong attack |
| sv9-49 | Zapping Short | Crackling Short | wrong attack |

These cluster heavily in **sv10 (Destined Rivals)** Trainer's-Pokémon cards — Twinleaf's sv10
attack-name data is systematically off and warrants a focused re-import from official data.

### Twinleaf data errors (vs the pokemontcg.io card dataset)

`rotomancer-official.spec.ts` compares Twinleaf card data against the snapshot's official card
metadata (HP / weakness / retreat / evolvesFrom) for **809** exact-printing sv-era cards. The
dataset is usually right (spot-check: 7/8), so these are *likely* Twinleaf data bugs — the fix is to correct the
card. 18 discrepancies in 809 cards (~2%):

| printing | card | field | Twinleaf | official |
|---|---|---|---|---|
| sv8-145 | Slakoth | HP | 90 | **60** |
| sv9-86 | Hop's Silicobra | HP | 60 | **80** |
| sv10-45/193 | Misty's Psyduck | HP | 50 | **70** |
| sv5-18 | Grubbin | HP | 60 | **70** |
| sv5-32 | Litten | HP | 60 | **70** |
| sv9-104 | N's Klang | HP | 160 | **90** |
| sv9-87 | Hop's Sandaconda | HP/weak/retreat | 90 / Lightning / 1 | **140 / Grass / 3** |
| sv10-9 | Mow Rotom | weakness | Fighting | **Fire** |
| sv5-18 | Grubbin | weakness | Fighting | **Fire** |
| sv7-17 | Toedscool | weakness | Fighting | **Fire** |
| sv9-6 | Petilil | weakness | Fighting | **Fire** |
| sv10-219/150 | Team Rocket's Persian ex | retreat | 1 | **2** |
| sv10-137 | Marnie's Morpeko | retreat | 1 | **0** |
| sv7-57 | Slowpoke | retreat | 1 | **2** |
| sv7-103 | Meltan | evolvesFrom | "Meltan" | **(empty — it's a Basic)** |
| sv10-156 | Taillow | "Wing Attack" damage | 10 | **20** |
| sv10-9 | Mow Rotom | "Trimming Mower" damage | 0 (none) | **20** |

(Attack-damage check is restricted to *flat* official damage — `20×`/`120+` computed attacks
are skipped to avoid representation false positives.)

Resistance / type / attack-cost errors (same cross-check):

All are Twinleaf bugs **except Turtonator**, which the independent spot-check overturned (the
dataset is wrong, Twinleaf's Fire is correct). The cost rows in particular deserve per-card
ground-truthing.

| printing | card | field | Twinleaf | dataset | verdict |
|---|---|---|---|---|---|
| sv9-103/104/105 | N's Klink / Klang / Klinklang | resistance | (none) | **Grass** | Twinleaf bug |
| sv8-107 | Gastrodon | type | Water | **Fighting** | Twinleaf bug (Limitless ✓) |
| sv8-137 | Turtonator | "Steaming Stomp" cost | **Fire** | Fighting | **dataset wrong** (Limitless ✓ Fire) |
| sv10-90/91 | Mankey / Primeape | cost | Colorless | **Fighting** | Twinleaf bug (Mankey Limitless ✓) |
| sv10-117 | Team Rocket's Nidoran♂ | "Hammer In" cost | Dark,Dark | **Dark,Colorless** | Twinleaf bug (unverified) |
| sv10-49 | Misty's Gyarados | "Waterfall" cost | Water,C,C | **Water,Water,C** |
| sv10-41 | Combusken | "Combustion" cost | Fire | **Colorless** |
| sv10-61 | Wash Rotom | "Manual Wash" cost | Lightning | **Water** |
| sv10-90/91 | Mankey / Primeape | cost | Colorless | **Fighting** |
| sv5-21 | Brambleghast | "Powerful Needles" cost | Grass,Grass,C | **Grass,C,C** |
| sv5-71 | Duosion | "Double Trick" cost | Psychic | **Colorless** |
| sv9-7 | Lilligant | "Spinning Attack" cost | Grass,Grass,C | **Grass,C,C** |

### Independent spot-check (Limitless TCG, not derived from pokemontcg.io)

To put an error rate on the data findings, 8 were checked against Limitless TCG (an independent
transcription of the physical cards). **7 confirmed real Twinleaf bugs; 1 was a dataset error:**

| card | field | Twinleaf | pokemontcg.io | Limitless | verdict |
|---|---|---|---|---|---|
| Slakoth SSP-145 | HP | 90 | 60 | 60 | ✅ Twinleaf bug |
| Grubbin TEF-18 | HP / weak | 60 / Fighting | 70 / Fire | 70 / Fire | ✅ Twinleaf bug |
| Petilil JTG-6 | weakness | Fighting | Fire | Fire | ✅ Twinleaf bug |
| Gastrodon SSP-107 | type | Water | Fighting | Fighting | ✅ Twinleaf bug |
| Hop's Sandaconda JTG-87 | HP/weak/retreat | 90/L/1 | 140/Grass/3 | 140/Grass/3 | ✅ Twinleaf bug |
| Zeraora DRI-78 | attack name | Thunder Blitz | Thunder Raid | Thunder Raid | ✅ Twinleaf bug |
| Mankey DRI-90 | cost | Colorless | Fighting | Fighting | ✅ Twinleaf bug |
| **Turtonator SSP-137** | cost | **Fire** | Fighting | **Fire** | ❌ **dataset error — Twinleaf right** |

Lessons: (1) HP / weakness / type / retreat / attack-name findings are very solid (7/7) — safe to
fix. (2) Attack **cost** findings are the risky category — the one dataset error landed there, and
because the IR shares the dataset's source, "IR agrees" did not catch it; verify each cost against
an independent source before fixing. (3) An authoritative-*sounding* source is not the same as an
authoritative one; pokemontcg.io is excellent but not infallible.

**Card-name typo (bonus, found via resolution):** Twinleaf names SSP-7 **"Vivillion"** (official
"Vivillon") — a misspelled card name (also the filename `vivillion.ts`). Because the resolver
name-validates, this card silently fails to match and its other data goes unchecked, so fixing the
name may surface further findings on it. Of 1662 official sv-era Pokémon, 809 resolve exactly; the
other 853 are genuinely-absent printings (secret/alt-art numbers Twinleaf doesn't carry, and the
zsv/rsv sets whose collector numbering differs) — only this one is a fixable name mismatch.

Patterns worth a targeted audit: several **Grass Pokémon carry a Fighting weakness instead of
Fire**; **Hop's Sandaconda** has HP, weakness *and* retreat wrong (likely wholly wrong stats).
Two cosmetic evolvesFrom diffs (Team Rocket's Nidorina/Nidorino — Twinleaf has a space before
the ♀/♂ glyph) are allow-listed but not real bugs.

Notes:
- "Owner" is a hypothesis from reading both sides, not a verdict. Confirm against
  `~/projects/pokemon-cards/docs/vendor/por_rulebook.md` + the card's printed text before
  changing either engine.
- The Decidueye case is partly a fixture limitation (the mirror has no Grass Energy in hand),
  but the IR also mis-classifies a conditional attack as pure damage — both are real.
- `skip` is not a finding: 29 `me*` are unmapped (deferred set-code map) and 25 are
  number-drift / absent printings that the resolver correctly refuses to substitute by name.
