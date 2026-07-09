# Toroidal Isotropic Transformer (TIT) — geometric benchmark

**Stewart Barteau & Claude (Anthropic), 2026** · Hermann, Missouri
Cleaned harness **v1.1**.

---

## What this is

A geometric instrument, not a language model. A single dependency-free Python
file that measures four geometric properties of the golden-ratio orbit on the
circle, each derived from the proof that φ emerges as a structural necessity
from three conditions: homogeneity, isotropic suppression, and iteration.

**φ is not assumed in the tests. Each prediction is a genuine measurement.**

```bash
python3 tit.py        # ~2 s, no dependencies
```

Compare your output against `RESULTS.md`.

---

## The four predictions (v1.1)

Stated before the code so a reader can evaluate them independently.

**P1 — φ uniquely maximizes the inf-functional.**
`delta_inf(ω) = inf_{n≥1} n‖nω‖` is maximized, over a dense scan of (0,1), at
ω in the noble class {φ−1, 2−φ, …}, with value **φ⁻² = 2 − φ = 0.381966…**.
This is demonstrated by optimization, not by evaluating a short slate of points.

**Bridge — the Hurwitz liminf is a *different* constant.**
`liminf_{n} n‖nφ‖ = 1/√5 = 0.447214…` is the asymptotic value along the
Fibonacci subsequence of n. It is **not** the inf-functional maximum (φ⁻²).
The harness reports both and never conflates them. (See `RESULTS.md` for the
correction of an earlier arithmetic error that equated the two.)

**P2 — discrepancy law at Fibonacci N.**
The star discrepancy satisfies `N·D*_N → 1` (optimal 1/N scaling), and
consecutive discrepancies satisfy `D*_{F_k}/D*_{F_{k+1}} → φ`. The orbit
self-encodes φ in its own compression rate. (The earlier `D*_{F_k} = 1/F_{k+1}`
was wrong by a factor of φ; the correct scaling is `D*_{F_k} ≈ 1/F_k`.)

**P3 — three-gap property with φ ratios.**
By the Steinhaus (three-distance) theorem the orbit has at most three distinct
gap lengths — three at generic N with `large = medium + small` and both adjacent
ratios equal to φ, degenerating to exactly two (still in ratio φ) at Fibonacci N.

**P4 — φ-winding is the most uniform orbit.**
At matched N, `N·D*_N` for φ-winding is lower than for any other tested
irrational (√2−1, e−2, π−3) and far lower than for a rational. This is a
comparative measurement, replacing the earlier "step variance = 0" test, which
was a tautology (the orbit is a constant displacement by construction).

---

## The Stern–Brocot search

The benchmark's core is the Stern–Brocot mediant search — a binary search
through the tree of rationals that converges to φ from ω = 1/2 with no knowledge
of φ. The mediants are ratios of consecutive Fibonacci numbers; the algorithm
discovers φ by maximizing discrepancy avoidance. This is the proof operating as
an algorithm: φ = [1;1,1,1,…] is the unique irrational whose continued-fraction
partial quotients are all 1, and the mediant path instantiates that.

---

## On the 2/π ↔ 1/π correspondence (open, not settled)

Google Research's TurboQuant (ICLR 2026) identifies **2/π ≈ 0.6366** as the
irreducible multiplicative bias in high-dimensional KV-cache compression via the
Johnson–Lindenstrauss transform (it is the mean of |⟨u,v⟩| over the sphere). The
companion framework derives **1/π ≈ 0.3183** as the isotropic-suppression
magnitude on the toroidal field.

These differ by exactly a factor of 2. They are **plausibly the same constant
seen from two normalizations** — a half-angle / one-sided-measure relationship —
but that factor of 2 has to be *derived*, not asserted. Until the derivation is
written out and checked, this is a **conjectural correspondence**, not an
identity. It is listed here as open work, not as a confirmed result.

---

## Architecture (why the torus)

| Property | Standard transformer | TIT |
|---|---|---|
| State space | ℝᵈ — flat, unbounded | 𝕋ⁿ — compact torus |
| Origin | fixed (position 0) | every point valid (homogeneous) |
| Update | different per layer | constant displacement everywhere |
| Winding number | undefined on ℝᵈ | native — φ |
| Positional encoding | added externally | the geometry *is* the encoding |

Winding numbers are undefined on ℝᵈ, so the topological proof has nothing to
grab. The torus is what makes the argument applicable — and is the substrate the
`docs/TOROIDAL_GRAPH_MAPPING.md` spec builds the memory chart on.

---

## Files

```
tit.py        — the benchmark (run this)
README.md     — this file
RESULTS.md    — reference output from a clean v1.1 run + the two-constants note
results.json  — machine-readable results
```

## References

- S. Barteau & Claude (Anthropic), *Emergence Without Assumption*, 2026.
- S. Barteau & Claude (Anthropic), *The Driving Mechanism*, 2026.
- A. Hurwitz (1891), *Ueber die angenäherte Darstellung der Irrationalzahlen
  durch rationale Brüche*, Math. Ann. 39. — the liminf constant 1/√5.
- V. T. Sós (1958), *On the theory of Diophantine approximations*. — three-gap.
- H. Weyl (1916), *Über die Gleichverteilung von Zahlen mod. Eins*. — equidistribution.
- A. Zandieh, V. Mirrokni et al. (Google Research), *TurboQuant*, ICLR 2026. —
  the 2/π compression constant (see the correspondence note above).

## License

MIT.
