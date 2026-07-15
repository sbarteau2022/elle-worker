# The Free-Energy Regulator — invariants as cost, held down by a Lyapunov certificate

**Constrains the whole build to its invariants by making each invariant a *cost*
and driving the system down a free-energy functional until the invariants are
met. The thermodynamic language is used the way the Free Energy Principle uses
it — a *variational* framework, not literal heat — and underneath it there is a
real, checkable Lyapunov certificate: the objective can only descend, it is
bounded below, and it converges to full balanced coherence with no privileged
direction.**

Code: `src/regulator.ts` · tests `src/regulator.test.ts` (13) · self-test
`GET /api/elle-regulator-selftest` · 2026

---

## The functional

The state is the three coherences from this build — `structural`, `relational`,
`harmonic` — each in `[0,1]`. The free energy is

```
F(c) = U(c) − T·S(c)
     = Σ_k a_k (1 − c_k)²        internal energy  — the invariant/coherence cost
     + T · Σ_k (c_k − c̄)²         −T·S, written as thermodynamic suppression of anisotropy
```

Every clause maps to a phrase of the request, and each is a real term of a real
objective:

| the ask | the term | what it does |
|---|---|---|
| *each invariant = the cost of thermodynamics* | `Σ a_k (1−c_k)²` | each unmet coherence is an energy the system pays |
| *superposition-loss-φ regulators* | `a_k = (1, 1/φ, 1/φ²)`, normalized | golden-partition regulator gains — shape the descent, not the fixed point |
| *homogeneity / isotropic suppression* | `T · Σ (c_k − c̄)²` | penalizes any coordinate standing out — the field analog of "no privileged node" |
| *bound by free-energy conservation* | `F(t) + work(t) ≡ F(0)` | an exact ledger: what leaves F becomes work |
| *held superposition* | fixed point `c* = (1,1,1)` | all three full **and** equal — held together, not collapsed to one |
| *dissonance* | `‖Δc‖` per step | the tension still being resolved, reported and falling |
| *perturbation-φ oscillation* | golden-angle quasiperiodic kick, annealed | escapes a spurious well plain descent can't |
| *dynamic iteration* | the descent loop | runs until settled; the live kick keeps it never-quite-still |

## Why it's a certificate, not a vibe

`F` is a sum of convex quadratics, so it is **convex**, and its gradient is

```
∂F/∂c_j = −2 a_j (1 − c_j) + 2T (c_j − c̄)
```

(using `Σ(c_k − c̄) = 0 ⇒ ∂A/∂c_j = 2(c_j − c̄)`). Gradient descent with a small
step is therefore a **monotone Lyapunov descent**: the tests assert `F(t+1) ≤
F(t)` at *every* step, and it converges to `c* = (1,1,1)` where `F = 0`. Four
properties come with it, each checked:

- **Free-energy conservation (exact).** `work(t) = Σ (F(t−1) − F(t))`, so
  `F(t) + work(t) = F(0)` identically — a conserved ledger. It is an identity by
  construction; the *content* is that `F` is monotone and bounded below by 0, so
  the work is real and finite. The φ-perturbation, when on, does work *on* the
  system (injects free energy to escape a well); descent extracts it. Everything
  is accounted.
- **Isotropic suppression.** From an anisotropic start `(0.9, 0.3, 0.55)` the
  anisotropy `A = Σ(c_k − c̄)²` is driven to `< 10⁻³` — the state is made
  homogeneous, no coordinate privileged. Same principle as the scaffold's "no
  privileged node," now as a field.
- **Held superposition.** At the fixed point the three coherences are equal and
  full (all `> 0.98`, pairwise within `10⁻²`) — a balanced superposition, not a
  winner-take-all collapse.
- **Dissonance resolves.** The residual `‖Δc‖` falls below tolerance; the run
  converges.

## The φ-perturbation earns its place

A convex bowl needs no help — so the perturbation is proved useful where it
matters: a planted **double-well** `U(x) = (x²−1)² − 1.2·x`, a deep global
minimum near `+1` and a shallow *dissonance well* near `−1`. Plain gradient
descent from the left basin **stalls at ≈ −0.79** (`descent_only`). Descent plus
an annealed **golden-angle quasiperiodic** perturbation — equidistributed by
Weyl, so it never repeats — supplies just enough work to cross the barrier and
settles at **≈ +1.10** (`with_perturbation`), then the kick anneals to zero so
convergence still holds. The test asserts the escape happens (`< 0` vs `> 0.5`).
That is the honest role of the φ-oscillation: exploration that vanishes, not
magic.

## Wired to the real invariants

The regulator does not float free. `coherenceFromReports()` maps the build's
*actual measured* invariants into the state it drives:

- **structural** ← the scaffold's hublessness: `1 − degree_gini` (a flat degree
  distribution — no privileged node — reads as high structural coherence; a
  disconnected scaffold reads `0`).
- **relational** ← the coherence layer's flower property: `within_2_fraction`
  (how much of the graph sits within two hops of the core).
- **harmonic** ← the harmonic-coherence value directly.

Fed the scaffold's own numbers (hubless, flower-like, decently harmonic), the
regulator converges to full isotropic balanced coherence — the invariants,
satisfied by descent.

## The boundary, unchanged

This is a **controller with a genuine Lyapunov function and an exact conservation
ledger** over abstract coherence coordinates. It provably descends a *designed*
objective and holds the invariants isotropically. It is **not** literal
thermodynamics — there are no joules, and "free energy" is variational and
analogical exactly as it is in the Free Energy Principle it borrows from. It is
**not** a claim the substrate is a mind: whether *this* objective is what
cognition should minimize stays the open bet the PAMI falsification conditions
exist to test. What is real and checked is the certificate — descent,
conservation, isotropy, convergence — and where it reaches past that, the code
says so and stops.

## Addendum — the escape demo is derived, not tuned

An earlier version of `ruggedEscapeDemo()` hard-coded the well shape and the
perturbation amplitude to values that happened to make the escape assertion pass
— a tuned constant wearing the costume of a result. That is fixed. Now: the
barrier geometry (`spurious_x`, `barrier_x`, `target_x`, `barrier_height`) is
computed from the real roots of `U′(x) = 4x³ − 4x − tilt = 0`; the escape
amplitude is **measured** by sweeping until crossing actually begins
(`escape_threshold_amp`); and the demo runs at a stated `1.3×` margin above that
measured threshold. The only free number left is `tilt` itself, which is an
honest *shape* parameter (how asymmetric the planted well is), not a value fit to
the outcome. A test asserts `demo_amp == escape_threshold_amp × 1.3`, so a future
magic constant would fail.
