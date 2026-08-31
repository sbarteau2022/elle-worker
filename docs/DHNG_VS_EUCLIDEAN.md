# DHNG vs Euclidean recall — what actually wins, and where

Measured 2026-08-30. Harness archived at `docs/experiments/dhng_bench.test.ts.txt`.
Read `docs/PSI_ENCODER_FINDING.md` first — it establishes why ψ cannot be the
placement function.

## The honest headline

A jointly-fit hyperbolic atlas beats the live retriever **only at high dimension,
and only where relevance sits farther away than the retriever's traversal reaches.**
It is not a general replacement. It is a second tier that covers the case
spreading activation structurally cannot.

## Setup

1,093-node derivation tree, content inherited parent→child with drift, relevance
defined by the **tree** (whole grandparent subtree — 3–6 hops apart), never by any
metric under test. 303 queries.

Baselines, in ascending order of fairness:

| Arm | What it is |
| --- | --- |
| A | bare cosine on content — **a strawman**, listed only to show how misleading it is |
| B | cosine + 2-hop spreading activation — **the real incumbent**, what `graphExpand` does |
| C | `hyperMap` jointly fit on the **same** edges, swept over dimension |
| D | **ablation** — `hyperMap` on shuffled edges |

## Result

    A  bare cosine (strawman)              0.0564
    B  cosine + 2-hop expansion  <- REAL   0.3245

    dim | hyperMap | ablated | structure | radial spread | vs REAL
      2 |  0.0931  | 0.0522  |  0.0409   |    2.744      | -71.3%
      4 |  0.1217  | 0.0532  |  0.0685   |    2.609      | -62.5%
      8 |  0.1428  | 0.0544  |  0.0884   |    0.840      | -56.0%
     16 |  0.2009  | 0.0536  |  0.1473   |    0.482      | -38.1%
     32 |  0.2710  | 0.0531  |  0.2179   |    0.373      | -16.5%
    128 |  0.3600  | 0.0535  |  0.3065   |    0.151      | +10.9%

**The ablation is clean.** Shuffled edges score 0.0535 against 0.3600, so structure
carries 85% of the score. Contrast `PSI_ENCODER_FINDING.md` §2, where the
depth-in-radius "fix" ablated to within 2% of itself and was therefore fake.

## Two corrections to earlier claims, both mine

**A weak baseline produced a +202% figure.** With arm B at 1-hop instead of 2-hop,
`hyperMap` measured +202.3%. Strengthening the baseline to what `graphExpand`
actually does collapsed it to +2.8% on that corpus. The 202% was a strawman win —
the same error `RETRIEVAL_STATUS.md` warns about. Quote the +10.9%, and only for
the wide-relevance regime.

**Low dimension is worse, not better.** Hyperbolic embedding is usually sold on
low-dimensional efficiency, and radial spread does collapse as dimension rises
(2.744 → 0.151). Both facts are true and both are irrelevant to quality here:
mAP rises monotonically with dimension anyway. The signal in a jointly-fit atlas
is not confined to the radius.

## What changed in the code

- `hyperMap` default `dim` **2 → 128**. At 2 the atlas is 71% *worse* than the
  retriever it augments, so the old default shipped it in the regime where it loses.
- Dimension clamp **16 → 512**, node cap **256 → 20,000**, edge cap **2,048 →
  200,000**. All three silently truncated rather than erroring; Target C's own
  acceptance fixture is 500 nodes, past the old node cap.
- Malformed edges (missing `weight`/`kind`) propagated **NaN** through the
  gradient and completed with `loss = NaN` and every point at the origin — a
  degenerate atlas that read as a successful one. Now coerced, with a regression
  test.

## What this does NOT establish

- The corpus is synthetic and tree-shaped. δ-hyperbolicity **has now been measured
  on real corpus content** (`DELTA_HYPERBOLICITY_CONTENT.md`) and it does **not**
  read as tree-like: graph δ/diam 0.16–0.25 across k ∈ {3,5,8}, against a
  synthetic-tree band of 0.00–0.08 and a ring/cycle band of 0.475–0.480. The
  earlier `GRAPH_PRESSURE_TEST.md` reading (also cyclic) was over co-recall edges
  the retriever itself created and did not settle this; the new one is over
  structure derived from the content. **So the conditional above has fired: the
  real structure is cyclic-or-mixed, and none of the above transfers.** The +10.9%
  mAP gain stands as a synthetic-tree-corpus result only. Two measured caveats
  bound how hard that is stated — see that doc's Limitations 1–3.
- +10.9% on 303 synthetic queries is not a production result. It justifies
  building the held-out benchmark; it does not substitute for one.
- Cost is unpriced here. A 128-dim atlas over a real memory graph carries the
  storage and query-time consequences the siege raised (`L4W-ATLAS-FULLSCAN-01`),
  which a 10.9% mAP gain may or may not justify.
