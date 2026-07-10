# Retrieval status — what's live, what's a lens, what the benchmark settled

*Written after a KV-cache phase-retrieval benchmark came back negative for phase.
Records where the geometry/phase/structure stack actually sits so the
phase-as-retrieval-key question doesn't get reopened by accident.*

## The benchmark (pythia-160m, layer 8/12, block 32, k=4, n=40)

| method | mass_recall | oracle_recall |
|---|---|---|
| content_rope_SUB | **0.395** | 0.300 |
| content_raw | 0.368 | 0.237 |
| recent_window | 0.245 | 0.375 |
| phase_content | 0.179 | 0.188 |
| phase_hybrid_SUB | 0.178 | 0.100 |
| oracle | 0.862 | 1.000 |

**Verdict: phase-as-retrieval-key loses to content ~2:1, and it's significant**
(content vs phase gap ≈ 4σ at n=40). Phase even loses to the trivial recency
baseline on oracle_recall. The one pro-phase signal is that `content_rope`
(RoPE = positional phase braided into content) is the top method — so *phase
modulates content* holds, *phase replaces content* does not. content_raw vs
content_rope (0.368 vs 0.395) is within noise; only content-over-phase is
established.

## Why this does not threaten anything in production

The live retriever never uses phase or the geometric charts:

- **`memory.ts` recall** = semantic embedding (Vectorize) + importance + recency
  decay **+ `graphExpand`** (spreading activation over co-recall edges). That is
  **content + structure** — exactly the two legs the benchmark says win.
- **`graph.ts` nightly hygiene** (φ⁻ⁿ decay + captured-resonance sweep) in
  `consolidate.ts`.
- **`self-shape.ts`** → the `memory_graph_shape` facet of `self_state`.

Everything else — `pami`, `pfar`, `vfar`, `hyper`, `torus`, `product`,
`structure` — is **tool-surface only**: it runs only when Elle explicitly calls
the tool. Nothing automatic routes retrieval through phase or the charts. So the
negative result lands on a mechanism that was never on the critical path.

## PAMI is ruled out for KV retrieval (and that's correct)

PAMI is a φ-spaced complex-Morlet **wavelet transform over a 1-D residual
signal** → an 8-phase fingerprint + multifractal dims. It decodes a *time series
into phase space*. KV-cache retrieval operates on *d-dimensional key vectors per
block* — there is no 1-D frequency axis inside a single key to Morlet-transform.
PAMI structurally cannot be the phase source there, and the benchmark used a more
KV-appropriate phase extractor than PAMI *and still lost*. So the loss isn't
"wrong phase decoder" — phase underperforms content on that surface, full stop.
Do not try to force PAMI onto KV retrieval.

## Where geometry *can* earn retrieval keep — structure, not phase

The benchmark's surviving signal is that **structure** (which memories genuinely
belong together) beats content-lookup on the hard cases, and phase does not. So
the one direction with empirical wind is to weight recall by graph *structure*,
which is already the live secondary tier (`graphExpand`).

### Experiment shipped: cycle-weighted graph expansion

`graphExpand` now accepts `cycleBoost` (SpreadOpts). Over the traversed
subgraph, edges that lie on a **cycle** (recurrence — `nonBridgeEdges`, exact via
Tarjan bridge-finding) have their weight multiplied by `cycleBoost` before
spreading; **bridge** edges (pure linear derivation) are untouched. So memories
that form a recurrent loop with the seed pull harder than ones hanging off a
one-off chain — recurrence is the structural signal that survived.

- **Live setting:** `memory.ts` runs it at `GRAPH_CYCLE_BOOST = 1.3` — a mild
  ~30% boost, bounded to the graph-expansion tier (which is already secondary to
  semantic recall). **One constant reverts it** (set to `1`). Runtime-checked:
  loop members pull ~34% harder; a bridge-only memory is left exactly unchanged.
- **Why it's safe:** `cycleBoost` of 1 (or absent) is byte-for-byte the old
  behavior; the boost only reorders the *additional* graph-pulled memories, never
  the semantic hits; and cycle-membership (needs a ≥3-node loop) is orthogonal to
  the pairwise co-recall runaway the hygiene sweep suppresses.
- **Honest caveat:** there is no offline recall eval for the memory graph yet, so
  this is a *live experiment*, not a proven win. It is deliberately mild and
  trivially reversible.

### The live A/B harness (shipped — so we can actually run the test)

Every real recall now computes **both arms in one traversal** (`graphExpandAB`:
one set of DB reads, two pure spread passes — boost off vs on), serves the
boosted arm, and logs what each arm surfaced to `elle_recall_traces`
(best-effort, off the hot path's success criteria — a failed log never touches
the returned recall). Per trace we store the top-k graph-tier ids each arm
surfaced (by activation, excluding the semantic hits) and two divergences:

- **`divergence`** — *ordered positional* divergence (primary): fraction of
  positions where the two ordered top-k differ. 0 iff the served graph tier is
  unchanged. This catches a **pure reorder** (same members, boost lifts a
  recurrence memory above a bridge one) — verified end-to-end: a bridge memory
  outranking a cycle member at baseline `[farHi, B, C]` becomes `[B, C, farHi]`
  under the boost → ordered divergence 1, set divergence 0.
- **`set_divergence`** — Jaccard set distance (secondary): did *membership*
  change, not just order.

**Read it with the `recall_ab` tool** (full/cofounder scope). It aggregates the
recent traces: `changed_fraction` (how often the boost changed the tier at all),
`reorder_only_fraction` (changed order but not membership — the boost's subtle
effect), `mean_divergence` / `mean_set_divergence`, and the most-divergent
queries with both id sets for inspection.

**What it measures and what it doesn't:** IMPACT (how much / how often the boost
changes recall), not quality — there is no ground-truth recall label here.
Quality is judged by eyeballing the divergent cases in `recall_ab`, or by
correlating with a downstream usage signal once one exists. The honest live test
is: is the boost changing recall at all, in which cases, and do those changes
look better on inspection. If `changed_fraction` is ~0 over real traffic, the
boost is inert and `GRAPH_CYCLE_BOOST` should go back to 1; if it changes recall
and the divergent cases look right, it stays and we raise it.

## One-line summary

Live retrieval is content + structure (the benchmark winners); phase and the
geometric charts are optional lenses off the critical path; PAMI stays out of KV;
and the one structure-weighting experiment (cycle boost) is now live, mild, and
reversible.
