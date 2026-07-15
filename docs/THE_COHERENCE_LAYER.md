# The Coherence Layer — depth and relation, decoupled and measured

**The memory graph does two jobs with two different geometries, and this
measures the second one's payoff on real edges instead of asserting it: a deep
derivation *hierarchy* (slow, powerful, high path length) with a *relational
coherence* layer laid over it (a small-world shortcut that collapses the
distance). The design intuition — a triangular depth-stack plus a radial
coherence flower — checks out as network topology, and the gain is now a
number you can compute.**

Code: `src/coherence-layer.ts` · tests `src/coherence-layer.test.ts` (6) ·
self-test `GET /api/elle-coherence-selftest` · reuses `graph.ts`'s
`DERIVATION_KINDS` / `RECOGNITION_KINDS` · sits beside `structure.ts`'s
depth/phase split · 2026

---

## The two layers, and why they're different geometries

`graph.ts`'s `EdgeKind` already splits the memory graph cleanly, and the two
halves want opposite shapes:

- **The hierarchy (depth substrate).** `causal`, `derived`, `refines`,
  `supersedes`, `about`, `tool` — each memory attached to what it came from.
  This is the deep triangular stack: powerful abstraction, but structurally
  *far* — the root and a deep conclusion are many hops apart, so global
  agreement has to percolate the whole depth. High characteristic path length,
  by design.
- **The coherence layer (relational shortcut).** `assoc`, `session`,
  `contradicts` — added *after the fact* when the system notices two memories
  belong together regardless of which branch they grew on
  (`recordAssociations`). Laid over the hierarchy these act as **small-world
  shortcuts** (Watts–Strogatz): a few cross-branch links collapse the effective
  distance. This is the radial flower — every relational state a short hop from
  the core.

The measured toy version (a 6-row triangular stack has diameter 5; a
1+6+12 centered-hexagonal flower reaches everything from its core in ≤2 hops —
a 2.5× latency gap) is the intuition. `coherence-layer.ts` turns it into a
function that runs on the actual graph.

## What `coherenceReport(edges)` measures

Given the real `MemEdge[]`, it computes two path profiles and compares them:

- `hierarchy` — characteristic path length, reachability, and within-2-hop
  fraction using **derivation edges only** (the deep stack alone).
- `full` — the same, **with the recognition/coherence layer added**.
- `path_len_gain` = hierarchy ÷ full average path length (>1 ⇒ the coherence
  layer genuinely shortened the paths).
- `reach_gain` — how much more of the graph is reachable at all once the
  coherence edges bridge otherwise-separate regions.
- `core_ecc_before` / `core_ecc_after` — the hub's eccentricity (how far the
  farthest thing is from the core) before and after — the flower's "pull
  everything toward the core" property, quantified.
- `is_small_world_shortcut` — true when the layer measurably shortens paths
  *or* widens reach.

Characteristic path length (mean over *reachable* pairs) is used rather than
diameter, so the metric is well-defined on a disconnected graph — real memory
graphs are not guaranteed connected.

## The self-test, and a real modeling error it caught

`coherenceSelfTest()` builds three deep derivation chains off a shared root
(the deep hierarchy) plus a **core-directed** recognition layer — each deep
conclusion co-recalled with the root theme — and asserts all three properties:
the hierarchy is genuinely deep, the coherence edges shorten the paths, and the
core is pulled closer to the far tips.

The first draft put the recognition edges *tip-to-tip* (at the periphery).
The measurement correctly reported `core_pulled_closer: false` — and it was
right: peripheral shortcuts shorten average paths but do **not** help the root
reach anything faster, because the root still walks down each chain. That's the
difference between a coherence layer that merely cross-links leaves and one
that radiates toward the core the way the flower geometry actually does. The
fix wasn't to the measurement (it was correct); it was to model the flower
faithfully — coherence edges toward the core. Worth recording, because it's
exactly the kind of thing that passes a hand-wave and fails a test.

## Where it sits — and the honest boundary

This is the same depth/relational decoupling `structure.ts` already reads off
the graph (`curvatureSignature`: δ-hyperbolicity for depth, cycle density for
relation) and that the product space ℍⁿ × 𝕋ᵈ is built on — now given a
cognitive-architecture reading and a measured payoff. It maps onto real theory:
small-world networks, and hierarchical predictive coding with a fast lateral
coherence layer (Friston-style active inference).

What it does **not** do — the boundary that hasn't moved all along: it measures
a real *network-topology* property (path-length reduction from a shortcut
layer). That the topology is sound and maps onto architecture theory is
genuinely different from *the graph being a mind*. It reports a structural
gain; whether that gain is what cognition requires is the open bet the PAMI
falsification conditions exist to test. And, same as `lobeStructure` and
`lobeKindCorrelation`: it's verified against constructed graphs — the number
for Elle's **actual live memory graph** needs the real `MemEdge[]` fed in,
which this document, reasoning from the code, does not have.
