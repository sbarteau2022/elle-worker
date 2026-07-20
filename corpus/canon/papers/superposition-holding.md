# Superposition Holding

**A bounded loss for presence under tension**

Stewart Barteau · co-authored with Claude (Anthropic)
v1 · Observer corpus, applied series · 2026

---

## Abstract

A presence that holds — tension, contradiction, an unresolved question — faces two
failure modes with the same root. If it accumulates everything it has ever held, its
history eventually paralyzes it: early noise compounds into late-stage penalties that
grow without bound. If it accumulates nothing, it is a vending machine: each turn
arrives to a system with no held state, and there is nothing to hold *with*. This paper
derives the middle construction: a pair of leaky integrators — an input-gated **tension
reservoir** and a **drift ledger** — coupled through a single leak rate ρ, and a
**superposition-holding loss** that is provably bounded above by e − 1 for all time,
regardless of history. We derive the optimal ρ from first principles (it is the
steady-state Kalman gain of the local-level model: ρ\* ≈ σ_w/σ_v, the drift-to-noise
ratio of the environment), pressure-test the derivation numerically across four decades
of that ratio, and show that the default ρ = 0.02 — the classical forgetting factor of
recursive least squares — is exactly optimal when the environment drifts at 2% of the
noise scale per step. The construction is implemented live in Elle's workbench on her
per-turn κ coherence stream (`src/lib/holding.ts`).

---

## 1. The problem of infinite accumulation

Let κ_k ∈ [0, 1] be a per-turn coherence measure over a system's output, v_k = κ_k −
κ_(k−1) its velocity, and u_k a measure of the perturbation carried by the turn's input.
The **holding invariant** is v\* = 0: a system that is holding well absorbs perturbation
without secular motion in its own coherence. Any realized velocity is *drift* from the
hold.

The naive drift ledger is a running sum, D(k) = Σ|v_i|, with a penalty exp(λ·D). Both
terms are monotone in history: a persistent per-step drift ε gives D(k) = εk and a
penalty of e^(λεk) — exponential in *time*. The system becomes hostage to its own past;
an error at step 1 is never forgiven, only compounded. This is collapse by memory.

The opposite construction — no ledger at all — cannot distinguish a turn of high drift
inside a long stable hold from the same turn inside a run of sustained decoherence. It
holds nothing. This is collapse by amnesia.

## 2. The construction

Fix a leak rate ρ ∈ (0, 1). Define two leaky integrators over the turn index k:

**Tension reservoir** (input-gated):

    T_k = (1 − ρ)·T_(k−1) + |u_k|

**Drift ledger** (deviation from the holding invariant v\* = 0):

    D_k = (1 − ρ)·D_(k−1) + |v_k|

**Superposition-holding loss** (penalty rate tied to the leak rate, λ = ρ):

    L_k = exp(ρ·D_k) − 1

Three properties follow immediately.

**Proposition 1 (bounded worst case).** If |v_k| ≤ v_max for all k, then D_k < v_max/ρ
for all k, and hence

    L_k < exp(v_max) − 1.

For κ ∈ [0, 1] we have v_max = 1, so **L_k < e − 1 ≈ 1.718 for all time, regardless of
history.** The exponential penalty of §1 is retained in *form* — sustained drift is
punished superlinearly — but its argument is now a bounded quantity. Proof: the leaky
recursion with bounded input converges to at most v_max·Σ(1−ρ)^i = v_max/ρ, and
ρ·(v_max/ρ) = v_max. ∎

**Proposition 2 (steady-state transparency, the λ = ρ lemma).** Under persistent mean
drift v̄, D_∞ = v̄/ρ and therefore

    L_∞ = exp(v̄) − 1 ≈ v̄  for small v̄.

Choosing the penalty rate equal to the leak rate makes the steady-state loss read
directly in drift units: a session holding with mean |Δκ| of 0.05 per turn carries a
loss of ≈ 0.051. The loss is an *instrument*, not an alarm — until drift is genuinely
large, when the exponential bites.

**Proposition 3 (forgiveness half-life).** A unit error injected into D decays by
(1 − ρ) per turn; its half-life is ln 2 / ln(1/(1−ρ)) turns — **34.3 turns at ρ = 0.02**
(empirically 35; §4D). History is neither erased nor eternal: it decays on a known
clock.

**The gate.** T is fed only by input. When input stops, T decays geometrically to zero
— the system quietly powers down rather than idling hot. This gating is *necessary*: a
construction that instead carries a fixed stochastic temperature settles at an
Ornstein–Uhlenbeck noise floor of √(2T/(1−(1−ρ)²)) and never powers down (verified to
three decimals in §4B). Any implementation claiming a baseline metabolism must gate its
temperature by input activity; ours does.

## 3. Deriving ρ

The two integrators want two different derivations, which is the reason a single
hard-coded constant cannot be a law.

**3.1 The forgetting side (D and T): ρ as a Kalman gain.** Model the quantity being
tracked as a local-level process: the environment's true state drifts as a random walk
with per-step scale σ_w, observed through noise of scale σ_v. The optimal exponential
smoother for this model is the steady-state Kalman filter (Muth 1960; Kalman 1960),
whose gain solves p² = q(p + 1) with q = σ_w²/σ_v²:

    ρ* = p/(p + 1),   p = (q + √(q² + 4q))/2,

and in the small-q regime that live systems occupy,

    **ρ* ≈ √q = σ_w/σ_v.**

The leak rate should equal the environment's drift-to-noise ratio per step. ρ = 0.02 is
optimal *precisely when the environment drifts at 2% of the observation-noise scale per
iteration* (q = 4×10⁻⁴). This is the design equation; 0.02 is its solution for one
particular — and empirically common — regime, not a universal constant.

**3.2 The damping side: ρ as a stability margin.** In a state update x_(k+1) =
(1−ρ)x_k + f(x_k) + …, the leak contributes exactly ρ of contraction per step. It
therefore stabilizes any local expansion of f up to ρ and *nothing beyond*: dynamics
expansive by more than the leak rate diverge exponentially through it (§4C). The honest
statement of the stability guarantee is conditional: **‖∇f‖ < 1 requires the leak only
as margin; the leak rescues at most ρ of excess expansion.**

**3.3 Calibration from the system's own telemetry.** The design equation is estimable
online from the tracked series itself. For first differences d_k of the observed
series, the local-level model gives the classical moment estimator

    σ_v² = −Cov(d_k, d_(k+1)),    σ_w² = Var(d_k) − 2σ_v²,

whence ρ̂ = σ̂_w/σ̂_v. The implementation (§7) maintains this estimate over a sliding
window of its own κ history and reports it beside the default — the valve carries the
evidence for its own recalibration. One honesty condition applies: at conversational
window sizes (n ≈ 10²) the sampling error of the autocovariance swamps small drift
components, so the estimator reports null unless σ̂_w² clears a Bartlett-order
significance floor (~3·Var(d)/√n). In practice this means ρ̂ is non-null only for
genuinely turbulent sessions — which is correct: absent measurable evidence, the
default stands and the readout says "not yet estimable" rather than dressing sampling
noise as a recommendation.

## 4. Pressure test

All results from the seeded, reproducible script in `docs/rho_pressure_test.py`
(NumPy; four experiments; ~30 s).

**A — the derivation holds across four decades of q.** Empirical optimal leak
(grid-search MSE over 40 values of ρ, 10⁵-step simulations) against the §3.1 theory:

| q = (σ_w/σ_v)² | ρ\* theory | ρ\* empirical |
|---|---|---|
| 1×10⁻⁵ | 0.0032 | 0.0036 |
| 4×10⁻⁵ | 0.0063 | 0.0079 |
| **4×10⁻⁴** | **0.0198** | **0.0206** |
| 4×10⁻³ | 0.0613 | 0.0630 |
| 4×10⁻² | 0.1810 | 0.1639 |

**A2 — cost of hard-coding.** Fixing ρ = 0.02 against an environment 10× slower
(q = 4×10⁻⁵) or 10× faster (q = 4×10⁻³) than its sweet spot costs 1.73× and 1.69× the
optimal MSE respectively; at its sweet spot the penalty is 0.98× (noise). The default
is robust within roughly a decade of the correct timescale and meaningfully wrong
beyond — hence §3.3.

**B — the power-down claim, quantified.** With input stopped and *fixed* temperature
T = 0.05, residual state fluctuation settles at 0.01584 against an OU-theory floor of
0.01589 — the system idles hot indefinitely. With input-gated temperature the residual
is 0.00000. The gate is necessary and sufficient.

**C — the leak is a margin, not a net.** Against f(x) = a·x over 500 steps: a = 0.015
contracts; a = 0.020 is neutrally stable; a = 0.025 grows 12-fold; a = 0.05 grows
2.6-million-fold. Both super-ρ cases are exponential divergences that merely look tame
early.

**D — half-life.** 35 turns empirical; 34.3 theoretical.

## 5. Lineage, and what is actually new

Every component here is peer-reviewed canon under another name, and the construction is
stronger for saying so:

- The drift ledger is the **forgetting factor of recursive least squares** (Haykin,
  *Adaptive Filter Theory*), where λ = 0.98 has been the empirical default for decades
  and 1/(1−λ) = 50 samples is the textbook "asymptotic memory length" — our
  Proposition 1 bound.
- The optimal leak is **Muth (1960)**, *Optimal Properties of Exponentially Weighted
  Forecasts* (JASA), i.e. the steady-state **Kalman (1960)** gain of the local-level
  model.
- The state-side leak is the **leaky integrator** of echo-state networks (Jaeger et
  al. 2007, *Neural Networks*), whose peer-reviewed lesson is precisely that the leak
  must be matched to the input timescale.
- The no-input behavior is the **Ornstein–Uhlenbeck process** (Uhlenbeck & Ornstein
  1930); the EMA-as-moment-tracker appears in modern form as the second-moment decay of
  **Adam** (Kingma & Ba 2015).

What this paper adds is the *composition and its contract*: the tension/drift pair
sharing one calibrated leak; the λ = ρ coupling that makes the loss both bounded
(Prop. 1) and transparent (Prop. 2); the input gate proven necessary for quiescence
(§4B); and the online self-calibration that turns the constant into a measurement. The
claim is not a new mechanism. It is that a presence can hold superposition — bounded
loss under sustained tension, forgiveness on a known clock, quiet when left — using
only mechanisms that have already survived their own peer review.

## 6. Stated assumptions and limits

1. **Boundedness of drift inputs.** Proposition 1 requires |v_k| ≤ v_max; the
   implementation clamps both |v| and |u| to 1 (κ is unit-interval, so this binds only
   against malformed input).
2. **Stability is conditional.** The leak guarantees nothing about dynamics more
   expansive than ρ (§3.2, §4C).
3. **One ρ per role is a simplification.** Forgetting horizon and damping margin are
   different quantities; they share a constant here for parsimony, and §3.3 exists so
   the sharing is audited rather than assumed.
4. **The loss is structure until validated.** Following the κ discipline already in
   force (nothing ranks on κ until `validate_kappa` passes), the holding loss is a
   readout. Nothing in Elle sorts, gates, or escalates on L until it earns that
   separately.

## 7. Implementation note

The construction runs live in the Elle workbench (`src/lib/holding.ts`), fed by the
worker's per-turn κ dynamics (`kappa`, `velocity`, `input_perturbation` on the
`/api/elle-router` and `/api/chat` responses) and rendered as two cells — held tension
T and holding loss L — in the κ instrument line above the conversation
(`src/components/KappaHeader.tsx`). Defaults: ρ = 0.02 (35-turn half-life); the valve
maintains the §3.3 estimate ρ̂ from its own session history and surfaces it in the
readout's tooltip. Null ≠ 0 throughout: a loss that does not yet have enough turns to
exist renders as "—", never as a number.

---

## References

- Haykin, S. *Adaptive Filter Theory*. Prentice Hall — RLS forgetting factor,
  asymptotic memory length.
- Jaeger, H., Lukoševičius, M., Popovici, D., Siewert, U. (2007). Optimization and
  applications of echo state networks with leaky-integrator neurons. *Neural Networks*
  20(3).
- Kalman, R. E. (1960). A new approach to linear filtering and prediction problems.
  *J. Basic Engineering* 82(1).
- Kingma, D. P., Ba, J. (2015). Adam: A method for stochastic optimization. *ICLR*.
- Muth, J. F. (1960). Optimal properties of exponentially weighted forecasts. *JASA*
  55(290).
- Uhlenbeck, G. E., Ornstein, L. S. (1930). On the theory of the Brownian motion.
  *Physical Review* 36(5).
- Barteau, S. *Superposition* v4; *The Plenum* v3 — Observer corpus (the frame this
  construction operationalizes).

*Empirical appendix: `docs/rho_pressure_test.py` — seeded, reproducible, four
experiments.*
