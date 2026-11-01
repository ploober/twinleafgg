# Conformance state snapshots

Conformance Stores select their snapshot backend through `createConformanceStore`.
`CONFORMANCE_STATE_SNAPSHOTS=legacy` is the default: a copier specialized for the
existing Card/StateLog sharing rules. Ordinary gameplay and bot Stores retain the
original generic legacy backend. General-purpose `deepClone` is unchanged.

`CONFORMANCE_STATE_SNAPSHOTS=graph` enables the experimental stable-prototype
backend. Other values fail startup. Graph snapshots passed response comparisons
and correctness tests but regressed Graviton throughput, so they are **not** the
default. Use `legacy` to roll back graph experiments immediately.

Both backends capture state and effect with one reference context and preserve
attack identity pins. Cards, functions and append-only StateLog entries stay
shared; mutable containers are copied. Arrays retain legacy `.map` semantics,
including holes and independent copies of repeated array references. Object
cycles and aliases use the reference context. Probe dispatch restores shared Card
scalar values on success and failure.

The graph backend uses class prototypes and lightweight lineage handles instead
of retaining source instances. Unsupported shapes fall back for the entire
capture, preserving state/effect aliasing and provenance. Set
`CONFORMANCE_SNAPSHOT_DIAGNOSTICS=1` to collect graph capture counts, duration and
fallback reasons by site through `snapshotDiagnostics()`; keep this off when
measuring throughput.

Graph menu captures can carry a single-use Card inventory. `setProbeSnapshot` is
an internal workflow: callers may mark the inventory safe only when dispatch
immediately follows capture without structural changes. Preparation callbacks
must disable the inventory. State assignment and ordinary dispatch invalidate it;
probe dispatch consumes it and captures scalar values at dispatch entry. Later
probes traverse the graph normally.

The measured candidate retains the faster legacy copier and avoids entry-tuple
allocation during scalar collection. It still makes whole-state copies and
retains legacy prototype ancestry. Reducing the number of snapshots is separate
future work; no pooling, mutable snapshot reuse, copy-on-write, GC flag tuning or
replay checkpoints are introduced here.

The evidence bundle is in the conformance harness repository at
`results/state-cloning-gc-20261031/`, including frozen source archives, complete
response hashes, ABBA results, ten-minute profiles and `report.md`.
