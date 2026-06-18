# Rotomancer ↔ Twinleaf cross-engine test bed — design

**Status:** spike landed (oracle replay of plain attacks); this doc is the plan for the rest.
**Audience:** anyone extending the `rotomancer/` test harness in `ptcg-server`.

---

## 1. Goal

Two independently-written Pokémon TCG engines model the same cards:

- **Twinleaf** (`ptcg-server`) — a playable engine. Cards are hand-written TypeScript
  classes whose `reduceEffect(store, state, effect)` imperatively mutates game state via
  effects (`DealDamageEffect`, `MoveCardsEffect`, …) and interactive prompts. ~9,800 card
  files. Known to contain approximations/bugs (we just fixed a card-duplication bug in
  `MoveCardsEffect`).
- **Rotomancer** (`~/projects/pokemon-cards`) — a correctness-first engine. Cards are
  **data**: each compiles to a closed-set **Effect IR** (`irVersion` 1.54.0) executed by a
  VM (`sim/`), and validated against the rulebook + compendium. It ships golden behavioral
  **scenarios** (`ScenarioSpec`: a fixture + a list of steps/expectations).

The goal is a **test bed inside Twinleaf** that runs the same card behavior through both
models and flags disagreements. Disagreements are high-signal: they are bugs in one engine
or the other (or an IR faithfulness gap).

Why it's worth building:
- A second, independently-written interpreter of the Rotomancer IR is a strong correctness
  oracle for the IR itself.
- Twinleaf gets a path to *generate* card behavior from IR instead of hand-coding it.
- Shared cards get a standing cross-engine regression net.

---

## 2. Two strategies (one harness)

There are two distinct ways to "test cards against each other." They share most plumbing;
(A) is a strict subset of (B)'s effort and is the foundation.

### (A) Oracle replay — *no interpreter* — ✅ spike done
Translate a Rotomancer scenario (`fixture` + `items`) into a Twinleaf `setupGame` state,
run the steps as **native** Twinleaf actions, and assert Rotomancer's expectations. This
tests *native Twinleaf* against *Rotomancer's golden numbers*. It needs only: a
`printingId`→card resolver, and a fixture/step/expectation translator.

### (B) IR interpreter + differential — the deeper artifact
Build a TypeScript interpreter that executes a Rotomancer IR program *as* a Twinleaf card
(`InterpretedCard.reduceEffect` walks the IR ops and emits Twinleaf effects). Then, for a
shared card, run the *same* scenario through (a) the native card and (b) the IR-interpreted
card and assert identical observable post-state. This audits **both** engines at once and
makes Twinleaf able to play any IR-encoded card.

```
                    ┌─────────────────────────── shared harness ──────────────────────────┐
Rotomancer scenario │  printingId resolver → setupGame fixture → run steps → assert        │
(fixture + items) ──┤                                                                      │
                    │  (A) steps run on NATIVE card ───────────────► compare to expectations│
                    │  (B) steps run on INTERPRETED card ──┐                                │
                    │      native card ───────────────────┴──► assert identical post-state │
                    └──────────────────────────────────────────────────────────────────────┘
```

Recommended order: finish (A)'s breadth first (high value, low risk), then layer (B)'s
interpreter op-by-op on the same harness.

---

## 3. Components

```
ptcg-server/src/sets/tests/
├── test-helpers.ts            setupGame(), getCardBySetAndNumber()   [shared]
├── card-test-helpers.ts       actions + query/assertion helpers      [shared]
├── rotomancer/
│   ├── bridge.ts              printingId → Twinleaf card; energy map  ✅
│   ├── recipe-runner.ts       fixture/items → setupGame/actions/asserts ✅ (attack+damage only)
│   ├── ir-interpreter.ts      IR program → Twinleaf effects           ▢ (B)
│   ├── differential.ts        native-vs-interpreted comparison        ▢ (B)
│   └── DESIGN.md              this file
└── rotomancer-oracle.spec.ts  runnable scenarios                      ✅
```

### 3.1 Printing resolver (`bridge.ts`) — ✅
Rotomancer identifies a card by `printingId` (`"sv8-116"` = set prefix + collector number).
Twinleaf identifies by `fullName` (`"Koraidon SSP"`) and carries `card.set` + `card.setNumber`.
Resolution = `prefix → Twinleaf set code` then load that set and find the card whose
`(set, setNumber)` matches. **Resolution must be printing-precise** — `Kingambit me2pt5-148`
and `Kingambit SVI` are *different printings* with possibly different attacks; never
substitute by name alone.

### 3.2 Recipe runner (`recipe-runner.ts`) — ✅ (minimal)
Translates a `RecipeFixture` into a `SetupGameConfig` (player 0 = "us"/card-under-test,
player 1 = "them"), then dispatches each `item` as either a step (action) or an expectation
(assertion). Unsupported kinds **throw** — no silent skips, so coverage gaps are visible.
Currently supports `attack` + `expect{Our,Their}ActiveDamage`.

### 3.3 IR interpreter (`ir-interpreter.ts`) — ▢ to build
An `InterpretedCard extends PokemonCard` whose `attacks`/`powers` are synthesized from the
IR `fragments`, and whose `reduceEffect` runs the matching fragment's `body` when its trigger
fires. The interpreter is a dispatcher over the closed IR vocabulary (see §4). It needs four
sub-evaluators:
- **op executor** — `body[]` op kind → Twinleaf effect(s)
- **count evaluator** — `const`/`forEach`/`perCount`/`upTo`/… → a number or prompt bound
- **predicate evaluator** — `and`/`not`/`turn.aspect`/`subtype`/`energyType`/`zoneIs`/… → bool
- **selector resolver** — `opponentActive`/`anyOwnPokemon`/… → a `CardTarget`/prompt

### 3.4 Differential harness (`differential.ts`) — ▢ to build
Runs a scenario twice (native vs interpreted card in the same slot), then compares observable
state: damage on each slot, special conditions, zone sizes/contents, energy counts, KO, prizes,
match outcome. Reuses the conservation helpers (`collectAllCardIds`, `expectNoDuplicateCards`)
to also assert no card was lost/duplicated.

---

## 4. Mapping tables

### 4.1 Set prefix → Twinleaf set code (`bridge.ts`)
| prefix | set | code | status |
|---|---|---|---|
| sv5 | Temporal Forces | TEF | ✅ |
| sv6 | Twilight Masquerade | TWM | ✅ |
| sv6pt5 | Shrouded Fable | SFA | ✅ |
| sv7 | Stellar Crown | SCR | ✅ |
| sv8 | Surging Sparks | SSP | ✅ |
| sv8pt5 | Prismatic Evolutions | PRE | ✅ |
| sv9 | Journey Together | JTG | ✅ |
| sv10 | Destined Rivals | DRI | ✅ |
| svp | SV promos | SVP | ✅ |
| me1/me2/me2pt5/me3 | Mega Evolution block | MEG/M1L/M1S/… | ▢ **biggest unlock** (me2pt5 alone = 43 cards) |
| zsv10pt5 / rsv10pt5 | Black Bolt / White Flare | ? | ▢ |

### 4.2 EnergyType → basic energy card — ✅
`GRASS→Grass Energy SVE`, `FIRE→Fire`, `WATER→Water`, `LIGHTNING→Lightning`, `PSYCHIC→Psychic`,
`FIGHTING→Fighting`, `DARKNESS→Darkness`, `METAL→Metal`, `COLORLESS→` any basic (we use Water).

### 4.3 IR op kind → Twinleaf effect (the core of the interpreter)
Frequencies are from the 219 committed programs — a Zipfian distribution, so a dozen ops
cover most cards. **Note the unit:** a Rotomancer *damage counter* = 10 HP; Twinleaf damage
is in HP. `damage.placeCounters count:3` → 30 HP.

| IR op (freq) | Twinleaf mapping | difficulty |
|---|---|---|
| `damage.deal` (≈240) | `DealDamageEffect` / `PutDamageEffect` (×weakness handled by engine) | easy |
| `damage.placeCounters` (20) | `PutDamageCountersEffect` (count × 10) | easy |
| `damage.move` (1) | read counters off source slot, `PutDamageCountersEffect` on target | easy |
| `cards.move` (72) | `MoveCardsEffect` / `MOVE_CARDS` prefab (zone via selector) | easy* |
| `energy.attachOrDiscard` (35) | `AttachEnergyPrompt` / `DiscardCardsEffect` | medium (prompt) |
| `condition.apply` (25) | `AddSpecialConditionsPowerEffect` (POISONED/ASLEEP/…) | easy |
| `heal` (15) | `HealEffect` | easy |
| `pokemon.knockOut` (10) | `KnockOutEffect` | easy |
| `pokemon.return`/`discard`/`devolve` (8) | `MoveCardsEffect` + `EvolveEffect`/devolve | medium |
| `discardFromHand` (7) | `MoveCardsEffect` hand→discard (+ prompt if chosen) | easy |
| `prize.modify`/`manipulate` (6) | prize list manipulation | medium |
| `game.win` (1) | set win condition / `GameWinEffect` | easy |
| `attack.lockOrModify` + `passive` family (≈150) | **continuous effects** — see §5 | **hard (the tail)** |

\* `cards.move` is easy mechanically but its *target selection* (which cards) routes through
the selector/predicate evaluators and often a prompt.

### 4.4 Count form → evaluation
| form | meaning | eval |
|---|---|---|
| `const {value}` | literal | `value` |
| `exactly`/`upTo`/`anyAmount` | a chosen count (prompt-bound) | min/max bounds → prompt |
| `forEach {of, who}` | count of a thing (benchedPokemon, energyAttached, …) | count over state |
| `perCount {base, per, count}` | `base + per × eval(count)` | compose |
| `plusIf`/`coinGate`/`coinFlipHeads` | conditional / flip-gated | predicate or `CoinFlipPrompt` |
| `scaled`/`countOf` | scaled or predicate-filtered count | count + filter |

### 4.5 Selector → target/prompt
| selector | Twinleaf | choice? |
|---|---|---|
| `self`, `ownActive`, `opponentActive`, `defendingPokemon` | direct `CardTarget` | no |
| `bothActives`, `eachOwnBench`, `eachOpponentBench`, `ownBench`, `opponentBench` | iterate slots | no |
| `oneOwnPokemon`, `anyOwnPokemon`, `anyOpponentPokemon`, `anyPokemon` | `ChoosePokemonPrompt` | **yes** |
| `eventSubject`, `defendingPokemonAtTriggerTime` | bound at trigger time | no |

### 4.6 Scenario step kind → Twinleaf action
`attack`→`useAttack`; `useAbility`→`useAbility`; `playItem/Supporter/Stadium`→`playTrainerCard`;
`evolve`→`EvolveEffect`/`PlayCardAction`; `retreat`→`RetreatEffect`; `attachEnergyFromHand`→
`PlayCardAction` (energy); `endActiveTurn`→`endTurn`; `opposing*`→ same actions dispatched as
player 1. (`useAttack`/`useAbility`/`playTrainerCard`/`endTurn` exist; retreat/evolve/attach/bench
+ an "opposing actor" wrapper are the gaps.)

### 4.7 Expectation kind → Twinleaf assertion
`expect{Our,Their}ActiveDamage`→`getDamage`; `…Condition`→`hasSpecialCondition`; `…KnockedOut`→
slot empty / in discard; `…BenchSize`/`…HandSize`/`…DeckSize`/`…DiscardSize`→`getZoneCount`;
`…EnergyCount`→`getEnergyCount`; `…Accepted/Refused`→ action threw or not; `expectMatch*`→ game
outcome. (damage/condition/zone-count exist; KO/accepted-refused/match-outcome are the gaps.)

---

## 5. The hard part: continuous effects (locks & modifiers)

Imperative ops (deal/move/heal/condition/KO) map almost 1:1 and are ~a couple of weeks for
~80% card coverage. The long tail is the `lockOrModify`/`passive` family —
`preventDamage`, `abilityShutoff`, `attackCostModifier`, `damageBuff`, `weaknessModifier`,
… — with **scopes** (`opponentNextTurn`, `untilLeavesActive`, `thisAttack`, `passive`).

The two engines model these differently:
- **Rotomancer:** a declarative *lock set* with reconciliation (`reconcilePassiveLocks`
  re-derives the active lock set from the board each step) and explicit scopes.
- **Twinleaf:** continuous effects are realized by **intercepting effects as they flow**
  through `reduceEffect` (e.g. Manaphy's Wave Veil checks state when a `PutDamageEffect`
  is reduced and sets `preventDefault`) plus **player `markers`** with turn stamps.

So the interpreter must translate `(lock kind, scope, predicate)` → a Twinleaf interceptor
(an effect handler that fires on the relevant effect during the scope window) + a marker for
lifetime. This is the bulk of the remaining work and where engine semantics most often
disagree (good — that's the point).

---

## 6. Determinism & choice alignment (the key risk)

Both engines can be made deterministic; the risk is making them make the *same* choices.

| source | Twinleaf | Rotomancer | alignment |
|---|---|---|---|
| coin flips | `BotArbiter` ALL_HEADS / scripted | `coinFlips: [bool]` | **clean** — map directly |
| shuffle/deck | `NO_SHUFFLE` + ordered deck | `matchSeed` + ordered `topOfDeck` | clean enough (pin order) |
| selector choices | interactive prompt, auto-resolved or `overridePrompt` | `choices` keyed by `ChoicePoint.path()` | **hard** — paths don't line up across engines |

**Between-turns timing.** A Twinleaf attack ends with `EndTurnEffect`, so dispatching an
attack also runs the opponent's between-turns checkup. Under ALL_HEADS that *clears
recovery-flip conditions* — a defender put to Sleep or Burned wakes/recovers immediately —
so `expectTheirActiveCondition ASLEEP` after a turn-ending attack will not hold even though
the engine applied it. Rotomancer observes the post-effect state *before* its checkup, so
this is an observation-point mismatch, not an engine bug. Portable assertions use conditions
that survive checkup (Poisoned, Confused) or check damage/KO instead.

Mitigations for selector choices:
1. **Prefer choice-insensitive assertions** — total damage, KO count, zone sizes, conservation.
   These are unaffected by *which* legal target was picked.
2. **Pin by semantic intent**, not by path — translate a recipe's intent ("target opponent
   active") into a Twinleaf `overridePrompt` handler, rather than replaying Rotomancer's
   path-keyed trace verbatim.
3. The spike sidesteps choices entirely (plain attacks, mirror matches → no weakness, no prompts).

---

## 7. Validity rule: exact printings only

Oracle replay is only valid on an **exact-printing match** (same set code *and* collector
number). Otherwise a "disagreement" is just a different card, not an engine bug. The resolver
must therefore have three outcomes, kept distinct:
- **exact** → run the test;
- **same name, different printing** → **skip** (report, do not substitute);
- **unmapped/unknown** → skip (report).

The spike chose mirror matches on confirmed exact printings (Koraidon SSP-116, Dedenne SSP-87,
Dartrix SFA-4) to guarantee validity.

---

## 8. Roadmap

| phase | scope | status |
|---|---|---|
| 0. Spike | resolver + minimal runner; 3 plain-attack scenarios vs native | ✅ done |
| 1. Resolver breadth | pin `me*`/`zsv`/`rsv` set-code map; exact/skip/unknown buckets | ▢ next |
| 2. Runner breadth | all step + expectation kinds; semantic choice pinning; weakness-aware | ▢ |
| 3. Corpus replay | auto-generate scenarios from all 219 IR programs for exact printings → agreement scorecard | ▢ |
| 4. IR interpreter | imperative ops + counts + selectors + predicates + flow + coin flips (~80% cards) | ▢ |
| 5. Lock/passive tail | continuous-effect interceptors + scopes/markers | ▢ open-ended |
| 6. Differential mode | native-vs-interpreted post-state comparison | ▢ |

---

## 9. Open questions / deferred

- **`me*` set-code map.** Largest coverage unlock; needs the Mega-Evolution block prefix →
  Twinleaf code correspondence pinned (MEG vs M1L vs M1S vs MEP).
- **Weakness/resistance in the runner.** Either compute it Twinleaf-side or trust Rotomancer's
  already-resolved expected numbers (its recipes encode post-weakness damage).
- **Source of scenarios.** Only 5 hand-written recipes exist (and they lean on `me*`). The
  scalable source is the 219 committed IR programs — derive minimal scenarios from them (as
  the spike does from `baseDamage`).
- **Adjudication.** When the engines disagree, which is right? Default to Rotomancer (rulebook
  authority) but confirm against `docs/vendor/por_rulebook.md` before "fixing" Twinleaf.
- **IR drift.** The IR is versioned (`irVersion`); pin the snapshot (`2026-05-17`) the harness
  reads so a Rotomancer bump doesn't silently change expectations.
