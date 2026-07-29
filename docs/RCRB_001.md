# RCRB-001 — Relational Coherence Recovery Benchmark

**Does φ's Hurwitz optimality actually pay off under *dynamics* — recovery
from shocks, escape from spurious minima, resonance-avoidance under periodic
perturbation — the way it visibly did not on the static retrieval task in
`pami-basis-ablation.test.ts`? Tested against the same rival ratios (silver
ratio, √2, e, π, a rational), using the real dynamical machinery already in
this codebase (`phase-vessel.ts`'s `vesselStep`, `regulator.ts`'s
perturbation-escape mechanism) rather than new math. Recovery speed and
escape-kick amplitude turn out to be structurally independent of the
winding/perturbation base entirely — not a φ-specific result, a fact about
how those two mechanisms are built. The one probe that does depend on the
base (periodic-perturbation phase clustering) first showed a ranking that
flipped with sample depth — traced to the Three-Gap Theorem, not noise — then
got replaced with two analytic metrics (star discrepancy, a closed-form Weyl
spectral envelope) that fixed the instability without flipping the
conclusion in φ's favor: rational ratios collapse unambiguously (now proven
three ways, one of them exactly), but among the irrationals tested, φ is
solid, middle-of-the-pack — not the winner.**

Code: `src/rcrb-001.test.ts` (self-contained; does not modify `regulator.ts`
or `phase-vessel.ts`) · companion to `PAMI_PHI_WIRING.md` (static retrieval)
and `FREE_ENERGY_REGULATOR.md` / `PHASE_VESSEL.md` (the mechanisms probed
here) · 2026

Status: **spec + first run, both reported.** Unlike `RETRIEVAL_EVAL_001.md`
(spec only, harness pending), this ran — the numbers below are what came
back, not a plan for numbers to come.

---

## Why static retrieval was the wrong test

`pami-basis-ablation.test.ts` measured whether a φ-spaced wavelet basis wins
a one-shot nearest-neighbor lookup. That's an information-theoretic
discriminability question. Hurwitz optimality is not a claim about
discriminability — it's a claim about resistance to resonance **under
iteration**: a φ-spaced (or φ-timed) system should be harder to "capture"
into a repeating, privileged pattern than a system spaced by a well-approxima
ble ratio. If that property matters anywhere in this codebase, it should show
up in something that runs over time and gets perturbed, not in a single
fingerprint comparison. This benchmark tests three such things.

## Part 1 — radial recovery speed after a shock

`phase-vessel.ts`'s `vesselStep` decomposes into two independent updates: an
angular one (`theta += 2π · winding`) and a radial one (`r2 = 1 + (r−1)(1−κ)`
— pure exponential relaxation toward the golden ellipse, governed only by
`κ`). The radial update never reads the winding number. So the prediction,
made before running anything, was: recovery time should be **exactly**
winding-invariant.

**Result: confirmed exactly.** φ, silver ratio, √2, e, π, and a plain
rational (0.6) all recover from an identical 1.8×-radius kick in **296
steps**, to the digit, every time. This is a real structural finding, not a
null result to shrug off: in the current architecture, "φ heals faster from
a shock" is not a claim the math supports. Recovery speed is a `κ`
(relaxation-rate) property only, fully decoupled from which winding number —
φ or otherwise — governs the phase.

## Part 2 — perturbation-escape efficiency

`regulator.ts`'s `phiPerturb()` generates a golden-angle quasiperiodic kick
used to escape a planted spurious minimum in `ruggedEscapeDemo`. Swapping its
base for each rival and sweeping the minimum amplitude needed to cross the
barrier, across four well shapes (`tilt` = 0.8, 1.0, 1.2, 1.5):

- **A plain rational base (0.6) ties φ exactly at every tilt** (1.1, 0.9,
  0.7, 0.3). If never-repeating phase mattered to this mechanism, the
  rational should need more amplitude or fail outright. It doesn't.
- **√2 needs *less* amplitude than φ at 3 of the 4 tilts** (0.9 vs 1.1, 0.8
  vs 0.9, 0.6 vs 0.7; tied at the fourth). φ is never the best performer in
  this probe.

Why: crossing a single planted barrier over 8000 simulated steps only
requires *some* sufficiently large oscillation — the run is long enough that
even a repeating (rational) kick eventually lands near a favorable phase.
This mechanism, as built, doesn't actually exercise equidistribution at all.
Testing the claim properly would need either far fewer steps (so a resonant
kick genuinely might not get a favorable phase in time) or a landscape with
multiple, moving wells.

## Part 3 — the real test: periodic-perturbation phase clustering

This is the direct dynamical analogue of Hurwitz optimality: if
perturbations arrive **periodically**, at some period the system doesn't
know in advance (a recurring write, a decay cycle, a cron tick), does the
*phase at which they land* cluster around a few privileged points
("resonance," the same pathology `graph.ts`'s `capturedResonanceScan` is
named for) or spread evenly? Swept 60 candidate periods (2..61), measured the
worst-case gap in phase-arrival coverage (`maxGap`, the same statistic
`phase-vessel.ts`'s own isotropy check uses) for each winding number, at two
sample depths:

| basis | worst-case gap, 500 samples/period | worst-case gap, 2000 samples/period |
|---|---|---|
| **φ** | **0.0643** (among the *worst*) | **0.0099** (the *best*) |
| silver ratio | 0.0720 | 0.0174 |
| √2 | 0.0364 | 0.0140 |
| e | 0.0271 | 0.0106 |
| π | 0.0140 (best at this depth) | 0.0138 |
| rational (0.6) | ≈1.0 (total collapse) | ≈1.0 (total collapse) |

Two honest findings, not one:

1. **The rational is unambiguously, catastrophically worse** — total
   resonance collapse at some tested period, at every sample depth. This part
   of the Hurwitz story holds up dynamically, not just in the static-index
   sense.
2. **Among the irrationals, φ is not a stable winner.** At 500 samples/period
   it's near the *worst* of the five; at 2000 samples/period, same periods,
   it's the *best*. The ranking inverted with nothing changed but sample
   depth. That instability means this particular operationalization —
   worst-single-gap across one fixed, finite list of periods — is dominated
   by whichever single period happens to have a coincidental near-rational
   alignment within the tested range. That's an artifact of which periods got
   tested, not a stable property of the winding number. It settles nothing
   about φ's relative standing among irrationals; it only rules out rational
   ratios convincingly.

## Part 4 — replacing the noisy metric with two analytic ones

Part 3's instability has a name: the **Three-Gap Theorem** (Steinhaus). For
any irrational α and any K, the points `{kα mod 1 : k=1..K}` always split the
circle into exactly two or three distinct gap lengths, and the worst gap only
shrinks in discrete **steps** — flat until some k happens to bisect the
largest gap, then a jump down. Different candidate ratios hit their
step-downs at different K, so "worst gap across many periods, at one fixed
K" can rank them however those steps happen to have landed at that specific
K. That's exactly why φ read worst at K=500 and best at K=2000 with nothing
else changed — not simulation noise, a structural property of the statistic
itself.

Two replacements, both smoother because both look at the whole point set
instead of the single worst gap, added to `rcrb-001.test.ts` without
touching Part 3 (kept as the honest record of what the naive metric does):

**4a. Star discrepancy `D*_K`** — the Koksma–Hlawka object: the max deviation
between the empirical CDF of `{kβ mod 1}` and the ideal uniform CDF. Six
candidates, six K depths, worst-case over the same 60 periods:

| basis | K=100 | K=200 | K=400 | K=800 | K=1600 | K=3200 |
|---|---|---|---|---|---|---|
| **φ** | 0.23315 | 0.14888 | 0.07133 | 0.04550 | **0.01316** | 0.01003 |
| silver | 0.24999 | 0.10409 | 0.08243 | 0.03910 | 0.02161 | 0.01279 |
| √2 | 0.21762 | 0.12061 | 0.07871 | 0.01998 | 0.01797 | 0.01313 |
| e | 0.26343 | 0.04070 | 0.02947 | 0.02401 | 0.01539 | 0.00705 |
| π | 0.71825 | 0.43650 | 0.10050 | 0.08600 | 0.05701 | 0.01370 |
| rational | 1.00000 | 1.00000 | 1.00000 | 1.00000 | 1.00000 | 1.00000 |

Smoother, and the rational is now unambiguous — pinned at exactly 1.0 at
every depth, no step-function ambiguity at all. φ solidly beats π at every
single depth (the category claim holding up cleanly). But φ does **not**
beat e cleanly: e is lower at K=200, 400, 800, and 3200; φ only edges back
ahead at K=1600. Still not a stable φ win, just a much less chaotic
non-win than Part 3's total ranking inversion.

**4b. Weyl spectral envelope** — closed-form, zero simulation:
`S_K(β) = |sin(πKβ)| / (K·|sin(πβ)|)`. The raw value still oscillates in K
(the numerator does), but its K-**independent** envelope, `1/|sin(πβ)|`, is
exactly what governs the worst case over all K, and it reduces to the same
`n·‖nω‖` Hurwitz-constant family already validated analytically in
`pami-basis-ablation.test.ts`, now applied to `β = P·ω` for many P instead of
ω alone:

| basis | worst-case envelope (lower = better) |
|---|---|
| silver ratio | **26.11** ← best |
| e | 30.94 |
| √2 | 36.92 |
| φ | 39.15 |
| π | 112.98 |
| rational | ∞ — exact, not approximate |

An exact trigonometric identity, no K, no sampling, no step-function artifact
of any kind — and it agrees with 4a: φ sits **fourth of five**, solidly
ahead of π, solidly behind silver, e, and √2.

## What this does and doesn't establish

- **Confirmed, dynamically, not just statically, and now three ways:**
  rational (well-approximable) winding numbers are a real, unambiguous
  liability — max-gap, star discrepancy, and the Weyl envelope all agree the
  rational collapses (the Weyl envelope even gives an *exact*, non-simulated
  certificate: infinite). This is the one place in this whole line of
  testing (static retrieval, basis ablation, and now this) where φ's
  *category* — "be irrational, don't be rational" — earns its claim outright,
  and the smoother metrics only strengthened that conclusion.
- **Not confirmed, even after replacing the noisy metric with two analytic
  ones:** that φ specifically, as opposed to another well-chosen irrational,
  is the better choice for this architecture's dynamics. Both replacements
  agree with each other and with Part 3's tentative read: φ is solid,
  middle-of-the-pack among the five irrationals tested, consistently beating
  π, consistently behind (or split with) silver ratio and e. The Three-Gap
  instability was real and is now fixed; fixing it did not flip the result
  in φ's favor.
- Recovery speed and escape efficiency (Parts 1–2) remain unaffected by any
  of this — those two mechanisms are structurally decoupled from the
  winding/perturbation base entirely, smoother metric or not.

This joins `pami-basis-ablation.test.ts`'s F1 finding as a third and fourth
piece of evidence that the *applied*, architecture-specific claims about φ
need real follow-up work to stand on their own — while the underlying pure Hurwitz
mathematics, confirmed independently in that same file, is untouched by any
of this.
