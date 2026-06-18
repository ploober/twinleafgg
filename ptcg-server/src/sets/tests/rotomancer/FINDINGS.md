# Cross-engine findings — Rotomancer IR vs native Twinleaf vs official data

Discrepancies surfaced by independent cross-checks over the 2026-05-17 snapshot: the **corpus
replay** (native vs IR-declared damage), the **native-vs-interpreted differential** (bare +
primed boards), the **structural cross-check** (attack name + cost vs IR), and the **official
data cross-check** (Twinleaf vs authoritative card data — also the adjudicator). Each is
allow-listed so the suite stays green and *new* discrepancies still fail.

## Summary (~50 confirmed discrepancies)

| bucket | count | who's wrong |
|---|---|---|
| Attack names wrong (sv10-heavy) | 11 | **Twinleaf** (IR + official agree) |
| Card HP / weakness / resistance / type / retreat | ~20 | **Twinleaf** (official authoritative) |
| Attack cost wrong (incl. Turtonator) | ~11 | **Twinleaf** (official authoritative) |
| Attack damage wrong (Taillow, Mow Rotom) | 2 | **Twinleaf** |
| Engine/wiring bugs (Minccino errors, Mow Rotom no-damage) | 2 | **Twinleaf** |
| IR count drops a predicate (Aggron, Zoroark, Iono's Voltorb) | 3 | **Rotomancer** (IR faithfulness) |
| IR drops a conditional rider (Decidueye) | 1 | **Rotomancer** (IR faithfulness) |
| Cosmetic (Nidoran ♀/♂ spacing) | 2 | neither (formatting) |

**Headline:** the overwhelming majority are **Twinleaf data/wiring bugs**, concentrated in recent
sets (esp. **sv10 Destined Rivals**); the Rotomancer IR is mostly faithful, its few gaps all the
same shape (a predicate-filtered count flattened to an unfiltered one). The official-data check
**adjudicated** the ambiguous cases — notably reversing an early guess that Turtonator was an IR
bug (it's Twinleaf's). Details below by axis.

Scorecard (snapshot 2026-05-17): **19 agree · 1 disagree · 4 error · 54 skip**
(skip = 29 unmapped `me*` + 25 number-drift / not-in-Twinleaf).

| printing | attack | finding | likely owner |
|---|---|---|---|
| sv8-105 | Vibrava — "Cutting Wind" | Twinleaf names the attack **"Cutter Wind"**; IR (and the real card) use **"Cutting Wind"**. | **Twinleaf** (data typo) |
| sv8-137 | Turtonator — Steaming Stomp | Cost type differs: Twinleaf **Fire**, IR **Fighting**. ⚠️ The official data cross-check later adjudicated this: official cost is **Fighting**, so **Twinleaf** is wrong, not the IR. (Corrected from an earlier guess.) | **Twinleaf** (official-confirmed) |
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

### Twinleaf data errors (vs authoritative official card data)

`rotomancer-official.spec.ts` compares Twinleaf card data against the snapshot's official card
metadata (HP / weakness / retreat / evolvesFrom) for **809** exact-printing sv-era cards. The
official data is authoritative, so these are clean Twinleaf data bugs — the fix is to correct the
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

| printing | card | field | Twinleaf | official |
|---|---|---|---|---|
| sv9-103/104/105 | N's Klink / Klang / Klinklang | resistance | (none) | **Grass** |
| sv8-107 | Gastrodon | type | Water | **Fighting** |
| sv8-137 | Turtonator | "Steaming Stomp" cost | Fire,C,C | **Fighting,C,C** |
| sv10-117 | Team Rocket's Nidoran♂ | "Hammer In" cost | Dark,Dark | **Dark,Colorless** |
| sv10-49 | Misty's Gyarados | "Waterfall" cost | Water,C,C | **Water,Water,C** |
| sv10-41 | Combusken | "Combustion" cost | Fire | **Colorless** |
| sv10-61 | Wash Rotom | "Manual Wash" cost | Lightning | **Water** |
| sv10-90/91 | Mankey / Primeape | cost | Colorless | **Fighting** |
| sv5-21 | Brambleghast | "Powerful Needles" cost | Grass,Grass,C | **Grass,C,C** |
| sv5-71 | Duosion | "Double Trick" cost | Psychic | **Colorless** |
| sv9-7 | Lilligant | "Spinning Attack" cost | Grass,Grass,C | **Grass,C,C** |

The official cross-check is also the **adjudicator** for the IR-vs-Twinleaf findings: Turtonator's
cost was flagged earlier as a likely IR error, but the official data confirms the IR (Fighting) —
**Twinleaf** is wrong. This is why an authoritative third source matters.

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
