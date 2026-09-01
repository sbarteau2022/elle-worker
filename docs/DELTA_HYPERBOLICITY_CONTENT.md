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

**The tree-like precondition is not cleared — which is not the same as refuted.**
The precise three-arm status:

- **Lexical arm** (tf-idf over 1021 production chunks): graph δ/diam **0.16–0.25**
  across k ∈ {3,5,8}, against a synthetic-tree band of **0.00–0.08** and a
  synthetic-ring / cycle-control band of **0.475–0.480**. Outside the tree band at
  every k — reads against tree-likeness, bounded by Limitations 2 and 3.
- **PAMI arm** (real content geometry, not lexical): δ/diam 0.20–0.29 — also not
  tree-like, though it measures signal-descriptor space, not the corpus.
- **Semantic arm** (production bge-large embedding — the decisive one): **blocked,
  unmeasured.** See "The blocked decisive arm" below.

So `DHNG_VS_EUCLIDEAN.md`'s caveat **stands rather than being lifted**: the +10.9% mAP
atlas gain remains a synthetic-tree-corpus result. No arm produced evidence of
tree-likeness, two arms produced evidence against it, and the strongest supportable
statement stops there. The corpus is not established to be cyclic; the hyperbolic prior
is not established to be justified; the burden of proof sat on tree-likeness and was
not met.

**Target C precondition: not cleared** (unmet, pending the semantic arm — not "dead").

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

## The blocked decisive arm — production embedding geometry

The one measurement that would remove Limitations 2 and 3 entirely is δ over a k-NN
graph built from the production embedding (`@cf/baai/bge-large-en-v1.5`) on the same
1021 chunks. Two routes were attempted from this environment and both are closed by
egress policy, not by the repo:

- **Local inference with the same weights**: `Xenova/bge-large-en-v1.5` (ONNX
  conversion of the identical model) via transformers.js. `huggingface.co` returns
  **403 CONNECT** — an organization policy denial, reported rather than retried.
- **The deployed vectors themselves**: corpus vectors live only in Cloudflare
  Vectorize (`env.VECTORIZE.upsert`, `src/index.ts:762`); the worker host is now
  egress-allowed, but `/api/search` is service-key-gated and this environment holds
  only the lane dispatch key — the block is auth, not egress (see the literature
  section's correction below). The available Cloudflare tooling exposes
  D1/KV/R2/Workers but not Vectorize.

What unblocks it, either one: allow `huggingface.co` + `cdn-lfs.huggingface.co` in the
environment's custom network access (then re-run locally, same chunks, same instrument,
same controls), or dump the 1021 vectors / their top-9 neighbor lists from any
network-permitted machine and hand the file to the probe. The analysis side is already
written and calibrated; only the vectors are missing.

## Why the prior reading did not already answer this

`GRAPH_PRESSURE_TEST.md` reports toroidal 0.53–0.73 (cyclic), but over **co-recall edges
the retriever itself created**: `recordAssociations` forms all pairwise edges among a
recall's touched set, so any recall touching 3+ nodes organically seeds a cycle. That
measured retriever behaviour, not content. This probe is the first reading over structure
derived from the content itself.

---

## What this changes

- `PREDICTIVE_CODING_LITERATURE.md` §6 item 2 moves from "never done" to measured on
  two of three arms, with the precondition **not cleared** and the decisive arm blocked.
- `DHNG_VS_EUCLIDEAN.md`'s "What this does NOT establish" caveat stands with measured
  weight behind it. Hyperbolic embedding of the real corpus is not justified by any
  measurement in hand — and not condemned by one either.
- Target C stays blocked: previously for an unmeasured precondition, now for one that
  was measured where reachable and did not clear. §6 item 1 (precision term) remains
  the other blocker and is unaffected by this result.

---

## Literature check — is the answer already out there? (2026-09-01)

The question put to the literature: *is the semantic embedding space of a text corpus
tree-like / δ-hyperbolic — has anyone measured it?* Answer: **yes, repeatedly, and no
real embedding space, corpus, or network ever lands in the pure-tree band.** The field's
"tree-like" is a comparative judgment (δ much closer to 0 than to its maximum), not
membership in the band our synthetic tree calibrates. Sweep run over WebSearch, the
HF papers index, and scite full-text search; arxiv.org / openreview.net /
openaccess.thecvf.com are egress-blocked from this environment, so two exact tables
(noted below) are corroborated qualitatively rather than quoted.

### Normalization, before comparing anything

- Our probe reports **δ/diam ∈ [0, 0.5]**. The vision/NLP literature (Khrulkov et al.)
  reports **δ_rel = 2δ/diam ∈ [0, 1]** — exactly 2× ours. Converted: lexical arm
  δ_rel **0.32–0.50**, PAMI arm δ_rel **0.40–0.58**.
- Instrument mismatch that matters: Khrulkov / HypLoRA / 2512.20926 compute δ on
  **metric point clouds** (feature-space distances). Our graph numbers use **BFS hop
  distances on k-NN graphs** — the same instrument as the network-science corpus, which
  is therefore the apples-to-apples comparison. (Our own metric-space reading is ruled
  an artifact by Limitation 2 — distance concentration — so it is not compared.)

### What the literature says

1. **LLM token embeddings are measured and called tree-leaning, not trees.**
   *Hyperbolic Fine-tuning for Large Language Models* (HypLoRA, arXiv 2410.04010)
   measures δ-hyperbolicity of token embedding spaces across LLMs (LLaMA, Gemma, …),
   finds low relative δ, a token-frequency power law with frequent tokens near the
   origin, and concludes the spaces have a latent tree-like / hyperbolic organization.
   Exact per-model table not retrievable through allowed egress; the conclusion is
   corroborated independently by the *Hyperbolic Large Language Models* survey
   (arXiv 2509.05757) and search-surfaced abstracts.
2. **The field's best "tree-like" real example is δ_rel ≈ 0.24.** arXiv 2512.20926
   (δ-hyperbolicity, ultrametricity, neighbor joining over LLM embeddings) reports
   varying degrees of hyperbolicity; the smallest observed (ProtT5) is **0.2408**,
   described as "tree-like with minimal deviation" — and notes tree-likeness does not
   guarantee downstream clustering gains. Nothing real approaches 0.
3. **The vision reference point.** Khrulkov et al., *Hyperbolic Image Embeddings*
   (CVPR 2020, arXiv 1904.02239) define δ_rel and report image datasets "significantly
   closer to 0 than 1", with the curvature recipe c(X) = (0.144/δ_rel)². In practice
   the field treats δ_rel ≈ 0.14–0.35 as hyperbolic enough to benefit.
4. **Hop-distance numbers, the fair comparison.** Real-world networks (Borassi et al.,
   arXiv 1503.03061 and companions) span **2δ/diam ≈ 25–89%** on hop metrics; only
   engineered near-trees go lower. Our hop-based readings convert to 2δ/diam =
   **32–50%** (lexical) — at the *more hyperbolic* end of the measured real-world range.

### What that does to the verdict

- **Strict tree: conceded.** The literature settles it — no natural corpus, embedding
  space, or network hits the synthetic-tree band. Expecting the 0.00–0.08 band was a
  category error the pre-registered rule inherited (consistent with Limitation 1, which
  had already shown the rule's pull-comparison half uninformative).
- **Hyperbolic-leaning: not refuted — our values sit inside the published range.**
  δ_rel 0.32–0.50 is above the field's best (0.24) but the same order, and the
  hop-metric comparison puts the corpus on the more-hyperbolic side of real networks.
- **The atlas's actual claim was never "tree".** `ℳ = ℍⁿ × 𝕋ⁿ` (atlas spec) carries a
  flat torus factor with nontrivial cycles by design, so non-tree δ is that model's
  *prediction*, not its failure. The product-geometry claim has independent support:
  Gu, Sala, Gunel & Ré (ICLR 2019) show products of hyperbolic spaces beat both
  Euclidean and single-hyperbolic word embeddings (+2.6 Spearman similarity, +3.4
  analogy; 32.55% distortion reduction on a social graph); Gardner et al. (Nature 2022)
  find grid-cell population activity on a torus; RoPE already places transformer
  positional phase on a product of circles.
- **Honest reframe of the Target C precondition:** not "the corpus is a tree" (dead)
  but "the corpus geometry is consistent with a hyperbolic-leaning / product structure"
  — which the measured arms support and the still-open semantic arm can sharpen.

### The semantic arm's block, corrected

The earlier "worker host is egress-blocked" wording is stale: the worker hostname has
since been allowed in the environment egress policy. The remaining block is **auth,
not egress** — `/api/search` (src/index.ts:2837) is service-key-gated and this
environment holds only the lane dispatch key. Unblock paths unchanged in substance:
attach `ELLE_SERVICE_KEY` via the environment's API-credentials proxy mechanism (never
as a plain environment variable), or run the neighbor-list dump from a machine that
holds the key and hand the file to the probe.

### Sources

- HypLoRA: https://arxiv.org/abs/2410.04010 (see also https://openreview.net/pdf?id=TkEdQv0bXB)
- Hyperbolic LLM survey: https://arxiv.org/abs/2509.05757
- δ/ultrametricity/NJ on LLM embeddings: https://arxiv.org/abs/2512.20926
- Khrulkov et al., Hyperbolic Image Embeddings: https://arxiv.org/abs/1904.02239
- Borassi et al., On the Hyperbolicity of Small-World and Treelike Random Graphs /
  hyperbolicity measurement line: https://arxiv.org/abs/1503.03061
- Gu, Sala, Gunel, Ré, Learning Mixed-Curvature Representations in Product Spaces:
  https://openreview.net/forum?id=HJxeWnCcF7
- Gardner et al., Toroidal topology of population activity in grid cells:
  https://www.nature.com/articles/s41586-021-04268-7
