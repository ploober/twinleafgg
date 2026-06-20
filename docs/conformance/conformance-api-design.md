# Stateless Conformance API for TCG State Machines

> A stateless HTTP API that **both** engines — `twinleafgg` (TypeScript) and
> this project's `sim/` (Java) — implement, so a differential/conformance test
> suite can drive them from identical inputs and diff their behavior at the
> granularity of a single decision.
>
> Status: **design** (no implementation yet; twinleaf targeted first).
> Last reviewed: 2026-06-19.

## 1. Purpose & scope

We want to test two independently-built Pokémon TCG engines against each other.
Each exposes the same API:

- **Request** carries a complete game **state** plus an ordered **action log**.
- **Response** carries the resulting **observable state**, the next **pending**
  decision, and the **events** that occurred.

The harness feeds the *identical* request to both engines and diffs the
responses. Any divergence — a different resulting board, a different set of
legal options, a different event order, a different "is this move illegal"
verdict — is a conformance finding, adjudicated against
[`docs/vendor/por_rulebook.md`](vendor/por_rulebook.md) and the compendium
rulings (north-star pillar 5).

**Scope:** Standard-format play, the intersection of cards both engines
implement. The API is an *oracle* surface — it is omniscient (sees both hands,
both decks, all prizes) and is explicitly **not** a player-facing client.

**Non-goals:** matchmaking, lobbies, persistence, hidden-information
enforcement, UI, AI/strategy. The API adjudicates; the harness decides.

## 2. Design principles (load-bearing)

1. **The engine is a pure adjudicator — it never makes a free choice.** Every
   player decision is an action from a player actor; every random outcome is an
   action from the `system` actor. Fed identical actor inputs, two correct
   engines *must* produce identical observable output. This is the property the
   whole suite rests on.
2. **Statelessness via replay-from-initial.** A request carries `initialState`
   + the full `actions[]` log. The engine **replays** the log from the initial
   state, stops at the next decision, and returns. It reconstructs mid-action
   position by deterministic replay — it never serializes its own continuation.
3. **Single-decision granularity.** Every atomic decision is its own pending:
   one pending per damage counter placed, per card discarded, per card searched.
   Forced single-option decisions are still discrete (we never auto-resolve).
4. **All randomness is externalized to `system`.** No PRNG seed lives in the
   state. Shuffles, coin flips, and random picks are `system` actions whose
   outcomes the harness supplies.
5. **State stores only mutable, positional facts.** Intrinsic card data (HP,
   types, attacks, retreat cost, weakness, ability text, stage) is resolved from
   the card's `printing` against a shared card database — never duplicated into
   state. This keeps state lean and makes "do the engines agree on card data" a
   separate, explicit concern.
6. **Compare an observable projection, not raw internal state.** Two engines
   will never be byte-identical internally. The contract defines a canonical
   projection and what is in scope for equality per zone.

## 3. The actor model

There are exactly three actors, distinguished by **where decision authority
lives**:

- **`A` / `B`** — a player with genuine agency at this decision. This is
  "whoever the effect gives the choice to," *not* "the turn player":
  *"your opponent discards a card of their choice"* is a `B` decision on `A`'s
  turn.
- **`system`** — no agency; the outcome is chance. Shuffles, coin flips, random
  picks ("discard a *random* card").

**The pending shape is actor-agnostic.** A random hand-discard is the *same*
pending a player discard would be — same `descriptor`, same `legalActions` —
only the `actor` differs:

```jsonc
// "discard 1 RANDOM card from opponent's hand"   → system decides
{ "actor":"system", "descriptor":"discard 1 random card from B's hand",
  "legalActions":[ {"type":"discard","owner":"B","target":"p"},
                   {"type":"discard","owner":"B","target":"q"} ] }

// "your opponent discards a card OF THEIR CHOICE" → B decides, identical options
{ "actor":"B", "descriptor":"discard 1 card from your hand",
  "legalActions":[ {"type":"discard","owner":"B","target":"p"},
                   {"type":"discard","owner":"B","target":"q"} ] }
```

In the differential harness, the harness drives all three actors: `A`/`B` per
the test's scripted strategy, `system` per the test's scripted randomness.

## 4. Interaction model

### 4.1 Request / response

```jsonc
// REQUEST
{ "schemaVersion":"0.1", "initialState":{…}, "actions":[ …actor-tagged actions… ] }

// RESPONSE
{ "status":"awaitingAction" | "gameOver" | "invalidAction",
  "applied": 3,                                   // # of actions consumed from the log
  "pending": { "actor":"A|B|system", "descriptor":"…", "legalActions":[ … ] } | null,
  "events":  [ … resolution trace … ],
  "state":   { … observable projection … } }
```

- **`awaitingAction`** — the engine replayed the log and is now blocked on
  `pending`. The normal case (including at a quiescent turn boundary, where
  `pending` is the active player's main-phase menu).
- **`gameOver`** — terminal; `pending` is `null`, `state.outcome` is set.
- **`invalidAction`** — an action in the log was illegal at its point;
  `index` + `reason` (normalized code) identify it. See §10.

### 4.2 Replay semantics & batching

Because the request carries the whole log and the engine replays it, **batching
is free**: append N actions and read the state once. The engine validates each
action in turn and returns only the final `state` (with the cumulative
`events` and the final `pending`).

- **Step** (append one action at a time) to **localize** a divergence to a
  specific action.
- **Batch** (append many) to **fast-forward** a trusted prefix — e.g. set up a
  known board position cheaply, then step carefully through the part under test.

Batching requires the harness to *precompute* `system` actions (shuffle orders,
flips) to interleave them. In pure step-by-step exploration, the engine tells
you when a `system` turn is pending and you answer it then.

### 4.3 The action log is the portable test artifact

`(initialState, actions[])` is engine-independent. One log replays on both
engines, on future versions of either, forever. A conformance corpus is a
collection of these logs plus the expected observable projection at each step.

### 4.4 Cost & optional checkpointing

Replay is O(actions) per request — negligible for bounded games (a few hundred
actions). If it ever bites, an engine *may* snapshot a quiescent boundary state
(§8.4) to truncate the prefix, but that is an optional optimization, never part
of the contract.

## 5. Determinism & randomness

All nondeterminism is a `system` action; the harness supplies the outcome.

**Shuffle.** When the engine reaches a shuffle point it yields a `system`
pending that hands over the deck to reorder; the `system` action returns the new
order:

```jsonc
// pending
{ "actor":"system", "descriptor":"shuffle A's deck",
  "legalActions":[ {"type":"shuffle","deck":["water2","b_ho","trainer","d5"]} ] }
// action
{ "actor":"system", "type":"shuffle", "order":["b_ho","trainer","water2","d5"] }
```

This — rather than letting the engine roll its own dice and patching the result
afterward — is what makes **shuffle-then-draw** correct. Cards like **Iono** and
**Judge** ("shuffle hand into deck, *then* draw") resolve the shuffle and the
draw in one engine step; because the order is supplied *at shuffle time*, the
draw is deterministic and both engines draw the same cards. A post-hoc
"rewrite the deck between steps" scheme would draw before the harness could
intervene — and those are tier-1 Standard cards, not edge cases.

The pre-shuffle `deck` array in the pending is compared as a **multiset**: its
order is internal and about to be overwritten. The shuffle is a
**synchronization point** that erases any accumulated hidden-order divergence
between the engines.

**Coin flips** are `system` actions with `legalActions:[{flip,heads},{flip,tails}]`.
**Random picks** are `system` actions over the same candidate `legalActions` a
player pick would offer (§3).

There is deliberately **no RNG seed in the state** — determinism lives in the
action log, not the state, which is exactly what lets two engines with different
internal PRNGs agree.

## 6. State schema (`initialState` and response `state`)

Same schema for both. `initialState` is always a **quiescent boundary**
(no half-finished decision). The response `state` is the observable projection
and may add read-only derived fields (e.g. effective `maxHp`) for diffing;
`pending` rides *outside* `state`.

```jsonc
{
  "schemaVersion": "0.1",

  // ── global ───────────────────────────────────────────────
  "turn": 5,                    // turn counter — drives "this/last turn" + first-turn rules
  "activePlayer": "A",          // whose turn it is now
  "firstPlayer": "A",           // who took the game's first turn (first-turn restrictions key on this)
  "phase": "main",              // setup | main | checkup | gameOver  (checkup is transient)
  "outcome": "ongoing",         // ongoing | winA | winB | tie

  "stadium": { "iid":"st1", "printing":"sv6-256", "owner":"B" },   // shared, or null

  "players": {
    "A": {
      "active": {
        "stack":  [ {"iid":"c10","printing":"sv4-54"},     // [0] = basic (bottom, stable identity)
                    {"iid":"c11","printing":"sv4-55"} ],    // [last] = current top
        "energy": [ {"iid":"e1","printing":"sve-2"},        // basic energy
                    {"iid":"e2","printing":"sv5-159"} ],    // Special Energy (effect is card-DB data)
        "tools":  [ {"iid":"t1","printing":"sv1-197"} ],    // attached Tool(s); array for effect exceptions
        "damage": 60,                                       // HP units (= 6 counters); always ×10
        "conditions": ["poisoned","burned"],                // set; asleep/paralyzed/confused mutually excl.
        "poisonDamagePerTurn": 20,                          // default 10; raised by effect here
        "markers": {
          "playedOnTurn": 3,                // when the CURRENT evolution entered play
          "movedToActiveOnTurn": -1,        // -1 = since setup / never promoted this game
          "damageTakenThisTurn": 0,         // for counterattack effects
          "abilitiesUsedThisTurn": [],      // once-per-turn ability labels already fired
          "cannotAttackNextTurn": false     // self-imposed attack lock from a prior attack
        }
      },
      "bench": [                            // ordered, max 5; position can be rules-relevant
        { "stack":[{"iid":"c20","printing":"sv3-125"}], "energy":[], "tools":[],
          "damage":0, "conditions":[], "markers":{"playedOnTurn":4} }
      ],
      "hand":     [ {"iid":"h1","printing":"sv2-185"}, {"iid":"h2","printing":"sve-2"} ],
      "deck":     [ {"iid":"d1","printing":"sv4-54"}, {"iid":"d2","printing":"sv1-197"} ],  // ORDERED, [0]=top
      "discard":  [ {"iid":"x1","printing":"sve-2"} ],     // compared as a multiset
      "lostZone": [ ],                                      // count matters for Lost-Zone cards
      "prizes":   [ {"iid":"p1","printing":"sv4-54","faceUp":false},
                    {"iid":"p2","printing":"sve-2","faceUp":false} ],   // remaining; taken by position

      "flags": {
        "supporterPlayedThisTurn": false,
        "energyAttachedThisTurn":  true,
        "stadiumPlayedThisTurn":   false,
        "retreatedThisTurn":       false,
        "cardsPlayedThisTurn":     2,
        "prizesTakenThisTurn":     0,
        "prizesTakenLastTurn":     1,
        "vstarUsed":               false    // once-per-game VSTAR Power
      }
    },

    "B": { /* identical shape */ }
  },

  // ── advanced / deferred: lasting timed effects not derivable from the board (§8.3) ──
  "activeEffects": [
    // { "id":"fx1", "kind":"preventAllDamage", "target":"B.active",
    //   "appliedOnTurn":4, "expires":"endOf:A:next" }
  ]
}
```

### 6.1 Card references: `{iid, printing}`

`iid` is a stable per-game instance handle so an action or shuffle `order` can
name a *specific physical copy* across zones. `printing` is the set-number
identity (`sv4-54`) for card-DB lookup. A Pokémon-in-play is identified by its
stack's **bottom (basic) `iid`** — stable through evolution, retreat, and
promotion (the top card changes on evolve; the bottom does not).

### 6.2 Conventions

- **Damage in HP units** (×10; counters × 10).
- **Conditions** are a set; asleep/paralyzed/confused are mutually exclusive,
  poison/burn stack with them.
- **Deck is ordered** (`[0]` = top). **Discard / lostZone** compared as
  multisets. **Bench** ordered (position is rules-relevant). **Hand** compared
  as a multiset.
- **Omniscient:** both hands, both decks, and prize contents are present.
- **`flags`** are the rules-observable per-turn/per-game gates (the
  once-per-turn and once-per-game bits), not raw engine bookkeeping; each engine
  maps its internal counters onto them.

### 6.3 `activeEffects` — the hard, deferred part

Continuous modifiers that are *derivable from the board* — an ability granting
−30 to incoming damage while in play, an attack-cost reduction — are
**recomputed each step and not stored**. Only *timed* effects that outlive their
trigger and cannot be re-derived ("prevent all damage until end of opponent's
next turn", "can't attack next turn") need to live here, and that `kind`
vocabulary maps onto each engine's lock/modifier system — the single biggest
schema item. **Deferred:** most test positions sidestep it by *building effects
through the action log* rather than declaring them in `initialState`. Pin the
`kind` vocabulary only when a test needs to *start* mid-effect.

### 6.4 Quiescent boundaries

`initialState` and the "start of the active player's main phase" are
**quiescent** — fully specified by the fields above, no pending mid-resolution.
To begin "3 counters into a distribution", start from the prior quiescent state
and put the triggering actions in the log. Turn boundaries are the canonical
quiescent points and double as the optional checkpoint anchors (§4.4).

## 7. Action vocabulary

Every action is `{ "actor": "...", "type": "...", … }`. *(To be finalized
against each engine's dispatch surface; the player set below mirrors the `sim/`
sealed `Action` type — see §11.)*

**Player actions (`A`/`B`):**

| `type` | payload | notes |
|---|---|---|
| `playItem` / `playSupporter` / `playStadium` | `card` (iid) | trainer plays |
| `attachEnergy` | `card`, `target` | the one manual attach/turn |
| `attachTool` | `card`, `target` | |
| `benchBasic` | `card` | hand → bench |
| `evolve` | `card`, `target` | |
| `retreat` | `to` (bench slot) | pays retreat cost |
| `useAbility` | `source`, `ability` | |
| `declareAttack` | `source`, `name` | forces `endTurn` after resolution |
| `promoteBench` | `target` | choose new active after a KO |
| `choose` | `target` | a single pick inside an effect (one per pending) |
| `discard` | `owner`, `target` | one per pending |
| `placeCounter` | `target` | one per counter distributed |
| `takePrize` | `index` | one per prize |
| `endTurn` | — | explicit; forced single option after an attack/forced-end (§9) |

**System actions (`system`):**

| `type` | payload | notes |
|---|---|---|
| `shuffle` | `order` (iid list) | reorders the deck handed over in the pending |
| `flip` | `face` (`heads`/`tails`) | one per coin flipped |
| `pick` | `target` | a random selection from the pending's `legalActions` |

## 8. Pending & legalActions

The engine yields a `pending` whenever it needs an action. `legalActions`
enumerates the candidate actions valid *right now*.

- **`legalActions` is itself a conformance check.** Both engines must offer the
  same option set — for the main-phase menu, for a search ("which Basics are in
  the deck"), and even for *random* picks (the candidate set a `system` pick
  ranges over). Eligibility bugs are caught at the pending, before any action is
  taken.
- **No auto-resolution.** A forced single-option decision (a shuffle, the
  `endTurn` after an attack) is still a discrete pending, so it stays
  observable.

## 9. Turn boundaries

Turn-end is **frequently engine-decided** (attacking ends the turn; effects can
force "your turn ends"), so it is demarcated explicitly:

- **`endTurn` action** — the forced single option after an attack or
  forced-end, the explicit choice when passing. Every turn-end is one uniform,
  comparable step.
- **`turnEnded(P)` / `turnStarted(Q)` events** bracket the between-turns
  **checkup**, giving the harness clean alignment anchors.

The checkup is a multi-step, order-sensitive, `system`-driven sub-protocol and a
prime conformance surface: special conditions resolve — poison (auto damage),
burn (`system` flip + damage), asleep (`system` flip to wake), order matters —
KO checks may owe the owner a `promote` pending, then the turn flips, `turn`++,
per-turn `flags` reset, and the new player takes the **mandatory draw**
(deck-out here ⇒ `gameOver`).

**Conventions pinned by the contract** (otherwise-silent divergence sources):

- `activePlayer` stays the **ending** player through checkup, flips at
  `turnStarted`.
- Per-turn `flags` reset at **`turnStarted`** (so "this turn" is unambiguous).
- Checkup ordering (poison → burn → sleep, per rulebook) is identical.
- "next turn" markers (`cannotAttackNextTurn`, timed `activeEffects`) clear at a
  defined edge of the boundary.

```
A: declareAttack a1 "..."          → damage/KO/prize resolve
                                     pending {actor:"A", legalActions:[{type:"endTurn"}]}   // forced
A: endTurn                         → checkup begins
   system: flip (A.active asleep)  → {face:"tails"}        // stays asleep
   (auto) poison: A.active −20
   events [conditionChecked, damaged, turnEnded(A)]
   (auto) turn→6, activePlayer→B, B.flags reset, B draws d1
   events [turnStarted(B), draw(B,[d1])]
                                     pending {actor:"B", descriptor:"main", legalActions:[…]}
```

## 10. Comparison, normalization & errors

- **Diff the observable projection**, per-zone in-scope as in §6.2 (ordered vs
  multiset). Card identity by `printing`, never by `iid` when comparing across
  engines (iids are each engine's own handles unless seeded from the same
  `initialState`).
- **Normalized rejection codes.** "Both engines reject this illegal move" is a
  conformance result we assert. twinleaf throws `GameError(GameMessage)` and
  `sim/` returns `false`/throws; both map onto a shared `reasonCode` enum so
  `invalidAction` responses are comparable, not just both-illegal.
- **Card intersection.** The suite runs only on cards both engines implement,
  with *agreeing* card data. `GET /v1/capabilities` returns each engine's
  implemented-card list; the harness computes the testable intersection and
  needs a shared card-data source so a divergence is a *behavior* bug, not a
  data mismatch.

## 11. REST surface & versioning

- **`POST /v1/step`** — `{ schemaVersion, initialState, actions[] }` →
  `{ status, applied, pending, events, state }`. The one core endpoint.
- **`GET /v1/capabilities`** — `{ engine, version, schemaVersion,
  supportedSets[], implementedCards[] }`. Drives the testable intersection.
- **`POST /v1/normalize`** (optional) — canonicalize a state for comparison.

`schemaVersion` is carried in every request/response; engines advertise the
versions they speak via `capabilities`.

## 12. Per-engine implementation notes

### 12.1 `twinleafgg` (TypeScript) — targeted first

The full implementation design lives in
[`conformance-api-twinleaf-impl.md`](conformance-api-twinleaf-impl.md)
(components, build sequence, first-pass scope). Summary below.

Strong fit on serialization, weaker on determinism:

- **State** (`ptcg-server/src/game/store/state/state.ts`) is fully
  round-trippable via `StateSerializer` — a head start on import/export.
- **Actions** dispatch through `Store.dispatch` (`…/store/store.ts`); prompts
  live in `state.prompts[]` and resolve via `ResolvePromptAction`.
- **Card identity** is `Card.fullName` (set-number) — aligns with `printing`.
- **Changes required:**
  - Replace the `Arbiter` (`…/game/core/arbiter.ts`, inline `Math.random()`
    for `CoinFlipPrompt`/`ShuffleDeckPrompt`) with a **scripted resolver** that
    surfaces these as `system` pendings answered from the action log.
  - Stop auto-answering shuffles; surface them as `system` actions.
  - **Decompose aggregate prompts** (`ChooseCardsPrompt` min/max, distribution)
    into one pending per unit (§3, §8).
  - Report `legalActions` at each pending. The callback-continuation problem
    (the prompt callback is a non-serializable closure) is dissolved by
    **replay-from-initial** (§4.2): the closure fires synchronously within one
    replayed `dispatch`; it never crosses a request boundary.

### 12.2 `sim/` (this project, Java) — implement second

Strong fit on determinism, missing an output serializer:

- **Runtime state** is [`Match`](../sim/src/main/java/net/ploober/rotomancer/sim/state/Match.java) /
  [`Player`](../sim/src/main/java/net/ploober/rotomancer/sim/state/Player.java) /
  [`PokemonInPlay`](../sim/src/main/java/net/ploober/rotomancer/sim/state/PokemonInPlay.java).
- **Action dispatch** is the sealed `Action` type + [`MatchDriver`](../sim/src/main/java/net/ploober/rotomancer/sim/vm/MatchDriver.java)
  (`runTurn`, the B9 seams, `checkOutcome`, `MatchOutcome`).
- **Choices** already route through `ScriptedOracle` (path→answer) — close to
  the action-log model. **Randomness** is already deterministic via seedable +
  scriptable [`Rng`](../sim/src/main/java/net/ploober/rotomancer/sim/vm/Rng.java).
- **Test harness** [`RecipeExecutor`](../sim/src/main/java/net/ploober/rotomancer/sim/recipe/RecipeExecutor.java)
  + [`ScenarioSpec`](../sim/src/main/java/net/ploober/rotomancer/sim/cards/ScenarioSpec.java)
  `Fixture` is ~80% of a neutral `initialState`; `BoardSnapshot` is ~80% of the
  observable projection.
- **Changes required:**
  - Build a **state ⇄ JSON projection** for `Match`/`Player`/`PokemonInPlay`
    (none exists today; the runtime types are mutable, un-annotated).
  - Disable `ScriptedOracle`'s **auto-pick-when-one-option** (§3 no
    auto-resolution).
  - Stop **reshuffling the deck on every from-deck move**; deck order is part of
    state and only a `system` shuffle reorders it.
  - **Decompose aggregate choices** into one pending per unit.

## 13. Open questions & deferred decisions

1. **`activeEffects` vocabulary** (§6.3) — the timed-effect `kind` set. Deferred
   until a test must *start* mid-effect; most cases build effects via the log.
2. **Shared card database** — the agreed source of card data both engines
   resolve `printing` against; needed so divergences are behavior, not data.
3. **Naming** — `action` is the unit; we have no committed noun for the
   per-action exchange ("step"). Cosmetic; settle when writing the OpenAPI.
4. **Checkup ordering** — write the exact poison/burn/sleep + KO/promote order
   into the spec from the rulebook before either engine implements §9.

## 14. Appendix — worked example: Iono

Initial state (trimmed): A holds Iono (`sv2-185`) + cards `x`,`y`; deck
`[d1..d6]`; 4 prizes left. B has hand `[p,q,r]`; deck `[e1..e7]`; 5 prizes left.
Iono: "Each player shuffles their hand into their deck. Then each player draws a
card for each remaining Prize." The harness sends an *identical* growing log to
both engines.

Both shuffles are `system` actions (§5). Iono's "each player shuffles … *then*
each player draws" means both shuffles complete before any draw, so the draw is
deterministic against the injected orders.

```jsonc
// 1 — A plays Iono; first sub-step is A's shuffle
REQ  { initialState, actions:[ {actor:"A",type:"playSupporter",card:"iono"} ] }
RES  status:"awaitingAction", applied:1,
     pending:{actor:"system", descriptor:"shuffle A's deck",
              legalActions:[{type:"shuffle", deck:["d1","d2","d3","d4","d5","d6","x","y"]}]},
     events:[ supporterPlayed(A,iono), handToDeck(A,[x,y]) ]

// 2 — system shuffles A's deck (order injected); next, B's shuffle
REQ  actions:[ …, {actor:"system",type:"shuffle",order:["x","d3","d1","y","d5","d2","d6","d4"]} ]
RES  pending:{actor:"system", descriptor:"shuffle B's deck",
              legalActions:[{type:"shuffle", deck:["e1","e2","e3","e4","e5","e6","e7","p","q","r"]}]},
     events:[ shuffled(A), handToDeck(B,[p,q,r]) ]

// 3 — system shuffles B's deck → both draws fire automatically
REQ  actions:[ …, {actor:"system",type:"shuffle",order:["e1","p","e2","q","e3","r","e4","e5","e6","e7"]} ]
RES  status:"awaitingAction",
     pending:{actor:"A", descriptor:"main: choose an action", legalActions:[…]},
     events:[ shuffled(B),
              draw(A,4,[x,d3,d1,y]),     // top 4 of A's injected order
              draw(B,5,[e1,p,e2,q,e3]),  // top 5 of B's injected order
              discard(A,iono) ],
     state: A.hand=[x,d3,d1,y], A.deck=[d5,d2,d6,d4], A.discard=[iono];
            B.hand=[e1,p,e2,q,e3], B.deck=[r,e4,e5,e6,e7]
```

The payoff: the draws are deterministic because the order was supplied *at
shuffle time*, inside the same step as the draw. Two realistic catches the diff
surfaces: an engine that reshuffles internally draws different cards at the final
step; an engine that sequences the draw before the second shuffle diverges in
`events` one step earlier.
