# Conformance API — twinleaf Implementation Design

> The twinleaf-specific implementation of the stateless conformance API specified
> in [`conformance-api-design.md`](conformance-api-design.md). twinleaf is the
> first of the two engines to implement it. Strategy: an **additive adapter
> package** over the `ptcg-server` engine — **no card-effect edits in the first
> pass**.
>
> Status: **M0–M6 implemented** (the full build sequence in §6; see §8 for milestone findings).
> Last reviewed: 2026-06-20.
>
> Paths below are in `~/projects/twinleafgg/ptcg-server/`.

## 1. Relationship to the neutral spec

The neutral spec defines the wire contract: `{ initialState, actions[] }` →
`{ status, pending, events, state }`, three actors (`A`/`B`/`system`),
single-decision granularity, replay-from-initial statelessness. **This doc is
how we realize that contract on twinleaf** without rewriting the engine. The
core enabling facts (all verified against source):

- The `Store` is **fully headless-drivable**: `new Store(handler)`, set `.state`,
  call `dispatch()`. No network. The `setupGame` / `TestStoreHandler` pattern in
  `src/sets/tests/test-helpers.ts` is our entry template.
- A triggering `dispatch` **returns with the prompt pending** in
  `state.prompts[]`; `ResolvePromptAction(id, result)` fires the card callback
  **synchronously**. We supply a handler that *halts* on prompts instead of
  auto-resolving.
- The `Store` **does not call the `Arbiter`** — the handler does. Externalizing
  randomness is "don't wire the Arbiter," not "rip it out."
- Card identity is `Card.fullName` (set-number) = the neutral `printing`.

## 2. First-pass scope

**In scope:**

- Headless driver + non-resolving handler (§4.1).
- State import / projection: neutral `initialState` ⇄ twinleaf `State` (§4.2).
- Action mapping for the player vocabulary (§4.3).
- The six **prompt decomposers** for single-decision granularity (§4.4).
- The **`system` actor** for *prompt-mediated* randomness — `ShuffleDeckPrompt`
  and `CoinFlipPrompt` (incl. attack coin-flips and checkup flips) (§4.5).
- `legalActions`, phased (§4.6); turn boundaries + checkup (§4.7); event mapping
  (§4.8); rejection codes + capabilities (§4.9); the HTTP layer (§5).

**Out of scope for the first pass** (deferred, §9):

- **Cards with built-in (`Math.random`) randomness** — ~88 card-effect sites in
  two uniform families (random pick-from-a-list; inline Fisher-Yates shuffle).
  These cannot be externalized without a per-card semantic refactor (a global
  `Math.random` shim is unportable — see [`conformance-api-design.md`](conformance-api-design.md)
  §12 and the audit). **They are excluded from the conformance corpus** and the
  `capabilities` card list until migrated. Note: **`iono.ts` is in this set**
  (inline shuffle), so the neutral spec's Iono appendix is illustrative only
  until Iono is migrated; the worked example here (§Appendix) uses an in-scope
  card that shuffles through `ShuffleDeckPrompt`.
- **Setup phase / mulligan** — `initialState` is always *post-setup* (a quiescent
  board), constructed directly (like `setupGame`), so twinleaf's `setup-reducer`
  is never run.
- **`activeEffects` declared in `initialState`** — tests start from a clean board
  and build lasting effects through the action log (neutral spec §6.3).
- **Legacy mechanics** not in current Standard (GX attacks, V-UNION assembly).

The boundary is sharp and mechanical: **prompt-mediated randomness is in scope;
inline `Math.random` is out.** A coin-flip *attack* that uses `CoinFlipPrompt` is
testable; the handful of cards that inline `Math.random() < 0.5` are not.

## 3. Architecture

An additive package (proposed `src/conformance/`) that depends on the engine but
**modifies no card files**. Data flow per request:

```
HTTP  POST /v1/step { initialState, actions[] }
  │
  ▼
Driver (stateless replay loop, §4.1)
  ├─ StateAdapter.import         neutral initialState → twinleaf State  (§4.2)
  ├─ replay actions[]:
  │    ├─ top-level action  → ActionMapper → store.dispatch(...)        (§4.3)
  │    ├─ pending prompt     → PromptDecomposer (1 of 6)                 (§4.4)
  │    │     └─ accumulate single picks; on completion decode+validate+
  │    │        ResolvePromptAction (card callback fires UNCHANGED)
  │    └─ pending system     → SystemResolver (shuffle / flip)           (§4.5)
  ├─ LegalActions.compute    for the surfaced pending                    (§4.6)
  ├─ EventMapper             twinleaf state.logs → neutral events        (§4.8)
  └─ StateAdapter.project    twinleaf State → observable projection      (§4.2)
  │
  ▼
{ status, applied, pending, events, state }
```

The only engine-core touchpoint is one optional small patch (§4.5) for a few
non-card inline coin flips; everything else is the additive package.

## 4. Components

### 4.1 Headless driver & the non-resolving handler

A `ConformanceStoreHandler implements StoreHandler` whose `onStateChange`
**does not auto-resolve** pending prompts (the `TestStoreHandler` does — ours
won't); it simply records that the engine is blocked. The driver owns the loop:

```ts
function step(initialState, actions): Response {
  const { store, iidMap } = StateAdapter.import(initialState);   // §4.2
  let cursor = 0, accum: WirePick[] = [];

  while (true) {
    const prompt = store.state.prompts.find(p => p.result === undefined);
    if (prompt) {                                       // a decision is open
      const kind = classify(prompt);                    // system (shuffle/flip) | aggregate
      const handler = kind === 'system' ? SystemResolver : decomposerFor(prompt);
      const sub = handler.next(prompt, accum, store.state);   // next single decision, or null
      if (sub === null) {                               // pick set complete → resolve
        const wire   = handler.assemble(prompt, accum);
        const result = prompt.decode(wire, store.state);
        if (!prompt.validate(result, store.state)) return invalid(cursor, prompt);
        store.dispatch(new ResolvePromptAction(prompt.id, result));   // callback fires unchanged
        accum = [];
        continue;                                       // may surface the next prompt
      }
      if (cursor < actions.length) { accum.push(toWirePick(actions[cursor++], sub)); continue; }
      return awaiting(sub, store, iidMap);              // log dry mid-decision → surface it
    }
    if (cursor < actions.length) { ActionMapper.dispatch(store, actions[cursor++], iidMap); continue; }
    return store.state.winner !== GameWinner.NONE
      ? gameOver(store, iidMap)
      : awaiting(LegalActions.topLevel(store.state), store, iidMap);
  }
}
```

Statelessness is by replay: every request re-runs the whole `actions[]` from
`initialState`. No continuation is stored; the engine reconstructs mid-decision
position by re-reaching the prompt and re-consuming the accumulated picks.

### 4.2 State adapter (neutral ⇄ twinleaf `State`)

**Import** (`neutral initialState → twinleaf State`):

- Build `players[]` directly (model on `buildPlayer` in `test-helpers.ts`), not
  via `setup-reducer`. Populate every zone (deck ordered, hand, discard, prizes,
  lostzone), each `PokemonCardList` (evolution stack, attached energy/tools,
  damage, special conditions, markers), `state.stadium`, `turn`, `activePlayer`,
  per-player `flags`.
- **Register `knownCards`** — every referenced card must be in the
  `CardManager` / `StateSerializer.knownCards` registry, or deserialization /
  lookups throw. Reuse `ensureCardsRegistered(...)`.
- **iid map** — assign each neutral `iid` to its constructed twinleaf `Card`
  object and keep a bidirectional `iid ⇄ Card` map. `printing == fullName`. The
  map is rebuilt deterministically on each import (import is a pure function of
  `initialState`), so iids are stable across replay.

**Project** (`twinleaf State → observable projection`): emit the neutral `state`
schema, translating `Card → {iid, printing}` via the iid map, damage to HP units,
special conditions to the canonical token set, and twinleaf markers/turn-counters
to the neutral `flags`. This is the diffable artifact; it reuses what
`BoardSnapshot`-style projection does conceptually but targets the neutral schema
(not twinleaf's native `StateSerializer` JSON).

### 4.3 Action mapper

| neutral action | twinleaf |
|---|---|
| `playItem` / `playSupporter` / `playStadium` | `PlayCardAction(playerId, handIndex, target)` |
| `attachEnergy`, `attachTool` | `PlayCardAction` with the attach target |
| `benchBasic`, `evolve` | `PlayCardAction` to bench / evolve target |
| `retreat` | `RetreatAction(playerId, benchIndex)` |
| `useAbility` | the ability-use action / `UseAbilityEffect` path |
| `declareAttack` | `AttackAction(playerId, name)` |
| `endTurn` | `PassTurnAction(playerId)` |

`choose` / `discard` / `placeCounter` / `takePrize` / `promoteBench` are **not
top-level dispatches** — they are the single picks consumed by the decomposers
(§4.4) and the prize/promote pendings, fed from `accum`.

**`endTurn` reconciliation.** Attacking auto-ends the turn in twinleaf (the
attack runs straight into `betweenTurns`). The neutral model requires an explicit
forced `endTurn`. The driver interposes: after an `AttackAction` resolves, it
surfaces a forced `pending { actor, legalActions:[{endTurn}] }` and maps the
subsequent `endTurn` action onto the turn transition that twinleaf would have run
— so the boundary is one uniform, observable step (neutral spec §9).

### 4.4 Prompt decomposers

One per aggregate prompt type; **no card edits**. Interface:

```ts
interface PromptDecomposer<P extends Prompt<any>> {
  handles(p: Prompt<any>): p is P;
  next(p: P, picks: WirePick[], state: State): Pending | null;   // next single decision, or null
  assemble(p: P, picks: WirePick[]): unknown;                    // wire form decode() expects
}
```

Feasibility (verified against each prompt's `decode`/`validate`/options):

| Prompt | Result type | Decompose | Adapter needs |
|---|---|---|---|
| `ChooseCardsPrompt` | `Card[]` | ✅ state-free | candidates `.cards` − `.blocked`, shrink per pick |
| `ChoosePokemonPrompt` | `PokemonCardList[]` | ✅ state-free | enumerate `.playerType`+`.slots` − `.blocked` |
| `AttachEnergyPrompt` | `CardAssign[]` | ✅ state-free | `.cardList`×targets; filter differentTypes/maxPerType/sameTarget |
| `PutDamagePrompt` | `DamageMap[]` | ✅ running total | `.maxAllowedDamage` per target − placed-so-far |
| `MoveDamagePrompt` | `DamageTransfer[]` | ⚠️ needs `state` | recompute sources after each move |
| `DiscardEnergyPrompt` | `DiscardEnergyTransfer[]` | ⚠️ needs `state` | `.cardList` unset; look up per source via `StateUtils.getTarget` |

The two ⚠️ rows are **not blockers** — the driver holds `state`, which is all
they need. The clean invariant: **`validate()` runs on the final result type, not
the pick form**, so the inner loop is dumb accumulation and only the terminal
`decode(picks, state)` + `validate(result, state)` touches state — exactly what
`game-socket.ts` does server-side. twinleaf's atomic mutation is preserved (and
is rulebook-correct: KOs resolve after the whole placement, not between picks).

### 4.5 `system` actor & randomness (in scope: prompt-mediated only)

- **`ShuffleDeckPrompt`** → a `system` pending whose `legalActions` carry the deck
  array; the `system` action returns the new `order`. The driver applies the
  order rather than the Arbiter's Fisher-Yates. Because the order is supplied at
  shuffle time, shuffle-then-draw is deterministic.
- **`CoinFlipPrompt`** (attack flips and checkup burn/sleep flips) → a `system`
  pending `legalActions:[{flip:heads},{flip:tails}]`; the action supplies the
  face.
- **Do not wire the Arbiter.** Pending coin/shuffle prompts are resolved from the
  action log via the `system` actor.
- **Small engine patch (the only non-additive change):** a few *non-card* inline
  flips exist (`game-store/effect-reducers/game-effect.ts`,
  `prefabs/prefabs.ts`). Route these through the handler's `flipCoin` hook so they
  too become `system` decisions, or convert them to `CoinFlipPrompt`. This is a
  ~2-site patch, distinct from the out-of-scope ~88 *card* sites.

### 4.6 `legalActions` (phased)

`legalActions` is a conformance surface (both engines must agree on what's legal),
so gaps mean the harness can't compare legality there.

- **Phase 1:** decomposer/system `legalActions` (computed above) + hand-card
  playability from `store.ts:calculatePlayability` / `player.playableCardIds`
  (covers which hand cards are playable) + the forced pendings (`endTurn`,
  `promote`, `shuffle`).
- **Phase 2:** legal **attacks** (`CheckPokemonAttacksEffect`), **retreat**
  legality (cost/lock checks), **ability** activation. New enumeration code, but
  the underlying checks exist.

### 4.7 Turn boundaries & checkup

`endTurn` → `PassTurnAction` → `startNextTurn` → `betweenTurns`
(`game-phase-effect.ts`): special conditions resolve — poison (auto), burn
(`CoinFlipPrompt` → `system`), asleep (`CoinFlipPrompt` → `system`) — then
`checkState` (KOs → owner owes a `promote` pending), then `initNextTurn`
(`turn++`, mandatory draw, **deck-out ⇒ `gameOver`**). The driver emits
`turnEnded(P)` / `turnStarted(Q)` events bracketing this, surfaces the checkup
flips as `system` pendings, and enforces the neutral-spec conventions
(`activePlayer` flips at `turnStarted`; per-turn `flags` reset at `turnStarted`;
fixed poison→burn→sleep order).

### 4.8 Event mapping

twinleaf appends `StateLog` entries (`GameLog.*`) during reduction. Map them to
the neutral event vocabulary:

| twinleaf `GameLog` | neutral event |
|---|---|
| `LOG_PLAYER_PLAYS_*` | `playedItem` / `supporterPlayed` / `stadiumPlayed` |
| draw / `DrawCardForTurnEffect` | `draw` |
| KO / prize | `ko`, `prizeTaken` |
| `LOG_PLAYER_ENDS_TURN` / turn start | `turnEnded` / `turnStarted` |
| shuffle / condition checkup | `shuffled` / `conditionChecked` |

### 4.9 Rejection codes & capabilities

- twinleaf throws `GameError(GameMessage.X)` (with `Store` rollback). Catch at the
  driver boundary and map `GameMessage` → a shared normalized `reasonCode`, so
  `invalidAction` responses are comparable across engines.
- `GET /v1/capabilities` returns the registered card list **minus the excluded
  built-in-randomness set** (§9), plus engine/schema versions. The harness
  intersects this with pokemon-cards' list.

## 5. HTTP layer

twinleaf is already Node/TypeScript. A thin handler wraps the driver:

- `POST /v1/step` — `{ schemaVersion, initialState, actions[] }` →
  `{ status, applied, pending, events, state }`. Pure function of the body.
- `GET /v1/capabilities`; `POST /v1/normalize` (optional canonicalizer).

The driver is the real component; the harness may also call it **in-process**
(it is also Node), with HTTP as the cross-process option. Statelessness means no
session store and trivial horizontal scaling.

## 6. Build sequence

| M | Milestone | Acceptance |
|---|---|---|
| **M0** | Headless driver + non-resolving handler; import + project a no-prompt board | `import → project` round-trips a static board; "attach a basic Energy" action changes the projection correctly |
| **M1** | Action mapper + event mapper; a full no-prompt turn | bench/evolve/attach/retreat/attack/`endTurn` drive a turn; events match |
| **M2** | Prompt decomposers (start `ChooseCards` + `ChoosePokemon`, then the other 4) | "discard 2" / "search 1" / "spread N counters" surface as N decisions; card callbacks unchanged |
| **M3** | `system` actor: `ShuffleDeckPrompt` + `CoinFlipPrompt` | a search-and-shuffle card and a coin-flip attack replay deterministically |
| **M4** | Turn boundaries + checkup | poison/burn/sleep resolve with `system` flips; deck-out ⇒ `gameOver`; `turnEnded`/`turnStarted` emitted |
| **M5** | `legalActions` phase 1 then phase 2 | main-phase menu, attacks, retreat, abilities enumerated |
| **M6** | Capabilities + rejection codes + HTTP | `/v1/step` + `/v1/capabilities` live; illegal moves return normalized `reasonCode` |

## 7. Testing & validation (before the cross-engine diff exists)

- **Determinism:** replay an identical `actions[]` twice; assert byte-identical
  projection + events.
- **Replay idempotence:** `project(import(s))` stable at quiescent boundaries.
- **Golden logs:** a small corpus of *in-scope* cards with expected projections,
  authored from existing twinleaf `*.spec.ts` scenarios.
- **Decomposer equivalence:** for each aggregate prompt, assert the
  decomposed-then-reassembled result equals what the one-shot `TestStoreHandler`
  resolution produces (proves decomposition is behavior-preserving).

Cross-engine differential testing begins once the pokemon-cards side implements
the same contract.

## 8. Risks & open items

- **`legalActions` phase 2** completeness (attacks/retreat/abilities) — real new
  code; phaseable but don't undersize.
- **`endTurn` / attack-auto-end** reconciliation correctness (§4.3).
- **iid stability** across replay — guaranteed only if import is a pure function
  of `initialState`; keep it so (no `Math.random`/`Date.now` in import).
- **The ~2-site non-card inline-flip patch** (§4.5) is the only engine-core edit;
  keep it minimal and documented.
- **Excluded-card list maintenance** — the ~88 set must stay in sync with the
  `capabilities` filter as cards migrate.
- **Set-module load fragility under the headless runner** — some set barrels throw
  on `require` under `ts-node`/`jasmine-ts` (observed: `set-scarlet-and-violet`/SVI
  raises `Class constructor TrainerCard cannot be invoked without 'new'`, a
  class-extension / import-order issue), which makes **every** printing in that set
  unusable by the headless adapter until the load is fixed. The `capabilities`
  filter must therefore exclude **load-failing sets** in addition to the
  inline-`Math.random` cards (§9) — a load-time exclusion distinct from the
  semantic one. *Surfaced in M1:* Kirlia SVI was unusable, so the in-scope no-prompt
  turn test uses **Kirlia SIT** (same evolution line, a set that loads).
- **`checkState` runs after every prompt resolution and re-sets-up a 0-prize board.**
  `Store.dispatch(ResolvePromptAction)` runs `checkState` once the prompt callback
  returns; on a board where either player has **0 prizes left**, `checkState` reads
  that as game-over and triggers a sudden-death re-setup (`check-effect.ts` ~L383:
  collect all zones back to deck + `ShuffleDeckPrompt`). *Surfaced in M2:* minimal
  test boards with `prizes: []` spuriously produced a shuffle pending after a resolve.
  Conformance `initialState` boards must carry ≥1 prize per player (a real
  mid-game position always does); the harness should treat a 0-prize side as a
  terminal/`gameOver` state, never a live `initialState`.
- **Coin flips need NO engine patch (§4.5 overestimated the work), but diverge from
  the design's flip-as-pending model.** *Surfaced in M3:* the primary coin mechanism
  is `CoinFlipEffect` (used by `COIN_FLIP_PROMPT` / `FLIP_A_COIN_*` / `MULTIPLE_COIN_FLIPS`),
  and `game-effect.ts` **already** consults `handler.flipCoin()` for it — so the
  conformance handler just implements `flipCoin()` reading the next `flip` action from
  the log; **purely additive, no engine edit**. (A `CoinFlipPrompt` *prompt-class* path
  also exists for a handful of cards, e.g. Rufflet SIT — resolved via `ResolvePromptAction`
  in the loop's system branch.) Both consume `flip` actions in log order via a cursor the
  driver shares with the flip hook. **Divergence from design §5:** twinleaf computes flips
  **eagerly** during the triggering dispatch (then a `WaitPrompt` animates), so it can't
  pause and surface a single-decision pending *per* flip — flips are supplied inline in
  the action log and consumed as the engine flips; if the log is dry at a flip point the
  driver surfaces a best-effort `{actor:'system', flip}` pending and stops. Shuffles, by
  contrast, *are* real prompts (`ShuffleDeckPrompt`) and surface/resolve cleanly per §5.
- **M4 (turn boundaries + checkup) needed NO new driver code — the M0–M3 loop already
  carries it.** *Surfaced in M4:* `PassTurnAction` runs the whole boundary synchronously
  inside one dispatch — `startNextTurn` (logs `LOG_PLAYER_ENDS_TURN` → `turnEnded`),
  `betweenTurns` (special conditions), `checkState`, `initNextTurn` (`turn++`, `LOG_TURN` →
  `turnStarted`, mandatory draw, deck-out ⇒ `endGame`). Consequences:
  (a) `turnEnded` / `turnStarted` / `deckedOut` already map via the M1 event-mapper;
  (b) burn and sleep raise a **`CoinFlipPrompt`** (the prompt-class path, *not* the inline
  `flipCoin` hook), so the M3 `system` branch resolves them from `flip` actions unchanged —
  sleep raises N flips as an array `store.prompt`, each surfacing as its own `'Coin flip'`
  the loop answers in order (callback fires once all resolve);
  (c) **poison and burn deal damage with NO log** (state-only `active.damage +=`), so the
  checkup is observable in the *projection* (damage / `conditions`), not in events — there is
  **no `conditionChecked` event** (the §4.8 table lists one, but twinleaf gives nothing to map
  it from without synthesizing a diff, which would be fragile and engine-specific; kept the
  event vocab closed);
  (d) **deck-out ⇒ `gameOver`** projects through the existing `state.winner` / `phase` mapping
  (`endGame` sets both) and the **drawing** player loses; `initNextTurn` logs
  `LOG_PLAYER_DRAWS_CARD` *before* the empty-deck check, so a deck-out emits a `drew`
  immediately followed by `deckedOut` — both engines must agree on this ordering.
  `PokemonCardList` defaults make an imported afflicted Pokémon self-sufficient (no trigger
  card): `poisonDamage=10`, `burnDamage=20`, `sleepFlips=1`. Multi-condition simultaneity
  (poison+asleep on one active) and a checkup-poison KO → `promote` pending both reuse existing
  machinery (M2 `ChoosePokemon` decomposer) but aren't covered by the M4 spec.
- **M5 (`legalActions` — the main-phase menu) is new enumeration code (`legal-actions.ts`).** At a
  quiescent main boundary the driver now returns `pending = { actor, descriptor:'main', legalActions }`
  instead of `null` (a contract change — several M1–M3 specs that asserted `pending` null at a
  boundary were updated). Phases per §4.6: phase-1 hand plays from the store's `playableCardIds`;
  phase-2 attacks/retreat/abilities mirror the reducers' own gates via the Check* query effects.
  Each entry mirrors a dispatchable top-level action (incl. the new `playItem`/`playSupporter`/
  `playStadium`/`useAbility` dispatchers), and the spec round-trips every entry through `step` to
  prove soundness. *Surfaced in M5:*
  (a) **`playableCardIds` is only recomputed at the end of a `reduceEffect`** (store.ts) — so a no-op
  `step(board, [])` (read the menu with an empty log) sees a stale/empty list. `topLevelMenu` triggers
  a refresh with one read-only `CheckProvidedEnergyEffect` before reading hand playability.
  (b) **twinleaf's playability heuristic is conservative for Items/Supporters:**
  `CAN_PLAY_TRAINER_CARD` returns `true` for a Tool/Stadium unconditionally, but for an Item/Supporter
  only when the card implements `canPlay()` — otherwise it "errs on the side of caution" and returns
  `false`. So the phase-1 menu **under-lists** items/supporters that gate playability through
  `reduceEffect` throwing (e.g. Capturing Aroma). This is an engine-side legality gap, not an adapter
  bug; the menu's item/supporter coverage will improve as cards gain `canPlay`. Tools/Stadiums are the
  reliable trainer-classification probes for now.
  (c) **`LegalAction` carries no `actor`** (the `PendingDecision` does); to dispatch a menu entry the
  caller attaches the pending's actor.
  (d) Dispatch coverage gaps the menu can surface but the loop can't yet *complete*: a retreat paid
  with **mixed** energy raises `ChooseEnergyPrompt` (exact / all-identical energy auto-pays), and some
  attacks raise a `ChooseAttackPrompt` (e.g. Ralts "Memory Skip") — both unsupported prompt types
  today. Enumeration is correct; resolving these follow-ups is a later decomposer addition.
- **M6 (capabilities + rejection codes + HTTP) is fully additive — no engine edits.** *Surfaced in
  M6:*
  (a) **Rejection codes need no engine change.** `GameError.message` defaults to the `GameMessage`
  *value* (`message || code`), so the driver maps the caught error's `.message` → a neutral
  `ReasonCode` (rejection-codes.ts) with no `code` field added to `GameError`. The loop wraps its body
  in a `try/catch`: a `GameError` becomes `status:'invalidAction'` + `rejection`, anything else keeps
  propagating (adapter/contract bugs are not action rejections). The Store rolls back on throw, so the
  projected `state` is the pre-action position; on rejection `applied` is the count of actions applied
  **before** the rejected one (the cursor advances past an action before dispatching it).
  (b) **Capabilities enumerates ~12.4k cards** via `loadAllSets()` (an exported test-helper that
  force-loads every set module, idempotent). **Six sets fail to `require` under the headless runner**
  — `BST, DRV, NXD, PRC, SUM, SVI` (not just SVI as M1 found) — each caught per-module and surfaced in
  `excludedSets`; their cards never enter the registry. Of the 91 inline-`Math.random` cards, 86 are
  registered (the other 5 live in load-failing sets). **Context dependence:** the fs-based set
  enumeration works under jasmine-ts (source present, where it is tested); in compiled production
  `start.js` pre-loads all sets so `getAllCards()` is already full and the force-load is a no-op.
  (c) **The `Math.random` exclusion list is generated + drift-checked.** `excluded-random-cards.ts`
  (91 `fullName`s) is re-derived from source by `conformance-m6.spec.ts` (extraction handles
  escaped apostrophes, e.g. "PokéPark's Whismur PCGP"); the spec fails on drift, keeping the list
  honest as cards migrate off `Math.random` (§9).
  (d) **HTTP is a standalone thin module** (`src/conformance/http/`), decoupled from the backend's
  auth/DB/Core (uses `import * as express` to match the repo's no-`esModuleInterop` config). A
  structurally malformed request → 400 `malformedRequest`; a valid request with an illegal action is
  a normal **200** envelope with `status:'invalidAction'` — the transport error and the game-result
  rejection are kept distinct. Pure handlers (`handleStep`/`handleCapabilities`) are in-process
  testable; `server.ts` is a runnable entry (`CONFORMANCE_PORT`, default 8090). Mounting into the main
  `src/backend/app.ts` later is a one-liner, deferred. `/v1/normalize` is deferred (optional, §5).
- **Follow-up (post-M6): `ChooseEnergy` + `ChooseAttack` decomposers — closes the M5(d) gap.** Two
  more M2-style decomposers (`decomposers/choose-energy.ts`, `choose-attack.ts`), registered in the
  registry (which flips `classify` unsupported→decomposable, no other change). **`ChooseEnergyPrompt`**
  (`'Choose energy'`, retreat / energy-cost payment): one pick = one attached energy named by iid →
  an index into `prompt.energy`; raw result `number[]`. There is **no `endChoice`** — `validate`
  requires the picked set to pay the cost EXACTLY (`StateUtils.checkExactEnergy`), so `next` completes
  the instant the accumulation pays it, and never offers a pick that would overshoot. (Edge: a harness
  that picks a non-completable subset assembles an inexact set → `validate` fails → the loop throws;
  acceptable for deterministic conformance.) **`ChooseAttackPrompt`** (`'Choose attack'`, copy/disable
  — e.g. Ralts "Memory Skip"): a **single-select**, one pick = `{source iid, attack name}` → the raw
  `{index, attack}` (index into `prompt.cards`); `source` is the iid of the exact card in the prompt's
  list (its in-play top card), self-consistent because the harness echoes back the iid the menu
  emitted. **Now end-to-end replayable:** retreat with a non-trivial / mixed-energy cost, and
  copy/disable-attack cards. Still deferred: the copy/energy-accel cards that live in the
  inline-`Math.random` exclusion set (§9) — the prompt *mechanism* works, but those specific cards
  await migration.

## 9. Out of scope / deferred (first pass) — migration plan

- **Built-in-randomness cards (~88).** Migrate family-by-family to a `system`
  decision: (1) the ~70 "random pick from a list" → one shared
  `discardRandomFromHand`-style prefab that raises a `system` pick over the
  candidate cards (by identity); (2) the ~12 inline Fisher-Yates shuffles
  (incl. `iono.ts`) → route through `ShuffleDeckPrompt`; (3) the ~6 one-offs →
  `CoinFlipPrompt` / `system` pick. Each migration removes a card from the
  excluded set and adds it to `capabilities`. This is the path to making the
  neutral spec's Iono appendix executable.
- **Setup / mulligan**, **`activeEffects` in `initialState`**, **legacy
  mechanics** — as in §2.

## Appendix — in-scope worked example: a search-and-shuffle item

A Nest-Ball-style item: "Search your deck for a Basic Pokémon, put it on your
Bench, then shuffle your deck" — searches via `ChooseCardsPrompt`/`ChoosePokemonPrompt`
and shuffles via `ShuffleDeckPrompt` (both in scope).

```jsonc
// 1 — play the item; the search surfaces as a single ChoosePokemon decision
REQ  actions:[ {actor:"A",type:"playItem",card:"nest"} ]
RES  pending:{actor:"A", descriptor:"search deck: choose a Basic Pokémon",
              legalActions:[ {type:"choose",target:"b_pi"}, {type:"choose",target:"b_ho"} ]}
     events:[ playedItem(A,nest) ]                      // decomposer enumerates candidates from the prompt

// 2 — A chooses; bench placement is automatic; next, twinleaf raises ShuffleDeckPrompt → system
REQ  actions:[ …, {actor:"A",type:"choose",target:"b_pi"} ]
RES  pending:{actor:"system", descriptor:"shuffle A's deck",
              legalActions:[ {type:"shuffle", deck:["water2","b_ho","trainer","d5"]} ]}
     events:[ benchedFromDeck(A,b_pi) ]

// 3 — system supplies the order (driver applies it, not the Arbiter); back to A
REQ  actions:[ …, {actor:"system",type:"shuffle",order:["b_ho","trainer","water2","d5"]} ]
RES  status:"awaitingAction",
     pending:{actor:"A", descriptor:"main: choose an action", legalActions:[ … ]}
     events:[ shuffled(A) ]
     state:{ A.bench has b_pi; A.deck = ["b_ho","trainer","water2","d5"] }
```

Under the hood: the `ChoosePokemonPrompt` is decomposed (here it's a single pick,
so one decision), its result reassembled and resolved via `ResolvePromptAction`
so the item's callback fires unchanged; the `ShuffleDeckPrompt` is left
unresolved by our handler and surfaced as the `system` decision.
