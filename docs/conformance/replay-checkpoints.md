# Experimental conformance replay checkpoints

The checkpoint prototype is **off by default**. `step()` remains the uncached reference implementation. Only the HTTP conformance step handler selects checkpoint execution; gameplay and bot Stores do not use it.

Set `CONFORMANCE_REPLAY_CHECKPOINTS=on` to experiment, or `off` for immediate rollback. Invalid values fail startup. Checkpoints currently require `CONFORMANCE_STATE_SNAPSHOTS=legacy`, which selects the previously accepted specialized legacy copier. Graph snapshots remain a separate experiment.

## What is captured

`driver.ts` exposes an internal replay session and explicit `ReplayFrame`. A checkpoint contains the State, IID/Card maps, in-flight attack identity, complete replay-frame bookkeeping, events, and Store log ID in one reference context. Each restore creates fresh mutable Cards and containers, a new Store and handler, and freshly installed flip/movement providers. No Store, handler, callback or generator from the source request is cached.

Capture occurs after automatic prompt processing, at a live boundary with no unresolved prompt, wait callback, reaction/probe execution, trainer continuation or unfinished driver segment. Setup and terminal boundaries are excluded. Unknown Store fields decline capture. Rejected or partially applied requests never publish staged checkpoints; any rejection-prefix reconstruction uses uncached `step()`.

The detached codec serializes a reference graph into a private Buffer. It preserves cycles, object/array aliases, sparse arrays, Map/Set contents, descriptors, frozen history, attack identity, per-Card deck/transit metadata, and lightweight zone lineage. Restored objects inherit approved engine class prototypes rather than previous request instances. The global deck-stamp clock advances monotonically.

Class definitions must be exported by engine game/set modules loaded before replay actions. Unknown closures, unapproved classes, proxies, accessors, symbols, custom native containers and unsupported inherited data decline the whole capture. Class static object/accessor state is rejected except for the explicitly captured CardList metadata; Orthworm's module-scoped attack WeakMap also declines capture. Optional key/capture recursion limits fall back to reference replay. This conservative policy can reduce hit rate, including when a direct caller lazily loads another set after the cache's initial definition scan. It never authorizes an arbitrary request-local constructor. HTTP workers initialize their card registry before serving requests.

## Cache policy

Each worker owns its cache. Entries never cross workers, processes or engine builds. Keys include the schema/build namespace, snapshot backend, complete canonical initial state and ordered action prefix. Hash lookup always checks full key equality. A hit must be a nonempty prefix strictly shorter than the requested action log; there is no whole-response cache.

The combined published/staged payload budget is 16 MiB and 32 entries per worker, with a 1 MiB limit including each entry's canonical key. There is also a bounded 128-fingerprint admission history: a prefix must occur twice before capture, so one-off paths do not immediately pay serialization costs. Inputs longer than 128 actions, setup inputs and unsupported non-JSON in-process inputs use reference replay. Temporary canonical-key memoization is limited to 64 prefixes. These are conservative prototype policies, not a correctness limit on supported requests.

Payloads are immutable after publication. Every restore decodes an independent graph; mutable decoded snapshots are never reused. Invalid payloads are evicted and replayed from the root. Ordinary engine errors retain their existing behavior. Runtime statistics expose hit/action counts, reasons for skipped capture, key/capture/restore time, serialized bytes, entry count and byte budget. Serialization bytes describe payload traffic, not total allocated heap bytes.

## Measurement and correctness

The frozen control includes the previously accepted snapshot optimizations and readiness changes. The frozen candidate and deterministic inputs are identified by complete source/input manifests. The campaign runtimes and original checkouts remain unchanged.

Graviton comparison uses 60 workers, 120 persistent fixed-replay clients with two connections per worker, and worker-specific chronological traces with complete expected-response hashes. Each fixed arm warms 200 requests per worker, then checks 204,000 measured responses. Disjoint start/middle/last-recorded slices preserve ordering within each slice; trace truncation and omitted gaps are recorded in the case manifest. A separate cache-off ABBA comparison tests the replay refactor itself.

Full-pipeline acceptance uses 120 fuzz threads, a 24 GiB harness heap, quiet mode, Rotomancer TCP_NODELAY with its normal heap, 45 seconds of warm-up and 120 seconds of measurement per ABBA arm. Allocation, retaining-path diagnostics and ten-minute instrumented profiles run separately from throughput tests. Timing from local tests, instrumented profiles or repeated small regression corpora is not performance evidence.

Tests cover complete-response equality, actual prefix restoration, sibling rejection isolation, cycles/aliases, sparse arrays, fresh Cards, attack identity, frozen objects, lineage, temporary piles, metadata, exact-key collisions, budgets, configuration and unsupported-shape fallback. Mutation checks verify the lineage, Card metadata and alias guards. The existing conformance suite continues to cover prompt answers, nested rollback, reactions and scripted randomness. Conformance fix-ledger protections remain intact; changed signature anchors follow equivalent resumable initializers.

Measurements, rollout decision and reproducible commands are in the [iteration report](/home/james/projects/pmtcg-conformance-tests/results/replay-checkpoints-20261101/report.md) and [reproduction instructions](/home/james/projects/pmtcg-conformance-tests/results/replay-checkpoints-20261101/reproduce.md). A passing correctness suite alone does not promote checkpointing. Enabling it by default requires a repeatable CPU/allocation benefit with full-fuzzer throughput inside control variation or better.

The throughput benchmark archive precedes the depth/external-state fallback hardening. The delivery source is frozen separately and used for the final diagnostic profile. No throughput improvement is claimed for the delivery version; default-off remains the rollout decision.
