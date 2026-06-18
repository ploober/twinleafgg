# Cross-engine findings — Rotomancer IR vs native Twinleaf

Discrepancies surfaced by three independent cross-checks over Rotomancer's IR snapshot:
the **corpus replay** (`rotomancer-corpus.spec.ts`, native vs IR-declared damage), the
**native-vs-interpreted differential** (`rotomancer-differential.spec.ts`, bare + primed
boards), and the **structural cross-check** (`rotomancer-structural.spec.ts`, attack name +
cost). Adjudication (which project to fix) is intentionally **deferred** — this is the
measurement, recorded as it was found. Each is allow-listed so the suite stays green and
*new* discrepancies still fail.

Scorecard (snapshot 2026-05-17): **19 agree · 1 disagree · 4 error · 54 skip**
(skip = 29 unmapped `me*` + 25 number-drift / not-in-Twinleaf).

| printing | attack | finding | likely owner |
|---|---|---|---|
| sv8-105 | Vibrava — "Cutting Wind" | Twinleaf names the attack **"Cutter Wind"**; IR (and the real card) use **"Cutting Wind"**. | **Twinleaf** (data typo) |
| sv8-137 | Turtonator — Steaming Stomp | Cost type differs: Twinleaf **Fire**, IR **Fighting**. Turtonator is a fire attacker, so the IR cost looks wrong. | **Rotomancer** (IR cost) |
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
native card's attack definition (101 attacks cross-checked). For the same printing the names
should be identical, so each row is a real data error on one side. None are cost mismatches
beyond Turtonator above.

| printing | IR name | Twinleaf name | kind |
|---|---|---|---|
| sv10-219 | Haughty Order | Haughty Orders | cosmetic (plural) |
| sv10-65 | Crushing Press | Crush Press | cosmetic |
| sv8-141 | Dyna-Blast | Dynablast | cosmetic (hyphen) |
| sv10-199 | Explode Together Now | All-Out Explosion | **different attack** |
| sv10-219 | Cruel Slash | Slash and Cash | **different attack** |
| sv10-78 | Thunder Raid | Thunder Blitz | **different attack** |
| sv10-85 | Chiming Commotion | Ring Ring Noise | **different attack** |
| sv6-110 | Ground Crasher | Ground Crack | **different attack** |
| sv8-128 | Stick 'n' Draw | Plug and Draw | **different attack** |
| sv8-141 | World Ender | World's End | **different attack** |
| sv9-49 | Zapping Short | Crackling Short | **different attack** |

The "different attack" rows cluster in sv10 (Destined Rivals) Trainer's-Pokémon cards, which
suggests one project's sv10 attack-name data is systematically off — worth a targeted audit.

Notes:
- "Owner" is a hypothesis from reading both sides, not a verdict. Confirm against
  `~/projects/pokemon-cards/docs/vendor/por_rulebook.md` + the card's printed text before
  changing either engine.
- The Decidueye case is partly a fixture limitation (the mirror has no Grass Energy in hand),
  but the IR also mis-classifies a conditional attack as pure damage — both are real.
- `skip` is not a finding: 29 `me*` are unmapped (deferred set-code map) and 25 are
  number-drift / absent printings that the resolver correctly refuses to substitute by name.
