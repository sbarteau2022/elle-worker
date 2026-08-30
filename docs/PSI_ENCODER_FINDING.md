# The Leaf Encoder ψ cannot be repaired by tuning

Measured 2026-08-30. Scripts: `docs/experiments/{bench,honest,beta}.mjs`.

## 1. The shipped ψ is exactly Euclidean

`COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md` §2.2 sets
`f = Σ s(vᵢ)e(pᵢ) / max(1, ‖Σ s(vᵢ)e(pᵢ)‖)` and `ψ = tanh(0.9‖f‖)·f/‖f‖`.

Near-orthogonal unit vectors in ℝ¹⁰²⁴ give `‖Σ‖ ≈ √M·mean|s|`, which passes 1
almost immediately, so the `max(1,·)` clamp fixes `‖f‖ = 1` and therefore
`‖ψ‖ = tanh(0.9) = 0.716298` for every input.

    rho over 2000 reports shaped like §5.1 RippedFeatures
      min = median = max = 1.800000000    stddev = 6.0e-14
      100.0% within 1e-3 of the 1.80 bound
      the clamp engages from M=4 leaves (200/200); at M=2, 182/200

Every point therefore lies on one sphere. At fixed norm r,
`‖u−v‖² = 2r²(1−cos θ)`, so `d_B = arcosh(1 + 2‖u−v‖²/(1−r²)²)` is a strictly
increasing function of cosine distance:

    Spearman(d_hyperbolic, d_cosine) = 1.000000000000  (3000 candidates)
    pairwise ranking inversions                 0 / 19900

Confirmed a second time end-to-end: on a same-subtree retrieval task the
hyperbolic arm using the shipped ψ scores **0.0207 mAP — identical to plain
Euclidean cosine to four decimals**, across every corpus setting tested.

**ℍ¹²⁸ under this encoder is 128 dimensions of restated cosine similarity.**

## 2. The obvious fix is a depth ruler, not a retrieval win

Replacing the leaf-count radius with a derivation-depth radius
(`ρ = ρ₀ + β·d`, so `radial_depth = ρ` by construction) appears spectacular —
0.2216 mAP against 0.0207, a 970% relative gain, stable across content drift
and cyclic contamination.

That stability is the tell. Ablating content entirely — **random directions,
same radii** — scores 0.2175:

    Euclidean cosine (content only)        0.0207
    depth-radius psi (content + depth)     0.2216
    ABLATION random dirs + depth radius    0.2175   <- content removed
    ABLATION depth difference only         0.0179   <- no geometry

Content contributes 0.0041 mAP: **under 2% of the score.** The gain is depth
structure correlating with the label, which is exactly the confound that makes
a synthetic benchmark flatter a mechanism.

Sweeping the radial weight finds no escape:

    beta   psi mAP   ablated   content share
    0.00    0.0207    0.0185       11%     <- identical to Euclidean
    0.05    0.1645    0.1558        5%
    0.15    0.2157    0.2114        2%
    0.35+   0.2216    0.2175        2%

At β=0 it *is* cosine. Any β large enough to help swamps the angular term,
because near-orthogonal directions in high dimension make `d_B ≈ |ρ_a − ρ_b|`.
**There is no parameterization of "hashed direction + analytic radius" that
produces a content-driven improvement.** ψ cannot be tuned into working.

## 3. The machinery that does work is already in the repo

`src/hyper.ts` `hyperMap()` already implements Nickel & Kiela: Riemannian SGD
with the inverse-metric rescaling `(1−‖x‖²)²/4`, negative sampling, 300 epochs,
the analytic distance gradient. That fits radius and angle **jointly against
observed structure**, which is the only way both carry signal — precisely what
a hand-composed encoder cannot do, per §2.

§2.2 specifies a hashing projector that bypasses it.

**Proposed correction:** ψ produces input *features*; `hyperMap` produces the
manifold *coordinates*. The plan currently has ψ doing both.

## 4. What this still does not establish

- Whether Elle's real corpus is tree-like enough to profit. The only
  δ-hyperbolicity measurement in the repo (`GRAPH_PRESSURE_TEST.md`) reads
  toroidal 0.53–0.73 — cyclic — and was computed over retriever-manufactured
  co-recall edges, not corpus content.
- `hyperMap` currently clamps `dim` to `[2,16]` and caps at 256 nodes / 2048
  edges, against a plan that specifies ℍ¹²⁸ and a 500-node benchmark.
- No held-out retrieval benchmark exists, so none of this is yet measurable on
  real data. `RETRIEVAL_EVAL_001.md` is "spec only, no scoring run yet".

The benchmark above is synthetic and its labels correlate with depth by
construction. It is sufficient to prove §1 and §2 — both are statements about
the metric, not about Elle's data — and insufficient to prove any positive
claim about retrieval quality.
