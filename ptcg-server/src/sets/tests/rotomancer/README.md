# Rotomancer ↔ Twinleaf cross-engine test bed

A test harness that cross-checks Twinleaf's card engine against the **Rotomancer** project's
Effect-IR (`~/projects/pokemon-cards`) and the snapshot's **official** card data. It both
*executes* IR inside Twinleaf and *statically* compares card data, surfacing real bugs in either
project. Start here, then read [`DESIGN.md`](DESIGN.md) (architecture) and
[`FINDINGS.md`](FINDINGS.md) (what it found).

## Components (`rotomancer/`)
| file | role |
|---|---|
| `bridge.ts` | resolve a Rotomancer `printingId` → Twinleaf card (name-validated, exact/mismatch/unmapped); energy/cost ↔ CardType maps |
| `recipe-runner.ts` | translate a Rotomancer scenario (fixture + steps + expectations) → `setupGame` + actions + assertions |
| `ir-interpreter.ts` | execute an IR program as a Twinleaf card: damage/condition/heal/counters/cards.move ops; const/forEach/perCount/plusIf counts; flow.control; multi-target selectors + target predicates |
| `ir-predicates.ts` | evaluate IR predicates (compare / subtype / damageState / stadiumInPlay / and-or-not) |
| `ir-cards.ts` | card-predicate matcher + deterministic `cards.move` execution |
| `tools/*.py` | regenerate the vendored fixtures from the Rotomancer snapshot |
| `fixtures/*.json` | vendored corpora (hermetic — no cross-repo dependency at test time) |

## The five cross-checks (spec files in `../`)
| spec | what it compares | finds |
|---|---|---|
| `rotomancer-resolver.spec.ts` | printingId resolution buckets | — (unit) |
| `rotomancer-oracle.spec.ts` | hand-picked scenarios vs native | — (smoke) |
| `rotomancer-corpus.spec.ts` | native execution vs IR-declared damage | attack-name/cost/rider gaps |
| `rotomancer-differential.spec.ts` | native card vs IR-interpreted card (bare + primed boards) | IR count/predicate flattening |
| `rotomancer-structural.spec.ts` | IR attack name + cost vs Twinleaf (static) | attack-name/cost data bugs |
| `rotomancer-official.spec.ts` | Twinleaf vs **official** data: HP/weakness/resistance/type/retreat/evolvesFrom/attack name+cost+damage | Twinleaf data bugs; **adjudicates** IR-vs-Twinleaf disputes |

The official data is authoritative, so `rotomancer-official` doubles as the **adjudicator**: when
the IR and Twinleaf disagree, whichever matches official is right (e.g. it proved Turtonator's cost
and all 11 structural name diffs are Twinleaf bugs, not IR bugs).

## How findings stay green
Every confirmed discrepancy is allow-listed in its spec with a one-line reason; a **new**
discrepancy fails the suite. So the corpus is a standing regression net, and the allow-lists +
`FINDINGS.md` are the running catalogue (~55 discrepancies to date).

## Regenerating fixtures
```
cd ptcg-server
python3 src/sets/tests/rotomancer/tools/generate-plain-attack-scenarios.py > .../fixtures/plain-attack-scenarios.json
python3 src/sets/tests/rotomancer/tools/generate-attack-scenarios.py       > .../fixtures/attack-scenarios.json
python3 src/sets/tests/rotomancer/tools/generate-official-metadata.py      > .../fixtures/official-metadata.json
```
Run the suite with `npm run test:sets` (uses the project-local `jasmine-ts`; works on node 12+).
