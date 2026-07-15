# The Coherence Regulator — Engineering Synthesis

**A φ-based dynamical instrument for measuring and regulating coherence, built
and validated end-to-end on real market data. One synthesis of the whole arc:
the math, the architecture, every measured result, the honest negatives, and
the open frontier.**

Status: **SHADOW** throughout — the instrument runs live on real data and
records everything, but gates no real decision until each promotion is earned by
measurement. Companion docs (per component): `RECOVERY_VS_ATR_REAL.md`,
`RECOVERY_OVERLAY_REAL.md`, `WITNESS_GATES.md`, `CONVICTION_LIVE.md`, `SPINE.md`,
`KAPPA_BACKTEST.md`, `DISSONANCE.md`, `PERTURBATION.md`, `REGIME.md`,
`PHI_OSCILLATOR.md`, `COHERENCE_FIELD.md`. · 2026

---

## 0. The one-paragraph version

A single coherence variable **κ ∈ (0,1)** is derived from a parameter-free
two-term recovery recurrence whose only constant is the golden ratio φ. It runs
as a leaky log-odds regulator with **open rails** (complete failure and complete
success are structurally unreachable) and an **inverse collapse/recovery law**
(trust is lost φ² ≈ 2.618× faster than it is earned). Measured on six years of
real daily data across seven instruments, κ is a **state variable** — it tracks
the volatility regime (SPY κ→forward-vol r = 0.394) but does **not** forecast
direction. Its two-timescale **beat (dissonance)** is a **transition** detector,
and applied as a **golden-frequency oscillator** it keeps the needle off the
bottom (waking on 1.8–4.6% of bars where a constant perturbation was frozen at
0%) without ever breaching the open rails. The measured identity is a
**coherence/risk instrument, not an alpha oracle** — and the open question is
whether κ computed over the *relational graph* (not price) can lead the
observable, which would make it a general adaptive-system framework rather than
a risk model.

---

## 1. Method — how everything here was built

Every claim in this document was produced under one discipline, because the
subject invites confabulation and the whole point was to refuse it:

- **SHADOW first.** Nothing gates a real decision until measurement earns it.
  Modules are pure and self-contained; the live wiring is best-effort and
  reversible; order-touching enforcement sits behind an explicit flag.
- **Pre-registration.** Claims are registered *before* the run. When a
  pre-registered claim fails, it is **pinned as measured reality** with the
  mechanism named in the test and the doc — never quietly dropped. Multiple
  own-predictions were refuted this way and kept on the record.
- **Measured, not narrated.** "Notation doesn't close gates; measurements do."
  Results live in D1 tables and are read back verbatim, not paraphrased.
- **Real data.** 6 years of daily OHLC (Alpaca, IEX feed) across
  SPY/QQQ/NVDA/AAPL/TSLA/GLD/TLT, warmed on the first half, tested
  out-of-sample on the second.

Test count grew from ~628 to **750** over the arc; `tsc --noEmit` clean at every
step.

---

## 2. The core instrument — the φ recovery regulator

### 2.1 φ falls out; it is not chosen

Define recovery as genuinely recursive — this step built from the last *two*
recovered states, no free parameters:

```
R_k = R_{k-1} + R_{k-2}            (Fibonacci)
```

Its characteristic equation x² = x + 1 has positive root **φ = (1+√5)/2**. Raw
Fibonacci explodes, so renormalize by its own growth (d_k = D_k/φ^k):

```
d_k = φ⁻¹·d_{k-1} + φ⁻²·d_{k-2}       with   φ⁻¹ + φ⁻² = 1
```

— a **convex combination** of the last two states. Bounded in [0,1] by
construction (no clamps anywhere in the update path). Constants:

```
PHI = (1+√5)/2 ≈ 1.618
W1  = φ⁻¹      ≈ 0.618      (weight on κ_{k-1})
W2  = 1 − W1 = φ⁻² ≈ 0.382  (float-exact complement — sum is exactly 1)
```

Strain and recovery are the same φ⁻¹ contraction read in opposite directions;
the sideways-grind fixed cycle converges to exactly **{1/3, 2/3}**.

### 2.2 The asymmetric log-odds regulator

State lives in log-odds z = ln(κ/(1−κ)); κ = logistic(z). A ρ-leaky integrator
enforces two design constraints:

- **Inverse proportionality** — "collapse rate inversely proportional to
  recovery rate": `S_C · S_R = s²` exactly, with φ the canonical pair
  `S_C = φ·s`, `S_R = φ⁻¹·s` → ratio **φ² ≈ 2.618**. Trust lost 2.6× faster than
  earned; behaviorally, one violation takes **ceil(φ²) = 3** confirmations to clear.
- **Open rails** — "never let the loss function achieve complete failure or
  success": the leak bounds |z| < Z strictly, so κ is confined to the **open**
  interval. At defaults (ρ=0.10, Z=3): κ ∈ **(0.047, 0.759)**. The rails are
  themselves asymmetric *by consequence* — the success ceiling sits nearer
  neutral than the failure floor, so complete success is structurally harder to
  approach than complete failure.

### 2.3 The step invariant

"One step is the leak-rate floor." A single perturbation — even maximal — cannot
carry the state across a threshold; thresholds are reached by **accumulation
only**. Exact minima, proven live:

| clock | steps to strain from rest |
|---|---|
| ρ=0.02 slow valve (historian) | **13** |
| ρ=0.10 fast regulator | **7** |
| regulator from neutral (0.15 floor) | 4 |
| from full conviction | 6 |

Knee at ρ ≈ 0.223 (where one maximal step *can* strain). The 2% floor carries
11× slack.

---

## 3. Live channel — conviction (`conviction.ts`, promoted)

The regulator wired into the real trading cron as exactly what it measured to be
— a **drawdown-shaper**:

- Every open equity position carries a regulator; one cron cycle = one
  observation. Direction is thesis-relative (a red bar *confirms* a short);
  weight is the validated perturbation form `w = |ret| / (2·ATR)` on a
  self-seeding n=22 Wilder scale.
- State persists in D1 (`elle_conviction`), stepped through the **pure**
  `stepAsymmetricZ` — proven float-identical to the in-memory closure.
- κ is surfaced into the decision prompt every cycle (Elle sees her own strain).
- Sizing is **de-risk only**: `target = entryQty · min(1, κ/0.5)`. Neutral or
  charged ⇒ full size (the Gate-2 lesson: no up-levering). The size floor is
  **open** (~9.5%), and the trim target is floored at 1 unit — a position is
  never flattened by the regulator (a real hole the tests caught: `floor()`
  would have rounded the last share away). Full exits belong to the decision
  loop and RULE 0 (price-space hard stops, outside κ).
- The trim **executor** is gated behind `ELLE_CONVICTION_ENFORCE=on`; the ledger
  runs and records what it *would* do either way.

**Validation trail** (5yr real OHLC, 591 paired trend envelopes): the binary
exit was retired (−0.08R, tail amputated); the perturbation overlay rehabilitated
it (+0.37R, half the exposure, 44% shallower worst trade); the asymmetric overlay
was the best drawdown-shaper (worst −0.89R vs −1.92R incumbent) at a modest tail
cost. Three "witness gates" (costs / leverage / mean-reversion niche) closed by
measurement — two against the spec's own formulas. Final identity: **cheapest-to-
run left-tail control in the series, not an alpha source.**

---

## 4. The decision spine (`spine.ts`)

The unified Falcon: **three tier-collapses in order** (Tier 1 → collapse → feeds
Tier 2 → collapse → feeds Tier 3 → collapse), then **dissent holds all three
without collapsing them**, and **Axis 17 (the Future Axis) is the only thing that
collapses the decision** into a prediction gated by κ.

The unification is literal: **one spine run = one observation on the decision
regulator**, the exact parallel of one cron cycle being one observation on a
position regulator. The three tiers set the observation's direction (does the
field cohere) and weight (agreement × confidence); a coherent field steps
`recover`, a contested one `strain`, through the **same `stepAsymmetricZ`**.
Conviction is earned across repeated coherent runs, never one (single-step-no-
collapse carried over); a credible dissent reverses the sign of the update. The
drawdown-shaper that sizes a trade and the regulator that gates a decision are
the **same instrument over different streams**. Gates nothing; predictive value
of Axis 17 remains the registered open measurement.

---

## 5. Two clocks, dissonance, and the φ oscillator

### 5.1 The pathology the backtest exposed

A single self-normalized regulator grades a stream against its *own* volatility
(w = |ret|/2·ATR), so every bar is "normal-sized against itself." It re-scales
into any regime and can never be surprised: **frac_strained = frac_charged = 0
on all seven symbols across three years.** A self-referential signal sinks below
its own noise floor and goes quiet.

### 5.2 Dissonance — signal from disagreement

Two clocks watch the same stream: **fast** (ρ=0.10, the smoke alarm) and **slow**
(ρ=0.02, the historian). Both equilibrate to the same level under steady state
(z* = −w·zMax, independent of ρ — proven), so calm *or* steady trend ⇒ they agree
⇒ no signal. A regime **change** makes the fast clock lurch while the slow lags
⇒ they diverge. `D = κ_fast − κ_slow` is the dissonance — the **beat frequency
between two φ-regulators**: silent during agreement, loud during change. A
transition detector, orthogonal to the κ level.

### 5.3 Dissonance is a regulator, not a forecaster

Measured as a *predictor*, dissonance is weaker than the κ level and was the
wrong yardstick. Its job is **perturbation** — to keep the needle off the bottom.
Wired back in as extra drive, it is stochastic resonance that lifts the sub-
threshold signal over the rail.

### 5.4 The φ oscillator — a constant fails, the golden frequency works

A **constant** bias cannot lift a stuck needle (measured: constant gain → 0%
active on real data). Dissonance is a **φ oscillator**:

```
θ_{k+1} = θ_k + 2π·φ⁻¹   (mod 2π)              — the golden rotation
z_reg   = stepAsymmetricZ(z_reg, dir, w, ρ) + A·|D|·sin(θ)
```

Why φ specifically: the golden ratio is the **most irrational number**, so a
φ-frequency rotation is maximally **non-resonant** — `{k·φ⁻¹ mod 1}` is the most
equidistributed sequence there is; it never phase-locks and never repeats. In
KAM theory the **golden torus is the last invariant curve to break** under
perturbation. So a φ oscillator keeps the needle perpetually exploring — off the
bottom — without resonating into a lock (settle) or a blow-up. Any other
frequency risks phase-locking with the market's own periodicities; φ is the one
that structurally can't. `A·|D|` is dissonance-gated (silent in steady state);
κ = logistic(z) ∈ (0,1) for any finite z, so the open-rail invariant survives any
bounded oscillator by construction.

---

## 6. The coherence field — measured material ground (`coherence.ts`)

Tier 1 ("Material Ground") must be **measured or retrieved, never generated.**
This is the measured half — a coherence field over real prices, on two orthogonal
axes and three scales:

- **Temporal** (each instrument vs its own past): κ + dissonance.
- **Spatial** (instruments vs each other): cross-sectional correlation — do an
  area's members move as a bloc or disperse. Dissonance across *space*.
- Scales: **instrument → area (sector) → world map**, the Falcon's Scalar
  Structure axis (one instrument at every scale). The world map adds **inter-area
  coherence** — do the sectors themselves move as one bloc (risk-on/off).

---

## 7. The three-clock decomposition

The arc converges on a clean dynamical-systems reading — **κ and dissonance are
different observables and the information lives in their interaction**, `Risk =
f(κ, Δκ, D)`, not `f(D)`:

| clock | observable | role | measured |
|---|---|---|---|
| **state** | κ level | where the system sits (altitude) | vol-regime discriminator; SPY κ→vol r=0.394 |
| **transition** | dissonance / φ-oscillator | the system is changing (acceleration) | fires ~4% on indices, 20-day lead |
| **recovery** | φ⁻¹ rate / κ half-life | how fast coherence returns | half-life ≈ 6.9 bars = ln2/ρ, ρ=0.10 |

The recovery clock is not a free parameter: the measured κ half-life (6.5–7.8
bars for equities) matches the regulator's own leak timescale ln(2)/0.10 = **6.93**
almost exactly. The market obeys the regulator's designed recovery rate.

---

## 8. The empirical record — every measured result

### 8.1 κ backtest (6yr, train/test, horizon 5d)

| symbol | SNR κ | κ→vol | κ→dir | frac at rail | κ enters test |
|---|---|---|---|---|---|
| SPY | 0.188 | **+0.394** | −0.081 | 0 | 0.533 |
| QQQ | 0.088 | +0.282 | −0.094 | 0 | 0.528 |
| NVDA | 0.017 | +0.117 | −0.071 | 0 | 0.507 |
| AAPL | 0.016 | +0.130 | −0.126 | 0 | 0.496 |
| TSLA | 0.005 | +0.071 | −0.014 | 0 | 0.502 |
| GLD | 0.008 | −0.036 | −0.027 | 0 | 0.497 |
| TLT | 0.0004 | +0.016 | −0.082 | 0 | 0.454 |

κ **fluxes** (warm-start lifts it off 0.5, never pinned), **leads forward
volatility** on the indices, **never crosses a rail** (the pathology), and does
**not** forecast direction (the honest null, held out-of-sample).

### 8.2 Dissonance backtest

frac_fired 0.27–0.37 on every symbol (fires where single-κ was 0). diss→vol weak
and mixed (+0.12 SPY, negative AAPL/TLT) — **lost to the κ level** on vol
prediction. diss→dir ≈ 0. Verdict: a transition marker, not a better forecaster.

### 8.3 Regime analysis — the interaction

`interaction_real` (forward-vol in κ-low·D-rising > κ-high·D-rising): **6 of 7**.
SPY cells — the same rising dissonance precedes **0.019** forward vol when κ is
low vs **0.011** when κ is high (72% more, by κ context alone). The dominant
pattern: **low-κ cells carry the vol, high-κ cells the calm — universally.** κ
level is the regime discriminator; dissonance modulates within it.

- **SNR + confidence index**: SPY κ conf **1.0** (trust), dissonance **0.29**
  (indexed down). TLT both ≈ 0 (index says *use neither*). GLD flips —
  dissonance conf 0.50 > κ 0.17 (gold's vol is transition-driven).
- **Lead-time**: peak horizon **20 days** for 5 of 7 — dissonance is a slow
  (~monthly) vol-regime precursor, not a next-day trigger.
- **Recovery half-life**: 5.0–7.8 bars (≈ ln2/ρ).

### 8.4 Perturbation & the φ oscillator (three-way, real data)

| symbol | plain | constant | **φ oscillator** | rail breaches | vol active / quiet |
|---|---|---|---|---|---|
| SPY | 0 | 0 | **4.6%** | 0 | 0.0298 / 0.0147 (**2.0×**) |
| QQQ | 0 | 0 | 4.2% | 0 | 0.0379 / 0.0205 (1.85×) |
| AAPL | 0 | 0 | 4.0% | 0 | 0.0331 / 0.0297 (1.11×) |
| TLT | 0 | 0 | 3.6% | 0 | 0.0124 / 0.0146 (0.85×) |
| NVDA | 0 | 0 | 3.4% | 0 | 0.0507 / 0.0501 (1.01×) |
| TSLA | 0 | 0 | 2.6% | 0 | 0.0804 / 0.0595 (1.35×) |
| GLD | 0 | 0 | 1.8% | 0 | 0.0268 / 0.0211 (1.27×) |

The φ oscillator **wakes the needle** where plain *and* constant both froze (0%),
**never breaches the open rails**, and **self-gates** to higher forward vol on
the equity indices (SPY 2.0×, QQQ 1.85×). Honest exceptions: NVDA flat, TLT
inverted (on bonds the activation is closer to noise). Only the golden *frequency*
made it work — the constant of the same scale did nothing.

### 8.5 The coherence field — a live world-map snapshot

World: mean κ **0.42**, cross-coherence 0.59, **inter-area coherence 0.06**.

| area | mean κ | cross-coherence | firing |
|---|---|---|---|
| energy | 0.44 | **0.913** (tight bloc) | 0 |
| semis | 0.40 | 0.65 | 0.20 |
| broad_market | 0.42 | 0.63 | 0 |
| financials | 0.48 | 0.62 | **0.25** (in transition) |
| megacap_tech | 0.43 | 0.44 (idiosyncratic) | 0 |
| safe_haven | 0.36 | **0.19** (fragmented) | 0 |

Read: energy trades as one bloc; safe-havens are decoupled (gold ≠ bonds);
financials churning; **inter-area 0.06 ⇒ no unified macro regime** (sector-
rotation, not risk-on/off panic). This is measured ground, no LLM inventing it.

---

## 9. Refuted own-predictions (kept on the record)

The honesty ledger — pre-registrations that failed and were pinned with
mechanisms named:

1. Slow-bleed exit superiority → dead tie (trailing stops close distance without
   range expansion).
2. Overlay per-unit efficiency (P1) → −14% (recorded, not hidden).
3. Gate-2 vol-normalization → NVDA 0.439R (dollar-ATR re-amputates the tail).
4. Gate-3 knife cutoff → inverted (bleed-heavy universe).
5. Round-2 cost speculation → **backwards** (the overlay is *cheaper* than the
   incumbent, turnover 1.37 vs 2.00).
6. Dissonance as a vol forecaster → lost to the κ level (it's a regulator, not a
   predictor).
7. Constant-gain perturbation → froze at 0% on real data (needed the oscillator).

---

## 10. What is settled, and the open frontier

**Settled (measured, out-of-sample):**
- κ is a **state / volatility-regime** variable, not a direction forecaster.
- Dissonance is a **transition** detector; the φ oscillator makes it a live,
  rail-crossing, self-gated alarm without breaking the open rails.
- Recovery is the **ρ-leak** timescale; real κ obeys it (half-life ≈ 6.9 bars).
- The information lives in **f(κ, Δκ, D)**, and the confidence index tells you
  which variable to trust per asset.
- Measured identity: a **coherence/risk instrument** — cheapest-to-run left-tail
  control, robust to 10× costs, regime-independent — **not an alpha oracle.**

**The open frontier (the fork that decides what this *is*):**

> Does κ merely **summarize** market behavior, or does it **emerge from the
> relational structure of the graph** before the observable outcome moves?

Everything measured so far is **price-derived** — κ is computed from returns, so
it cannot lead its own inputs. For κ to lead the observable it must be computed
over a *different substrate than price* — the **association graph** (the corpus,
the events, who-relates-to-whom). If relational coherence shifts before price
does, the architecture crosses from a **risk model** to a **general adaptive-
system framework.** That experiment needs the graph as a first-class signal
source, and two still-unbuilt pieces support it:

1. **Wire Tier 1 to *read* the coherence field** instead of generating ground —
   collapse the LLM's job from *inventing* market reality to *reading the
   instruments*.
2. **The precedent library** (~280 outcome-labeled historical events) — the
   *prior* ground that gives the first numbers a real origin (base rates over
   the most-similar precedents), answering "where did the first numbers come
   from." The measured coherence field is the *present* ground; this is the
   *prior*.

---

## Appendix — file & table map

| concern | module | D1 table | tests |
|---|---|---|---|
| φ regulator | `recovery.ts` | — | `recovery*.test.ts`, `step-invariant.test.ts` |
| conviction (live) | `conviction.ts` | `elle_conviction`, `elle_conviction_replay` | `conviction.test.ts` |
| decision spine | `spine.ts` | `elle_spine_runs` | `spine.test.ts` |
| κ backtest | `backtest.ts` | `elle_kappa_backtest` | `backtest.test.ts` |
| dissonance | `dissonance.ts` | `elle_dissonance_backtest` | `dissonance.test.ts` |
| perturbation | `perturbation.ts` | `elle_perturbation_backtest` | `perturbation.test.ts` |
| φ oscillator | `phi-oscillator.ts` | `elle_phi_perturbation_backtest` | `phi-oscillator.test.ts` |
| regime analysis | `regime.ts` | `elle_regime_analysis` | `regime.test.ts` |
| coherence field | `coherence.ts` | `elle_coherence_field` | `coherence.test.ts` |

All SHADOW. The one-shots and daily refresh run from the trading cron
(`trading.ts`), each guarded and best-effort. Enforcement is behind
`ELLE_CONVICTION_ENFORCE`. Everything else records and waits for the next
measurement to earn its promotion.
