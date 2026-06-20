# Conformance Adapter — Fidelity Testing Design

> A testing strategy for the twinleaf conformance adapter (`ptcg-server/src/conformance/`).
> Goal: high confidence that the adapter **faithfully drives and reads the twinleaf engine** —
> independent of the cross-engine differential test, which is deferred until the second engine
> implements the contract.
>
> Status: **proposed**. Last reviewed: 2026-06-20.
>
> Paths below are in `~/projects/twinleafgg/ptcg-server/`. Companion docs:
> [`conformance-api-design.md`](conformance-api-design.md) (neutral contract),
> [`conformance-api-twinleaf-impl.md`](conformance-api-twinleaf-impl.md) (the M0–M6 adapter).

## 1. Context & goal

The adapter (M0–M6) was exercised by 58 specs (now 87, after Steps A–B below). They are strong at
**internal consistency** —
determinism, `project(import)` round-trip stability, decomposition-equals-one-shot — but most of
them use the adapter as both the thing under test *and* the source of the expected value. That
leaves one class of bug uncovered: the adapter can be **self-consistent and still systematically
wrong** about what the engine did (a projection that reads the wrong field; an `importState` that
builds subtly non-canonical state; a dropped event; randomness that isn't actually externalized).

This doc hardens **fidelity to the engine**. It is explicitly single-engine and **self-contained**:
no second engine, and no external scenario corpus. (The Rotomancer card-effect harness is set aside
here by design — see §10.)

## 2. The oracle problem & principles

Without an external oracle, every expected value must come from somewhere other than the adapter.
Exactly three self-contained oracles exist, and each tier is built on one:

1. **The raw engine `State`** — the thing the adapter projects *from*. The projection is the most
   likely silent liar; check it against its own source (Tier 1).
2. **The engine's own canonical headless driver** — `setupGame` + `TestStoreHandler` +
   `card-test-helpers` (core engine test infra, independent of the conformance package; the existing
   non-conformance card specs use it). A second, independent way to drive the same engine (Tier 2).
3. **Physical invariants** — conservation, monotonicity, multiples-of-10 — true regardless of any
   expected value (Foundations + Tier 3).

**Why layered, not one harness.** Each oracle has a different blind spot. Native-vs-adapter (Tier 2)
only proves the adapter matches the engine's *other* headless path — if `setupGame` and
`importState` shared a wrong assumption it would not catch it. Raw-state projection checks (Tier 1)
and invariant/property tests (Foundations/Tier 3) attack different failure modes. The value is in the
overlap.

## 3. Foundations (shared helpers — formerly "Tier 0")

Small, oracle-free, reused by every tier. **Reuse what exists** in `card-test-helpers.ts`:
`collectAllCardIds`, `findDuplicateCardIds`, `expectNoDuplicateCards`, `expectCardsConserved`,
`getDamage`/`getEnergyCount`/`getZoneCount`/… readers.

New, in `src/conformance/tests/support/`:

- **`assertInvariants(state: State): void`** — physical truths that hold after any step:
  no duplicate card ids across all zones (`expectNoDuplicateCards`); total card count conserved
  per request (compare to the imported board's `collectAllCardIds`); every slot's `damage` a
  multiple of 10; `prizes` length non-increasing across a turn; attached `energies` ⊆ the slot's
  `cards`; bench ≤ 5; `outcome !== 'ongoing' ⟺ phase 'gameOver'`.
- **`withNoRandomness(fn)`** — stub `Math.random` to throw for the duration of `fn`, asserting an
  in-scope replay never calls it. Turns the "prompt-mediated randomness in, inline `Math.random`
  out" boundary (design §2) into an enforced invariant and proves replay determinism has no hidden
  source. (Coin/shuffle go through the `system` actor; the handler's `flipCoin` and the
  ShuffleDeckPrompt path never touch `Math.random`.) **Two implementation findings (Step A):**
  (a) the one cosmetic core consumer is `GameStatsTracker` (a `Math.random` display-id on the first
  damage event, writing `gameStats` the projection never reads), so the guard temporarily no-op's its
  two reducer entry points (`trackDamageDealt`/`handlePokemonEvolution`) rather than pre-seeding
  per-state — which also makes it compose with `step()` (re-imports internally), not just
  `replay(game)`; (b) the guard must **not** inspect `Error().stack` — under ts-node, reading `.stack`
  invokes `source-map`'s randomized quicksort, a `Math.random` cascade — so it throws instead of
  recording stacks.
- **`stepChecked(initial, actions)`** — wraps `step`, then asserts `assertInvariants(result via a
  re-import)` and `project(import(initial)) deep-equals` re-projection (idempotence). A drop-in the
  existing specs can adopt incrementally.
- **`expectProjectionsEqual(a, b)`** — deep-compare two `NeutralState`s with a documented ignore-list
  (none expected today; the hook exists for incidental fields).

**Acceptance:** the helpers exist, `withNoRandomness` wraps the M1/M3/M4 determinism specs green,
and `assertInvariants` is wired into `stepChecked` and a handful of existing specs.

## 4. Tier 1 — projection vs raw `State`

**Goal.** Prove `projectState` reads the engine faithfully. `project(import(s)) == s` only proves
shape survives a round-trip — import and project can share the same wrong assumption.

**Build.** `assertProjectionMatchesState(state: State, ctx: IidContext): void` — for each projected
field, assert it equals the value read directly from `state`: per-slot `damage`, `conditions`,
`energy` iids (and order), `tools`, stack order; each zone's contents/order (deck order, hand/discard
multisets, lostzone count, prizes + `faceUp`); the 8 `flags`; `stadium` + owner; `turn`,
`activePlayer`, `phase`, `outcome`. Run it after representative mutations (drive via
`card-test-helpers`, then project the same `state`).

**The sharp target — the deferred-to-default fields.** [state-adapter.ts](../../ptcg-server/src/conformance/state-adapter.ts)
hardcodes four projected fields to constants; each is a silent-misreport risk. A matrix proves each
is either genuinely invariant in the engine, or exposes the gap:

| projected field (default) | mutation that should move it | verdict to establish |
|---|---|---|
| `markers.movedToActiveOnTurn` (`-1`) | promote a benched Pokémon (KO / retreat) | does twinleaf track a turn stamp? |
| `markers.damageTakenThisTurn` (`0`) | deal damage to a slot this turn (`damageTakenLastTurn`?) | engine field exists? project it |
| `markers.abilitiesUsedThisTurn` (`[]`) | use a once-per-turn ability (`ABILITY_USED`) | derive from board effect / marker |
| `flags.cardsPlayedThisTurn` (`0`) | play N cards in a turn | no engine counter → confirm or add |

Outcome is either "confirmed invariant for in-scope play (documented)" or a projection fix + the
field becomes real.

**Files:** `tests/support/projection-fidelity.ts`, `tests/projection-fidelity.spec.ts`.
**Acceptance:** every projected field asserted against raw state in ≥1 scenario; the four deferred
defaults each adjudicated.

## 5. Tier 2 — native-vs-adapter equivalence (the centerpiece)

**Goal.** The direct answer to "is the adapter hooking in correctly": drive the *same* scenario
through (a) the adapter and (b) the engine's own canonical headless path, and assert agreement. Both
sides are twinleaf — one via `step()`, one via `setupGame`+`card-test-helpers` — so any divergence is
an adapter-fidelity bug.

**Build.** A scenario authored once, materialized two ways:

```ts
interface Scenario { board: BoardSpec; actions: Step[]; } // Step ≈ the §4.6 action vocabulary
```

- **Adapter path:** `BoardSpec → NeutralState` → `step(actions-as-NeutralAction[])` → engine state.
- **Native path:** `BoardSpec → SetupGameConfig` → drive the equivalent steps via `useAttack` /
  `playCardFromHand` / `retreat` / `endTurn` / `useAbility` → engine state.

Two sub-assertions (they catch different things):

- **Import fidelity** — build the *same board* via `importState` and via `setupGame`, and structurally
  diff the two raw `State`s (normalize incidental noise: `card.id` numbering, log `timestamp`, prompt
  object internals). Catches `importState` constructing **non-canonical** state — a missing flag,
  wrong `isPublic`, wrong `hp`/`hpBonus` init — that would make the engine behave differently than in
  real play. Nothing today can see this class.
- **Replay fidelity** — project both post-action states and `expectProjectionsEqual`. Two engine
  states that project identically are conformance-equivalent, so this validates the adapter's dispatch
  path (including the attack auto-end / checkup reconciliation, impl §4.3/§4.7) lands where the
  engine's own driver lands.

**Curated scenarios (~20–40)** spanning the vocabulary, one fidelity concern each:

| scenario | exercises |
|---|---|
| bench a basic; attach energy; evolve | `PlayCardAction` paths, energy/evolve gates |
| attack (prompt-free, e.g. Kirlia "Slap") | `AttackAction` → damage → auto-end → checkup |
| retreat with exact / mixed energy | `RetreatEffect` + `ChooseEnergy` decomposer |
| search-and-shuffle item | `ChooseCards`/`ChoosePokemon` + `system` shuffle |
| spread-damage attack | `PutDamage` decomposer (×10 vs HP) |
| coin-flip attack (heads & tails) | `system` flip alignment |
| poison / sleep checkup over `endTurn` | between-turns flips, condition projection |
| KO → promote; deck-out ⇒ gameOver | `checkState`, `endGame`, outcome projection |
| use a once-per-turn ability | `UseAbilityAction`, ability markers |

**Files:** `tests/support/scenario-runner.ts` (the two materializers + the runner),
`tests/support/raw-snapshot.ts` (the import-fidelity snapshot + `synthCtx`),
`tests/support/canonical-neutral.ts` (`projectNative` + iid-stripping `canonicalize`),
`tests/equivalence.spec.ts`.
**Acceptance:** every curated scenario agrees on both sub-assertions; a deliberately-broken
projection/import makes a scenario fail (negative control).

**Realized (Step B, 2026-06-20).** Shipped as 11 robust-core scenarios (87 conformance specs total).
Findings that shaped the build:

- **Import fidelity is a deep raw-state snapshot, not a normalized full-`State` diff.**
  `snapshotRawState` (`raw-snapshot.ts`) walks the engine `State` into an iid/id/identity-free structure
  that *includes the fields the projection ignores* — `isPublic`/`isSecret` per zone, `hp`,
  `pokemonPlayedTurn`, the per-player flag counters, `usedGX`. Documented exclusions (normalized away):
  `card.id` (native bases at 1000, adapter at 1), object identity, `player.name`, `state.prompts`,
  `state.logs`, `lastAttack`. This is the class nothing else can see.
- **Replay fidelity compares canonicalized projections, applied to BOTH sides.** `projectNative` reuses
  the real `projectState` via a synthetic ctx (`iid = String(card.id)`); `canonicalize` strips iids
  (printing + structure is the engine-neutral identity; ordered zones keep order, hand/discard/lostZone
  sort as multisets). Same projection on both sides means projection bugs cancel — this isolates
  **dispatch** fidelity (projection correctness is Tier 1's job). Chosen over a post-action raw diff
  because the two drivers (`useAttack` vs `declareAttack`→`AttackAction`) legitimately leave different
  transient internals (§9).
- **The BoardSpec is the intersection both builders can express.** `setupGame` and `importState` both
  build `State` directly at `PLAYER_TURN`; the shared subset is per-slot card/energy/damage/tools,
  hand/deck/discard piles, a prize *count* (materialized as N× the native `DEFAULT_FILLER`
  'Water Energy SVE' face-down so the boards match exactly), and turn. Special conditions, an in-play
  stadium, and custom flags/markers are NOT presettable natively, so scenarios induce them via *actions*
  (`playStadium` enters a stadium; conditions arise mid-game) — never via the board.
- **Two engine gates surfaced as scenario constraints:** evolution is blocked at `state.turn` ∈ {0,1,2}
  (play-pokemon-effect.ts), so the evolve scenario runs at turn 3; coin-flip equivalence is **heads-only**
  (native `BotArbiter` is ALL_HEADS), tails stays an M3-spec concern.
- **Once-per-turn ability deferred to Step C.** No in-scope ability is prompt-free (e.g. Dynamotor raises
  pick prompts), and robust-core forbids native-auto-resolver alignment.
- **Negative controls (both confirmed, reverted):** (a) injecting `usedGX = true` in `importState` fails
  import-fidelity on every scenario while the 13 projection-based specs stay green — proving the deep
  check earns its keep; (b) no-op'ing the adapter's `attachEnergy` dispatch fails replay-fidelity on
  exactly the two attach scenarios while import-fidelity passes — isolating dispatch divergence.

## 6. Tier 3 — property / fuzz (breadth the hand boards can't reach)

**Goal.** Explore the state/action space far past curated boards, where the surprising adapter bugs
hide.

**Build.** A **seeded** generator (deterministic PRNG, seed logged for replay — never bare
`Math.random`, so a failure is reproducible):

- **Board generator** — random valid post-setup boards: basics + energies + a few evolutions in
  zones, ≥1 prize per side, legal bench sizes, occasional conditions/damage. Only in-scope printings
  (loadable sets, no inline-`Math.random` cards).
- **Action generator** — uses the **M5 menu (`topLevelMenu`) as the legal-move oracle**: at each step
  pick a random enumerated legal action, feed required follow-ups (flips/picks) from the decomposer's
  own `legalActions`, advance, repeat for a bounded depth.

**Per-step assertions:** `assertInvariants`; replay-determinism (run the generated log twice →
identical `state`+`events`); `project(import)` stability; every enumerated-legal action dispatches
without throwing; an action *not* in the menu yields `invalidAction` (not a crash). On failure, print
the seed + minimized action log.

**Files:** `tests/support/generators.ts`, `tests/fuzz.spec.ts` (bounded iteration count for CI
stability; a longer nightly variant optional).
**Acceptance:** N seeded runs green; a known-injected bug (e.g. menu lists an illegal move) is caught
and reported with a replayable seed.

**Realized (Step C, 2026-06-20).** 40 seeded games (`maxActions` 25) + 3 negative-space cases = 43
fuzz specs; total conformance suite now 133. The harness (`generators.ts`): `mulberry32` PRNG;
`genBoard` over a curated pool (Ralts/Kirlia/Gardevoir/Rufflet/Pikachu/Raichu + SVE energies +
Primordial Altar); `playRandomGame` walks `replay(import, logSoFar).pending` as the frontier oracle,
committing a random *accepted* candidate each step. Findings that reshaped the build:

- **The menu is best-effort, not a guarantee.** The engine's own `Check*` effects over-report
  attack/ability legality for cards with internal preconditions (e.g. Kirlia's "Refinement" with an
  empty hand → `cannotUseAbility`). So the strict "every enumerated action dispatches" property is
  false for this engine; the generator instead **backs out of a rejected candidate and tries another**
  (the menu is a candidate set; `endTurn` is always legal so no frontier is dead).
- **Inline `CoinFlipEffect` needs its flip pre-fed.** Pikachu's "Whimsy Tackle" consumes a flip from
  the log *during* dispatch (driver.ts:221), unlike a `CoinFlipPrompt` which surfaces as a system
  pending. The generator detects the "coin flip needed" signal and appends a PRNG flip, keeping that
  seam under test.
- **`ChoosePrizePrompt` was unsupported → a decomposer was added** (Step C, Part 1). A non-terminal KO
  (defender survives, >1 prize left) raises it; previously `classify()` returned `unsupported` and the
  driver threw, capping random play at the first mid-game KO. The new `choosePrizeDecomposer` makes
  prize-taking / non-terminal KOs / KO→promote driveable, and unblocked the deferred Tier-2 KO→promote
  equivalence scenario (native-aligned picks via `resolveFollowups`).
- **Pre-existing engine quirk surfaced (documented, not adapter fidelity):** runtime tool-play
  (`PlayCardAction`) attaches a Tool to `slot.tools` but not `slot.cards`, while `collectAllCardIds`
  walks `.cards` — so a *played* tool reads as a lost card. Confirmed identical on the native driver,
  so it is an engine/helper data-model inconsistency; the fuzz stays in-scope by excluding Tools from
  the pool (impl doc §8).
- **Negative controls (confirmed, reverted):** breaking `choosePrizeDecomposer.assemble` (empty result)
  fails the prize spec + KO equivalence via the prompt's `validate`; re-adding the Tool to the pool
  fires the fuzz's card-conservation invariant — proving both checks are non-vacuous.

## 7. Tier 4 — silent-failure hardening

Three smaller guards against the ways the adapter fails *quietly*.

- **Seam exhaustiveness.** `classify()` ([decomposers/index.ts](../../ptcg-server/src/conformance/decomposers/index.ts))
  and the event mapper ([event-mapper.ts](../../ptcg-server/src/conformance/event-mapper.ts)) are
  closed sets that fall through silently (an unhandled prompt → `unsupported` only if a card hits it;
  an unmapped `GameLog` → dropped). Collect the prompt `type`s and `GameLog`s actually encountered
  across the Tier-2 scenarios + Tier-3 fuzz, and assert none are unclassified / unmapped beyond an
  explicit allow-list. Optionally widen the encountered set with a sweep of in-scope cards' attacks.
- **Non-perturbation.** `topLevelMenu` and `buildCapabilities` reduce `Check*` effects on live state;
  assert `project → buildMenu → project` is stable and `state.prompts` gains no orphan entries —
  pinning the "additive, doesn't disturb the engine" property everything rests on.
- **Golden regression net.** Freeze the projected `state`+`events` JSON for the Tier-2 curated
  scenarios. *After* fidelity is established by Tiers 1–2 (the golden is adapter-derived, so it is a
  regression net, not a primary oracle), this catches unintended projection/event changes cheaply.

**Files:** `tests/seam-coverage.spec.ts`, `tests/non-perturbation.spec.ts`, `tests/golden/…`.
**Acceptance:** seam coverage asserts the encountered universe; non-perturbation green; goldens
committed with a refresh script.

**Realized (Step D, 2026-06-20).** Seam-coverage + non-perturbation shipped (tests-only; suite now
165). The golden net was **split out to its own Step E** (below) to scope its churn separately.

- **Seam exhaustiveness** (`seam-coverage.spec.ts`). Corpus = 25 fuzz seeds + 6 runs of a crafted
  KO board; `collectSeams` prefix-walks each game (only at *follow-up* frontiers — the open prompt is
  always answered by a pick/system action) for prompt `type`s, and reads every `GameLog` from a full
  replay's `state.logs`. The realized universe: **6 prompt types** (Choose cards/pokemon/prize/attack/
  energy + Coin flip), **all classified** (zero `unsupported`); **12 mapped** GameLogs; **7 dropped**,
  all intentional and allow-listed (`LOG_GAME_FINISHED_WINNER`, `LOG_PLAYER_PLAYS_STADIUM` — no
  `playedStadium` event kind, `LOG_PLAYER_FLIPS_HEADS/TAILS` — coin faces are inputs,
  `LOG_PLAYER_DISABLES_ATTACK`, `LOG_PLAYER_NO_ACTIVE_POKEMON`, `LOG_PLAYER_NO_PRIZE_CARD`). Asserts:
  none unsupported beyond `ALLOW_UNSUPPORTED` (empty); none dropped beyond `ALLOW_UNMAPPED`; and a
  non-vacuous floor (the corpus actually exercised the high-value prompt + event seams).
- **Non-perturbation** (`non-perturbation.spec.ts`). Across 3 crafted boards (each forcing a `Check*`
  path) + 25 fuzz seeds: `snapshotRawState` is identical before/after `topLevelMenu`, `state.prompts`
  and `state.logs` are unchanged (no orphan prompt / stray log), and the menu is idempotent — pinning
  "building the menu is read-only."
- **Doc correction:** `buildCapabilities` takes no `State` and reduces no effects (pure registry
  enumeration); the §7 line above overstated it — non-perturbation concerns `topLevelMenu` only.
- **Negative controls (confirmed, reverted):** removing the `LOG_POKEMON_KO` case from the event mapper
  makes seam-coverage flag it as dropped-beyond-allow; mutating `active.damage` inside `topLevelMenu`
  fails non-perturbation's before/after snapshot.

## 8. Sequencing & acceptance

| step | scope | rationale | status |
|---|---|---|---|
| **A** | Foundations + Tier 1 | small, high-signal, touches every path; adjudicates the deferred defaults | ✅ done |
| **B** | Tier 2 | the centerpiece fidelity oracle; needs the two materializers + state diff | ✅ done (11 robust-core scenarios) |
| **C** | Tier 3 | breadth once the harness + invariants exist; absorbs Tier-2's deferred follow-up-pick scenarios | ✅ done (40 seeds; + ChoosePrizePrompt decomposer) |
| **D** | Tier 4 (seam coverage + non-perturbation) | hardening the silent-failure seams | ✅ done (165 specs) |
| **E** | Tier 4 (golden regression net) | frozen projected `state`+`events` for the Tier-2 scenarios + an env-gated refresh; split from D to scope golden churn on its own | next (optional) |

Each step lands independently (its own spec files), runs under `jasmine-ts`, and gates on
project-wide `tsc --noEmit` = 0 — same bar as M0–M6. No engine-core or card edits.

## 9. Risks & limits

- **Shared-assumption blind spot (Tier 2).** Native-vs-adapter can't catch a bug both `setupGame` and
  `importState` make. Mitigated by Tier 1 (raw-state) + Tier 3 (invariants) attacking other modes.
- **`setupGame` parity nuance.** The native helpers (`useAttack`) and the adapter's path
  (`declareAttack → AttackAction`) enter the engine at slightly different points; a divergence there is
  itself a useful finding, but the state-diff must normalize non-semantic differences carefully or it
  will flag noise.
- **Fuzz flakiness.** Bound iterations; always print the seed; keep the generator to in-scope cards so
  a failure is a real adapter bug, not an out-of-scope card.
- **Golden churn.** Goldens are adapter-derived; keep them small, scenario-scoped, and refreshed by a
  script, and never treat a golden diff as a *fidelity* signal on its own.
- **Not a substitute for cross-engine.** This raises single-engine fidelity confidence; it does not
  replace the differential test against the second engine.

## 10. Out of scope

- **Cross-engine differential testing** — depends on the second engine implementing the contract
  (design §1).
- **The Rotomancer card-effect harness** — a separate, existing effort whose corpus *could* later seed
  Tier-2 scenarios; deliberately excluded here to keep this strategy self-contained.
- **The ~88 inline-`Math.random` cards** — out of the conformance corpus (impl §9); the generators and
  scenarios use only in-scope, loadable printings.
- **HTTP load / concurrency** — the layer is stateless; low risk, untested by intent.
