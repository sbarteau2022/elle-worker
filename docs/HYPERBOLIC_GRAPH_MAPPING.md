# HYPER — Hyperbolic Neural Graph Mapping

*The formalization behind `src/hyper.ts`. This is the working math document: the
implemented system is exactly what is written here, and every open question is
listed at the bottom so the formalization work has a live target.*

## 0. Where it sits in the pipeline

```
stream ──▶ PFAR rip ──▶ fingerprint ┐
image  ──▶ vFAR rip ──▶ fingerprint ├──▶ encoder ψ ──▶ point in 𝔹ⁿ ┐
signal ──▶ PAMI      ──▶ index      ┘                              ├──▶ hyperMap ──▶ atlas
memory graph (graph.ts) ──▶ typed weighted edges ──────────────────┘
```

The rippers turn raw inputs into structural fingerprints; the graph kernel
holds typed, weighted edges between memories. HYPER is the stage after both:
one geometry in which "how alike are these structures" and "which is more
general" are the same kind of question — a distance and a radius.

Hyperbolic space is the right container because its volume grows exponentially
with radius, matching the exponential growth of nodes with depth in a tree.
A tree embeds in the hyperbolic plane with arbitrarily low distortion; it does
not embed in any Euclidean space of fixed dimension (Sarkar 2011). The memory
graph is tree-*ish* — provenance kinds (`causal`, `derived`, `refines`,
`supersedes`) form a DAG of derivation with associative cross-links — which is
exactly the regime where hyperbolic embeddings beat Euclidean ones (Nickel &
Kiela 2017).

## 1. The space

We use the Poincaré ball of curvature −1:

$$\mathbb{B}^n = \{\, x \in \mathbb{R}^n : \lVert x \rVert < 1 \,\},
\qquad g_x = \lambda_x^2\, g^E, \quad \lambda_x = \frac{2}{1-\lVert x\rVert^2}.$$

**Möbius addition** (the ball's group operation):

$$u \oplus v = \frac{(1 + 2\langle u,v\rangle + \lVert v\rVert^2)\,u + (1-\lVert u\rVert^2)\,v}{1 + 2\langle u,v\rangle + \lVert u\rVert^2 \lVert v\rVert^2}.$$

**Geodesic distance:**

$$d(u,v) = \operatorname{arcosh}\!\left(1 + \frac{2\lVert u-v\rVert^2}{(1-\lVert u\rVert^2)(1-\lVert v\rVert^2)}\right)
        = 2\operatorname{artanh}\lVert (-u) \oplus v \rVert.$$

**Depth** (radial coordinate — the hierarchy readout):

$$\rho(x) = d(0, x) = 2 \operatorname{artanh}\lVert x \rVert.$$

**Exponential / logarithmic maps at the origin** (the door between the flat
tangent space, where the encoder works, and the ball):

$$\exp_0(t) = \tanh(\lVert t\rVert)\,\frac{t}{\lVert t\rVert},
\qquad \log_0(y) = \operatorname{artanh}(\lVert y\rVert)\,\frac{y}{\lVert y\rVert}.$$

Numerics: all points are kept strictly inside the ball by the retraction
$\Pi(x) = x \cdot \min\!\big(1, (1-\varepsilon)/\lVert x\rVert\big)$ with
$\varepsilon = 10^{-5}$.

## 2. The encoder ψ: fingerprint → point

[MEASURED] `ripVector` produces 29-dimensional input features by default (`RIP_DIM = 29`). PAMI-like inputs use `pamiBridgeVector`, truncated or zero-padded to the requested feature width. Other reports contribute up to 512 finite numeric leaves in sorted-key order. Each path hashes to a unit direction; its value contributes `tanh(sign(v) * log(1 + abs(v)))` times that direction. If the resulting sum is u with finite norm n > 0, the feature vector is `u * tanh(n) / n`; the zero vector remains zero. This replaces the old hard clamp that erased radial variation.

[MEASURED] Input feature width and fitted manifold dimension are separate: `hyperMap` defaults to 128 manifold coordinates. A 1024-wide consumer must adapt at its own boundary. See `src/hyper.ts` and `PSI_ENCODER_FINDING.md`.

[OPEN] These transformations are instrumentation. They do not establish geometry-specific retrieval benefit on real content; the old fixed-radius encoder's failure cannot be repaired by relabelling its dimensions.

## 3. The mapping: Riemannian optimization

Given nodes $V$ (optionally carrying features) and typed weighted edges $E$
from the memory graph, find an atlas $X = \{x_i\}_{i \in V} \subset \mathbb{B}^n$
minimizing

$$\mathcal{L}(X) =
\underbrace{\sum_{(u,v,k,w) \in E} \hat w \,\big(d(x_u, x_v) - \delta(\hat w)\big)^2}_{\text{attraction to a target distance}}
\;+\;
\underbrace{\sum_{(u,v') \in \mathcal{N}} \max\big(0,\; \mu - d(x_u, x_{v'})\big)^2}_{\text{margin repulsion (negative samples)}}
\;+\;
\lambda_h \underbrace{\sum_{(u,v,k) \in E_h} \max\big(0,\; m + r_u - r_v\big)^2}_{\text{provenance depth}}$$

with:

- **Edge strength** $\hat w = \min\!\big(1, \tfrac{w \cdot c(k)}{2}\big)$, where
  $w$ is the stored edge weight (reinforced by co-recall, capped at 4) and
  $c(k)$ the kind's conductance from `graph.ts` — the same constants that
  govern spreading activation, so the geometry and the traversal cannot drift
  apart.
- **Target distance** $\delta(\hat w) = \delta_{\text{far}} - (\delta_{\text{far}} - \delta_{\text{near}})\,\hat w$,
  with $(\delta_{\text{near}}, \delta_{\text{far}}) = (0.3, 1.6)$: a strong,
  conductive edge wants its endpoints ~0.3 apart; a weak one is content at 1.6.
- **Negative set** $\mathcal{N}$: per edge and epoch, a few uniformly sampled
  (seeded PRNG) non-neighbors of $u$, pushed out past margin $\mu = 2.4$.
- **Provenance depth**: $E_h \subset E$ are the directed derivation kinds
  {`causal`, `derived`, `refines`, `supersedes`}. $r_x = \lVert x \rVert$ is
  the Euclidean radius (monotone in true depth $\rho$, cheaper to
  differentiate). The hinge with margin $m = 0.08$ demands the consequent
  (dst) sit strictly farther from the origin than its antecedent (src):
  derivation depth becomes radial depth. $\lambda_h = 1$.

**Optimizer** — Riemannian SGD with retraction (Nickel & Kiela):

$$x \;\leftarrow\; \Pi\!\left(x - \eta_t \cdot \frac{(1-\lVert x\rVert^2)^2}{4} \, \nabla^E_x \mathcal{L}\right),$$

where $\frac{(1-\lVert x\rVert^2)^2}{4} = \lambda_x^{-2}$ is the inverse
metric (Euclidean gradient → Riemannian gradient), and $\eta_t$ anneals
linearly from $\eta_0 = 0.05$ to $0.1\,\eta_0$. The Euclidean gradient of the
distance is closed-form:

$$\frac{\partial d(u,v)}{\partial u}
= \frac{4}{\beta\sqrt{\gamma^2 - 1}}
\left( \frac{\lVert v\rVert^2 - 2\langle u,v\rangle + 1}{\alpha^2}\, u - \frac{v}{\alpha} \right),
\qquad
\alpha = 1 - \lVert u\rVert^2,\;\; \beta = 1 - \lVert v\rVert^2,\;\;
\gamma = 1 + \frac{2\lVert u - v\rVert^2}{\alpha\beta},$$

verified in `hyper.test.ts` against numeric differentiation.

**Initialization.** A node with features starts at $\psi(f)$ (plus a
deterministic id-hash jitter of norm 0.01 to break ties); a bare node starts
at an id-hashed direction of radius 0.1. So features *place* and edges
*refine* — a new fingerprint has a home before the graph has opinions about it.

**Determinism and bounds.** No `Math.random` anywhere: seeded mulberry32
throughout, so the same (nodes, edges, options) always yields the identical
atlas. Caps: 20,000 nodes, 200,000 edges, 1,000 epochs, dim ∈ [2, 512] (default 128). `hyperMapCapacity()` reports dropped input so callers can distinguish a complete atlas from clipped input.
Cost is $O(\text{epochs} \cdot |E| \cdot (1 + \text{negs}) \cdot n)$ — bounded
by construction, Worker-safe.

## 4. Readouts

- **Depth** $\rho(x_i) = 2\operatorname{artanh}\lVert x_i\rVert$: generality.
  Small = central/general (an anchor memory many things derive from); large =
  peripheral/specific (a leaf observation).
- **Neighbors**: $k$ nearest by geodesic distance — structural kinship that
  respects hierarchy (two leaves of different subtrees are *far* even when
  their Euclidean coordinates are close, because the geodesic detours toward
  the origin).
- **Locate** (fold-in): a new fingerprint is placed at $\psi(f)$ against a
  stored atlas without re-fitting — an $O(|V|)$ query. Honest caveat returned
  with the result: the encoder places it, edges haven't pulled it; re-map to
  integrate it properly.

## 5. The tool surface

`hyper(mode, …)` — same router shape as `pfar`/`vfar`:

| mode | in | out |
|---|---|---|
| `map` | `nodes[]` (id, `rip` or `features`), `edges[]` (src, dst, kind, weight), `dim`, `epochs`, `seed` | depth stats, most-central + deepest nodes, atlas stored at `/hyper/<id>.json` (`store:false` inlines the points) |
| `locate` | `map_path`, `rip` or `features[]`, `k` | the point, its depth, nearest atlas neighbors |
| `neighbors` | `map_path`, `id`, `k` | k nearest by geodesic distance |
| `dist` | `a`, `b` (points, or atlas ids with `map_path`) | geodesic distance + both depths |

The numeric core never touches a model; `interpret` (map only, default true)
lays one LLM reading over the shape statistics, same contract as the rippers —
the geometry stands on its own if synthesis is unreachable.

## 6. Open questions (the live formalization work)

1. **Curvature.** Fixed at $c = 1$. Making $c$ (or per-map curvature learned
   from the graph's δ-hyperbolicity) a parameter changes the depth scale;
   Gromov δ of the actual memory graph would tell us what curvature it wants.
2. **Model choice.** The Poincaré ball is numerically fragile near the
   boundary (we retract at $1 - 10^{-5}$). The Lorentz/hyperboloid model
   (Nickel & Kiela 2018) is stabler for deep hierarchies and has a cleaner
   exponential map; the geometry seam here (`poincareDist`/`distGrad`) is
   where it would swap in.
3. **The encoder.** ψ is a fixed random-feature map. The trained version —
   a small $W$ learned so that $d(\psi(f_u), \psi(f_v))$ predicts edge
   strength on held-out edges — would let *new* fingerprints land near their
   true neighborhood without re-mapping. That is the actual "neural" claim,
   and it needs a training corpus of (fingerprint, edge) pairs first.
4. **Target-distance schedule.** $\delta(\hat w)$ is linear in edge strength.
   A principled alternative: $\delta = -\log(\hat w)$-style, so weight
   composes multiplicatively along paths the way conductance does in
   spreading activation.
5. **Hinge coordinate.** The depth hinge uses Euclidean radius $r$ rather
   than true depth $\rho$; monotone-equivalent for the constraint, but the
   margin $m$ therefore means different amounts of $\rho$ at different radii.
   Restating the hinge in $\rho$ makes the margin uniform at the cost of a
   $\lambda_x$ factor in the gradient.
6. **Evaluation.** Add mean distortion and mAP-of-reconstruction (the N&K
   metrics) to `stats` so a mapping's quality is a number, not a vibe.

## References

- M. Nickel, D. Kiela — *Poincaré Embeddings for Learning Hierarchical
  Representations*, NeurIPS 2017.
- M. Nickel, D. Kiela — *Learning Continuous Hierarchies in the Lorentz Model
  of Hyperbolic Geometry*, ICML 2018.
- R. Sarkar — *Low Distortion Delaunay Embedding of Trees in Hyperbolic
  Plane*, Graph Drawing 2011.
- O. Ganea, G. Bécigneul, T. Hofmann — *Hyperbolic Neural Networks*, NeurIPS
  2018 (the Möbius operations used by the encoder seam).
