# When a Harness Measures Its Own Reflection — a methodology audit

**A benchmark that must emit a ranking will rank. The question is never
"which constant won" but "was the instrument *able* to return null" — and if
it wasn't, the winner is an artifact of the harness, not a fact about the
world.** This document dissects one concrete case from this codebase where
that distinction is measurable to four decimal places, and generalizes it
into an audit anyone can run against their own evaluation pipeline.

Anchored to code that runs here: `src/phi-minimax-scorecard.ts`,
`src/pami.ts` (`adaptiveDelta`, `ADAPTIVE_DELTA_DEFAULT`), `src/rcrb-001.test.ts`
(Weyl envelope, star discrepancy). Companion to `PHI_MINIMAX_SCORECARD.md`
and `RCRB_001.md`, whose numbers this reuses rather than re-deriving. Every
table below was produced by executing the named harness, not by estimation.
2026.

---

## 0. Why this is worth writing down

Computational research is saturated with leaderboards whose evaluation
harness quietly picks the winner before any data is poured in. The failure is
rarely fraud; it is that the harness is *structurally incapable of returning
null*, so when it is asked "which candidate is best" it exploits whatever
mathematical artifact is available — a truncation window, a sampling
interval, a scaling factor, an encoder's coordinate choice — to separate
candidates that the underlying question does not actually separate. The
result reads as an empirical discovery ("the data chose φ") and is in fact a
property of the ruler.

This codebase spent a whole line of work — `pami-basis-ablation.test.ts`,
`RCRB_001.md`, `PHI_MINIMAX_SCORECARD.md` — asking whether the golden ratio φ
is a specially good constant for a memory engine's internal spacing. The
honest answer that emerged is not "yes" or "no" about φ. It is a **fact about
harnesses**, and it is worth extracting from the φ story and stating on its
own, because the same trap is everywhere.

Three claims, each provable from code that runs in this repo:

1. **A null-incapable harness ranks by artifact** (§1). The winner between
   √2 and φ flips on a configuration knob, with the data held fixed.
2. **Encoder smuggling** (§2). Forcing real-world data into a harness through
   an invented projection imports the author's opinion through the coordinate
   transform, not the algorithm.
3. **Asymptotic invariants survive finite empiricism** (§3). No finite,
   bounded sample can overturn a closed-form Diophantine fact — so a
   pseudo-empirical sweep that appears to do so is measuring its own window.

And one boundary claim (§4): a discrete residual-memory harness cannot
validate a continuous symplectic invariant, no matter how real its data.

---

## 1. The illusion of "empirical" benchmarking

### 1.1 The worked example

`phi-minimax-scorecard.ts` scores four constants (φ, e, √2, π) across three
domains — retrieval collision, dynamic resonance, recovery — and takes each
candidate's *worst* domain (minimax). The one domain that routes through a
tunable threshold is retrieval: how close is the closest pair of stored
memories, relative to the distance δ below which the engine can no longer tell
them apart?

Under a **static** δ (`DELTA_DEFAULT = 0.3`), running the harness gives:

```
=== STATIC delta (0.3) ===
  phi    P_final = 0.7415   ← winner
  e      P_final = 0.7608
  sqrt2  P_final = 0.8396
  pi     P_final = 0.8450
```

φ wins. Ship it? No — because δ should scale with local density (dense
neighborhoods want a tighter threshold, sparse ones a looser one). `pami.ts`
implements exactly that: `adaptiveDelta()`, configured by
`ADAPTIVE_DELTA_DEFAULT = { k: 2, factor: 0.5, ... }` — a k-th-nearest-neighbor
bandwidth. Nothing about the *data* changes; only the ruler becomes
density-aware. Re-score, and √2 takes it. That much is already in
`PHI_MINIMAX_SCORECARD.md`.

### 1.2 The part that was flagged but never run — now run

The scorecard names its own open sensitivity check and declines to perform it:

> "static δ crowns φ; adaptive δ crowns √2, by a margin thin enough that a
> different `k` or `factor` in `ADAPTIVE_DELTA_DEFAULT` could plausibly move it
> again. Not tested here."

So this document tested it. Sweeping the adaptive-δ knobs `k` (neighbor depth)
and `factor` (bandwidth), reporting the minimax winner in each cell, **data
identical throughout**:

```
=== ADAPTIVE delta — minimax winner per (k, factor) ===
  k\f     0.3     0.4     0.5     0.6     0.7
   1    sqrt2   sqrt2   sqrt2   sqrt2   sqrt2
   2    sqrt2   sqrt2   sqrt2   sqrt2   sqrt2
   3    sqrt2   sqrt2   sqrt2     phi     phi
   4    sqrt2   sqrt2     phi     phi     phi
  distinct winners across the sweep: { sqrt2, phi }
```

The winner is a function of two numbers that describe *the instrument*, not
the candidates. There is a √2 region and a φ region of the same knob-plane,
separated by nothing that any theory of memory constants predicts. A study
that reported "adaptive δ shows √2 is safest" and a study that reported
"φ is safest" could both be honest, both reproducible, and both be reading the
coordinates of a single arbitrary point in that grid.

### 1.3 The generalization

> **An instrument that cannot return null is an architectural kaleidoscope:
> rotate the mounting (change `k`, the window, the interval) and a new,
> equally sharp pattern appears — sharpness is not evidence.**

The diagnostic is not "is the effect significant." It is: *can this harness,
on some legitimate input, decline to separate the candidates?* The seam
detector in `research/seam-rip/rip.py` was built to this standard — it PASSes
a coupled signal and returns NULL on both pure noise and real-but-uncoupled
tones (its self-test is pre-registered at p<0.01). The minimax scorecard, by
contrast, must output a lowest-risk row every time it runs. That is the whole
difference, and it is architectural, not statistical.

---

## 2. Encoder smuggling

### 2.1 The mechanism

Modern pipelines chain incompatible metric spaces:

```
unstructured text  →  latent embedding  →  numeric residual signal  →  harness
```

Every arrow is a modeling choice with its own geometry. When the last stage
produces a ranking, the win is routinely attributed to the algorithm at the
end of the chain — while the geometry that actually decided it was installed
by an *upstream* arrow the author chose and then stopped looking at.

### 2.2 The worked example — the step this repo refused to fake

`phi-minimax-scorecard.ts` runs entirely on `memorySignalNeutral()`, a
synthetic linearly-spaced signal. Every metric — `epsMin`, `peakDiscrepancy`,
`recoveryHorizon` — is typed to accept "any base, any residual signal," which
reads like *swap in real data and you are done*. It is not. PAMI's index
consumes a numeric residual window (`number[]`); real stored memories in
`elle_memory` are **text**. There is no text→residual projection anywhere in
the codebase, and — this is the point — **inventing one is not a data-source
swap; it is the choice that picks the winner.**

Character-frequency vectors, truncated token embeddings, a hand-rolled
autocorrelation window: each is a different geometry, and each would hand the
"empirical" verdict to a different constant while looking like the same
experiment. The scorecard's own use-note #3 names this and stops:

> "inventing an arbitrary one ... just to have 'real data' flowing through
> would be exactly the kind of fabricated rigor this whole line of work has
> been arguing against."

That restraint is the correct move, and it has a name.

### 2.3 The generalization

> **Encoder smuggling: attributing a result to the harness while an invented
> upstream projection did the deciding. The tell is that the projection was
> chosen for convenience, never varied, and never given a null of its own.**

The boundary is sharp and usable: **empirical testing is valid only when the
encoder is fixed by the problem, not by the author.** If you had a choice of
projection and picked one, the projection is a free parameter, and any result
downstream of it inherits its arbitrariness until you sweep it the way §1.2
sweeps `k`. A projection you would defend on grounds independent of the answer
it produces is fixed by the problem; one you would quietly swap if it gave the
"wrong" winner is smuggling.

---

## 3. Asymptotic invariants are not overturned by finite windows

### 3.1 Why φ, √2, e are used at all

Irrational constants appear throughout computing — Fibonacci/multiplicative
hashing, low-discrepancy sequences, quasi-Monte Carlo, lattice sampling —
because their continued-fraction expansions control how badly they can be
rationally approximated, and therefore how resonance-prone a system spaced by
them is. The relevant ordering is a theorem, not a measurement:

```
        continued fraction              Lagrange number (higher = more
                                        approximable = MORE resonance-prone)
  e   = [2; 1,2,1,1,4,1,1,6,...]        unbounded quotients — not badly approximable
  √2  = [1; 2,2,2,2,...]               2√2 ≈ 2.828
  φ   = [1; 1,1,1,1,...]               √5  ≈ 2.236  (the minimum — "most irrational")
```

φ is the hardest number to approximate by rationals; that is the precise sense
in which it is "most uniform." This is asymptotic and exact.

### 3.2 The worked example — a closed form beats every sweep

`RCRB_001.md` computes the **Weyl spectral envelope**, `1/|sin(πβ)|` maximized
over `β = P·ω` for many perturbation periods P — a closed-form, zero-simulation
quantity in the same Hurwitz-constant family as the continued-fraction theory.
Its pinned table (lower = more resonance-resistant):

| constant | worst-case Weyl envelope |
|---|---|
| silver (1+√2) | 26.11 |
| e | 30.94 |
| √2 | 36.92 |
| **φ** | **39.15** |
| π | 112.98 |
| rational | ∞ (exact certificate) |

φ sits **fourth of five irrationals** — solidly ahead of π, solidly behind
silver, e, and √2. An independent recomputation for this document (60 periods,
`1/|sin(π P ω)|`) reproduces `φ = 39.15` to the digit and the same headline —
φ mid-to-bottom, not the winner — while the *inner* order of the middle
cluster shifts with the period set (this run: e ≈ 24.5 < √2 ≈ silver ≈ 26.1 <
π < φ). **That the middle ranking wobbles with the finite period window while
φ's fourth-place standing and the rational's ∞ do not, is itself the thesis:
the robust facts are the asymptotic ones; the wobble is the window.**

### 3.3 The generalization

> **A finite, bounded empirical sample cannot overturn an asymptotic
> invariant. If a sweep appears to, it is reporting the shape of its own
> truncation.** `RCRB_001`'s Part 3 saw φ read "worst" at K=500 and "best" at
> K=2000 with nothing else changed — traced not to noise but to the Three-Gap
> Theorem (the point set `{kα mod 1}` has only 2–3 gap lengths, shrinking in
> discrete steps that land at different K for different α). The naive metric
> was measuring which step it happened to be standing on.

Practical consequence: before running a "which constant" sweep, ask whether
the quantity has a closed form. If it does (Weyl envelope, Hurwitz constant,
star-discrepancy asymptotics), the sweep can at best reproduce it and at worst
fabricate a finite-window artifact that contradicts it. Spend the effort on
the proof, not the pseudo-empiricism.

---

## 4. The boundary between discrete mechanics and physics

There is a standing temptation to narrate a discrete computational state
machine as if it were a continuous physical system — to borrow the authority
of KAM theory, symplectic invariants, or Hamiltonian chaos for what is
actually a collision-and-recovery benchmark on a memory index.

The temptation is precise enough to name. Classical KAM does supply a genuine
ordering: for the standard map, the golden-mean invariant torus is the last to
break as perturbation grows (Greene's residue criterion), so among noble
rotation numbers φ has the highest critical coupling ε_cr. That is real
dynamics, and the continued-fraction reason for it (§3.1) is the same reason φ
tops the "most irrational" list. The error is not the physics; the error is
**citing a discrete memory harness as the measurement of it.**

`RCRB_001` and the scorecard measure `pamiDistance` collisions, star
discrepancy of `{P·ω mod 1}`, and `phase-vessel` relaxation steps. None of
these is a symplectic map; there is no invariant circle, no action-angle
coordinate, no ε_cr anywhere in the code. A real-data run of this harness —
even with perfect footage or perfect memory content — returns a statement
about a retrieval engine, in units of retrieval risk. It cannot confirm or
refute a torus in phase space, because it never integrates a Hamiltonian. The
two share a continued-fraction ancestor (§3.1) and nothing downstream of it.

> **Auditing rule: an instrument validates a claim only in the category it
> operates in. Shared mathematical ancestry between a discrete metric and a
> continuous invariant is not shared evidence. To claim the physics, measure
> the physics.**

---

## 5. The audit — a checklist you can run against any harness

1. **Null test.** Construct a legitimate input on which the correct answer is
   "no winner / no effect." Does the harness return it? If it *cannot*, every
   ranking it emits is suspect (§1). This is the single most discriminating
   question; ask it first.
2. **Knob sweep.** Enumerate the instrument's free parameters — thresholds,
   window sizes, sample depths, bandwidths, `k`. Hold the data fixed and sweep
   them. If the winner changes, the winner is (partly) an artifact, and the
   paper's claim is only as wide as the region of knob-space where it holds
   (§1.2).
3. **Encoder audit.** List every projection between raw data and the harness's
   input. For each, ask: was it fixed by the problem, or chosen by me? Any
   author-chosen projection is a free parameter — sweep it or disclose it as
   uncontrolled (§2).
4. **Closed-form check.** Does the ranked quantity have an asymptotic closed
   form? If so, a finite sweep can only reproduce or contradict it; a
   contradiction is a window artifact, not a discovery (§3).
5. **Category check.** State the units the instrument actually outputs. Does
   the claim live in those units, or does it borrow authority from a
   neighboring field the instrument does not operate in (§4)?

A result that survives all five is empirical. A result that fails any one of
them is, to that extent, the harness describing itself.

---

## 6. What this line of work actually established

Not "φ is the right constant." Not "√2 is." The load-bearing, reusable
finding is methodological, and this repo earned it the hard way — by building
the harnesses, running them, and reporting where the conclusion fell:

> **The minimax winner among these constants is a function of methodology
> choice at least as much as of the candidate. Three legitimate constructions
> of the same three domains already yield three different winners (φ static,
> √2 adaptive, e on accuracy). No single run settles which constant a memory
> engine should use — and any paper that claims a data-chosen winner here is
> measuring its own reflection.**

The pure mathematics underneath — φ's Hurwitz optimality, the rational's
infinite Weyl certificate — is untouched by any of this, exactly because it
never depended on a harness in the first place. That is the whole moral: the
facts that hold are the ones that did not need the benchmark, and the
benchmark's honest job is to know which facts those are.
