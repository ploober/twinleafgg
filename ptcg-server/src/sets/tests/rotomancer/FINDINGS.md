# Cross-engine findings — Rotomancer IR vs native Twinleaf vs official data

Discrepancies surfaced by cross-checks over the 2026-05-17 snapshot: the **corpus replay**
(native vs IR-declared damage), the **native-vs-interpreted differential** (bare + primed
boards), the **structural cross-check** (attack name + cost vs IR), and the **data cross-check**
(Twinleaf vs the **pokemontcg.io** card dataset). Each is allow-listed so the suite stays green
and *new* discrepancies still fail.

> ✅ **Independently verified.** The "data" reference is the **pokemontcg.io** community dataset,
> which is not first-party and not infallible — so **every data finding was re-checked against
> Limitless TCG** (an independent transcription of the physical cards). Result: of **~41** findings
> checked, **40 are confirmed real Twinleaf bugs** and **1 (Turtonator's cost) was a pokemontcg.io
> dataset error where Twinleaf is correct**. The data bugs are safe to fix; the full per-card
> verification is in the **Independent verification** section below.

## Update — larger corpus (peg-emit, 1540 programs) + a harness determinism fix

Re-running the cross-checks against the larger **`template-parser-probe/peg-emit`** IR corpus
(1777 attack fragments, up from the earlier snapshot) surfaced two things.

### 1. Test-harness bug found & fixed: coin flips were never deterministic

The differential at scale produced *unstable* mismatches — the same card (e.g. Mankey's Wild Kick)
returned 30 then 0 across repeated games in one run. Root cause: **`BotArbiter`'s `ALL_HEADS` was
dead code for the modern coin-flip path.** `COIN_FLIP_PROMPT` → `CoinFlipEffect` resolves with
`Math.random() < 0.5` directly in `game-effect.ts`; the arbiter only ever intercepted the legacy
`CoinFlipPrompt`. So **every coin-flip card test was non-deterministic** (passing by luck), not just
the differential.

Fix (backward-compatible): `CoinFlipEffect` now consults a handler-provided `flipCoin()` when one
exists; production handlers don't implement it, so the real game still uses `Math.random`. The test
`TestStoreHandler` implements it via the arbiter, giving `ALL_HEADS` its intended authority. Verified:
Mankey is now `30 30 30 30 30`. This is a **Twinleaf test-infrastructure fix**, not a card bug — but
it hardens every coin-flip card test in the repo.

With flips deterministic, the differential is stable: **185 const/structured attacks compared, 0
mismatches** on both bare and primed boards. Every disagreement the larger corpus first showed turned
out to be an **interpreter-expressiveness gap, never a Twinleaf bug** — the native card always does
the real attack; the IR's simpler model diverges. Five gap families (allow-listed in
`rotomancer-differential.spec.ts`, each verified native-correct):

| family | example | why interp diverges |
|---|---|---|
| type/Special-filtered count | Hydrapple ex *Syrup Storm* ([G]), Marnie's Morpeko *Spiky Wheel* ([D]), Cinccino *Special Roll* (Special) | IR's `energyAttached` count drops the energy-type filter |
| count scope | Skeledirge *Torcherto*, Lillie's Clefairy ex *Full Moon Rondo* | IR counts a different population than "for each Benched (both sides)" |
| dynamic-to-HP | Medicham ex *Chi-Atsu* ("counters until remaining HP 50") | IR can't express a target-HP-relative count → flat const |
| self-damage / KO timing | Hop's Snorlax *Dynamic Press* | interp models opponent damage only |
| ability not modeled | Magmortar *Searing Flame* (Magma Surge +30 checkup burn) | interp runs the attack body, not the card's ability |

### 2. ~86 new attack name/cost discrepancies (Twinleaf wrong; IR = official, spot-checked)

The structural cross-check over the larger corpus (580 attacks cross-checked) found **3 cost + 83
name** discrepancies beyond the original 14. For **every** one, the **IR matches the official card
data** (`official-metadata.json`, 1309/1309 IR labels present in official). Spot-checked against
**Limitless** (independent): Crustle DRI-12 *Superb Scissors* (Twinleaf: "Great Scissors") and Mankey
DRI-90 *Wild Kick* cost **Fighting** (Twinleaf: Colorless) — both confirm **Twinleaf is wrong**.

- **3 cost bugs:** Wash Rotom sv10-61 (Lightning→**Water**), Mankey sv10-90 (Colorless→**Fighting**),
  Duosion sv5-71 (Psychic→**Colorless**).
- **78 wrong-name bugs:** native attack name wholly differs from official — incl. clear typos
  (*Suprise Attack*, *Neurokenesis*, *Tyranical Crush*, *Crackling Stomp*) and wrong attacks
  (*Great Scissors*→Superb Scissors, *Sudden Flash*→Abrupt Flash, Ogerpon *Dance*→*Kagura*).
- **5 cosmetic:** capitalization/spacing (*Call **F**or Family*, *Backdraft*→Back Draft).

The full adjudicated list is the fixture **`fixtures/known-discrepancies.json`** (loaded as the
structural allow-list). These are the same family as the data findings below — concentrated in
recent sets (esp. **sv10 Destined Rivals** Trainer's-Pokémon cards) and safe to fix.

### 3. Building out IR support → 4 coin-flip / cost bugs found & fixed

Teaching the interpreter more IR ops (`attack.lockOrModify` as a snapshot-neutral no-op,
`energy.attachOrDiscard` discard-from-self, `coinFlipHeads`, `noDefenderReduction`, and forEach
`damageCounters`/`prizesTaken`/`handCards`/`retreatCost`) **doubled differential coverage from 185
to 383 attacks compared** — and the newly-compared cards agree with the IR oracle in ~98% of cases.
The disagreements were six real **engine bugs in coin-flip / cost attacks**, each a different
mechanism, all now fixed (the differential agrees after the fix):

| card | attack | bug | fix |
|---|---|---|---|
| Combusken (sv10-41) | Double Kick | `effect.damage = 40·heads` set **outside** the async `COIN_FLIP_PROMPT` callbacks → `heads` always 0 → **always 0 damage** | flip via `MULTIPLE_COIN_FLIPS_PROMPT`, set damage in the callback |
| N's Klink (sv9-103) | Double Spin | printed `damage: 10` **plus** `effect.damage += 10·heads` → base double-counted → **+10 too high** | `+=` → `=` (overwrite the base, like other ×-damage cards) |
| Sunkern (sv6-6) | Bullet Seed | `WAS_ATTACK_USED(effect, 1)` but Bullet Seed is index **0** → coin logic never runs → **always base 10** | index `1` → `0` |
| Monferno (sv6-32) | Heat Blow | energy discard wired only to `WAS_ATTACK_USED(…, 0)` (Chop); Heat Blow is index 1 → **never discards** | run the discard for index 0 **or** 1 |

These confirm a **systemic risk in coin-flip damage attacks** (async callback ordering, base
double-apply, wrong attack index) — a targeted sweep of the corpus's coin-flip attacks would likely
surface more. One non-bug remains allow-listed: **Pecharunt's Poison Chain** (native 70 vs interp 20)
— the gap is Pecharunt's *Toxic Subjugation* ability (+50 poison during checkup), which the
interpreter doesn't model (it runs only the attack body — same family as Magmortar's Magma Surge).

### 4. Migrated to IR v2

Rotomancer moved its canonical schema to **v2** (compositional selectors `{side,spot}`/`{role}`;
`coinFlip`/`if` replacing `flow.control`+`kind2`; `continuous.modifier`+`rule.override` replacing
`attack.lockOrModify`; `energy.discard`/`attach`/`move`; a `{kind}`-tagged predicate sum type;
`ignore` replacing the flat damage-modifier strings). The interpreter now reads the v2 corpus
(`peg-emit-v2`, 1585 programs) natively — new module `ir-selectors.ts` for the compositional
selectors, and `ir-predicates.ts`/`ir-cards.ts` rewritten as `kind`-dispatched sum types.

The differential **validates the port against native ground truth**: coverage rose **383 → ~409
attacks compared, 0 mismatches**. Two divergences found during the port were interpreter bugs
(fixed): `matchesCardPredicate` silently matched the v2 `nameTag` leaf, over-triggering the
`plusIf` bonus on Team Rocket's Nidoqueen (Love Impact) and Articuno (Dark Frost) — now `nameTag`
is handled and unknown predicate kinds throw rather than match. One new allow-list entry, also an
ability-not-modeled case: **Galvantula's Shocking Web** (its *Compound Eyes* ability adds +50 vs
opponents with an Ability → native 100/KO; interp models only the attack body, 50).

Follow-up coverage passes took the differential to **~434 attacks compared, 0 mismatches** by
teaching the interpreter more deterministic v2 surface — `energy.discard` from the opponent's
active (with the `isa` energy-type filter), `hand.reveal` (snapshot-neutral no-op), the
`toolsAttached`/`minusPerCount` count forms, the `Tera` subtype, and the deterministic
board-mutation ops `pokemon.knockOut` (lethal damage through the normal pipeline, so the engine
awards the prize/promotes — a direct `KnockOutEffect` skips the prize flow) and `pokemon.discard`.
One integration crash was fixed (`resolveV2Single` dereferenced an empty selector; it now fails
cleanly → skip).

### 5. Choice-alignment infrastructure (Stage A)

To start covering the player-choice tail safely, the harness now runs a **divergence guard**:
`TestStoreHandler` counts genuine multi-option choices it makes (a `ChoosePokemon`/`ChooseCards`
prompt where more candidates were eligible than were selected), and the differential **skips an
attack when native made more such choices than the interpreted run** — i.e. native chose among
options that the interpreter resolved directly, so the two might have picked differently. Choices
both sides delegate to the harness (taking a prize, promoting after a KO) increment both counts
equally and so never trip the guard. This converts the residual false-mismatch risk into a safe
skip, which preserves the differential's zero-false-positive guarantee.

With the guard in place, **Stage A** resolves the *forced/degenerate* choices directly — first-N
matching for `cards.move` with a `player` chooser, `energy.attach` from hand/discard (usually empty
→ no-op) — taking the differential to **~440 attacks compared, 0 mismatches**. Choice-*affect*
targets (damage/condition/heal to a *chosen* Pokémon, e.g. "deal 50 to 2 of your opponent's
Pokémon") are deferred to **Stage B**: native distributes those via a prompt the harness resolves
unreliably, so aligning them needs the interpreter to emit the same prompts (a continuation-passing
rewrite), not a first-eligible guess. The remaining unsupported attacks are that Stage-B tail.

### 6. Wider observation surface (per-bench)

The differential's snapshot only compared the two **actives**' damage, so any divergence on the
**bench** was invisible — a chunk of "compared, 0 mismatches" was effectively vacuous for spread
attacks. Widening the snapshot to per-bench `{damage, conditions, energy}` immediately flushed out
two real **interpreter** bugs (now fixed) that had been hidden:

- **`untilHpRemaining` not modeled.** `damage.placeCounters` used the literal `count` (0) and
  ignored `untilHpRemaining`, so "counters until N HP remaining" attacks did nothing. The v2 IR
  *does* express this, so it's now implemented — which also retired the **Chi-Atsu** allow-list
  entry (Medicham ex "counters until 50 HP" now agrees).
- **`placeCounters` used `PutDamageEffect`.** That effect only lands on the defender, so counters
  placed on the *bench* (e.g. Palossand ex's Barite Jail, "counters until 100 HP on each Benched
  Pokémon") silently did nothing. Switched to `PutCountersEffect`, which native uses and which
  applies to any Pokémon. Caught only because the snapshot now sees the bench.

### 7. Multi-turn LOCK differential (Phase 5) — first finding

The single-turn differential can't see "during your opponent's next turn" riders — the interpreter
no-ops the 273 `continuous.modifier`/`rule.override` ops, so they're *vacuously* "compared". The new
`rotomancer-locks.spec.ts` actually exercises them: it runs the lock attack, then on the opponent's
turn deals a known synthetic hit (in `GamePhase.ATTACK`, so phase-gated native interceptors fire)
and compares the **observed** result — mechanism-independent, so it doesn't matter whether native
reduces via the engine's `damageReductionNextTurn` property or a bespoke marker.

Scope so far: `damageReduction` on self (the most common modifier, 42 ops). The interpreter applies
it via `damageReductionNextTurn`; 9 mapped printings compared, **0 unexplained mismatches** — and it
**found a real Twinleaf bug**:

> **Team Rocket's Moltres ex — Flame Screen** ("takes 50 less damage next turn"). The card's
> `reduceEffect` *adds* `FLAME_SCREEN_MARKER` but **never reads it to reduce damage** (unlike Flareon
> ex / Vaporeon ex, which do). The marker is dead — the reduction is never enforced; native takes
> full damage. The IR and interpreter both apply the 50-less correctly. → **Twinleaf bug**
> (allow-listed, not fixed).

The probe pattern generalises: `preventDamage` is now wired in (see §9), with `damageDebuff` and the
`rule.override` shutoffs (`cannotAttackNextTurn` / retreat lock — probe = attempt the action) still
to come.

### 8. Mega-Evolution (`me*`) mapping — 2 more Twinleaf bugs

The `me*` block was 26% of the corpus and previously `unmapped` (skipped everywhere). Twinleaf does
implement these sets, so the resolver now maps **me1 → MEG** (Mega Evolution) and **me2 → PFL**
(Phantasmal Flames) — collector numbers align (Mega Venusaur ex me1-3 = MEG-3, Mega Heracross ex
me2-4 = PFL-4). me2pt5 (Erika's-prefixed cards) and me3 have no implemented Twinleaf printing yet, so
they stay unmapped. This widened every cross-check at once (differential 439→454, structural 611→650).

As predicted for a newer mechanic, the freshly-visible cards were bug-rich — two Twinleaf bugs and
one IR gap surfaced immediately (all allow-listed, not fixed):

> **Mega Sharpedo ex (PFL) — Greedy Fang**: card text is "Draw 2 cards" but the native `reduceEffect`
> draws 1 (`MOVE_CARDS … count: 1`). **Twinleaf bug.**
>
> **Mega Sharpedo ex (PFL) — Hungry Jaws**: the "+150 if this Pokémon has any damage counters" rider
> is wired to attack **index 0** (Greedy Fang) instead of index 1 (Hungry Jaws), so Hungry Jaws never
> applies it. **Twinleaf bug.** (Both Sharpedo bugs are in the same `reduceEffect`.)
>
> **Paldean Tauros (PFL) — Raging Charge**: the IR counts Tauros Pokémon *that have damage*; the real
> attack is "40 per damage *counter* on your Tauros Pokémon" — the IR drops the per-counter scaling.
> IR faithfulness gap.

### 9. Lock family — `preventDamage` + `damageDebuff` wired in → an IR-integration predicate bug found & fixed

Extended the multi-turn probe (§7) to the rest of the *incoming-damage* lock family — every modifier
whose effect the synthetic probe (damage taken by the lock user's active) can observe:

- `continuous.modifier { preventDamage }` on self ("prevent all damage from *⟨matching⟩* Pokémon next
  turn", 16 ops). Natively a marker + `preventDefault`; the interpreter reproduces it by reusing the
  engine's `damageReductionNextTurn` with a large "prevent-all" sentinel — **gated on evaluating the
  `matching` predicate against self**, sound because the mirror probe's next-turn attacker is the
  same printing as the locked Pokémon.
- `continuous.modifier { damageDebuff }` on the defending Pokémon ("attacks used by the Defending
  Pokémon do N less next turn" — Growl/Charm, 11 ops). Natively a marker on the defender that reduces
  *its outgoing* damage (`PutDamageEffect` where `source` is marked). In the mirror probe the
  defender's only next-turn attack hits the lock user's active, so the same incoming
  `damageReductionNextTurn` applied to self reproduces the observable. The synthetic `__probe__`
  attack carries `source = opponent.active`, so it triggers the native marker just like a real attack.

The lock scorecard went 10 → 22 compared (`damageReduction 10 + preventDamage 7 + damageDebuff 5`).

This immediately surfaced a bug — **in the IR integration itself, so it was fixed** (not
allow-listed):

> **Terapagos ex — Crown Opal** ("prevent all damage from **Basic non-[C]** Pokémon"). The IR encodes
> the non-Colorless clause as `not(isa energyType:Colorless)`, and the native card checks
> `sourceCard.cardType !== COLORLESS`. But `matchesCardPredicate`'s `energyType` arm only inspected
> `EnergyCard.provides`, so for **any Pokémon** it returned no-match → `not(...)` was always true →
> the interpreter wrongly prevented a Colorless attacker (took 0; native, correctly, took 220). Fix:
> `energyType` now also matches a **Pokémon's own `cardType`** (and a Trainer matches neither). This
> is the correct general reading of `isa energyType:X` across supertypes.

The remaining lock families need a *different* probe geometry and are the next to wire in:
`damageVulnerability` (`yourNextTurn` — needs a probe on the lock-user's *own* next turn, after
skipping the opponent's), and the `rule.override` shutoffs (attack/retreat — probe = attempt the
action and observe the block, not a damage measurement).

## Summary (~50 discrepancies; data findings 40/41 verified as Twinleaf bugs)

| bucket | count | who's wrong (Limitless-verified) |
|---|---|---|
| Attack names wrong (sv10-heavy) | 11 | **Twinleaf** ✓ (all checked) |
| Card HP / weakness / resistance / type / retreat | ~20 | **Twinleaf** ✓ (all checked) |
| Attack cost wrong | 9 | **Twinleaf** ✓ (all 9 checked) |
| Attack damage wrong (Taillow, Mow Rotom) | 2 | **Twinleaf** ✓ |
| Card-name typo (Vivillon) | 1 | **Twinleaf** ✓ |
| Engine/wiring bugs (Minccino errors, Mow Rotom no-damage) | 2 | **Twinleaf** |
| IR count drops a predicate (Aggron, Zoroark, Iono's Voltorb) | 3 | **Rotomancer** (IR faithfulness) |
| IR drops a conditional rider (Decidueye) | 1 | **Rotomancer** (IR faithfulness) |
| **Turtonator cost (Steaming Stomp)** | 1 | **pokemontcg.io dataset** — Twinleaf correct (Fire) |
| Cosmetic (Nidoran ♀/♂ spacing) | 2 | neither (formatting) |

**Headline:** the data findings are **Twinleaf data bugs, now independently confirmed** (40/41 vs
Limitless), concentrated in recent sets (esp. **sv10 Destined Rivals**) — safe to fix. The only
false positive was Turtonator (a pokemontcg.io dataset error, caught only because we checked an
independent source). The Rotomancer IR's own gaps are few and all the same shape (a
predicate-filtered count flattened to an unfiltered one).

Scorecard (snapshot 2026-05-17): **19 agree · 1 disagree · 4 error · 54 skip**
(skip = 29 unmapped `me*` + 25 number-drift / not-in-Twinleaf).

| printing | attack | finding | likely owner |
|---|---|---|---|
| sv8-105 | Vibrava — "Cutting Wind" | Twinleaf names the attack **"Cutter Wind"**; IR (and the real card) use **"Cutting Wind"**. | **Twinleaf** (data typo) |
| sv8-137 | Turtonator — Steaming Stomp | Cost differs: Twinleaf **Fire**, IR/pokemontcg.io **Fighting**. ⚠️ **NOT a Twinleaf bug.** Limitless TCG (independent) confirms the cost is **Fire** — the pokemontcg.io dataset (and the IR derived from it) are wrong; Twinleaf is correct. | **pokemontcg.io dataset** |
| sv6pt5-5 | Decidueye — Power Shot | IR encodes a flat **170**; the real attack is *"discard a Grass Energy from your hand; if you do, 170, else nothing."* Twinleaf implements the rider. | **Rotomancer** (IR faithfulness) |
| sv10-82 | T.R.'s Wobbuffet — Headbutt Bounce | Twinleaf has no attack by that name. Limitless confirms DRI-82 Wobbuffet's attacks are **"Rocket Mirror"** and **"Headbutt Bounce"** — Twinleaf's attack data for this card is wrong. | **Twinleaf** (Limitless ✓) |
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

### Independent verification (Limitless TCG, not derived from pokemontcg.io)

**All ~41 data findings were checked against Limitless TCG** (an independent transcription of the
physical cards). **40 confirmed as real Twinleaf bugs; 1 was a pokemontcg.io dataset error.** The
initial 8-card sample happened to include the one dataset error (Turtonator), which made the rate
look like 1-in-8; across the full set it is **1-in-41 (~2.4%)**.

Representative confirmations (Limitless agreed with the dataset, i.e. Twinleaf is wrong) across
every axis: HP — Slakoth 60, Misty's Psyduck 70, Grubbin 70, Litten 70, Hop's Silicobra 80, N's
Klang 90, Hop's Sandaconda 140; weakness — Grubbin/Petilil/Toedscool/Mow Rotom Fire (not Fighting);
type — Gastrodon Fighting (not Water); resistance — N's Klink line Grass −30; retreat — Slowpoke 2,
Persian ex 2, Marnie's Morpeko 0; cost — Mankey/Primeape Fighting, Wash Rotom Water, Combusken/
Duosion Colorless, Brambleghast/Lilligant GCC, Misty's Gyarados WWC, Nidoran♂ DC; damage — Taillow
20, Mow Rotom Trimming Mower 20; attack names — Cutting Wind, Stick 'n' Draw, Dyna-Blast/World
Ender, Ground Crasher, Crushing Press, Explode Together Now, Chiming Commotion, Zapping Short,
Thunder Raid, Headbutt Bounce (Wobbuffet does have it); card name — Vivillon (not "Vivillion").

The **only** finding Limitless reversed:

| card | field | Twinleaf | pokemontcg.io | Limitless | verdict |
|---|---|---|---|---|---|
| **Turtonator SSP-137** | "Steaming Stomp" cost | **Fire** | Fighting | **Fire** | ❌ dataset error — Twinleaf right |

Lessons: (1) the data findings are **safe to fix** — independently confirmed. (2) The dataset is
excellent but not infallible, and because the IR shares its source, "IR agrees" can't catch a
dataset error — only a genuinely independent source can. (3) Spot-checking 8 wasn't enough to
trust the set; verifying all of them was the right call.

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
