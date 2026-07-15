# Mixing Diagnostics — measuring what "bounded walk" actually does

**"Empirical mixing" was a claim, not a measurement. This corrects it: the two
questions you can ask of a dynamical walk — *do adjacent states diverge?* and
*does the orbit cover the space?* — answered with numbers, not adjectives. The
honest result is "bounded, exploratory, WEAKLY sensitive-dependent" — not a
certified ergodic flow.**

Code: `src/hyperbolic-mixing.ts` · tests `src/hyperbolic-mixing.test.ts` (6) ·
report `GET /api/elle-mixing-report` · measures `hyperbolic-sync.ts` against a
`torus-sync.ts` control · 2026

---

## The two measurements

**1. Divergence of adjacent states — largest Lyapunov exponent (Benettin
method).** Seed two trajectories ε apart under the *same* heading schedule,
advance both, accumulate `log(separation/ε)`, and renormalize the perturbation
back to ε each step so it never saturates. Separation is measured in
**hyperbolic** distance — the intrinsic metric. `λ > 0` is sensitive dependence,
the signature of mixing. Negative curvature makes nearby geodesics diverge
exponentially, so a positive λ is the curvature showing up as a number.

**2. State-space coverage.** Bin the reachable disk (radius R) into a grid,
count occupancy over a long run, and report the visited-cell fraction and the
occupancy coefficient of variation (CV). Broad coverage with low CV = uniform
fill; broad coverage with high CV = clumped.

## The measured numbers (deterministic, reproducible)

The walk has a fixed start and no randomness, so these are exact:

| quantity | value | reading |
|---|---:|---|
| **λ_hyperbolic** (per tick) | **+0.0113** | positive — sensitive dependence is real |
| **λ_torus** (per tick, control) | **−0.000008** | ≈ 0 — the flat torus is integrable, as it must be |
| ratio | **~1360×** | the hyperbolic divergence is decisively above the flat baseline |
| **coverage** | **74.6%** of reachable cells (334 / 448) | broad exploration |
| **occupancy CV** | **0.72** | non-uniform — broad but clumped, not equidistributed |

## What this honestly says

- **The curvature is doing real work.** λ_hyperbolic is ~1360× the flat-torus
  control (which sits at machine-zero). The negative-curvature divergence is not
  an estimator artifact — the same estimator reads ≈0 on the integrable torus.
- **But it is WEAK.** 0.0113/tick is a small exponent — the walk is
  sensitive-dependent, not violently chaotic. Over 3000 ticks the compounded
  separation is large, but per-step the stretch is gentle (the golden-rotating
  heading and the isometric boundary retraction fold trajectories back, damping
  the exponent).
- **Coverage is broad but not uniform.** 75% of cells get visited, but CV 0.72
  means occupancy is uneven — the orbit explores most of the disk without
  filling it evenly. This is *not* the equidistribution a certified ergodic flow
  would give.

**Verdict, in the code and here: bounded, exploratory, weakly sensitive-
dependent — not a certified ergodic (Anosov) flow.** That is exactly what a
functional bounded walk needs to be — dynamic enough to explore, bounded enough
to stay viable — and no more. The earlier "empirical mixing" phrasing
overclaimed; these numbers are the correction, and `/api/elle-mixing-report`
returns them live so the claim can never drift from what the code does.

## Why the honest version is the useful one

For the sync layer, strong ergodicity was never the requirement. What the
covert channel needs is: (a) the position sequence never repeats and stays
bounded (✓ — golden heading + isometric retraction), and (b) an observer
without the secret geodesic cannot predict the next position (✓ — sensitive
dependence, even weak, plus the master-derived secret origin). A *strongly*
chaotic walk would actually hurt — it would amplify the cross-platform
floating-point divergence that already forces the numerical-determinism caveat
(`docs/HYPERBOLIC_BRIDGE.md`). Weak-but-positive sensitivity is the right
operating point, and now it is a measured one.
