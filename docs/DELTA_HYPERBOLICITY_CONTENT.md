# δ-hyperbolicity on content-derived structure

Closes the standing precondition recorded in `PREDICTIVE_CODING_LITERATURE.md` §6 item 2
("Measure delta-hyperbolicity on content-derived structure. Still never done. Still the
stated Target C precondition.") and the caveat in `DHNG_VS_EUCLIDEAN.md`
("δ-hyperbolicity has still never been measured on real corpus content").

Probes: `docs/delta_content_probe.cjs` (measurement, pre-registered before the first run),
`docs/delta_content_scrutiny.cjs` (calibration of the probe's own pipeline against known
shapes, written after the first run but before interpreting it). Both are deterministic
and repo-only — no network, no external dependency. Re-run with `node docs/<file>`.

---

## Verdict

**The corpus's content-derived structure does not read as tree-like.** Graph
δ/diam sits at **0.16–0.25** across k ∈ {3,5,8}, against a synthetic-tree band of
**0.00–0.08** and a synthetic-ring / cycle-control band of **0.475–0.480**. It is
between the two, nearer the tree end at k=3, but outside the tree band at every k.

So `DHNG_VS_EUCLIDEAN.md`'s caveat **stands rather than being lifted**: the +10.9% mAP
atlas gain remains a synthetic-tree-corpus result, and "if the real graph is cyclic, none
of the above transfers" is now the measured case, not the hypothetical one.

**Target C precondition: does not clear.**

Two limits bound how hard that verdict can be stated; both are recorded below, and
neither is an argument — each was itself measured.

---

## Instrument validation (hard assertions, all passed)

The shipped instruments are `deltaHyperbolicity` and `curvatureSignature`
(`src/structure.ts`). Four graphs with hand-derivable answers:

| control | δ median (spread) | δ/diam | expectation |
|---|---|---|---|
| balanced binary tree, n=511 | 0 (0–0) | 0.0000 | δ=0 — **asserted** |
| clique K32 | 0 (0–0) | 0.0000 | δ=0 — **asserted** (δ=0 ≠ tree) |
| cycle C64 | 15 (15–16) | 0.4688 | δ/diam ≥ 0.3 — **asserted** (theory ≈ 0.5) |
| torus 23×23 | 10 (9–10) | 0.4545 | reported, not asserted |

The clique control is the one that matters for reading the result: δ=0 holds for a tree
*and* for a clique, so a low δ alone is not evidence of hyperbolicity. δ/diam is the
discriminating quantity, and the controls bracket it.

`deltaHyperbolicity` samples the lexicographically first 32 node names, not a random
sample; every measurement below is therefore run over R seeded relabelings
(`0xA11C0DE0–4`) so the sample is effectively random. A sample=64 sensitivity check at
k=5 moved δ from 4 to 4.

---

## Arm 1 — real corpus, production chunker, tf-idf k-NN

`corpus/**/*.md` — 51 files, 1.2 MB, 157,970 words → **1021 chunks** by the production
`semanticChunks` (extracted verbatim from `src/index.ts` at runtime and transformed, so
there is no chunker drift between this probe and production). tf-idf cosine similarity,
symmetrized k-NN, R=5 relabelings.

| k | \|E\| | comps | giant | diam | δ median (spread) | **δ/diam** | hyperbolic pull | toroidal pull | cycle_rank |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 2000 | 3 | 95.7% | ≈28 | 4.5 (3.5–5.5) | **0.1607** | 0.0849 | 0.9151 | 982 |
| 5 | 3370 | 1 | 100.0% | ≈14 | 3.5 (3.5–4) | **0.2500** | 0.0630 | 0.9370 | 2350 |
| 8 | 5389 | 1 | 100.0% | ≈10 | 2.5 (2.5–2.5) | **0.2500** | 0.0513 | 0.9487 | 4369 |

Direct metric 4-point δ on the angular distances (no graph in the loop): δ/diam median
**0.0361**. That number is *not* usable as evidence of tree-likeness — see Limitation 2.

## Arm 2 — PAMI content geometry (post-S1 radial-squash fix, post-S2 torus-aware bridge)

120 real `pamiIndex` outputs across 4 signal families × 30 seeds (`0xDE17A000+`), 0 nulls,
k-NN over `pamiDistance`, R=3.

| k | \|E\| | comps | giant | diam | δ median | δ/diam | hyperbolic | toroidal |
|---|---|---|---|---|---|---|---|---|
| 3 | 258 | 3 | 50.0% | ≈10 | 2 | 0.2000 | 0.1337 | 0.8663 |
| 5 | 411 | 3 | 50.0% | ≈7 | 2 | 0.2857 | 0.0875 | 0.9125 |
| 8 | 639 | 3 | 50.0% | ≈5 | 1 | 0.2000 | 0.0843 | 0.9157 |

Metric 4-point δ/diam on `pamiDistance`: 0.1406. Also not tree-like. The **50% giant
component at every k** is a second finding worth flagging on its own: PAMI descriptors of
different signal families do not connect to each other under nearest-neighbour linking at
any k tried — the space is separating families, not embedding them in one manifold.

---

## Limitation 1 — half my own pre-registered verdict rule is uninformative

The pre-registered rule read: TREE-LIKE iff for every k and every relabeling
`suggested.hyperbolic > suggested.toroidal` **and** median δ/diam < cycle-control/2.

The first clause is dead. `curvatureSignature` computes
`toroidal = b₁/(b₁ + components)`, and a symmetrized k-NN graph always has cycle rank
b₁ = |E| − n + c ≫ c. The toroidal pull therefore sits near 1 for *any* k-NN graph,
whatever the underlying shape.

That is an argument; here is the measurement. `delta_content_scrutiny.cjs` runs the
**identical** pipeline (same tokenizer, same tf-idf, same `knnEdges`, same relabelings,
same shipped instruments) over two synthetic corpora of known shape — a 255-node binary
topic tree with path-vocabulary inheritance, and a 200-topic ring with a ±2 window:

| corpus | k | δ/diam | hyperbolic | toroidal |
|---|---|---|---|---|
| **TREE** (n=255) | 3 | 0.0000 | 0.3622 | 0.6378 |
| | 5 | 0.0500 | 0.1766 | 0.8234 |
| | 8 | 0.0833 | 0.1235 | 0.8765 |
| **RING** (n=200) | 3 | 0.4773 | 0.0186 | 0.9814 |
| | 5 | 0.4750 | 0.0186 | 0.9814 |
| | 8 | 0.4800 | 0.0188 | 0.9812 |

`hyperbolic pull ever > toroidal pull` — **false on the tree corpus too.** The rule cannot
return TREE-LIKE for a corpus that *is* a tree by construction. It is reported here as
uninformative rather than quietly dropped or rewritten, and the verdict above rests on the
δ/diam clause alone — which does discriminate cleanly (tree 0.00–0.08, ring 0.475–0.480).

## Limitation 2 — tf-idf distances on this corpus are pathologically concentrated

Over 199,839 randomly sampled chunk pairs (seed `0xA11C0DE8`), real-corpus tf-idf angular
distances: p1 0.4387, p5 0.4661, p25 0.4806, p50 0.4863, p75 0.4908, p95 0.4955,
p99 0.4975. **IQR/median = 0.0210.**

Chunks are near-orthogonal and nearly equidistant. When all pairwise distances are nearly
equal, all three quadruple sums in the Gromov 4-point condition are nearly equal and the
metric δ collapses toward 0 *mechanically*, independent of shape. That is why Arm 1's
metric δ/diam of 0.0361 — lower than even the synthetic tree's 0.0755, while its graph
δ/diam is well above the tree's — cannot be read as hyperbolicity, and cannot be used to
overturn the graph reading.

It also bounds the verdict in the other direction: a similarity signal this weak may not
be strong enough to carry a shape verdict at all. The CYCLIC-OR-MIXED reading is stated
as "does not clear the tree-like precondition", not as "the content is a torus".

## Limitation 3 — tf-idf is a lexical proxy for the production embedding

Production similarity edges come from `@cf/baai/bge-large-en-v1.5` (Workers AI, network).
The repo-only constraint forbids that, so tf-idf cosine stands in. This was pre-registered
as a limitation before the first run, not discovered afterwards. The production embedding
could plausibly be less concentrated than tf-idf; whether it is also less cyclic is
unmeasured and would need a network-permitted run to settle.

## Why the prior reading did not already answer this

`GRAPH_PRESSURE_TEST.md` reports toroidal 0.53–0.73 (cyclic), but over **co-recall edges
the retriever itself created**: `recordAssociations` forms all pairwise edges among a
recall's touched set, so any recall touching 3+ nodes organically seeds a cycle. That
measured retriever behaviour, not content. This probe is the first reading over structure
derived from the content itself.

---

## What this changes

- `PREDICTIVE_CODING_LITERATURE.md` §6 item 2 moves from "never done" to measured, with
  the precondition **failing**.
- `DHNG_VS_EUCLIDEAN.md`'s "What this does NOT establish" caveat is now confirmed, not
  pending. Hyperbolic embedding of the real corpus is not justified by its measured shape.
- Target C stays blocked, now for a measured reason rather than an unmeasured one. §6
  item 1 (precision term) remains the other blocker and is unaffected by this result.
