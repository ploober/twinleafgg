# Rotomancer IR → Twinleaf integration: support design

This document is the authoritative map of **every Rotomancer Effect‑IR v2 feature** and how the
Twinleaf cross‑engine differential supports it (or deliberately defers it). It is meant to be read
alongside [FINDINGS.md](FINDINGS.md) (the running log of what each expansion uncovered) and the
interpreter modules it describes:

| module | responsibility |
|---|---|
| [ir-interpreter.ts](ir-interpreter.ts) | op dispatch, amount/count evaluation, the `InterpretedCard`, lock reproduction |
| [ir-selectors.ts](ir-selectors.ts) | the compositional `{side,spot,role,quantity,chooser,bind}` selector → concrete targets |
| [ir-predicates.ts](ir-predicates.ts) | the `{kind}`‑tagged predicate sum type → boolean against live state |
| [ir-cards.ts](ir-cards.ts) | the card‑predicate vocabulary (`isa`/`nameTag`/and‑or‑not) and `cards.move` |
| [bridge.ts](bridge.ts) | printing‑id ↔ Twinleaf set/number resolution, energy/cost mapping |

> **Source of truth.** We integrate against the `peg-emit-v2` corpus (~1,851 ATTACK fragments,
> v2‑shaped, tagged `irVersion 1.54.0`) at
> `~/projects/pokemon-cards/tools/template-parser-probe/peg-emit-v2/`. The authoritative v2 schema is
> `~/projects/pokemon-cards/docs/ir-v2-design.md`; the live v1.54.0 Java types are under
> `sim/src/main/java/.../ir/`. Counts in the tables below are occurrences in the corpus.

---

## 1. Design principles — the support contract

> 🧭 **North star: accuracy.** Nothing here is "good enough" merely because a test passes or a
> scorecard is green — it is acceptable only when it is *as faithful as possible* to the real
> semantics. The entire value of a cross‑engine oracle is that it tells the truth about where two
> engines diverge; an approximation that agrees *for the wrong reason* (a predicate that matches by
> coincidence, a probe that passes vacuously, a selector that guesses instead of resolving) poisons
> the oracle — it hides real bugs or manufactures false ones. When faithful support needs more
> infrastructure, build it or defer it honestly as a **counted** gap; never fake it. Every principle
> below is in service of this one.

The integration is an **oracle**, not a re‑implementation. Five principles govern what "support" means.

1. **Mirror‑board differential.** Every check runs the *native* Twinleaf card and the *IR‑interpreted*
   card on the same mirror board (both players hold the same printing), then compares an observable.
   Identical stats mean any divergence isolates the attack **effect**. The interpreter only has to
   reproduce the *observable consequence*, never the engine's internal mechanism.

2. **Deterministic‑subset interpretation.** We interpret only the part of a program whose outcome is
   forced by the rules. Anything that needs a genuine **player choice over multiple distinct options**,
   **hidden information**, or **randomness beyond coin flips** is not interpreted.

3. **Throw‑to‑skip.** Every unsupported construct throws a clean `Error`. The differential catches it
   and **skips that card** (counts it as `unsupported`/`skipped`), never as a failure. This keeps
   coverage *explicit* (the scorecards show exactly how many cards each gap costs) and makes a wrong
   guess impossible — an unsupported op can never produce a false mismatch.

4. **Mechanism‑independent observation.** We compare observable game state — damage, special
   conditions, attached energy, zone contents, prize counts — or an observable *outcome* (a blocked
   action throws `BLOCKED_BY_EFFECT`). Whether native enforces a thing via a marker, a per‑card
   interceptor, or a central engine property is irrelevant; the interpreter is free to pick whichever
   Twinleaf mechanism yields the same observable.

5. **Fix the integration, allow‑list the cards.** A divergence is triaged into: an **IR‑integration
   bug** (our interpreter/selector/predicate is wrong → *fix it*), an **IR faithfulness gap** (the IR
   itself drops detail → note it), or a **native Twinleaf card bug** (the engine card is wrong →
   *allow‑list it, never fix it* — see [memory: rotomancer-no-card-fixes]). To date the only thing
   fixed in non‑test code is **1 IR‑integration predicate bug**; every native card bug is
   **allow‑listed, not fixed** — Flame Screen, Mega Sharpedo ex's Greedy Fang & Hungry Jaws, Wugtrio
   ex's Numbing Hold, and the 4 coin‑flip/index bugs (Combusken Double Kick, N's Klink Double Spin,
   Sunkern Bullet Seed, Monferno Heat Blow). Those last four were briefly patched early in the spike,
   *before* this rule was set; the patches have since been **reverted** and the bugs allow‑listed, so
   the treatment is now uniform.

Two corollaries shape the per‑feature decisions below:

- **A no‑op is a valid support strategy** when the construct is *snapshot‑neutral* in the single‑turn
  differential (e.g. `hand.reveal` moves no cards; a next‑turn `rule.override` changes nothing
  *this* turn). The lock differential later probes the next‑turn ones explicitly.
- **A skip is better than a guess; but an *aligned prompt* beats a skip.** Picking "the first eligible"
  directly would be a guess that can disagree with native — so until **Stage B** (§12.5) the affect‑target
  choices threw → skip. Stage B now *emits the same prompt native does* and lets the **harness** resolve
  both runs identically: no guess, and the comparison meaningfully tests the IR's choice geometry. Where
  the prompt geometry can't yet be mirrored faithfully (e.g. `excludeSelf`/`extremum`), it still throws → skip.

---

## 2. Origins & triggers

Every IR program is a list of `Fragment`s, each with an `origin`:

| origin | corpus | status | plan |
|---|---|---|---|
| `ATTACK` | 100% | **Supported** | Each fragment → an `Attack` with printed damage `0`; the `body` executes op‑by‑op when the attack is used (`InterpretedCard.reduceEffect`). Cost is mapped via `bridge.costToCardType`. |
| `ABILITY` | 0% (not emitted) | **Out of scope** | Would need an ability‑trigger harness (use‑ability action, passive `static` triggers). The op vocabulary largely overlaps, so the selector/predicate/amount machinery would be reused; the new work is the trigger plumbing. |
| `RULE_BOX` | 0% (not emitted) | **Out of scope** | Always‑on rule text (e.g. "this Pokémon can't retreat"). Maps to passive `continuous.modifier`/`rule.override` with `scope: static`. |

The interpreter copies the native card's engine‑relevant stats (`hp`, `cardType`, `weakness`,
`resistance`, `retreat`, `stage`, …) onto the `InterpretedCard` so the differential isolates the
effect, not the chassis.

---

## 3. Operations (the `Op` sum type)

Status legend used throughout:

- **✅ Supported** — executed into Twinleaf effect(s) and cross‑checked.
- **🟡 Partial** — the deterministic forms execute; the rest throw → skip.
- **🟦 No‑op** — accepted but snapshot‑neutral (or applied only so a lock probe can observe it later).
- **⛔ Skip** — throws by design; the card is skipped.
- **⬜ Out of scope** — not emitted by the ATTACK corpus.

| op | corpus | status | Twinleaf mechanism / reason |
|---|---:|:--:|---|
| `damage.deal` | 1680 | ✅ | Defender damage routes through the normal pipeline (`effect.damage +=`, so weakness/resistance/prevention apply); multi‑target/spread damage is direct `PutDamageEffect` (weakness‑free), matching how native spread works. `ignore` (weakness/resistance/defenderEffects) is inert in a mirror → no‑op. |
| `cards.move` | 307 | ✅ | `MOVE_CARDS` between zones hand/deck/discard/lostzone. `chooser:'auto'` → first‑N matching; `chooser:'player'` → **emits a `ChooseCardsPrompt`** (predicate → `blocked`; the filter‑aware harness picks the same first‑N matching, §12.7). **bench→active (same owner) = a SWITCH** via `player.switchPokemon` + a Bench `ChoosePokemonPrompt`. **attached → hand/discard** (move a card off a Pokémon named by `from.of`) via `PokemonCardList.moveCardsTo` (keeps the `.energies`/`.tools` sub‑lists the snapshot reads in sync — never `MOVE_CARDS`). **prize → hand** ("take a Prize card") via the native `TAKE_X_PRIZES` prefab (prizes are a `CardList[]`; the prefab emits the same `ChoosePrizePrompt` the harness resolves, no guard bump). **stadium → discard** ("discard the Stadium in play") via the global singleton: the Stadium lives in one player's `player.stadium`, so the source is resolved by the non‑empty zone (mirroring `StateUtils.getStadiumCard`), not the owner‑keyed `resolveZone` from‑path; exercised + observed on the stadium‑loaded board (§12.3). Counts `exactly`/`all`/`upTo`. `attached`→discard of **Pokémon Tools** is now supported (Tool subtype + the tools‑loaded board, §12.3); the auto gather reads `.tools` (where the engine keeps attached Tools), so `moveCardsTo` updates the snapshot's tools count. **Throws** on `opponent`/`random` chooser, deck **search** (`visibility:search`/`searchTyped`), a `source` selector (the "from your opponent's Pokémon" player‑choice‑of‑which‑Pokémon shape — native emits a `ChoosePokemonPrompt` of a different geometry, e.g. Minccino), and place‑a‑Pokémon / bench‑search / active(self‑bounce) endpoints. Counts `exactly`/`all`/`upTo` plus **`untilHandSize`** (draw‑to‑hand‑size — draw `max(0, N − handSize)` from the deck top, §8.2). |
| `energy.discard` | 197 | ✅ | Discards matching attached energy from the resolved target(s). Counts `exactly`/`all`, plus the player‑chosen `anyAmount`/`upTo` (collapsed to the greedy maximum the harness auto‑resolves native's `DiscardEnergyPrompt` to — §8.2). When the source is a player‑choice pool ("from among your Pokémon", `chooser`/`quantity:'one'`), resolves the spatial pool directly (§6, `spatialPool`). With `bindAs` it records the discarded list for a later `countOf` (discard‑and‑scale — §8.1). **Throws** on non‑`attached` source. |
| `condition.apply` | 197 | ✅ | `AddSpecialConditionsEffect`. **Throws** on `removeMode` (condition removal — **0 corpus cards**, so the throw is defensive/unexercised). |
| `rule.override` | 192 | 🟡 | See §5. `retreatShutoff`/defending and `attackShutoff`/`ownNextAttack` are reproduced (probed by the lock differential); the rest are **🟦 no‑op** (snapshot‑neutral this turn, not yet probed). |
| `continuous.modifier` | 131 | 🟡 | See §4. `damageReduction`/`preventDamage`/`damageDebuff` are reproduced (lock‑probed); the rest are **🟦 no‑op**. |
| `coinFlip` | 104 | ✅ | Under the `ALL_HEADS` harness a flip is heads → run the `then` branch. The interpreter's `headsOf(n)` reproduces the exact head count the native card's real flips would yield. |
| `heal` | 86 | ✅ | `HealEffect` on each resolved target. |
| `energy.attach` | 52 | 🟡 | Moves first‑N matching energy from hand/discard onto the target. Counts `exactly`/`upTo`/`all`. **Throws** on `deck` source (a search over filler energy — not a forced outcome). On the differential's bare board the source is usually empty (a genuine forced no‑op). |
| `choice` | 37 | ✅ | Always "you may ⟨then⟩" (empty `else`). Emits a `ConfirmPrompt` (harness always confirms, no ambiguity increment) and runs `then` through the continuation runner — mirrors native. |
| `if` | 24 | ✅ | Evaluates `when` via `ir-predicates`, runs `then`/`else`. |
| `energy.move` | 23 | ✅ | Move the first `count` matching attached energy from the source selector to the first‑eligible destination — the same target the harness's `resolveMoveEnergyRaw` picks for native's `MoveEnergyPrompt` (§12.7), so the two agree. (Energy prompts don't touch the ambiguity guard, so no prompt is emitted.) |
| `damage.placeCounters` | 22 | ✅ | `PutCountersEffect` (bypasses weakness, lands on any Pokémon incl. bench). Supports `untilHpRemaining` (bring target to N HP). |
| `hand.reveal` | 11 | 🟦 | Reveals a hand — moves no cards, changes no tracked zone. Snapshot‑neutral no‑op. |
| `iterate` | 9 | ✅ | All are "put N damage counters on your opponent's ⟨spot⟩ in any way you like" — reproduced with the native `PUT_X_DAMAGE_COUNTERS_IN_ANY_WAY_YOU_LIKE` prefab (one slot‑aware `PutDamagePrompt`, §12.7), not a per‑iteration loop (which would trip the ambiguity guard N×). Other `iterate` shapes throw → skip. |
| `pokemon.knockOut` | 7 | ✅ | Lethal `PutDamageEffect(999)` through the normal pipeline so the engine awards the prize, discards, and promotes (mirrors native `KnockOutOpponentEffect`). |
| `pokemon.return` | 4 | ⛔ | Return a Pokémon (and attached) to deck/hand — disturbs deck order / is a choice. Throws → skip. |
| `damage.move` | 3 | ⛔ | Move existing damage counters between Pokémon — chosen source/destination. Throws → skip. |
| `costGate` | 3 | ⛔ | "Pay cost X, then do Y" — the cost is a player‑chosen discard. Throws → skip. |
| `pokemon.discard` | 2 | ✅ | Literal "discard this Pokémon and everything attached" (no prize, unlike a KO). |
| `special.endTurn` / `special.devolve` / `special.evolveSkip` / `prize.modify` / `prize.manipulate` / `deck.reorder` / `effect.invoke` / `game.win` / `energy.provides` | 0 | ⬜ | Spec‑defined but not emitted by the ATTACK corpus. Most are ability/trainer‑oriented. They'll be triaged when an ability harness exists. |

---

## 4. `continuous.modifier` kinds (next‑turn / passive stat modifiers)

A `continuous.modifier` is snapshot‑neutral in the single‑turn differential, so the **default is
no‑op**. The ones backed by an observable next‑turn consequence are reproduced and verified by the
**multi‑turn lock differential** ([rotomancer-locks.spec.ts](../rotomancer-locks.spec.ts)).

| modifier kind | corpus | status | reproduction / probe |
|---|---:|:--:|---|
| `damageReduction` | 42 | ✅ | Sets the engine's `damageReductionNextTurn`; the lock probe deals a synthetic hit next turn and compares the landed amount. |
| `preventDamage` | 42 | ✅ | "Prevent all damage from ⟨matching⟩ Pokémon" → a large `damageReductionNextTurn` sentinel, **gated on evaluating `matching` against self** (the mirror probe's attacker is the same printing). |
| `preventEffects` | 21 | 🟦 | "Prevent effects of attacks" — the single‑turn snapshot can't see it and the damage probe doesn't exercise effect‑prevention. No‑op for now; a future effect‑application probe would be needed. |
| `damageDebuff` | 11 | ✅ | "The Defending Pokémon's attacks do N less next turn." In the mirror the defender's only next‑turn attack hits self, so it's reproduced as `damageReductionNextTurn` on self (the lock user's active). |
| `damageBuff` | 7 | ✅ | "During your next turn, this Pokémon's ⟨attack⟩ does +N." Reproduced with the exact native `NEXT_TURN_ATTACK_BONUS` prefab in `InterpretedCard.reduceEffect`; the **own‑turn damage probe** (§12.4) re‑attacks next turn and compares the increase. Compared on 2 mapped cards (Metagross / Meteor Mash). |
| `damageVulnerability` | 3 | ⛔ | "The Defending Pokémon takes N more during your next turn." Deferred: the only mapped case (Vibrava / Screech) is a 0‑damage setup, so the +N can't be observed by a re‑attack; the damaging case (Stunfisk) is unmapped me2pt5. Counted skip. |
| `weaknessSuppression` | 3 | 🟦 | "No Weakness while active." Mirror‑mode already filters self‑weakness cards from the probes, so there's nothing to observe in the current harness. |
| `attackBaseDamageOverride` | 2 | ✅ | "…⟨attack⟩'s base damage is N next turn" (setup attack ≠ boosted, e.g. Watchog Focus Energy→Hyper Fang). Reproduced with the native `NEXT_TURN_ATTACK_BASE_DAMAGE` prefab (overwrites after the body); no mapped oracle card (rsv10pt5 name‑mismatch), so verified by a direct non‑vacuity assertion (§12.4). |
| (spec‑only: `coinGate`, `hpModifier`/`hpFloor`, `retreatCostModifier`, `attackCostModifier`, `conditionImmunity`, `typeModifier`, `benchCapModifier`, `energyAttachRestriction`, `conditionPreservation`, `weaknessModifier`) | 0 | ⬜ | Not emitted by the ATTACK corpus. |

---

## 5. `rule.override` kinds (game‑rule bans)

Like modifiers, these are snapshot‑neutral and default to no‑op; the lock differential probes them via
a **blocked‑action** probe (attempt the action, observe `BLOCKED_BY_EFFECT`).

| override kind | corpus | status | reproduction / probe |
|---|---:|:--:|---|
| `attackShutoff` (`ownNextAttack`/self) | 107 | ✅ | The "recharge" lock ("can't use ⟨attack⟩ next turn"). Pushes the name to the engine's central `cannotUseAttacksNextTurnPending`. **Own‑turn probe:** use the attack → `endTurn` (pass opponent) → re‑attempt → expect `BLOCKED_BY_EFFECT`. Verifies the IR names the right attack. |
| `retreatShutoff` (`opponentNextTurn`/defending) | 57 | ✅ | "The Defending Pokémon can't retreat next turn." Calls the same prefabs native does (`BLOCK_RETREAT` / `BLOCK_RETREAT_IF_MARKER`, keyed to the interpreted card). **Block probe:** attempt the locked active's retreat → expect `BLOCKED_BY_EFFECT` (throws in `propagateEffect`, so no bench/energy needed). |
| `attackShutoff` (`opponentNextTurn`/defending) | 11 | 🟡 | "The Defending Pokémon can't use attacks." Reproduction is built (central `cannotAttackNextTurn`) and a probe prototyped, but **all 11 printings are currently un‑comparable** (unmapped sets / number drift / not implemented in Twinleaf). Deferred on the corpus, not the harness. |
| `itemPlayRestriction` | 8 | ✅ | "Opponent can't play Item cards next turn." Reproduced by installing the engine's `ATTACK_EFFECT_ITEM_LOCK` marker on the opponent (`playTrainerReducer` throws `BLOCKED_BY_EFFECT`); the **play‑block probe** (§12.4) attempts a `PlayItemEffect` next turn. Compared on 6 mapped printings (incl. Galvantula ex, Frillish — up from 4 after the me‑set unblock). |
| `attackShutoff` (`untilLeavesActive`/self) | 5 | 🟦 | Self attack‑shutoff that lasts until the Pokémon leaves the Active spot (not just one turn). Different lifecycle than the recharge form. |
| `retreatShutoff` (`yourNextTurn`/self) | 3 | 🟦 | Self retreat‑lock on the user's own next turn. |
| `evolvePlayRestriction` | 1 | ⛔ | "Opponent can't play Pokémon from hand to evolve next turn." Deferred: the engine has **no** evolve‑lock mechanism (no marker, no check in `playPokemonReducer`), and it's a single corpus card (Bronzong sv5‑69) — building one is outside the oracle's remit. Counted skip. |
| (spec‑only: `abilityShutoff`, `benchPlayRestriction`, `stadiumPlayRestriction`, `evolutionRuleModifier`, `firstTurnAttackException`, `globalRetreatCostModifier`, `attackCostOverride`) | 0 | ⬜ | Not emitted by the ATTACK corpus. |

---

## 6. Selectors (`{side, spot, role, quantity, chooser, bind, where}`)

v2 replaced the 17 flat selector names with compositional axes. `ir-selectors.resolveV2Selector`
resolves the deterministic shapes; an op's `target.where` then filters via `ir-predicates`.

| axis / value | status | notes |
|---|:--:|---|
| `role: self` / `attacking` | ✅ | → the attacker's active. |
| `role: defending` | ✅ | → the opponent's active. |
| `role: eventSubject` / `currentTarget` | ⛔ | Event/iteration bindings — throw → skip. |
| `side: self` / `opponent` / `both` | ✅ | combined with `spot`. |
| `spot: active` / `bench` / `anywhere` | ✅ | built active‑before‑bench, low‑index‑first — the same order the harness enumerates choice candidates. |
| `quantity: each` / `all` | ✅ | all matching Pokémon (a forced set). |
| `quantity: one` | ✅ (affect‑target) / ⛔ (else) | A single **player‑picked** Pokémon. On an *affect‑target* op (damage/condition/heal/placeCounters) Stage B emits a `ChoosePokemonPrompt` the harness resolves identically to native (§12.5); `op.targetCount` chooses N distinct. As a predicate/`forEach` subject it still throws → skip. |
| `chooser: player` / `opponent` / `auto` | ✅ (affect‑target) / ⛔ (else) | Explicit chooser on an affect‑target selector → same Stage B prompt path. A `chooser` with `quantity:'each'`/`'all'`, or on a non‑affect selector, still throws → skip. |
| `spatialPool` (energy.discard source) | ✅ | The `side × spot` candidate pool a player‑choice **discard** ranges over ("discard any amount from among your Pokémon") — resolved directly, *without* the affect‑target choice throw, because the harness collapses the per‑Pokémon/per‑energy pick to greedy first‑eligible (§8.2). `resolveV2Selector` is refactored to build the pool via `spatialPool` then apply the choice throw, so its behavior is unchanged. |
| `bind: atInstall` / `now` | ✅ (inert) | Snapshot‑timing for "the Defending Pokémon at trigger time." In a single‑turn differential it's the same Pokémon, so the timing is inert. |
| `where: <predicate>` | ✅ | Post‑filter on resolved targets, evaluated by §8 with the target as subject. |
| `extremum` / `excludeSelf` | ⛔ | Superlative ("the most‑damaged") / self‑exclusion refinements — not yet handled; throw → skip. Corpus: `extremum` **0**, `excludeSelf` **1** (Koraidon *Unrelenting Onslaught*) — negligible (§13). |

`resolveV2Single` (predicate subjects) throws cleanly when a selector resolves to **no** Pokémon
(e.g. an empty bench) rather than dereferencing undefined — another throw → skip.

---

## 7. Predicates (the `{kind}`‑tagged sum type)

Used in `if.when`, `plusIf.when`, `target.where`, and `matching`. `ir-predicates.evalPredicate`
handles the deterministic leaves; the rest throw → skip. The default subject for selector‑less leaves
is the opponent's active (the implicit subject of an attack's riders).

| predicate kind | corpus | status | how |
|---|---:|:--:|---|
| `isa` | 428 | ✅ | Intrinsic match on the subject Pokémon via `matchesCardPredicate` (§11). |
| `conditionOn` | 63 | ✅ | Subject has a given Special Condition. |
| `damageState` | 30 | ✅ | `hasAny`/`full` damage on the selected list. |
| `and` / `or` / `not` | 24/11/17 | ✅ | Boolean combinators (recurse). |
| `cardInZone` | 19 | ✅ | Count of (optionally predicate‑filtered) cards in hand/deck/discard/bench, compared or `>0`. |
| `energyAttachedCount` | 13 | ✅ | Count of (filtered) attached energy vs N, **summed across every Pokémon the selector resolves to** (`spot:anywhere` → active + bench). |
| `prize` | 9 | ✅ | Prizes remaining vs N. |
| `handSize` / `deckSize` | 7/1 | ✅ | Zone size vs N. |
| `stadiumInPlay` | 7 | ✅ | Any stadium in play (`StateUtils.getStadiumCard`). Its **true** branch is exercised on the stadium‑loaded board variant (§12.3); the **5** mapped cards that resolve (Fan Rotom *Assault Landing* across SCR/PRE/ASC, Vivillon *Blow Through*) are now tested non‑vacuously instead of only on the false branch. |
| `hpRemaining` | 4 | ✅ | `hp − damage` vs N. |
| `compare` | 4 | ✅ | Compare two `attr` operands (`energyAttached`/`damageCounters`/`prizeRemaining`). |
| `boardCount` | 2 | ✅ | Count in‑play (filtered) Pokémon vs N. |
| `turn` | 16 | ✅ | "went first/second", "is your first turn" — read from `state.turn`/`activePlayer` (convention: turn 1 = first player's first turn, turn 2 = second player's; active player went first iff `state.turn` odd; "your first turn" = `state.turn ≤ 2`). Native reads the same `state.turn`, so they agree. In the single‑turn differential (`turn:2`) the value is determinable, so a true‑branch non‑vacuity assertion (§12.3) proves the model isn't vacuously matching. |
| `history` | 10 | 🟡 | `event:'evolved'` (`window:'thisTurn'`) ✅ — `pokemonPlayedTurn === state.turn` (the signal native evolution‑bonus cards read; `fromName` inert in a mirror). `attackUsed`/`healed` **⛔ throw → skip**: they need cross‑turn / heal history the engine doesn't expose (and `yourLastTurn` can't be exercised in a single‑turn differential). |
| `movedToActive` | 9 | ✅ | "switched into the Active this turn" — read from the engine's `player.movedToActiveThisTurn` (the `IS_POKEMON_MOVED_TO_ACTIVE_THIS_TURN` signal). Determinable‑false in the placed‑attacker setup; a switched‑in non‑vacuity assertion proves the true branch. |
| `hasTool` | 5 | ✅ | "this / the Defending Pokémon has a Pokémon Tool" — reads the engine's per‑Pokémon `tools` array (`list.tools.length > 0`). Exercised non‑trivially on the tools‑loaded board variant (§12.3). |
| `nameTag` | 4 | 🟡 | Supported by `matchesCardPredicate` for **card** matching (substring/owner); throws as a standalone **state** predicate (rare). |
| `resistanceType` / `retreatCost` / `sharedTypeInPlay` / `hasAttack` / `hasAbility` / `cardPlayed` | 2/1/… | ⛔ | Spec leaves not yet modeled (board‑shape or history dependent). Throw → skip. |

---

## 8. Amounts & counts

Two distinct vocabularies: **amounts** (a damage/heal magnitude, evaluated by `evalAmount`) and
**count quantifiers** (how many cards/energy to move, parsed inside each card/energy op).

### 8.1 Amount forms (`evalAmount`)

| amount form | corpus | status | how |
|---|---:|:--:|---|
| `const` | 1278 | ✅ | literal value. |
| `perCount` | 394 | ✅ | `base + per × count(inner)`. |
| `forEach` | 229 | ✅ | board cardinality (§9). |
| `plusIf` | 153 | ✅ | `base + (when ? bonus : 0)`, `when` via §7. |
| `coinFlipHeads` | 118 | ✅ | `headsOf(n)` under `ALL_HEADS`. |
| `countOf` | 34 | ✅ | Cardinality of a runtime **binding** a preceding op named via `bindAs` ("90 damage for each card you discarded in this way" — discard-and-scale, e.g. Inferno X). A fragment-scoped register threaded through the op runner holds the discarded card list; `countOf` returns its `.length`. **Throws → skip** on an unbound ref (e.g. the `cards.move bindAs` producer, deferred — §8.2). |
| `coinFlipsUntilTails` | 19 | ⛔ | Unbounded flip sequence — under `ALL_HEADS` it never terminates; semantically a player‑felt RNG. Throw → skip. |
| `minusPerCount` | 6 | ✅ | `max(0, base − per × count)`. |
| (spec‑only: `coinFlipTails`, `scaled`, `incomingDamageCounters`, `Amount.All`) | 0 | ⬜ | Not emitted. |

### 8.2 Count quantifiers (card/energy ops)

| quantifier | corpus | status | how |
|---|---:|:--:|---|
| `exactly` | 348 | ✅ | first N (after predicate filter). |
| `all` | 79 | ✅ | the whole filtered set. |
| `upTo` | 135 | ✅ (cards/energy.attach/discard) | first up‑to‑max — the harness takes the max (a forced upper bound); genuinely optional picks are guarded. On `energy.discard` it's the "discard up to N" producer half (e.g. Erasure Ball). |
| `anyAmount` | 10 | ✅ (energy.discard) / ⛔ (else) | "discard any amount" — the discard‑and‑scale producer (Inferno X). Collapsed to the greedy maximum, exactly what the harness resolves native's `DiscardEnergyPrompt` to (first‑eligible up to max; it never bumps the ambiguity guard, §12.2), so both engines discard the same set. As a discard *cost* (not a scale producer) it stays a player choice → skip. |
| `untilHandSize` (draw) | 14 | ✅ | "Draw until you have N cards in your hand" — deterministic `max(0, N − handSize)` from the deck top (the count snapshot reads zone *sizes*, so hidden deck order is irrelevant); mirrors native's `while (hand<N && deck) draw 1` behind a Confirm (§12.5, FINDINGS §23). |
| `untilHandSizeTrim` | 1 | ⛔ | "Discard down to a hand size" — a player‑chosen which‑cards discard (the lone case is `chooser:'random'`, Furfrou). Throw → skip. |
| search counts (`UpToSearchTyped`, …) | — | ⛔ | Deck search → throw → skip. |

---

## 9. `forEach` axes (`Countable`)

`countOf` in the interpreter resolves these board cardinalities (for `who: self`/`opponent`).

| axis | corpus | status |
|---|---:|:--:|
| `energyAttached` | 75 | ✅ |
| `damageCounters` (optionally on an explicit selector) | 46 | ✅ |
| `benchedPokemon` | 30 | ✅ |
| `pokemonInPlay` | 27 | ✅ |
| `prizesTaken` | 22 | ✅ |
| `discardCards` | 11 | ✅ |
| `toolsAttached` | 7 | ✅ (active+bench, `bothSides`) |
| `retreatCost` | 5 | ✅ |
| `handCards` | 4 | ✅ |
| `specialConditions` | 2 | ⛔ (throws → skip) |
| (spec‑only: `deckCards`, `prizesRemaining`, `prizesTakenLastTurn`, `damageTakenLastTurn`) | 0 | ⬜ |

---

## 10. Card predicates (`isa` attributes & `nameTag`)

`matchesCardPredicate` ([ir-cards.ts](ir-cards.ts)) is the shared vocabulary for `isa`, the `predicate`
field of energy/`cards.move` ops, and `matching` on modifiers. It **throws on unknown kinds/subtypes**
(a deliberate fail‑loud after a port bug once silently over‑matched).

| attribute | status | notes |
|---|:--:|---|
| `supertype` (Pokémon/Trainer/Energy) | ✅ | |
| `name` / `evolvesFrom` | ✅ | exact match. |
| `nameTag` (`substring` / `owner`) | ✅ | e.g. "Cynthia's", "Duskull". |
| `energyType` | ✅ | Matches an Energy card's `provides` **and** a Pokémon's own `cardType` (the fix from FINDINGS §9 — `isa energyType:Colorless` on a Pokémon now reads its type). |
| `subtype: Basic` / `Special` / `Stage 1` / `Stage 2` / `ex` / `Tera` | ✅ | Basic handles both basic energy and Basic Pokémon. |
| `subtype: Pokémon Tool` | ✅ | `TrainerCard` with `trainerType === TrainerType.TOOL`. Used by the `attached`→discard(Tools) cards (matched on the tools‑loaded board). |
| `subtype: Ancient` / `Future` / `Supporter` / `Item` / `Stadium` | ⛔ | Unsupported subtypes throw → skip (board rarely contains them anyway). |
| `hpAtMost` / `hasRuleBox` / `zoneIs` | ⛔ | spec leaves not yet wired. |
| `and` / `or` / `not` | ✅ | combinators. |

---

## 11. Control flow

| construct | status | how |
|---|:--:|---|
| `coinFlip { then }` | ✅ | Heads under `ALL_HEADS` → run `then`. The harness's determinism seam (`BotArbiter.flipCoin`, consumed by `CoinFlipEffect`) makes native and interpreter flip identically. |
| `if { when, then, else }` | ✅ | `evalPredicate(when)` selects the branch. |
| `choice { then }` | ✅ | "You may ⟨then⟩" → `ConfirmPrompt` (always confirmed) then run `then` (§3, §12.5). |
| `iterate { over, body }` | ✅ | The distribute‑counters idiom via the native prefab (§3, §12.7). |
| `costGate` | ⛔ | Pay‑to‑activate — throw → skip. |

---

## 12. Cross‑cutting infrastructure

### 12.1 Coin determinism (production seam)
`CoinFlipEffect` previously used `Math.random()` directly, making `BotArbiter.ALL_HEADS` dead code.
A `flipCoin()` seam on the handler/arbiter now drives both the native flip and the interpreter's
`headsOf(n)`, so a fresh game's flips are reproducible and the two engines agree flip‑for‑flip.

### 12.2 Divergence guard (`ambiguousChoices`)
`TestStoreHandler` counts genuine multi‑option choices it auto‑resolves. The single‑turn differential
**skips** any card where the native and interpreted runs faced a *different* number of ambiguous
choices — so a first‑eligible auto‑pick can never masquerade as a mismatch.

### 12.3 Observation surfaces (snapshots) & loaded boards
The single‑turn differential snapshots `{damage, conditions, energy, energyTypes}` per Pokémon and
`{active, bench[], hand, deck, discard, prizes}` per side — widened to **per‑bench** so spread damage
and multi‑target placement are observable (this surfaced the `untilHpRemaining` and
`placeCounters`‑vs‑`PutDamage` interpreter bugs), and to a typed‑energy multiset (`energyTypes`) so a
wrong‑**type** energy op is observable.

It runs over **seven board variants**: `bare`, `primed` (bench + pre‑damage), and five *loaded*
variants that each turn on one dimension so a divergence is attributable to it — `conditions` (defender
carries POISONED+BURNED+CONFUSED → `conditionOn` true branches), `energy‑rich` (typed energy on every
Pokémon → `energyAttachedCount`/`forEach energyAttached`), `zones‑loaded` (seeded hand + discard →
`handSize`/`cardInZone`/`forEach discardCards`), `tools‑loaded` (a Pokémon Tool — Float Stone, a
retreat‑only Tool that is inert for an attack snapshot — on both Actives, attached to `.tools` exactly as
the engine does → `attached`→discard(Tools), `hasTool`, `forEach toolsAttached`), and `stadium‑loaded` (a
Stadium — Town Store, inert: its only effect is a `UseStadiumEffect`‑gated ability the differential never
triggers — seeded into the attacker's `player.stadium`, the global singleton → `stadiumInPlay` true branches
and `cards.move stadium→discard`, observed via the snapshot's new per‑side `stadium` count). Loads are
mirror‑symmetric (the Stadium, a global singleton, is seeded once on the attacker's side, identically in
both runs), so a loaded variant can only surface real divergences. This audit (§12 in FINDINGS) found and fixed two IR‑integration bugs the
empty board hid: the `energy.discard`/`attach` predicate read the wrong path (`op.card.from.predicate`
vs `op.card.predicate`, dropping the type filter on all 249 ops), and `energyAttachedCount` over a
`spot:anywhere` selector counted only the active. Per‑variant **non‑vacuity assertions** (one per loaded
dimension — conditions, energy, zones, tools, and now stadium discard + `stadiumInPlay`) prove the loaded
inputs actually change the outcome (a green corpus is not enough).

### 12.4 Lock differential — five probe geometries
Next‑turn `continuous.modifier`/`rule.override` riders are invisible to the single‑turn snapshot.
The lock differential ([rotomancer-locks.spec.ts](../rotomancer-locks.spec.ts)) makes them observable:

| probe | observes | families |
|---|---|---|
| incoming‑damage | landed damage of a synthetic next‑turn hit | `damageReduction`, `preventDamage`, `damageDebuff` |
| blocked‑action (retreat) | `BLOCKED_BY_EFFECT` on a retreat attempt | `retreatShutoff` (defending) |
| own‑turn block | `BLOCKED_BY_EFFECT` on re‑using the attack after passing | `attackShutoff` (recharge) |
| own‑turn damage | landed damage when re‑attacking on the user's own next turn | `damageBuff`, `attackBaseDamageOverride` |
| play‑block | `BLOCKED_BY_EFFECT` on a `PlayItemEffect` next turn | `itemPlayRestriction` |

The own‑turn damage probe reuses the recharge probe's turn‑advance (`useAttack` → `endTurn` → re‑attack);
the interpreter reproduces the buffs with the exact native prefabs (`NEXT_TURN_ATTACK_BONUS` /
`NEXT_TURN_ATTACK_BASE_DAMAGE`), mechanism‑faithful (FINDINGS §15). The play‑block probe installs the
engine's `ATTACK_EFFECT_ITEM_LOCK` marker and attempts an Item play next turn (FINDINGS §16).

### 12.5 Choice alignment — Stage A + Stage B (both built)
Stage A is the divergence guard (§12.2): detect and skip choices. **Stage B** has the interpreter
*emit the same prompt native does* so the harness resolves both identically instead of skipping. The
enabling infra is a **continuation‑passing op runner** (`runOps`): a prompt‑emitting op resumes the
remaining body in its callback, so a choice mid‑body or inside an `if`/`coinFlip` branch is faithful —
with **no behavior change for any synchronous (no‑prompt) card**. Built across the player‑choice classes:

- **Affect‑targets** (`quantity:'one'`/`chooser`/`targetCount` on `damage.deal`/`placeCounters`/
  `condition.apply`/`heal`) → a `ChoosePokemonPrompt` whose geometry is derived from the selector
  (`side`→playerType, `spot`→slots, `where`→`blocked`); applied in the callback (chosen‑target damage via
  `PutDamageEffect`, weakness‑free, like native). Surfaced 4 benchless native bugs (FINDINGS §13).
- **`choice`** → `ConfirmPrompt` then run `then`. **`cards.move chooser:'player'`** → a Bench
  `ChoosePokemonPrompt` + `switchPokemon` for bench↔active switches, else a `ChooseCardsPrompt`.
  **`iterate`** → the native distribute‑counters prefab. **`energy.move`** → first‑eligible deterministic
  move. (FINDINGS §14; surfaced the Dangle Tail native bug.)

`compared` rose **bare 449→501, primed 450→508** across the whole of Stage B. What stays a counted ⛔
skip: `chooser:'opponent'`/`'random'`, `excludeSelf`/`extremum`, deck searches, place‑a‑Pokémon / prize /
attached `cards.move` endpoints, `costGate`/`pokemon.return`/`damage.move`, and the predicate gaps.

### 12.6 Printing resolution & name‑validation
`bridge.resolvePrinting` maps a printing‑id prefix → Twinleaf set code and **name‑validates** every
hit, so a misaligned set/number degrades to a safe `mismatch` skip rather than a false match. Mapped
prefixes: sv5–sv10, sv*pt5, svp, zsv/rsv (number‑drift‑tolerant), me1→MEG, me2→PFL, **me2pt5→ASC**
(Ascended Heroes), **me3→POR** (Perfect Order). me2pt5 required a **test‑loader fix** (§12.8): the loader
keyed each set module by its *first* card file's set code, and `set‑ascended‑heroes`'s first import is an
`other‑prints` reprints file whose first cards are `set='MC'` — so the module was keyed under MC, never
ASC, and `getCardBySetAndNumber('ASC', …)` always returned undefined (the same bug had silently kept
**me1→MEG** dormant too). Registering each module under *all* its set codes fixed both. ASC is a partial
Twinleaf implementation (~71 of 171 me2pt5 cards), so ~46 me2pt5 + the full me1/me3 sets resolve; the rest
name‑validate to safe skips.

### 12.7 Harness prompt‑resolution expansions
Stage B needed the shared test harness's auto‑resolver (`TestStoreHandler`) to *honor each prompt's
constraints* — it previously stubbed three, which silently broke or skipped the corresponding attacks.
Each fix is strictly more correct and was verified across the whole harness blast surface (**sets 71 +
conformance 190** specs, green):

| resolver | was | now |
|---|---|---|
| `resolvePutDamageRaw` | first `maxAllowedDamage` target (the Active) → rejected by a `[BENCH]` prompt → threw | honors `prompt.slots` (first in‑slot target) — unblocks `iterate` distribute‑counters |
| `resolveChooseCardsRaw` | ignored the prompt `filter` → picked first‑N of *all* cards (wrong card, inflated eligible/ambiguity) | filter‑aware (eligible = filter‑matching, non‑blocked) — unblocks predicate `cards.move`; surfaced the Dangle Tail native bug |
| `resolveMoveEnergyRaw` | **no‑op stub** | deterministic first‑eligible move (slots/blockedFrom/blockedTo/filter) — makes native `MoveEnergyPrompt` (87 cards) actually move, enabling `energy.move` |

These are mechanism‑level seams (like the §12.1 coin seam): they make the *native* engine behave the way
the real game does under auto‑resolution, so the interpreter, emitting the same prompt, can be compared
against it. The snapshot remains count‑based, so `cards.move` over hidden zones verifies *count moved*,
not card identity — an honest partial coverage, consistent with every other zone.

### 12.8 Set‑loader fix (multi‑set‑code modules)
The lazy card loader (`test‑helpers`) keyed each set module by **only its first card file's** set code
(`inferSetCodeFromModule`). Modules whose `index.ts` imports an `other‑prints` reprints file FIRST were
mis‑keyed under a foreign reprint code — so `ensureSetCodeLoaded(realCode)` threw and
`getCardBySetAndNumber(realCode, …)` returned undefined. This had silently kept **MEG (me1)** and **ASC
(me2pt5)** dormant (mapped in the bridge but resolving nothing). The fix (`inferSetCodesFromModule`)
registers each module under **every** set code its cards declare — purely additive (a module becomes
findable under more codes, never fewer; `loadSetModule` is idempotent and `CardManager.defineSet` is
first‑wins). It unblocked **+150** comparable cards (bare 588→738) at **0 differential mismatches**;
every divergence surfaced was a native Mega‑card bug, an IR‑faithfulness gap, or a Japan‑only translation
name discrepancy (catalogued, allow‑listed). One reprint artifact: with no `set‑stellar‑crown/lanturn.ts`,
`SCR‑49` now resolves the Lost Thunder Lanturn reprint (labelled `set='SCR'`) — surfaced by the structural/
official checks, allow‑listed. Verified safe across the **sets (22/0)** and **conformance (191/0)** suites.

---

## 13. Roadmap (prioritized)

| priority | item | unlock |
|---|---|---|
| ~~1~~ ✅ | **Stage B — full** (§12.5, §12.7): affect‑targets, `choice`, `cards.move chooser:'player'` (incl. switches), `iterate`, `energy.move` + the three harness‑resolution expansions | **Done** — the player‑choice class flipped from skip to compared (`compared` bare 449→501, primed 450→508). |
| ~~2~~ ✅ | **Own‑turn damage probe** (§12.4): `damageBuff` + `attackBaseDamageOverride` reproduced via native prefabs and verified | **Done** — `damageBuff` compared on 2 mapped cards, `attackBaseDamageOverride` verified by direct assertion; `damageVulnerability` deferred (no damaging mapped case). |
| ~~3~~ ✅ | **Play‑block probe** (§12.4): `itemPlayRestriction` reproduced via `ATTACK_EFFECT_ITEM_LOCK` and verified | **Done** — compared on 6 mapped printings (Galvantula ex, Frillish, …; was 4 at landing, 6 after the me‑set unblock); `evolvePlayRestriction` deferred (no engine evolve‑lock mechanism). |
| ~~4~~ ✅ | Amount `countOf` (runtime bindings) + `bindAs` tracking | **Done** — discard‑and‑scale (Inferno X shape) wired end to end via a fragment‑scoped binding register + greedy‑discard pool; `compared` rose bare 501→517, primed 508→524. Surfaced a 5th native card‑file bug (Heatran TWM Steel Burst discards all energy, not just `[M]`). Deferred: `cards.move bindAs` (4 `me3`‑unmapped cards, no oracle). |
| ~~4~~ ✅ | Predicate `turn` / `history` / `movedToActive` modeling | **Done** — `turn` (state.turn parity) + `movedToActive` (engine signal) + `history.evolved` (pokemonPlayedTurn) modeled; `compared` rose **+6 per variant** (bare 517→523, primed 524→530), 0 mismatches. True‑branch non‑vacuity assertions discharge the determinable‑at‑`turn:2` caveat. Deferred: `history.attackUsed`/`healed` (no engine signal). |
| ~~4~~ ✅ | `cards.move` `prize` + `attached` zone endpoints | **Done** — attached→hand (Energy off a Pokémon, via `moveCardsTo`) + prize→hand (via `TAKE_X_PRIZES`) modeled; `compared` rose **+6 per variant** (bare 523→529, primed 530→536), 0 mismatches. Deferred: attached→discard(Tools) (needs the Tool subtype + a tool‑loaded board), bench‑search, active(self‑bounce). |
| ~~4~~ ✅ | Tool‑loaded board variant + `'Pokémon Tool'` card subtype + `hasTool` | **Done** — a 6th `tools‑loaded` variant + the Tool subtype + `hasTool` + `forEach toolsAttached` (active+bench, `bothSides`); the snapshot gained a `tools` count. Surfaced **4 native bugs** (Gadget Show ×3 read the vestigial `card.tools`; Gnaw Through's `reduceEffect` is commented out). Deferred: `attached`→discard with a `source` selector (Minccino's "from your opponent's Pokémon"). |
| ~~4~~ ✅ | Map `me2pt5` / `me3` + the set‑loader fix (§12.8) | **Done** — `me3→POR` (+67), then the loader fix activated `me1→MEG` + `me2pt5→ASC` (dormant): **+150** comparable cards total (bare 521→738), 0 differential mismatches. Surfaced ~25 native Mega‑card bugs / IR‑faithfulness gaps / Japan‑only translation discrepancies (all allow‑listed, no interp bugs). Verified safe across sets + conformance. |
| ~~5~~ ✅ | `cards.move` `count:'untilHandSize'` (draw‑to‑hand‑size) | **Done** — the lone *deterministic* `unsupported cards.move count` bucket (8×/variant). Draw `max(0, N − handSize)` from the deck top, mirroring native's `while (hand<N && deck) draw 1` behind a Confirm. `compared` rose **+8 per variant** (bare 738→746, primed 747→755), **0 mismatches, no allow‑list entries** — Blissey ex / Lumineon *Return*, Cynthia's Garchomp ex *Corkscrew Dive* (×5), Mismagius ex *Hexa‑Magic*, Thievul *Greedy Hunt*, Decidueye *Stock Up on Feathers* all flipped clean. |
| ~~6~~ ✅ | `stadium‑loaded` board variant (7th) + `cards.move` stadium→discard | **Done** — a new observation surface that de‑vacuifies the last remaining always‑false predicate: **5** mapped `stadiumInPlay` cards (Fan Rotom *Assault Landing* ×3, Vivillon *Blow Through*) now take their TRUE branch, and the `cards.move stadium→discard` op (the deterministic slice of the `unsupported zone` bucket) is unblocked + observed via a per‑side `stadium` snapshot count. Surfaced **1 native bug** (Mow Rotom DRI *Trimming Mower* deals 0, not 20 — independently confirmed by the official‑data cross‑check; allow‑listed). New variant compares **757 at 0 mismatches**; most corpus stadium printings are Japan‑only / number‑drifted and name‑validate to safe skips. |
| **1** | **ABILITY / RULE_BOX origin** harness | Extends beyond attacks — the largest *scope* expansion; reuses all selector/predicate/amount machinery. **Blocked**: the corpus is 100% ATTACK (0 ABILITY/RULE_BOX fragments), so there is nothing to differentiate against until the IR emitter produces them. |
| 2 | Remaining ATTACK gaps are **genuine deferrals** (no deterministic oracle) | The 2026‑06‑22 census corrected the earlier "small gaps" framing: `condition.apply removeMode` = **0** corpus cards, `extremum` = **0**, `excludeSelf` = **1** (Koraidon), `damage.move` = **3** (Cofagrigus ×2 on speculative/unmapped `rsv10pt5`, Wobbuffet — player‑chosen counter move, no oracle). The real remaining buckets are all un‑oracled by nature: `cards.move` deck search (18), `chooser:'opponent'/'random'` (12–14), `native made an ambiguous choice` (10–33, inherent to choice‑alignment), the remaining `unsupported zone` endpoints (now only place‑a‑Pokémon `deck`/`discard`→bench + active self‑bounce, after stadium→discard landed), `coinFlipsUntilTails`. |

The guiding metric is the scorecards: every deferred item above is a precise, counted
`unsupported`/`skipped` number, so the value of each unlock is measurable before it's built. With
`untilHandSize` done, the differential has reached a **plateau** — the largest remaining skip buckets have
no deterministic oracle, so further ATTACK‑side gains require either an oracle‑bearing harness extension
(choice‑alignment for more affect‑target shapes) or new IR origins (ABILITY/RULE_BOX), not more vocabulary.
