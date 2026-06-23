# Cross-engine findings — Rotomancer IR vs native Twinleaf vs official data

> 🧭 **Accuracy is the north star.** Nothing is "good enough" because a scorecard is green — only
> when it is *as faithful as possible* to the real semantics. Prefer an honest, counted **skip** over
> a plausible **guess**, and confirm every agreement is *meaningful*, not vacuous. See
> [IR-SUPPORT-DESIGN.md §1](IR-SUPPORT-DESIGN.md#1-design-principles--the-support-contract).
>
> 📐 For the feature‑by‑feature map of **every IR construct → how the integration supports it**, see
> [IR-SUPPORT-DESIGN.md](IR-SUPPORT-DESIGN.md). This file is the running log of what each expansion
> *found*; that one is the design contract for what we *support*.

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

### 3. Building out IR support → 4 coin-flip / cost bugs found (now allow-listed, not fixed)

Teaching the interpreter more IR ops (`attack.lockOrModify` as a snapshot-neutral no-op,
`energy.attachOrDiscard` discard-from-self, `coinFlipHeads`, `noDefenderReduction`, and forEach
`damageCounters`/`prizesTaken`/`handCards`/`retreatCost`) **doubled differential coverage from 185
to 383 attacks compared** — and the newly-compared cards agree with the IR oracle in ~98% of cases.
The disagreements were four real **native engine bugs in coin-flip / cost attacks**, each a different
mechanism:

| card | attack | bug |
|---|---|---|
| Combusken (sv10-41) | Double Kick | `effect.damage = 40·heads` set **outside** the async `COIN_FLIP_PROMPT` callbacks → `heads` always 0 → **always 0 damage** |
| N's Klink (sv9-103) | Double Spin | printed `damage: 10` **plus** `effect.damage += 10·heads` → base double-counted → **+10 too high** |
| Sunkern (sv6-6) | Bullet Seed | `WAS_ATTACK_USED(effect, 1)` but Bullet Seed is index **0** → coin logic never runs → **always base 10** |
| Monferno (sv6-32) | Heat Blow | energy discard wired only to `WAS_ATTACK_USED(…, 0)` (Chop); Heat Blow is index 1 → **never discards** |

> ⚠️ **These four were briefly patched, then reverted.** They predate the "don't fix native Twinleaf
> card bugs, allow-list them" rule (see [memory: rotomancer-no-card-fixes]). To make the treatment
> consistent across the whole project, the card patches were **reverted** and the bugs are now
> **allow-listed** in the differential, keyed by *printing* (`KNOWN_NATIVE_BUGS_BY_PRINTING` in
> [rotomancer-differential.spec.ts](../rotomancer-differential.spec.ts)) — printing-keyed because
> "Double Spin" also belongs to Gossifleur (sv7-10), which is correct. The interpreter does the real
> attack; native is wrong. They join the family-(6) Twinleaf bugs (Greedy Fang, Hungry Jaws, …).

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

### 10. Lock family — `retreatShutoff` via a *blocked-action* probe → a 4th wrong-attack-index Twinleaf bug

The `rule.override` shutoffs can't be read by the damage probe — there's no number to measure, only
an action that does or doesn't go through. Added a second probe type for the most common shutoff,
`rule.override { retreatShutoff }` on the defending Pokémon ("the Defending Pokémon can't retreat
during the opponent's next turn", 57 ops, `opponentNextTurn`): run the lock attack, then attempt to
retreat the locked (opponent's) active and observe whether the engine throws `BLOCKED_BY_EFFECT`.

Both engines use the same enforcement (`BLOCK_RETREAT` / `BLOCK_RETREAT_IF_MARKER` keyed to the lock
card, via `DEFENDING_POKEMON_CANNOT_RETREAT_MARKER`), so the interpreter just calls those prefabs and
`InterpretedCard.reduceEffect` enforces the marker — and because the block throws in `propagateEffect`
(before the retreat reducer's bench/cost checks) the probe needs no bench or energy. 19 printings
compared, **0 unexplained mismatches**, and it **found a 4th wrong-attack-index Twinleaf bug**:

> **Wugtrio ex (TEF) — Numbing Hold**. The `BLOCK_RETREAT(...)` for Numbing Hold is guarded by
> `WAS_ATTACK_USED(effect, 0, this)` — but index 0 is *Tricolor Pump*; Numbing Hold is index **1**. So
> the retreat lock is **never installed** when Numbing Hold is used (and the misattributed block is
> dead code under Tricolor Pump, which returns first). The IR and interpreter correctly lock retreat;
> native doesn't. → **Twinleaf bug** (allow-listed, not fixed). Same class as Mega Sharpedo ex /
> Hungry Jaws (§8).

The remaining lock families are the next to wire in:
- `attackShutoff` / `opponentNextTurn` / defending (10 ops) — "the Defending Pokémon can't use
  attacks." A block probe was prototyped (give the defender energy, attempt its attack, observe
  `BLOCKED_BY_EFFECT`; the interpreter sets the engine's central `cannotAttackNextTurn`). But **all 10
  printings are currently un-comparable**: me2pt5/me3 are unmapped, the zsv numbers don't align, and
  TEF-46 (Frosmoth) / SSP-140 (Appletun) aren't implemented in Twinleaf at those numbers. So the
  family has no Twinleaf∩corpus intersection yet — deferred until those printings exist, not a harness
  gap. (The prototype was reverted to keep every scorecard live rather than perpetually `compared 0`.)
- `retreatShutoff`'s `yourNextTurn`/self variant (3); the `attackShutoff` `untilLeavesActive`/self
  variant (5); the `itemPlayRestriction` / `evolvePlayRestriction` bans (9); and `damageVulnerability`
  (`yourNextTurn`, 3 — a probe on the lock-user's own next turn).

### 11. Lock family — `attackShutoff` recharge via an *own-turn* probe

The largest shutoff bucket is `rule.override { attackShutoff }` on self with scope `ownNextAttack` —
the "recharge" lock ("during your next turn, this Pokémon can't use ⟨attack⟩", e.g. Mega Lucario ex /
Mega Brave, 105 ops). Unlike the defending shutoffs it fires on the lock user's *own* next turn, so it
needs a new probe geometry: use the attack, **pass the opponent's turn** (`endTurn` →
`PassTurnAction`), then re-attempt the same attack and observe `BLOCKED_BY_EFFECT`. The opponent is
given a Bidoof on the bench so the recharge attack's damage can't end the game before the lock user's
next turn.

Both engines push the attack name to the engine's central `cannotUseAttacksNextTurnPending` (promoted
at the turn's end, enforced at `game-effect.ts`), so the interpreter just pushes the IR's
`override.attackName` — and the probe verifies the IR names the *right* attack (a native that recharged
the wrong attack would show up as a mismatch, the way Wugtrio did for retreat). Restricted to the
standard recharge case (locked name = attack used). **17 printings compared, all `blocked=true` on both
sides, 0 mismatches** — real recharge attacks across sv5–sv10/svp (Flare Strike, Giant Wave, Haymaker,
Brave Slash, Cyber Drive, Impact Blow, Dirty Headbutt). No bugs this round: every native recharge lock
is correct and the IR agrees.

Lock differential total: **58 comparisons** — incoming-damage 22 (`damageReduction`/`preventDamage`/
`damageDebuff`) + retreatShutoff 19 + attackShutoff-recharge 17.

### 12. Loaded-board accuracy audit → 2 IR-integration bugs fixed

The bare/primed differential boards only set pre-damage + a bench, so whole classes of count/predicate
logic were exercised *only* in their trivial (zero) case — a **vacuous agreement** (a `conditionOn`
rider that only ever sees its false branch; a typed-energy count that only ever sees the active's cost
energy; a `forEach discardCards` that's always 0). Per the north star, "green" there is not enough.

Added three **focused** loaded-board variants — `conditions` (the defender carries
POISONED+BURNED+CONFUSED), `energy-rich` (every Pokémon carries 6 typed energies across active+bench,
both sides), `zones-loaded` (hand + a 12-Energy discard) — each turning on *one* dimension so a
divergence is attributable to it. Plus a narrow snapshot widening: `PokeSnap` now records
`energyTypes` (a typed multiset), so a wrong-**type** energy op (count unchanged) is observable. All
loads are mirror-symmetric (applied to both runs) and the divergence guard turns any genuine new choice
into a counted skip — so a loaded variant can only surface *real* divergences. It immediately did:

> **IR-integration bug #1 (fixed) — `energy.discard`/`energy.attach` read the card predicate from the
> wrong path.** The interpreter read `op.card.from.predicate`, but the predicate lives at
> `op.card.predicate` (a sibling of `op.card.from`) — in all **249** energy ops. So the type/subtype
> filter was silently dropped: `matchesCardPredicate(c, undefined)` matches *any* energy. Invisible on
> the empty board (nothing to discard/attach), it surfaced the instant the loaded board gave the
> predicate something to wrongly match: **Victini / Singe Off** and **Farfetch'd / Mach Cut** (IR:
> discard a **Special** Energy) discarded a *basic*; **Regirock ex / Regi Charge** (IR: attach a
> **Fighting** Energy from discard) attached *Fire*. Native, correctly, did neither. Fix: read
> `op.card.predicate`. → all four divergences resolved, and the energy-rich board now meaningfully
> verifies the filter *excludes* the wrong types.

> **IR-integration bug #2 (fixed, latent) — `energyAttachedCount` over a `spot:anywhere` selector
> counted only the active.** It used `resolveV2Single` (first target), so "≥N [type] Energy attached to
> *your Pokémon*" ignored the bench. Fixed to sum `energyCount` across every target the selector
> resolves to. **No compared card exercises it yet** — all five `≥4`-type-anywhere printings (Electro
> Fall, Crystal Fall, Flare Fall, Magnetic Burst, Darkfall) name-drift or are unmapped in Twinleaf — so
> this is a correctness fix verified by a *direct assertion*, not the differential oracle (an honest
> counted gap, not faked coverage).

Three **non-vacuity assertions** lock the audit's meaning (a green corpus isn't enough): a
`conditionOn` rider deals +100 only when the condition is loaded (20→120); `forEach energyAttached`
scales with loaded energy (20→60); `energyAttachedCount` sums bench energy (110, vs 10 active-only).
Also corrected an assumption along the way — `useAttack` *does* trigger the turn-transition checkup, so
loaded POISONED/BURNED tick (verified when a probe hit exactly lethal); the assertions use CONFUSED to
stay tick-free.

Differential now runs **five** board variants (bare 449, primed 450, conditions 450, energy-rich 438,
zones-loaded 441), all 0 mismatches.

### 13. Stage B (affect-target half) — prompt-emitting choice alignment → 4 native bugs found

Until now the interpreter **threw-to-skip on every player-choice affect-target** (a selector with
`chooser` or `quantity:'one'`): "deal damage to 1 of your opponent's Pokémon" was the single biggest
counted gap. Stage A only *detects and skips* such choices (the divergence guard); Stage B *aligns*
them — the interpreter now **emits the same `ChoosePokemonPrompt` native emits** (geometry derived from
the selector: `side`→playerType, `spot`→slots, `where`→`blocked`), so the harness resolves both runs
first-eligible to the *identical* target. The comparison then tests whether the IR's choice geometry
matches the printed card. Built for the four affect ops — `damage.deal`, `damage.placeCounters`,
`condition.apply`, `heal`.

The enabling change is a **continuation-passing op runner**: a prompt-emitting op resumes the rest of
the body in its callback, so a choice mid-body (or inside an `if`/`coinFlip` branch) is faithful for any
op order. An all-synchronous body still runs straight through — **no behavior change for any
already-supported card** (locks/structural/corpus stayed green). Chosen-target damage is applied with
`PutDamageEffect` *inside* the callback (weakness-free, like native `DAMAGE_OPPONENT_POKEMON`), never
`effect.damage +=` — the attack reducer's damage step has already run by the time a deferred prompt
resolves.

**IR-integration fix surfaced on first run — multi-target `targetCount`.** "50 damage to **2** of your
opponent's Pokémon" is encoded as `quantity:'one'` plus a sibling `op.targetCount: 2` (22 ops in the
corpus, value 2 or 3); `quantity` itself is never numeric. The first cut hard-coded a single pick, so
**Iron Crown ex / Twin Shotels** (6 printings) hit only 1 target — caught immediately by the bench
snapshot (native active 80 + bench 50 vs interp active 80 only). Fixed to choose `targetCount` distinct
Pokémon (`min = min(N, eligible)`, `max = N`), and to no-op when no legal target exists (which also
cleared the benchless "invalid auto-resolved prompt" noise). → all bench-bearing variants 0 mismatches.

**4 native bugs (allow-listed, not fixed — per the no-card-fix rule), all on the *benchless* board.**
Every "choose N of your opponent's Pokémon" attack agrees with native once the opponent has a Bench;
the divergences appear only on `bare` (opponent holds just the active), where the native cards mishandle
the degenerate too-few-targets / no-Bench case while the interpreter does the rules-faithful attack:

| attack | native (bare) | faithful (IR/interp) | native bug |
|---|---|---|---|
| **Sonic Double** (Steven's Skarmory) | 100 to the lone target | 50 (one hit) | printed base 50 **and** the distribute-to-2 prompt's 50 both land |
| **Dual Bolt** (Electivire ex) | 0 | 50 | prefab requires *exactly* 2 targets → unsatisfiable with 1 |
| **Garnet Volley** (Cinderace ex) | 0 | 180 to the active | `if (!hasBenched) return` — but the active is a legal target |
| **Crimson Blaster** (Armarouge) | 180 to the active (KO) | 0 | text says *Benched* only; native uses the any-Pokémon prefab |

These are skipped **only on `bare`** (`KNOWN_BENCHLESS_NATIVE_BUGS`, label-keyed), preserving the
meaningful agreement on the four bench-bearing variants — not skipped globally. A **non-vacuity
assertion** proves the lever fired: a `targetCount:2` choice over `spot:anywhere` lands 50 on the active
**and** bench[0] and leaves bench[1] untouched (a dropped prompt would damage one target or none).

Coverage: differential `compared` rose **bare 449→481, primed 450→485** (~+32/+35 newly-compared per
variant); the `player-choice affect-target …` skip reason dropped from the dominant gap to ~16. Full
suite **45 specs, 0 failures**. Still ⛔ (counted skips, follow-on Stage B increments): the `choice` op,
`cards.move` `chooser:'player'` (needs a real `ChooseCardsPrompt`), `energy.move`, `iterate`.

### 14. Stage B completion — remaining choice families + three harness expansions

The remaining player-choice families were closed by *emitting the same prompt native emits* — but most
needed the **test harness's prompt auto-resolver to actually honor the prompt's constraints**, which it
previously stubbed. Three harness expansions (in [test-helpers.ts](../test-helpers.ts), the shared
`TestStoreHandler`) were the unlock; each is strictly more correct and was verified against the whole
harness blast surface (**sets 71 + conformance 190 specs**, both green — the 39 pre-existing
Base64/Logger/Reconnection failures are unrelated infra, confirmed identical with this work stashed):

| harness fix | was | now | unlocks |
|---|---|---|---|
| `resolvePutDamageRaw` | picked the first `maxAllowedDamage` target (the Active), rejected by a `[BENCH]`-scoped prompt → threw | honors `prompt.slots` (first in-slot target) | `iterate` distribute-counters (Phantom Dive / Hex Hurl) |
| `resolveChooseCardsRaw` | ignored the prompt `filter`; picked first-N of *all* cards (wrong card / inflated eligible count) | filter-aware (eligible = filter-matching, non-blocked) | predicate-bearing `cards.move` |
| `resolveMoveEnergyRaw` | **no-op stub** (moved nothing) | deterministic first-eligible move (slots/blockedFrom/blockedTo/filter) | `energy.move` (87 native cards now actually move) |

Interpreter side (continuation-passing throughout, so a prompt mid-body resumes the rest):
- **`choice`** (37, all "you may"): emit a `ConfirmPrompt` (harness always confirms, no ambiguity
  increment) and run the `then` branch. Plumbing — its value is the switch then-branches below.
- **`cards.move` `chooser:'player'`** (124): **bench↔active = a SWITCH** via `player.switchPokemon` + a
  Bench `ChoosePokemonPrompt`; **zone↔zone moves** emit a `ChooseCardsPrompt` (IR predicate → `blocked`,
  so the now-filter-aware harness picks the same first-N matching). Deck **searches**
  (`visibility:search`/`searchTyped`), `chooser:'opponent'`/`'random'`, and place-a-Pokémon /
  prize / attached endpoints stay counted skips.
- **`iterate`** (9): the native `PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE` prefab (one PutDamagePrompt),
  not a per-iteration loop (which would trip the ambiguity guard N×).
- **`energy.move`** (23): relocate the first `count` matching attached Energy from the source selector to
  the first-eligible destination — the same target the now-functional `resolveMoveEnergyRaw` picks for
  native.

> **Native bug surfaced (allow-listed, not fixed) — Slowpoke SCR / Dangle Tail.** "Put a Pokémon from
> your discard pile into your hand." Native moves it from a *detached* temp `CardList`
> (`new CardList(); cards.cards = selected; MOVE_CARDS(cards, hand)`), so the card is added to the hand
> but **never removed from the discard** — a duplicate. IR/interp do the real move (discard −1). It only
> became visible once the filter-aware `ChooseCards` fix dropped native's ambiguity to 0 and unskipped
> the attack; diagnosed by a direct check (native: discard unchanged, Bidoof in both zones; interp:
> discard −1). Catalogued in `KNOWN_MISMATCHES` (6).

Coverage: differential `compared` rose **bare 481→501, primed 485→508** (the affect-target increment had
already lifted them from 449/450). All five board variants **0 mismatches**; rotomancer suite **50 specs,
0 failures**. Four non-vacuity assertions prove the new ops fire (choice runs its then-branch; a switch
swaps active↔bench; `iterate` lands all N counters; `cards.move`/`energy.move` move the right card/energy).

What remains a **counted skip** (honest gaps, not faithfully mirrorable under the current harness, or
genuinely out of scope): `chooser:'opponent'`/`'random'`; `excludeSelf`/`extremum` choice refinements;
`cards.move` endpoints that place a Pokémon (deck/discard→bench), take a prize, or pick up attached
cards; deck searches; `costGate` / `pokemon.return` / `damage.move`; and the predicate gaps
(`turn`/`history`/`movedToActive`). Each is a precise `unsupported` count in the scorecards.

### 15. Own-turn damage probe — next-turn damage-buff modifiers verified

Three `continuous.modifier` families were *applied but never verified* — accepted as snapshot-neutral
no-ops, which the north star only allows when the effect is genuinely unobservable. They are observable
on the lock user's **own next turn**, so a fourth lock-probe geometry (sibling of the recharge own-turn
probe) now checks them: use the setup attack, `endTurn` (opponent passes), re-attack on the user's own
next turn, and compare the landed damage native-vs-interp.

The interpreter reproduces the buffs with the **exact native prefabs** — `NEXT_TURN_ATTACK_BONUS`
(damageBuff) and `NEXT_TURN_ATTACK_BASE_DAMAGE` (attackBaseDamageOverride), [prefabs.ts](../../../game/store/prefabs/prefabs.ts)
— precomputed per card in `buildInterpretedCard` and run in `InterpretedCard.reduceEffect` on every
effect (install on use → apply on the own next turn → clear at EndTurn), **after** the attack body so a
base-damage override overwrites the body's base. Mechanism-identical to native, so agreement is faithful;
inert (empty closure list) for every card without such a modifier, so the other three probes and the
single-turn differential are unchanged.

- **`damageBuff`** ✅ — compared **2** mapped cards (Metagross / Meteor Mash, sv5-115 & sv5-178), 0
  mismatches. The other corpus printings are name-unmapped (Lucario ex sv8pt5-51, Meloetta ex zsv10pt5,
  Watchog rsv10pt5 all fail name-validation → safe skip) or unmapped (Pecharunt me2pt5).
- **`attackBaseDamageOverride`** ✅ (reproduced) — **no mapped oracle card** (Watchog rsv10pt5 name-
  mismatches), so verified by a **direct non-vacuity assertion** (setup overrides a different attack's
  base 50→100 — an overwrite, not an add), the same honest treatment as the `energyAttachedCount`-anywhere
  fix in §12.
- **`damageVulnerability`** ⛔ deferred — the only mapped case (Vibrava / Screech, sv8) is a **0-damage
  setup**, so the "+N to the Defending Pokémon" can't be observed by a re-attack; the one damaging case
  (Stunfisk / Pouncing Trap) is unmapped me2pt5. Stays a counted skip until a damaging mapped case exists.

Two non-vacuity assertions prove the buffs actually fire on the own next turn (damageBuff: 20 base → 80
next turn; override: 50 → 100). Rotomancer suite **54 specs, 0 failures**; lock differential now runs
**four** probe geometries (incoming-damage, retreat-block, recharge, next-turn damage buff).

### 16. Play-a-card block probe — `itemPlayRestriction` verified

The `rule.override` **play restrictions** were applied-as-no-ops and unverified. `itemPlayRestriction`
("during your opponent's next turn, they can't play Item cards") is now checked by a fifth lock-probe
geometry — a **play-a-card block probe**, sibling of the retreat-block probe: run the lock attack, then
on the opponent's turn attempt to play an Item (`PlayItemEffect` reduced directly, like the retreat probe
reduces `RetreatEffect`) and observe `BLOCKED_BY_EFFECT`.

The interpreter reproduces it by installing the engine's central `ATTACK_EFFECT_ITEM_LOCK` marker on the
opponent ([player.ts:93](../../../game/store/state/player.ts)); `playTrainerReducer` already throws
`BLOCKED_BY_EFFECT` on a `PlayItemEffect` while it's present ([play-trainer-effect.ts:168](../../../game/store/effect-reducers/play-trainer-effect.ts)),
and it's cleared at the opponent's turn end. Mechanism-independent (a native item-lock card produces the
same observable, whether via this generic marker or a card-specific one), so the probe compares the
*blocked* outcome, not the mechanism; inert for cards without the override.

- **`itemPlayRestriction`** ✅ — compared **4** mapped cards (Galvantula ex / Fulgurite sv7-159/168,
  Frillish / Oceanic Gloom rsv10pt5-126/44), **0 mismatches**. The rest skip: Budew me2pt5 unmapped.
- **`evolvePlayRestriction`** ⛔ deferred — the engine has **no** evolve-lock mechanism (no marker, no
  check in `playPokemonReducer`), and it's a single corpus card (Bronzong / Evolution Jammer sv5-69).
  Building an engine mechanism is outside the oracle's remit; it stays a counted no-op skip.

A non-vacuity assertion proves the rider blocks the opponent's Item play while a control without it does
not. Rotomancer suite **57 specs, 0 failures**; lock differential now runs **five** probe geometries.

### 17. Amount `countOf` + `bindAs` tracking — discard-and-scale attacks → a native discard-filter bug

The `countOf` amount form ("90 damage **for each card you discarded in this way**" — Inferno X) and the
`bindAs` binding it reads were both unsupported, so all 34 corpus occurrences skipped. They are now wired
end to end: a **producer** op (`energy.discard` with `bindAs:"discarded"`) records the discarded card
list in a fragment-scoped register threaded through the continuation runner; a **consumer**
(`{kind:"countOf", ref:"discarded"}` inside a `perCount` amount) reads its cardinality. Damage =
`base + per × |binding|`.

Three load-bearing facts made this a deterministic (no-guess) reproduction:

- **The discard amount is forced by the harness.** The producer's count is a player choice (`anyAmount`
  = "discard any amount", `upTo {max}`), but the shared harness resolves native's `DiscardEnergyPrompt`
  greedily (first-eligible up to `max`) and **never bumps the divergence guard** (test-helpers.ts:847;
  only `ChooseCards`/`ChoosePokemon` increment it). So the interpreter discards the same greedy-max set
  **without emitting a prompt** — exactly the `energy.move`/`iterate` pattern — and the two runs face the
  same number of choices. No guard skew, no guess.
- **The discard SOURCE is a pool, not a single chosen target.** "From among your Pokémon" is encoded
  `{chooser:'player', quantity:'one', spot:'anywhere'}`, which the affect-target selector throws on
  (Inferno X was skipping on the *selector*, before count or amount). A new `ir-selectors.spatialPool`
  returns the `side × spot` candidate pool without the player-choice throw (the per-pick is collapsed by
  the greedy resolution); `resolveV2Selector` is refactored to call it then apply the existing throw, so
  its behavior is unchanged.
- **Already non-vacuous on the bare board.** The attacker's cost energy is still attached at
  `applyEffects`, so even a bare board discards it and scales.

**What it found — a 5th native card-file bug.** `sv6-123` **Heatran TWM — Steel Burst** ("Discard all
**[M]** Energy from this Pokémon. 50 damage for each card discarded") natively discards **all** attached
energy — `CheckProvidedEnergyEffect.energyMap` is mapped unfiltered, with no `[M]` filter
([heatran.ts:44-55](../../set-twilight-masquerade/heatran.ts)) — inflating both the discarded count and
the `50×count` damage; it is further compounded by the out-of-scope **Incandescent Body** ability
(burns the attacker). The IR/interp faithfully discard only `[M]` Energy and model only the attack body.
→ **Twinleaf bug**, allow-listed by printing (`KNOWN_NATIVE_BUGS_BY_PRINTING`), never fixed
([memory: rotomancer-no-card-fixes]).

`compared` rose **bare 501→517, primed 508→524**; **0 mismatches** after the allow-list. A direct
non-vacuity assertion proves the damage scales with the bound discard set (1 Fire → 50, 2 Fire → 100)
and that the matching energy is actually discarded (attacker emptied). **Deferred** as an honest counted
gap: `cards.move` with `bindAs` (4 corpus cards, all `me3`-unmapped → no oracle to verify against; a
`countOf` over its unbound ref throws → counted skip). Rotomancer suite **58 specs, 0 failures**.

### 18. Turn-state predicates — `turn` + `movedToActive` + `history.evolved`

Three turn-local predicates used to throw → skip the whole attack: `turn` ("went first/second", "is your
first turn"), `movedToActive` ("switched into the Active this turn"), and `history` ("evolved this turn").
Each is now evaluated by reading the **same engine signal native cards read**, so native and interp agree:

- `turn` → `state.turn` + `state.activePlayer`. Convention ([sets/AGENTS.md](../../AGENTS.md)): turn 1 is the
  first player's first turn, turn 2 the second player's; the active player went first iff `state.turn` is
  odd; "your first turn" is `state.turn ≤ 2`.
- `movedToActive` → `player.movedToActiveThisTurn` ([player.ts:102](../../../game/store/state/player.ts), the
  `IS_POKEMON_MOVED_TO_ACTIVE_THIS_TURN` signal).
- `history event:'evolved'` → `PokemonCardList.pokemonPlayedTurn === state.turn` (what native
  evolution-bonus cards like Mothim / Accelgor check; `fromName` is inert in a mirror — the evolved card's
  own pre-evo *is* the fromName, and native doesn't re-verify it).

**The faithfulness discipline.** In the single-turn differential the attacker is placed at setup (`turn:2`),
so these gates evaluate to **determinable constants** (`movedToActive`/`evolved` false; `wentSecond`/
`isOwnFirstTurn` true). A model that returned the right constant for the *wrong* reason would agree
**vacuously** and hide a bug (the north-star trap, §1). So each predicate has a **true-branch non-vacuity
assertion** that exercises the side the corpus never reaches: a switched-in attacker (`movedToActiveThisTurn`
populated → +bonus), a later turn (turn 3, odd → wentSecond false → no bonus, vs turn 2 → bonus), and an
evolved-this-turn attacker (`pokemonPlayedTurn = state.turn` → +bonus). A constant model fails all three.

`compared` rose **+6 per board variant** (bare 517→523, primed/conditions 524→530); **0 mismatches** — no
native bug surfaced. **Deferred** (honest counted gaps, specific throw messages): `history event:'attackUsed'`
(needs cross-turn per-Pokémon attack history; its `yourLastTurn` window is unreachable in a single-turn
differential) and `history event:'healed'` (no heal-this-turn engine signal). Rotomancer suite **61 specs,
0 failures**.

### 19. `cards.move` `attached` + `prize` zone endpoints

`cards.move` used to support only flat zones (hand/deck/discard/lostzone) and threw "unsupported zone" on
everything else — the largest remaining `cards.move` gap. Two deterministic, observable endpoints are now
modeled:

- **attached → hand/discard** ("Put an Energy attached to this Pokémon into your hand" — Shiftry,
  Chien-Pao, Dipplin). The `attached` `from` carries a **selector** (`from.of`) naming the source Pokémon
  (like `energy.discard`), not an `owner`, so it can't go through `resolveZone`. The move uses
  `PokemonCardList.moveCardsTo` — which keeps the `.energies`/`.tools` sub-lists the snapshot reads in sync
  — **never** `MOVE_CARDS` (which would leave `.energies` stale → a false mismatch). `chooser:'player'`
  emits the same `ChooseCardsPrompt` native does; `auto` moves the first-N.
- **prize → hand** ("take a Prize card" — Umbreon ex's *Onyx*, sv8pt5). `player.prizes` is a `CardList[]`
  (6 face-down piles), so this can't use `MOVE_CARDS` either. Reproduced with the **exact native prefab**
  `TAKE_X_PRIZES` ([umbreon-ex.ts:57](../../set-prismatic-evolution/umbreon-ex.ts)), which emits a
  `ChoosePrizePrompt` the harness resolves first-eligible with no divergence-guard bump — so native and
  interp take the identical count to hand (mechanism-faithful, like the lock probes).

`compared` rose **+6 per board variant** (bare 523→529, primed/conditions 530→536); **0 mismatches** — no
native bug surfaced. Both are non-vacuous on the existing boards (the attacker always has cost energy; a
prize take is `getPrizeLeft()` −1) and have direct non-vacuity assertions. **Deferred** (honest counted
gaps): `attached`→discard of **Pokémon Tools** (the `'Pokémon Tool'` subtype isn't in `matchesCardPredicate`,
and no Tool is on the differential's boards → it would compare vacuously; needs a tool-loaded board — now
roadmap #1), plus bench-search / place-a-Pokémon / active(self-bounce) endpoints. Rotomancer suite **63
specs, 0 failures**.

### 20. Tools-loaded board variant + `'Pokémon Tool'` subtype + `hasTool` → 4 native bugs

To make Pokémon-Tool effects observable (so the deferred Tool cards stop comparing vacuously), a **sixth**
board variant seeds a Tool on both Actives, mirror-symmetric like `conditions`/`energy-rich`. Added: the
`'Pokémon Tool'` card subtype (`TrainerCard` + `trainerType === TrainerType.TOOL`), the `hasTool` predicate
(`list.tools.length > 0`), a `tools` count in the snapshot, and `forEach toolsAttached` now counts
active+bench and honors `bothSides`. **Float Stone** is the seeded Tool — retreat-only, so inert for an
attack snapshot (the differential never retreats).

**The load-bearing faithfulness detail.** A Tool must be seeded into `PokemonCardList.tools` **only** — not
`.cards` — exactly as the engine's `AttachPokemonToolEffect` leaves it. The harness's `buildPokemonSlot`
puts a configured tool in *both* `.cards` and `.tools`, which makes `moveCardsTo` find it in `.cards` first
(branch 1) and leave `.tools` **stale** — a test-only artifact a real game never has. Seeding `.tools`-only
(via `applyBoardMutations`) makes `moveCardsTo`'s `.tools` branch fire and the snapshot's tool count update
correctly. Correspondingly, `executeAttachedMove`'s auto gather reads `[...energies.cards, ...tools]` (Tools
live in `.tools`, not `.cards`).

The variant surfaced **4 native bugs** (interp faithful, allow-listed, never fixed):
- **Gadget Show** (Heat/Wash/Mow Rotom DRI) — "30 per Pokémon Tool attached to all your Pokémon" counts
  the **vestigial `PokemonCard.tools`** field (never populated; the engine stores tools on
  `PokemonCardList.tools`), so it always counts 0. IR/interp read the real `list.tools`.
- **Gnaw Through** (Arven's Skwovet DRI) — the entire `reduceEffect` is **commented out** (unimplemented),
  so it never discards the opponent's Tool. IR/interp do (opponent `tools` −1, `discard` +1).

And one **IR-integration bug fixed**: `forEach toolsAttached` ignored the IR's `bothSides` flag and counted
only the Active (Bronzong's *Tool Drop*, "40 per Tool attached to **all** Pokémon"); now it sums active+bench
across the named side(s). **Deferred**: `attached`→discard with a `source` selector (Minccino's "from your
opponent's Pokémon" — native emits a `ChoosePokemonPrompt` of a different geometry; counted skip).

`compared` rose **+6 per existing variant** (the prize/attached phase) and the new `tools-loaded` variant
compares ~528 cards at **0 mismatches**. Non-vacuity assertions prove a Tool is actually discarded (tools
1→0, discard +1) and that `hasTool` flips the damage with the Tool's presence. Rotomancer suite **66 specs,
0 failures**; conformance 191/0.

### 21. Map `me3 → POR` (Perfect Order) — +67 comparable cards, 0 mismatches

The Mega-era corpus prefixes `me2pt5`/`me3` were unmapped "until Twinleaf ships those sets"; Twinleaf has
since shipped **Perfect Order** (`POR`) and **Ascended Heroes** (`ASC`). Adding `me3 → POR` to the bridge's
`PREFIX_TO_SETCODE` resolves **80/80** me3 corpus attacks exactly (collector numbers align: me3-65 = POR-65
*Diggersby*) and unblocks **+67 comparable cards** across the differential (bare 521→588, primed 528→595) at
**0 mismatches on all six board variants** — a remarkably clean widening (these cards exercise the
already-supported op vocabulary on a fresh pool). The structural cross-check rose to 728 checked with
**0 cost-mismatches** and **1 attack-name** discrepancy:

| printing | attack | finding | likely owner |
|---|---|---|---|
| me3-46 | Hawlucha — Twinleaf **"Revenge Kick"** vs IR/pokemontcg.io **"Vengeful Kick"** | Perfect Order is a Japan-only Mega-era set whose English name isn't yet canonical; the Japanese リベンジキック transliterates literally to "Revenge Kick" (favoring Twinleaf). **Adjudication deferred** (allow-listed). | neither / TBD |

**`me2pt5 → ASC` is deferred** (not mapped): the card files exist and numbers align (me2pt5-22 = ASC-22 Mega
Charizard Y ex), but the Twinleaf `set-ascended-heroes` module is **not loadable** via
`getCardBySetAndNumber('ASC', …)` in the test harness (the loader infers each module's set code from its
first card and keys `set-ascended-heroes` under a non-`ASC` code, so it never loads → 0/202 me2pt5 attacks
resolve). Mapping it would be pure noise, so me2pt5 stays `unmapped` pending a harness fix (now roadmap #1).
Rotomancer suite **67 specs, 0 failures**; conformance 191/0.

### 22. Set-loader fix → me1/MEG + me2pt5/ASC unblocked (+150 cards), ~25 discrepancies

`me2pt5 → ASC` resolved 0/202 because the lazy card loader keyed each set module by **only its first card
file's** set code; `set-ascended-heroes`'s `index.ts` imports an `other-prints` reprints file first, whose
first 7 cards are `set='MC'`, so the module was keyed under MC and `ensureSetCodeLoaded('ASC')` never found
it. The same bug had silently kept **`me1 → MEG` dormant** too (mapped but resolving nothing). Fixing
`inferSetCodesFromModule` to register each module under **all** its set codes (additive — `defineSet` is
first-wins, `loadSetModule` idempotent) unblocked both, plus partial sv-era coverage.

**Scale:** the differential `compared` rose **+150** (bare 588→738, primed 595→747); the structural
cross-check from 728 to 921 checked — at **0 differential mismatches** after triage. **No interpreter bugs**
surfaced; every divergence is native-side or an IR-faithfulness gap, verified individually:

| class | examples | adjudication |
|---|---|---|
| native Mega-card bugs | Rock Hurl (Naclstack — deals 0); Hadron Spark (Miraidon ex — under-applies the +120 ex bonus, interp correctly KOs); Energy Crush (Delcatty — counts its OWN Pokémon, not the opponent's); Rising Lunge (coin +20 applied in the async COIN_FLIP_PROMPT callback, lost); Growl (Chikorita — damageDebuff set on the wrong Pokémon); Clutch (Larry's Braviary — retreat lock doesn't land on the defender) | allow-listed (interp faithful) |
| IR-faithfulness gap | Giant Bouquet (Mega Meganium ex — IR drops the `[G]`-type filter on the per-energy count, cf. Syrup Storm) | allow-listed |
| Japan-only translation names | U-turn/U-Turn, Geo Gate/Geogate, Volcanic Meteor/Volcano Meteor, Shining Feathers/Feather, Draining Kiss/Drain Kiss, … (me1/me2pt5) + 2 cost-data deltas (Water Shot, Take Down) | adjudication deferred (English names not canonical, cf. Hawlucha) |
| reprint-resolution artifact | sv7-49 Lanturn — no `set-stellar-crown/lanturn.ts`, so `SCR-49` resolves the **Lost Thunder** Lanturn reprint (labelled `set='SCR'`); different attacks/HP/resistance | allow-listed (printing artifact, surfaced not silent) |

**Loader safety** verified across the **sets (22/0)** and **conformance (191/0)** suites — the change is
additive (modules become findable under more codes). Rotomancer suite **67 specs, 0 failures**.

### 23. `cards.move count:'untilHandSize'` (draw-to-hand-size) + empirical roadmap re-grounding

Before building the next vocabulary item I censused the corpus (`fixtures/attack-scenarios.json`, 1851
scenarios) against the differential's per-op skip counter (`unsupportedReasons`). The result **corrected the
roadmap**: the three "small remaining ATTACK gaps" it named are essentially vapor —

| roadmap-named gap | corpus instances | verdict |
|---|---|---|
| `condition.apply removeMode` | **0** | the throw is defensive/unexercised — nothing to unblock |
| `extremum` / `excludeSelf` selectors | **0** / **1** | one card (Koraidon *Unrelenting Onslaught*) |
| `damage.move` | **3** | Cofagrigus ×2 (`rsv10pt5`, speculative/unmapped) + Wobbuffet — player-chosen counter move, **no deterministic oracle** |

The real skip buckets are dominated by **genuine deferrals** (no oracle): `cards.move` deck search (18×),
`chooser:'opponent'/'random'` (12–14×), and `native made an ambiguous choice` (10–33×, inherent to
choice-alignment, not a vocabulary gap). The **one large bucket that is deterministic** was
`unsupported cards.move count …` (8×/variant) — every instance is `count:'untilHandSize'`, *"draw until you
have N cards in your hand."*

**The fix** (one branch in `executeCardsMove`): draw `max(0, N − handSize)` from the deck top — the engine
equivalent of native's `while (hand.length < N && deck.length) draw 1` behind a Confirm (e.g. Blissey ex
*Return*: `ConfirmPrompt(WANT_TO_DRAW_UNTIL_6)` → that loop). The harness auto-confirms the `choice` wrapper on
both engines, and `.slice` clamps to deck size exactly as native breaks on an empty deck; the count-based
`snapshot` compares `hand`/`deck`, so both land identical.

**Result:** `compared` rose **+8 per variant** (bare 738→746, primed/conditions/tools-loaded 747→755,
energy-rich 726→734, zones-loaded 742→750) at **0 mismatches**, **no allow-list entries needed** — Blissey ex
& Lumineon *Return*, Cynthia's Garchomp ex *Corkscrew Dive* (×5 printings), Mismagius ex *Hexa-Magic*, Thievul
*Greedy Hunt*, Decidueye *Stock Up on Feathers* all flipped clean. The `unsupported cards.move count` reason is
gone from the scorecard. Rotomancer **67 specs, 0 failures**; structural 921/0, official 810/0.

**Plateau reached.** With `untilHandSize` done, every remaining ATTACK-side skip bucket lacks a deterministic
oracle, so additional gains require an oracle-bearing harness extension (a new observation surface, or more
affect-target choice-alignment) or new IR origins (ABILITY/RULE_BOX), not more vocabulary.

### 24. `stadium-loaded` board variant (7th) + `cards.move` stadium→discard

The plateau's first oracle-bearing extension: a Stadium observation surface. Two things shared one mechanism —
a Stadium in play — and both were oracle-backed rather than deferrals:
- **`stadiumInPlay`** (7 corpus) was "compared" but **vacuously**: no board variant had a Stadium, so it
  evaluated *false* every time and its true branch was never tested — exactly the kind of vacuous pass the
  north star flags as poisoning the oracle.
- **`cards.move stadium→discard`** ("discard the Stadium in play", 7 corpus) threw `unsupported zone
  "stadium"` — the deterministic slice of the `unsupported zone` bucket (the rest are place-a-Pokémon).

**The change.** (1) `executeStadiumMove` in [ir-cards.ts](ir-cards.ts): the Stadium is a global singleton, so
resolve the source by the non-empty `player.stadium` (mirroring `StateUtils.getStadiumCard`), move it to the
owner-aware `to` zone; a no-op when none is in play (as native guards). (2) A 7th board variant,
`stadium-loaded`, mirroring `tools-loaded` (§20): seed an **inert** Stadium (Town Store — its only effect is a
`UseStadiumEffect`-gated ability the differential never triggers; seeding directly bypasses its on-play
effect) into the attacker's `player.stadium`, and add a per-side `stadium` count to the snapshot so a discard
(1→0) is observable. Two non-vacuity assertions prove both branches fire.

**Result.** Suite **70/0**; the new variant compares **757 at 0 mismatches**. The de-vacuification is real:
the **5** mapped `stadiumInPlay` cards that resolve (Fan Rotom *Assault Landing* across SCR/PRE/ASC + Fan
Rotom2 ASC, Vivillon *Blow Through* M3) now exercise their TRUE branch. The realized count gain on the existing
variants is small — most corpus stadium printings are Japan-only / number-drifted and name-validate to safe
`mismatch` skips (Skarmory *Big Storm*, Eternatus *Shatter*, Wooloo/Dubwool *Knock Over*, Dhelmise, Probopass
all lack a name-aligned Twinleaf card) — but the resolving cards are now exercised, and one **native bug**
surfaced:

| card | bug | adjudication |
|---|---|---|
| Mow Rotom DRI *Trimming Mower* (sv10-9) | "20 damage. Discard a Stadium." Native deals **0** (the base-20 is never applied), though it discards the Stadium correctly. Independently confirmed by the official-data cross-check (`sv10-9:damage:Trimming Mower`). | allow-listed (`KNOWN_NATIVE_BUGS_BY_PRINTING`) — interp deals 20, the faithful value |

This was hidden in the differential only because the card previously threw on the stadium zone; unblocking it
exposed the known damage bug. The stadium-discard *mechanism* matched native exactly (both moved the Stadium
1→0 to the owner's discard) — only the damage diverged.

### 25. `cards.move bindAs` → `countOf` — discard-and-scale completed; the deterministic well is now dry

The last clean deterministic vocabulary gap: the `countOf ref not bound` skip bucket (4×/variant).
Discard-and-scale ("discard N cards, then `base + per × N` damage") was half-built — `energy.discard bindAs`
recorded the discarded list (Inferno X, §8.1), but `cards.move bindAs` did not, so its `countOf` threw
unbound and the card was skipped. The 4 cards are all me3 (Mega Clefable ex *Shooting Moons*, Mawile *Double
Eater*), shape: `cards.move` hand→discard `bindAs` (Energy, `upTo`, `chooser:'player'`) + `damage.deal
perCount {base, per, countOf}`. The §13 deferral reason ("me3-unmapped, no oracle") was **stale** — me3→POR
is now mapped and the native POR cards exist.

**The fix** (threading, not new logic): pass the fragment-scoped `bindings` register into `executeCardsMove`
(it already reaches `executeEnergyDiscard`) and record the chosen-and-moved set as `bindings[op.bindAs]` in
the move paths — even when empty, so `countOf` reads 0 rather than throwing. Added `max?` to the `CountForm`
type (the `upTo` upper bound the runtime already read via `any`).

**The oracle is near-identical.** Native *Shooting Moons*/*Double Eater* both do
`ChooseCardsPrompt(player.hand, Energy, {min:0, max:min(N,eligible)})` → discard chosen →
`effect.damage += cards.length × per`. The interpreter's `executeCardsMoveChoice` emits the same prompt (the
harness greedily discards `min(max, eligible)`), and `countOf` reads the recorded count. **Result:** all 4
me3 prints flipped clean — `compared` rose **+4 per variant** (bare 746→750, primed 755→759, …,
stadium-loaded 757→761) at **0 mismatches, no allow-list entries**. The `countOf ref not bound` reason is
gone from the scorecard. Suite **71/0**. A non-vacuity assertion proves the damage scales with the seeded-hand
Energy discarded (0/1/2 → base/+per/+2per) and the empty case binds `[]` (countOf 0, not a throw).

**The deterministic well is now dry.** Every remaining ATTACK-side skip bucket lacks a deterministic oracle:
`cards.move` deck search (18), `chooser:'opponent'/'random'` (12–14), `native made an ambiguous choice`
(10–33, inherent), place-a-Pokémon zone endpoints, `coinFlipsUntilTails`, `energy.attach` from deck. Further
ATTACK-side gains require either the **risky** Stage B choice-alignment extension (per-shape native
prompt-geometry verification; false-positive-prone) or new **IR origins** (ABILITY/RULE_BOX, still blocked at
0% of the corpus) — not more vocabulary.

### 26. Coverage audit — the plateau, made auditable and regression-guarded

With the deterministic vocabulary exhausted, this phase hardens rather than extends. The variant
differentials assert *0 mismatches on what we compare*, but nothing guarded the comparison **set** — a
refactor could silently move a card `compared → skipped` (coverage erodes, suite stays green). The **coverage
audit** ([rotomancer-differential.spec.ts](../rotomancer-differential.spec.ts), §12.9) classifies all 1851
corpus cards on a `primed` baseline and pins the result. The authoritative scorecard (2026-06-22):

| bucket | n | meaning |
|---|---:|---|
| **compared** | **759** | resolves exact → built + attacked → snapshot compared (matches the primed differential) |
| counted skip | 78 | interpreter throws a known unsupported reason (full histogram below) |
| `non-exact:mismatch` | 813 | printing doesn't name-validate to a Twinleaf card (number drift / Japan-only print with no Twinleaf equivalent) |
| `native-error` | 139 | resolves, but the **native** card throws on attack (catalogued by the corpus replay spec; the differential silently skips these — the audit makes them visible) |
| `allowlist-mismatch` | 41 | `KNOWN_MISMATCHES` (IR-faithfulness gap / native bug, by label) |
| `allowlist-native-bug` | 13 | `KNOWN_NATIVE_BUGS_BY_PRINTING` (by printing) |
| `self-weak` | 7 | mirror-unsafe (weak to its own type) — filtered |
| `non-pokemon` | 1 | not a `PokemonCard` |
| **total** | **1851** | ✓ completeness asserted |

Full skip histogram (the audit surfaces 3 reasons the differential's top-8 hides — `history event` 1,
`unsupported card subtype` 1, `unsupported predicate kind` 1): deck search 18, `cards.move chooser` 14, zone
11, ambiguous-choice 10, Stage-B affect-target 8, count form 5, `energy.attach` from zone 5, attached
multi-Pokémon source 2, unsupported op 2, + the three singletons.

**Two regression guards** (both verified to bite — a phantom compared key and a removed reason each fail with
a precise message): the current `compared` set must **⊇** the pinned baseline (a drop fails; additions pass),
and the observed skip-reason set must **⊆** the pinned `expectedSkipReasons` (a new throw fails). Coverage can
now only be lost on purpose, never by accident. The baseline (`fixtures/coverage-baseline.json`)
self-bootstraps and is re-pinned by delete + re-run after an intentional coverage change.

### 27. Choice differential — option-set equivalence retires the masking risk

The variant differentials resolve a player choice to **one** option (first-eligible). That left the project's
one masking risk (§12.10): a native/interp prompt-geometry mismatch can balance the divergence guard, the
harness picks first-eligible on each, and two *different* picks can coincidentally produce the same snapshot —
agreeing for the wrong reason. The **choice differential** verifies, for the single-select `ChoosePokemonPrompt`
affect-target class, that the engines offer the **same option set** (Invariant A) and that **every option does
the same thing** (Invariant B) — not just first-eligible.

**Mechanism.** Extract `choosePokemonCandidates` from the harness auto-resolver (so the option list is the very
one native resolves; behavior-preserving — sets 97/0, conformance 190 pass, differential counts unchanged),
then on a benched mirror board capture each engine's candidate set via `overridePrompt`, compare as canonical
`player-slot-index` keys, and re-run selecting each option to compare snapshots.

**Result: 35 attacks (all multi-option), 89 options checked, 0 mismatches** after triage. It immediately found
a native bug first-eligible can't see:

| card | bug | adjudication |
|---|---|---|
| Armarouge SSP *Crimson Blaster* (sv8-34) | offers the **Active** as a target though the text is "1 of your opponent's **Benched** Pokémon" — option set `{active,bench0,bench1}` vs the IR's `{bench0,bench1}`. The same bug `KNOWN_BENCHLESS_NATIVE_BUGS` only caught on the bare board; the option-set invariant catches it directly. | allow-listed (`KNOWN_CHOICE_BUGS`) |

**Both invariants verified to bite:** A flagged the real Crimson Blaster option-set divergence with a precise
message; a deliberate off-by-one skew of the interp's per-option pick produced **71** per-option mismatches
(each showing native landing on the chosen Pokémon vs interp on the wrong one) — exactly the masking case, now
impossible to hide. Follow-ups the harness enables: multi-select (`targetCount`≥2), `ChooseCardsPrompt` (now
done, §28), and the residual choice-ops including `chooser:'opponent'` (now safe to align).

### 28. Card-choice differential — ChooseCards option-set equivalence + identity-aware snapshot

§27 retired the masking risk for `ChoosePokemonPrompt`, but the differential still resolved every
**`cards.move chooser:'player'`** choice first-eligible via a `ChooseCardsPrompt` ("choose a card from your
discard to your hand"; "discard up to N Energy"). The risk was live there *and* worse: the snapshot was
**count-only** for piles (`hand`/`discard` are `.length`), so even with the same option set a per-pick check
was vacuous — every pick of the same size yields the same count. The fix has two intertwined parts:

1. **Identity-aware snapshot** (`snapshot(state, identity)`): adds sorted name-multisets `handNames`/
   `discardNames` for the observable pile zones, **opt-in** so the count-only callers (7-variant + §27
   differentials) are byte-identical — zero blast radius. Without it, Invariant B is vacuous for card moves.
2. **Card-choice differential** (2nd `describe`): seeds the op's from-zone with **distinct eligible cards + a
   non-matching decoy** (the decoy makes the *filter agreement* part of Invariant A bite), enumerates the
   eligible set via the shared `chooseCardsCandidates` (extracted from `resolveChooseCardsRaw`, behavior-
   preserving), and asserts **A — same eligible card-name multiset + `(min,max)`** and **B — each pick (every
   singleton + the max-count pick) produces the same identity-aware snapshot**.

**Result: 7 attacks (all multi-option, all distinct-identity), 32 picks checked, 0 mismatches** after triage —
the discard-and-scale energy class (Mega Clefable ex *Shooting Moons*, Mawile *Double Eater*) and opponent-hand
discard (Mega Absol ex *Claw of Darkness*) flip clean. It surfaced **5 native bugs** invisible to first-eligible
(all allow-listed, `KNOWN_CARD_CHOICE_BUGS`; in every case interp is faithful to the printed text/IR and native
diverges):

| card | bug | adjudication |
|---|---|---|
| Slowpoke SCR *Dangle Tail* (sv7-57) | **copies instead of moving** — native `MOVE_CARDS` is handed a fresh `CardList` source, not `player.discard`, so the chosen Pokémon enters the hand **and stays in the discard**. Invariant B caught it via `discardNames` (native discard count 4 vs interp 3). | Twinleaf bug |
| Iron Leaves TWM *Recovery Net* (sv6-19) | text "Choose **up to 2**" permits 0, but native's prompt is **min:1** (forbids choosing 0). IR `upTo` → min 0 is faithful. | Twinleaf bug (min) |
| Luxray ex TWM *Piercing Gaze* (sv6-195, sv6-68) | text "**discard 1 card**" is mandatory, but native's prompt is **min:0** (lets you skip). IR `exactly:1` → min 1 is faithful. | Twinleaf bug (min) |
| Dedenne SSP *Electromagnetic Sonar* (sv8-87) | text "**Put a Trainer card** … into your hand" is mandatory, but native's prompt is **min:0**. IR `exactly:1` → min 1 is faithful. | Twinleaf bug (min) |

(The Dangle Tail copy bug is distinct from Slowpoke's already-noted retreat data bug, sv7-57 below.)

**Both invariants verified to bite, and the identity snapshot proven load-bearing:** the real run flagged the 4
`min` divergences (Invariant A) and the Slowpoke copy (Invariant B); a deliberate ignore-the-pick skew of the
interp run produced **22** per-pick mismatches with **identical discard counts and damage, differing only in
`discardNames`/`handNames`** (e.g. *Shooting Moons* picking Grass: native discards Grass, skewed-interp
discards Fire — both count 1, both 160 damage) — exactly the case a count-only snapshot would have passed,
proving the identity snapshot is what makes Invariant B bite for card moves. **Out of scope** (documented
deferrals): `discard→bench` place-a-Pokémon (`resolveZone` throws on `to:bench`), deck-search, attached/prize
moves.

### 29. Switch differential — bench→active option-set equivalence + active-species identity

The last first-eligible-resolved `ChoosePokemonPrompt` class the choice differentials hadn't covered:
`cards.move bench→active` (same owner) — "switch to 1 of your (or your opponent's) Benched Pokémon." §27 only
covered AFFECT-target choices, and the mirror board seeds *identical* benched Pokémon, so the switch's
observable — which species is now Active — was invisible (`PokeSnap` had no name). Fixed with the §28 identity
pattern applied to Pokémon: **`PokeSnap.name`** (opt-in) records the Active/Bench species; the differential
seeds **distinct** benched Pokémon and asserts **A — same bench targets + `(min,max)`** and **B — switching to
each target promotes the same species**.

**Result: 13 switches (all multi-option), 39 targets checked, 0 mismatches** — self-switch (*Run Around*,
*Trading Places*, *Leap Out*, *Teleportation Attack*, *Hydro Turn*, *Reverse Thrust*, *Dire Nails*, *Poisonous
Ploy*) and opponent-switch (*Follow Me*, *Pull*) all clean, **no native bugs**. The active-species snapshot was
verified load-bearing: a deliberate always-switch-to-bench[0] skew produced **26** per-target mismatches that
differ *only* in `name` (native promotes e.g. Turtonator, skewed-interp promotes Togepi — both 0 damage, 0
energy) — exactly the case a count-only snapshot would have passed. Honest counted skips: 18 non-exact, 5
build-error (2 native name-drift `UNKNOWN_ATTACK` — Ninjask *U-turn*; and `chooser:'opponent'` — addressed in §30).

### 30. `chooser:'opponent'` alignment — the opponent picks

The last choice axis the differentials couldn't align: a choice the **opponent** makes. Census: **0**
affect-target opponent-choosers; **23** `cards.move chooser:'opponent'` (16 bench→active switches — *Whirlwind*,
*Push Down*, …; 7 hand→deck/discard — *Cursed Words*, *Tighten Up*), all previously throwing
`unsupported cards.move chooser "opponent"`. Three interp changes align it (the IR interpreter *is* the
integration under test): `executeSwitch` frames the Bench prompt from the **chooser's** perspective
(`opponent.id`/`BOTTOM`, matching native's `SWITCH_ACTIVE_WITH_BENCHED(opponent)`); `executeCardsMoveChoice`
owns the prompt by the chooser; the guard admits `'opponent'`.

**An ordering limitation surfaced and is honestly deferred.** Defender attack damage is deferred in
`effect.damage` (applied after the reduce, so weakness/resistance run), but a switch executes inline — so
`[deal 50 to the defender, then the defender switches]` (Bayleef *Push Down* me1-9) lands the 50 on the
*switched-in* Pokémon, while native applies the damage first (end of attack) then switches in
`AfterAttackEffect`. The harness caught exactly this (the 50 KO'ing the promoted Pokémon and yielding a prize)
before the guard was added. Since we can't faithfully order deferred-defender-damage before an inline
switch-of-the-defender, `executeSwitch` throws → skip when `owner === effect.opponent && effect.damage > 0`.
This is an interp limitation deferred (not a native bug), consistent with the project's throw-to-skip rule
(never a wrong answer).

**Result (no new harness — verified by the existing differentials):** the switch differential now enumerates
*Whirlwind* (sv10-2/183, opponent-chosen) and the main differential compares *Cursed Words* (Banette ×3 —
opponent discards from their own hand to deck) at **0 mismatches, no native bugs**. Coverage `compared` rose
**759 → 764** (+5: *Whirlwind* ×2 + *Cursed Words* ×3); one new honest skip reason (the ordering deferral);
baseline re-pinned. The rest are genuine non-resolves (*Tighten Up* is all `zsv10pt5`) or the Push Down ordering
deferral. (The card-choice *describe* skips *Cursed Words* on a "Shuffle deck" prompt its seeded board can't
auto-resolve — but it's covered clean in the main differential.)

### 31. Multi-select differential — option-combination equivalence (and 3 native bugs)

The last first-eligible-resolved gap: a choice of **N≥2** targets ("50 damage to 2 of your opponent's Pokémon"
— Twin Shotels, Split Bomb, Mirage Barrage, Obsidian, Trifrost). §27 covered only targetCount===1. The interp
already emits a max=N prompt, so this needs no interp change — just a combination-enumerating differential on a
3-bench board (K>N → genuine combinations), asserting **A — same candidate SET + max** and **B — selecting each
N-subset lands the same per-slot damage** (per-slot damage already distinguishes which Pokémon were hit, so no
identity snapshot needed). `min` is **reported, not asserted** — native's multi-target prefab systematically
uses min:1 (lets you under-target) vs the IR's exactly-N (11 cards, one prefab convention; orthogonal to the
masking risk).

**Result: 17 attacks (all multi-subset), 88 subsets checked, 0 mismatches** after triage; 11 min divergences
reported. **3 native bugs** surfaced (allow-listed, interp faithful in each):

| card | bug | invariant |
|---|---|---|
| Electivire ex DRI *Dual Bolt* (sv10-212, sv10-69) | native offers the **Bench only**, but the text "50 damage to 2 of your opponent's Pokémon" (and the IR) target **any** Pokémon | A (candidate set) |
| Steven's Skarmory DRI *Sonic Double* (sv10-142) | native sets the attack's base `damage:50` (auto-applied to the defender) **atop** the 50-spread to 2 chosen — double-hitting the Active (100 when also chosen); text is "50 damage to 2 of your opponent's Pokémon" = spread only | B (per-subset) |

Both invariants proven to bite on real findings (A caught Dual Bolt's bench-restriction; B caught Sonic
Double's double-count via the per-slot damage). With §27–§31, **every first-eligible-resolved choice point is
now verified by whole-option-set + per-outcome equivalence** — the masking risk is fully retired across
affect-targets, card moves, switches, opponent-choosers, and multi-select.

### 32. Native-error skip bucket — audit ("false-skip" surface)

Symmetric to the masking risk (two engines agreeing for the wrong reason), the **"false skip"** risk is a card
the harness silently drops behind a reason that hides a real divergence. The coverage audit's largest unexamined
bucket is **`native-error`** — cards that resolve but the *native* run throws on attack (swallowed at
[rotomancer-differential.spec.ts:1058](../rotomancer-differential.spec.ts)). Census of all **139**:

| error | n | cause | verdict |
|---|---|---|---|
| `UNKNOWN_ATTACK` | 109 | native card lacks that attack label (attack-name drift, mostly `me`-set) | native data (catalogued by the structural spec) |
| `CANNOT_USE_ATTACK` | 20 | native attack **precondition** the generic board doesn't satisfy: Unified Beatdown (`turn≤2`), Erasure Ball (≥4 Team Rocket Pokémon), Lucky Attachment (a basic Energy in hand), Blazing Destruction (a Stadium in play), Regi Charge ([F] Energy in discard) | honest skip (board too sparse; unblocking each is card-specific and risks surfacing IR gaps) |
| `NOT_ENOUGH_ENERGY` | 3 | harness attaches the IR cost; native's cost differs → throws (Wash Rotom, Duosion, Inteleon) | downstream of already-known native **cost** data bugs |
| `CANNOT_USE_POWER` | 3 | Duskull *Come and Get You* — place-a-Pokémon (`to:bench`, deferred) + native gates on a hand-Duskull precondition (and the wrong error message — it's an attack) | honest skip + native quirk |
| `forEachPokemon` TypeError | 3 | Rotom ex *Thunderbolt* calls `effect.player.forEachPokemon` in a `CheckTableStateEffect` handler where `effect.player` is undefined | **native card crash** (doesn't guard) |
| Invalid auto-resolved prompt `"Shuffle deck"` | 1 | see below | **harness gap → fixed** |

**Conclusion: the bucket is overwhelmingly legitimate** — native data drift, native attack preconditions the
fixed board doesn't meet, and native bugs — **not** a systematic harness gap hiding fixable coverage. The
"false-skip" concern is retired for this bucket.

**The one harness fix (and a native engine bug it exposed).** Gholdengo *Surf Back* (and the opponent-chooser
*Cursed Words*) shuffle the deck, and the auto-resolution threw `Invalid auto-resolved prompt result for
"Shuffle deck"`. Root cause: **`ShuffleDeckPrompt.validate` / `ShuffleHandPrompt.validate` sort the order with
a bare `array.sort()` (no numeric comparator)** — so `[0,1,…,28].sort()` → `[0,1,10,11,…,2,…]` and the
`s[i]===i` permutation check fails for **any deck ≥ 11 cards**. The arbiter returns a correct identity (NO_SHUFFLE)
order; the native validate wrongly rejects it. That's a genuine **native engine bug**
([game/store/prompts/shuffle-prompt.ts](../../../game/store/prompts/shuffle-prompt.ts)) — *not fixed* per the
standing rule (engine/card bugs are the user's). The **harness** fix is to skip validation for shuffle prompts
(the auto-resolved order is deterministic and correct by construction), in
[test-helpers.ts](../test-helpers.ts)'s `decodeAndValidatePromptResult`. This unblocked *Surf Back* (native-error
139→138) and, in the card-choice differential, *Cursed Words* ×3 — which then exposed that the card-choice
Invariant B enumerated singletons even for a `min>1` prompt (Cursed Words is "choose **3** cards", min:3); fixed
by gating singletons on `min ≤ 1` (the max-count pick covers min>1). Both are genuine **harness** fixes; no
native card/engine was touched.

### 33. "Native made an ambiguous choice" skip bucket — audit (identification-only)

The next-largest skip bucket: the main differential skips when `native.ambiguous !== interp.ambiguous` (the
divergence guard — the engines disagree on prompt geometry, so a first-eligible comparison isn't trustworthy).
Instrumented it on the primed board and compared `native.snap` vs `interp.snap` to separate *false skips*
(would compare cleanly) from real divergences. All **10**:

| card(s) | nat/intp | snap | classification |
|---|---|---|---|
| Explosion Y (Mega Charizard Y ex) ×2 | 2 / 1 | **MATCH** | **false skip** — native prompts the greedy energy-discard; the interp resolves it directly. Identical outcome, different ambiguity count — the guard is over-conservative here (refining it risks re-introducing false mismatches, so left as-is). |
| Sonic Double, Dual Bolt ×2, Crimson Blaster | — | MISMATCH | already-identified **native bugs** (§31, §31, §27) — the guard correctly skips them. |
| **Round (Wigglytuff me2-105/me2-77)** ×2 | 0 / 1 | MISMATCH | **IR card-data issue** — the IR encodes `perCount per:40`, but native (NXD Wigglytuff) and the printed text are *"20 damage **times** the number of your Pokémon with the Round attack"* (`damage:20, 'x'`). The interp's `40×3=120` over-damages → KOs the mirror defender → promotes (the spurious `intp=1` choice). Either the IR's `per` is doubled (40 vs 20) or `me2-105` is a Mega-era reprint mis-resolved to NXD Wigglytuff. → *identify*. |
| **Icicle Loop (Chien-Pao sv8-56/svp-152)** ×2 | 1 / 2 | MISMATCH | the 120 KOs the low-HP mirror defender, and the KO→promote prompt races the **deferred defender damage vs the inline energy-return** — the same ordering limitation as Push Down (§30). → *identify* (interp deferred-damage ordering). |

**Latent interpreter gap (identified, doesn't currently bite):** `countOf` evaluates `forEach.of` (`pokemonInPlay`
etc.) but **ignores `form.predicate`** — so Round's `hasAttack:'Round'` filter is dropped. On a mirror board
every Pokémon matches, so the count is unaffected; on a non-uniform board the interp would over-count.

**Conclusion:** the guard is doing its job — 8/10 are real divergences it correctly skips (4 known native bugs +
2 new IR-data/ordering findings); 2/10 (Explosion Y) are over-conservative false skips. **No clean
harness/interpreter bug to fix this round** — the new findings are an IR-data error (Round `per`), an interp
ordering limitation already documented (Icicle Loop), and a latent `countOf` predicate gap — all *identify*-only
per the standing rule.

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
