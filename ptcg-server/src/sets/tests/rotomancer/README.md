# Rotomancer ↔ Twinleaf cross-engine test bed

A test harness that cross-checks Twinleaf's card engine against the **Rotomancer** project's
Effect-IR (`~/projects/pokemon-cards`) and the snapshot's **official** card data. It both
*executes* IR inside Twinleaf and *statically* compares card data, surfacing real bugs in either
project. Start here, then read [`DESIGN.md`](DESIGN.md) (architecture) and
[`FINDINGS.md`](FINDINGS.md) (what it found).

**IR wire format: v2** (`tools/template-parser-probe/peg-emit-v2`). v2 replaced the v1 flat
selector strings with compositional selectors (`{side,spot}` / `{role}`), the `flow.control`+`kind2`
god-op with top-level `coinFlip`/`if`, the `attack.lockOrModify` god-record with
`continuous.modifier`+`rule.override`, `energy.attachOrDiscard` with `energy.discard`/`attach`/`move`,
and the god-record predicate with a `{kind}`-tagged sum type. The interpreter reads v2 natively.

## Components (`rotomancer/`)
| file | role |
|---|---|
| `bridge.ts` | resolve a Rotomancer `printingId` → Twinleaf card (name-validated, exact/mismatch/unmapped); energy/cost ↔ CardType maps |
| `recipe-runner.ts` | translate a Rotomancer scenario (fixture + steps + expectations) → `setupGame` + actions + assertions |
| `ir-selectors.ts` | resolve a v2 compositional selector (`{side,spot,role,quantity}`) → target Pokémon lists |
| `ir-interpreter.ts` | execute an IR v2 program as a Twinleaf card: damage/condition/heal/counters/cards.move/energy.discard ops; const/forEach/perCount/plusIf/coinFlipHeads counts; `coinFlip`/`if` control; `continuous.modifier`/`rule.override` no-ops |
| `ir-predicates.ts` | evaluate v2 sum-type predicates (isa / damageState / conditionOn / stadiumInPlay / energyAttachedCount / boardCount / hpRemaining / prize / handSize / cardInZone / compare / and-or-not) |
| `ir-cards.ts` | v2 card-predicate matcher (isa / nameTag / and-or-not) + deterministic `cards.move` execution |
| `tools/*.py` | regenerate the vendored fixtures from the `ir-v2/` corpus |
| `ir-v2/*.json` | **gitignored** local copy of Rotomancer's raw `peg-emit-v2` v2 IRs — the generators' input (vendor it in, see below) |
| `fixtures/*.json` | committed corpora (hermetic — no cross-repo dependency at test time) |

## The five cross-checks (spec files in `../`)
| spec | what it compares | finds |
|---|---|---|
| `rotomancer-resolver.spec.ts` | printingId resolution buckets | — (unit) |
| `rotomancer-oracle.spec.ts` | hand-picked scenarios vs native | — (smoke) |
| `rotomancer-corpus.spec.ts` | native execution vs IR-declared damage | attack-name/cost/rider gaps |
| `rotomancer-differential.spec.ts` | native card vs IR-interpreted card (bare + primed boards) | IR count/predicate flattening |
| `rotomancer-structural.spec.ts` | IR attack name + cost vs Twinleaf (static) | attack-name/cost data bugs |
| `rotomancer-official.spec.ts` | Twinleaf vs **official** data: HP/weakness/resistance/type/retreat/evolvesFrom/attack name+cost+damage | Twinleaf data bugs; **adjudicates** IR-vs-Twinleaf disputes |

The pokemontcg.io dataset is a useful third opinion when the IR and Twinleaf disagree — but it is
**not infallible** (it shares its source with the IR, and an independent spot-check against
Limitless TCG found one case, Turtonator's cost, where the dataset was wrong and Twinleaf was
right). It correctly adjudicated the 11 structural attack-name diffs as Twinleaf bugs, but **costs
should be ground-truthed against a truly independent source** before fixing. See FINDINGS.md.

## How findings stay green
Every confirmed discrepancy is allow-listed in its spec with a one-line reason; a **new**
discrepancy fails the suite. So the corpus is a standing regression net, and the allow-lists +
`FINDINGS.md` are the running catalogue (~55 discrepancies to date).

## Regenerating fixtures
The two attack-scenario generators read the raw v2 IRs from the **gitignored** `ir-v2/` corpus.
Vendor it in once (bulky + upstream-owned, so it's kept local, not committed):
```
cd ptcg-server
cp ~/projects/pokemon-cards/tools/template-parser-probe/peg-emit-v2/*.json src/sets/tests/rotomancer/ir-v2/
```
Then regenerate (each generator defaults to `ir-v2/`; pass a dir arg to override):
```
python3 src/sets/tests/rotomancer/tools/generate-plain-attack-scenarios.py > .../fixtures/plain-attack-scenarios.json
python3 src/sets/tests/rotomancer/tools/generate-attack-scenarios.py       > .../fixtures/attack-scenarios.json
python3 src/sets/tests/rotomancer/tools/generate-official-metadata.py      > .../fixtures/official-metadata.json
```
(`generate-official-metadata.py` reads the snapshot's official card data, not the v2 IRs, so it
still points at `~/projects/pokemon-cards`.)
Run the suite with `npm run test:sets` (uses the project-local `jasmine-ts`; works on node 12+).
