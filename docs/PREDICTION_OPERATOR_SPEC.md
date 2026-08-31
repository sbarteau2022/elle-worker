# PREDICTION OPERATOR SPEC — 𝒫

Work-stream **S4** of run `elle-siege-fixes-2026-08-31`. Finding **L1**.
Design only. This document changes no source, adds no test, and is not a patch.

Author's note on evidence discipline: **every factual claim below is tagged**
`[MEASURED]` (a command was executed in this session and its output observed) or
`[READ]` (text was read out of the working tree, but nothing was executed to
confirm it describes runtime behaviour). Numbers that appear without a tag do
not exist in this document. Where a number was read out of a results file that
this session did **not** regenerate, it is tagged `[READ — results file, not
re-run here]`.

Repo state at time of writing: `[MEASURED]` `git rev-parse --short HEAD` →
`46085d4`; `git status --porcelain` →

```
 M docs/OBSERVER_BLANKET_SIEGE_RESULTS.txt
 M docs/PAMI_DHNG_SIEGE_RESULTS.txt
 M docs/observer_blanket_siege.cjs
 M src/hyper.test.ts
 M src/hyper.ts
```

So the working tree is **dirty**: sibling streams S1/S3/S5 have uncommitted work
in flight. Section 6 below distinguishes HEAD state from working-tree state
wherever it matters.

---

## 0. VERDICT — THE GAP IS REAL

**There is no prediction operator anywhere in `src/`. 𝒫 is named in exactly two
comments and implemented in zero lines of code. In production, 𝒫 = identity and
the "residual" is the raw signal.**

The premise was verified before a word of design was written, and it was **not**
contradicted. The evidence, verbatim:

### E1 — `pamiIndex` *receives* the residual; it never *derives* one

`[MEASURED]` `sed -n '112p' src/pami.ts`:

```
export function pamiIndex(residual: number[], cfg: PamiConfig = SPEC_CONFIG): PamiIndex | null {
```

`residual` is a parameter. There is no call site inside `pami.ts` that computes
it. The pipeline downstream of it is fully implemented — `[MEASURED]`
`sed -n '72p;75p;107p' src/pami.ts`:

```
export function phiWaveletTransform(signalIn: number[], cfg: PamiConfig = SPEC_CONFIG): ScaleRow[] | null {
  if (n < 32) return null;
  return rows.length >= 4 ? rows : null;
```

### E2 — the type comment delegates the subtraction to the caller

`[MEASURED]` `sed -n '617p' src/pami.ts`:

```
  signal?: number[];       // the residual window (caller subtracts its prediction; identity-𝒫 = raw signal, dream-pass semantics)
```

### E3 — 𝒫 appears **once** in the entire source tree, in that same comment

`[MEASURED]` `grep -rn "𝒫" src/`:

```
src/pami.ts:617:  signal?: number[];       // the residual window (caller subtracts its prediction; identity-𝒫 = raw signal, dream-pass semantics)
```

One hit. A comment. No definition, no implementation, no test.

### E4 — the production entry point asks a language model to do the subtraction

`[MEASURED]` `awk 'NR==553' src/router.ts` (tool-catalog string, excerpt):

```
op=encode{signal}: residual window (subtract your prediction first; raw signal = dream-pass semantics) → its index.
```

`[READ]` `src/router.ts:1462` — `return clip(await pamiTool(env, a as PamiToolInput));` — the
argument object is LLM-authored JSON. Nothing on that path subtracts anything.

### E5 — no numeric predictor exists to be wired in

`[MEASURED]` `grep -rain "predict\|forecast\|kalman\|ewma\|autoregress\|one-step\|nextValue" src/*.ts | grep -v "\.test\.ts"` returns
prose and unrelated machinery only. The nearest named things:

- `src/spine.ts:162` `[READ]` — `export function axis17(field: DecisionField, dis: DissentReport, z: number): Prediction` —
  a prose/κ-gate over a `DecisionField`, not a numeric operator over a signal.
- `src/backtest.ts` `[READ]` — a κ back-test whose own header records
  `PT-BT3  κ does NOT predict forward DIRECTION`. It scores an existing quantity;
  it does not produce a one-step-ahead value for `pamiIndex`.
- `src/llm.ts:550` `[READ]` — `num_predict` is an Ollama token-budget field. Noise.

No Kalman filter, no EWMA, no AR model, no `nextValue`. Nothing.

### E6 — the only other production caller feeds a synthetic generator, not a residual

`[MEASURED]` `grep -rn "pamiIndex(" src/*.ts | grep -v "\.test\.ts"` — outside
`pami.ts` the only hits are `src/phi-minimax-scorecard.ts:73,98,165`, all of the
form `pamiIndex(memorySignalNeutral(N, s), cfg)`. `[READ]`
`memorySignalNeutral` synthesises summed sines with amplitude modulation. It is a
signal, not a residual of anything.

**Conclusion.** The architecture documents state that the residual is the
prediction error. The code states that someone else is expected to have already
subtracted a prediction. Nobody does. The system therefore indexes the geometry
of *raw signals* while describing itself as indexing the geometry of *surprise*.
Those are different claims, and only the weaker one is currently true.

---

## 1. TYPE SIGNATURE

### 1.1 What the consumer actually accepts

Grounded in the real code, not paraphrase.

`[MEASURED]` `sed -n '55p' src/pami.ts`:

```
export const SPEC_CONFIG: PamiConfig = { phaseCount: 8, qMax: 6, scaleKMin: -4, scaleKMax: 8, baseScale: 4 };
```

`[MEASURED]` `sed -n '63p' src/pami.ts`:

```
const MAX_SIGNAL = 4096;
```

`[MEASURED]` `sed -n '75p;107p' src/pami.ts`:

```
  if (n < 32) return null;
  return rows.length >= 4 ? rows : null;
```

So the consumer's contract, as enforced by executable code, is:

| property | value | provenance |
|---|---|---|
| input element type | `number` (finite; non-finite dropped upstream) | `[READ]` `pami.ts:112` signature |
| minimum length | 32 samples, else `null` | `[MEASURED]` `pami.ts:75` |
| maximum length | 4096 (`MAX_SIGNAL`) | `[MEASURED]` `pami.ts:63` |
| additional gate | ≥ 4 surviving wavelet scale rows, else `null` | `[MEASURED]` `pami.ts:107` |
| output | `PamiIndex` = 8 phases on 𝕋⁸ + 13 dims D(q) ∈ ℝ¹³ | `[READ]` `pami.ts:55`, `phaseCount: 8`, `qMax: 6` ⇒ q ∈ {−6..6} |

### 1.2 The signature of 𝒫

𝒫 is a **one-step-ahead point predictor over a scalar time series**, applied
causally and pointwise:

```
𝒫 : (history: number[]) -> number
```

- **Input**: `y[0..t-1]`, the observations strictly *before* index `t`. A
  compliant 𝒫 must never read `y[t]` or later. This is not stylistic — it is what
  makes the acceptance criteria in §4 meaningful.
- **Output**: `ŷ[t] ∈ ℝ`, a single scalar in the **same units as the observation**.
- **Units**: whatever the source series is denominated in. 𝒫 introduces no unit
  change, which is what allows the subtraction in §2 to be dimensionally legal.
- **Statefulness**: 𝒫 may carry internal state (§3), but that state must be a
  function of `y[0..t-1]` only.

### 1.3 The derived residualiser

The thing that actually gets called is the wrapper:

```
residualise : (y: number[], P: Predictor) -> number[]
```

Contract:

1. Emits one residual per input sample from `warmup` onward, so
   `out.length === y.length - warmup`.
2. **MUST reject rather than pad**: if `y.length - warmup < 32` the wrapper
   returns `null`. Padding to reach the `pami.ts:75` floor would manufacture
   structure that the wavelet transform would then faithfully report. `[MEASURED]`
   the floor is `if (n < 32) return null;`.
3. **MUST truncate at 4096** (`MAX_SIGNAL`, `[MEASURED]` `pami.ts:63`), keeping
   the most recent samples, so that windowing is not silently done twice.
4. Non-finite in ⇒ the whole call returns `null`. Never substitute 0 for NaN: a
   zero residual is the strongest possible claim ("perfectly predicted") and must
   never be produced by an error path.

### 1.4 What 𝒫 is explicitly NOT

- Not a predictor of `PamiIndex` values. It predicts in **observation space**,
  before the wavelet transform. Predicting phases or D(q) would be a different
  operator with different (and much harder) acceptance criteria; see §7.
- Not multi-horizon. Horizon is fixed at 1 sample. `[READ]`
  `docs/PREDICTIVE_CODING_LITERATURE.md` §0 records the caution that one-step
  accuracy "fails to order long-horizon success at all" — that caveat is
  inherited **UNVERIFIED** (see §7.4) and is a reason not to over-claim from a
  passing §4, not a reason to widen the horizon here.

---

## 2. THE RESIDUAL IDENTITY

### 2.1 The identity

```
R(t) = y(t) − 𝒫(y[0..t−1])            for t = warmup .. n−1
```

- **`observed(t)` = `y(t)`**, the raw scalar sample at index `t`, in source units.
- **The subtraction happens in observation space** — the same ℝ¹ the samples live
  in, *before* `phiWaveletTransform`.
- **Why that space.** Three reasons, in order of force:
  1. **Dimensional legality.** `𝒫` outputs source units (§1.2), so the difference
     is defined. Subtracting in phase space would mean subtracting angles on 𝕋⁸,
     where the wrap seam is currently broken (§6.2).
  2. **Linearity of the consumer's front end.** `[READ]` `pami.ts:72`
     `phiWaveletTransform` is a convolution against complex Morlet kernels — a
     linear operator W. So `W(y − ŷ) = W(y) − W(ŷ)`, meaning residualising in
     observation space is exactly equivalent to residualising each wavelet
     coefficient, and is cheaper and auditable. This equivalence does **not**
     survive the nonlinear stage (leaders → structure functions → ζ(q) → D(q)),
     which is precisely why the subtraction must happen upstream of it.
     `[UNMEASURED]` — this is an algebraic claim about the code as read; it has
     not been checked numerically in this session.
  3. **Falsifiability.** In observation space a baseline predictor is trivially
     definable (§4), so 𝒫 can lose.

### 2.2 How `pami.ts` constructs R(t) today — exactly

It **does not construct it at all.** `[MEASURED]` `pami.ts:112` takes `residual`
as a parameter; `[MEASURED]` `pami.ts:617` states the caller is responsible; and
`[MEASURED]` `grep -rn "𝒫" src/` yields that one comment and nothing else.

The effective production behaviour, by composition of `[READ]` `router.ts:1462`
→ `[READ]` `pami.ts:625` `export async function pamiTool(env: Env, a: PamiToolInput): Promise<string>`
→ `[READ]` `pami.ts:629` `const idx = pamiIndex(a.signal ?? []);` is:

```
R(t) = y(t) − 0        i.e.   𝒫 = identity-on-nothing,  R = y
```

**Is that consistent with the identity?** It is a **degenerate instance** of it:
`𝒫 ≡ 0` is formally a predictor, so the identity is not violated. But it is
inconsistent with every *claim* built on top of it. `[READ]` the `pami.ts` header
comment — "memory stored as the geometric residue of surprisal" — describes an
index over surprise. With `𝒫 ≡ 0` the index is over the signal itself. The file
is honest about this and names the regime: `[MEASURED]` `pami.ts:617` calls it
"dream-pass semantics". The gap is not a bug in the identity; it is the total
absence of a non-trivial 𝒫 to instantiate it with.

### 2.3 Required invariants of any implementation

- **I1 — Causality.** `R(t)` must be computable from `y[0..t]` alone. A test that
  reverses the tail of `y` beyond index `t` must leave `R(0..t)` bit-identical.
- **I2 — Length.** `residualise` returns exactly `n − warmup` values, or `null`.
- **I3 — No fabricated zeros.** No error path may emit `0`.
- **I4 — Translation.** `y + c ⇒ R` unchanged, for any 𝒫 that is
  translation-equivariant (the baselines in §4 are). This is a cheap unit test
  and catches most sign and indexing errors.
- **I5 — Identity fallback is explicit.** If a caller genuinely wants dream-pass
  semantics it must pass an explicit identity predictor, not omit the argument.
  Silence must not mean `𝒫 ≡ 0`.

---

## 3. WHAT PLAYS THE ROLE OF THE PRIOR

The prior is **a running statistic, not a learned model** — this is a design
decision, and here is the argument for it and the cost of it.

### 3.1 The decision

**Recommended: a running statistic (online, per-series, no training corpus).**

Rationale:
- `[MEASURED]` `pami.ts:63` `const MAX_SIGNAL = 4096;` and `[MEASURED]`
  `pami.ts:75` `if (n < 32) return null;` — the operating range is 32 to 4096
  samples of a *single* series. There is no cross-series corpus in the call path
  to train on, and a 32-sample series cannot support a fitted model with any
  meaningful parameter count.
- A learned prior imports the contamination problem from §5 into the operator
  itself: if 𝒫's parameters were fitted on data overlapping the evaluation
  window, §4's numbers are void by construction. A per-series running statistic
  fitted only on `y[0..t−1]` is contamination-free **by causality**, which is a
  much cheaper guarantee to audit than a provenance argument about a corpus.

### 3.2 State

The implementer must carry, per series:

| field | meaning |
|---|---|
| `mu` | running level estimate |
| `count` | samples consumed (for cold start / debiasing) |
| `last` | previous observation `y(t−1)` |

Nothing else is required by this spec. Anything richer (a slope term, a variance
term for precision weighting) is optional and falls under §7.

### 3.3 Update rule

Recommended default — **EWMA on the level**:

```
ŷ(t) = mu(t−1)
mu(t) = (1 − λ)·mu(t−1) + λ·y(t)
```

with `λ ∈ (0,1]` a single hyperparameter. **`λ` must be fixed before running §4
and recorded in the results file.** Tuning `λ` against the §4 test set and then
reporting the best value is the exact failure this run exists to prevent.

Note the boundary cases, which are the two baselines of §4:
- `λ = 1` ⇒ `ŷ(t) = y(t−1)` — the persistence/random-walk baseline (B-PERSIST).
- `λ → 0` with `mu` initialised to the prefix mean ⇒ the running-mean baseline
  (B-MEAN).

**This is the sharpest thing about the design and it must be stated plainly: the
recommended 𝒫 is a one-parameter interpolation between its own two baselines.**
It can therefore *only* beat them if the series has autocorrelation structure at
an intermediate timescale. If §4 shows it does not, the honest conclusion is that
EWMA is the wrong 𝒫 for this data — not that the criteria were too strict.

### 3.4 Cold start

- `warmup = 8` samples `[design choice, not measured]`. During warm-up, no
  residual is emitted at all.
- `mu` at `t = warmup` is initialised to the mean of `y[0..warmup−1]`.
- Rationale for emitting nothing rather than emitting a poorly-primed residual:
  `[MEASURED]` `pami.ts:107` `return rows.length >= 4 ? rows : null;` — the
  wavelet stage already discards scales it cannot support. A garbage prefix would
  survive into the largest scales (which have the fewest coefficients and so the
  most leverage on ζ(q)) and would not be gated out. Better to lose 8 samples.
- Consequence for the length contract: with `warmup = 8`, the caller needs
  **≥ 40 raw samples** to clear the `n < 32` floor `[MEASURED]` at `pami.ts:75`.
  This is a real narrowing of the operating range and must be documented at the
  tool boundary.

---

## 4. FALSIFIABLE ACCEPTANCE CRITERIA

*This is the load-bearing section. A prediction operator that cannot be wrong is
not a prediction operator.*

Everything here is **pre-registered**: thresholds, sample sizes, and the two
baselines are fixed by this document before any run. All values in this section
are `[DESIGN — pre-registered, not yet measured]`. Nothing here has been executed.

### 4.1 The two baselines 𝒫 must beat

- **B-MEAN** — `ŷ(t) = mean(y[0..t−1])` (running mean).
- **B-PERSIST** — `ŷ(t) = y(t−1)` (previous observation).

Both are causal, both are parameter-free, and both must be run on the *identical*
sample stream as 𝒫.

### 4.2 The metric

Primary: **one-step mean squared error**, on the same index set for all three
predictors:

```
MSE(𝒫) = (1/N) Σ_{t=warmup}^{n−1} ( y(t) − 𝒫(y[0..t−1]) )²
```

Report the **skill score** against each baseline:

```
S_B = 1 − MSE(𝒫) / MSE(B)
```

`S_B > 0` means 𝒫 beat baseline B. Report `S_MEAN` and `S_PERSIST` separately —
**never** a max, a mean, or a best-of. Beating one and losing to the other is a
real and reportable outcome.

### 4.3 Sample size

- **N ≥ 512 scored one-step predictions** per series. Below `pami.ts`'s own 4096
  cap `[MEASURED]` `pami.ts:63`, so a single admissible window can supply it.
- **≥ 20 independent series.** One series cannot distinguish a real effect from
  one lucky autocorrelation.
- Aggregate across series by reporting the **median skill score and the count of
  series with `S > 0`**, not the pooled MSE (pooling lets one high-variance series
  dominate).

### 4.4 The pre-registered thresholds

**PASS** requires *all* of:

- **A1** `median S_MEAN ≥ 0.10` across the ≥ 20 series.
- **A2** `median S_PERSIST ≥ 0.05` across the ≥ 20 series.
- **A3** `S > 0` against *both* baselines in **≥ 14 of 20** series (sign test,
  one-sided, p < 0.06 under a fair-coin null — 14/20 gives p ≈ 0.058).
- **A4** Causality test I1 (§2.3) passes bit-exactly.
- **A5** The residual stream clears `pami.ts:75` (`n ≥ 32`) and `pami.ts:107`
  (`≥ 4` scale rows) on **every** series, so no result is scored on a `null`.

**Why these numbers.** A1 at 0.10 is set above the noise floor a one-parameter
smoother can reach on white noise (where the true skill is 0) while staying well
below what a genuinely autocorrelated series would give. A2 is lower than A1
deliberately: B-PERSIST is the harder baseline on high-frequency data, and
demanding parity with A1 would make the criterion unfalsifiable in the other
direction (guaranteed failure regardless of 𝒫's quality). These are judgement
calls, stated so they can be argued with, and fixed so they cannot be moved after
seeing results.

### 4.5 What FALSIFIES the design — stated explicitly

The design is **falsified**, and this spec should be withdrawn or rewritten
rather than patched, if any of the following is observed:

- **F1 — No skill.** `median S_MEAN < 0.10` or `median S_PERSIST < 0.05`.
  Interpretation: the residual is not meaningfully different from the signal, so
  the whole "index the surprise" story is unsupported for this data and `𝒫 = 0`
  (dream-pass) is the honest production default.
- **F2 — Negative skill.** `median S < 0` against either baseline. 𝒫 is actively
  worse than doing nothing.
- **F3 — Inconsistency.** `S > 0` in fewer than 14/20 series. Any positive median
  is then a small-sample artifact.
- **F4 — Skill without consequence.** 𝒫 passes A1–A5, **but** the resulting
  `PamiIndex` values are not distinguishable from the `𝒫 = 0` indices — operationalised
  as: `median pamiDistance(index_with_𝒫, index_without_𝒫) < 0.30` across the 20
  series. `[MEASURED]` `pami.ts:216` `export const DELTA_DEFAULT = 0.3;` and
  `[READ]` `router.ts:553` "match when < 0.3" — i.e. if the two indices are inside
  the system's own *match* radius, then by the system's own definition they are the
  same memory and 𝒫 changed nothing that the retrieval layer can see. **This is
  the criterion most likely to fail, and it is the one that matters**: a 𝒫 that
  predicts well but moves the index less than the match threshold has improved a
  statistic without improving the system.
- **F5 — Leakage.** I1 fails. Any result obtained is void, not merely weak.

### 4.6 What a PASS does and does not license

A PASS licenses exactly one statement: *on ≥ 20 held-out forward-in-time series,
𝒫 reduced one-step MSE relative to running-mean and persistence baselines by the
pre-registered margins, and the resulting index moved beyond the match radius.*

It does **not** license: "the residual is the prediction error" as an
architectural claim, "PAMI indexes surprise", or any claim about long-horizon
behaviour. See §7.

---

## 5. THE CONTAMINATION CONSTRAINT

### 5.1 The constraint

**Retrospective validation is void here.** If 𝒫 — or any model in the loop that
selected the series, chose `λ`, or chose the window — has already seen the
outcomes, then §4's numbers measure memory, not prediction. Acceptance requires
**forward-in-time, hindsight-free** data: the prediction must be *written down
before* the observation exists.

This is not a stylistic preference. It is the only condition under which F1–F3
can actually fire.

### 5.2 The mechanism in-repo: `src/observer-live.ts`

`[READ]` this file's header describes itself as the only uncontaminated
validator, and states "The escape is not a cleverer statistic — it is TIME" and
that the admissibility predicate "is enforced at WRITE time."

The primitives, `[MEASURED]` by line-addressed read:

```
49: export const DEFAULT_MODEL_CUTOFF = '2024-06-01';
52: const DEFAULT_HORIZON_DAYS = 180;
64: export function admissible(cutoff: string, t0: string, due: string): { ok: boolean; reason: string } {
117: export async function logLivePrediction(
177: export function gatedFidelity(
196: export async function resolveLivePrediction(
228: export function spearman(a: number[], b: number[]): number {
247: export async function liveValidation(env: LiveEnv, userId: string, powerFloor = 8): Promise<Record<string, unknown>> {
```

**How it functions as a clock.** `[READ]` `admissible(cutoff, t0, due)` returns
false with `'t0 precedes training cutoff — outcome may be memorized'` when the
prediction time is not strictly after the model cutoff, and false with
`'resolution not in the future at t0 — not a live forecast'` when the resolution
date is not strictly after `t0`. Both conditions are checked **at write time** in
`logLivePrediction`. `[READ]` `resolveLivePrediction` refuses to resolve rows
marked inadmissible. `[READ]` `liveValidation` returns verdict `UNDERPOWERED`
below `powerFloor = 8` resolved admissible rows. The whole apparatus accrues as
real time passes and cannot be rushed — that is the property 𝒫's acceptance needs.

### 5.3 How 𝒫 would use it — and the honest caveat

**Caveat first, because it is load-bearing:** `observer-live.ts` as written
operates on *prose forecasts about agents* — `[READ]` `gatedFidelity(agentNames,
forecasts, outcomes)` matches on `overlapMatch(f.predicted_change, o.description)`,
a text-overlap score. It does **not** currently accept numeric windows. This spec
therefore describes an **adaptation**, not a drop-in. Claiming otherwise would be
the mixing failure this run exists to prevent.

The required adaptation, minimally:

1. **Write-before-outcome.** At time `t0`, `𝒫` emits `ŷ` for a sample not yet
   observed, and that scalar is persisted alongside `t0` and the due timestamp —
   the same shape as `logLivePrediction`, with `predicted_change` replaced by a
   numeric field.
2. **Admissibility unchanged.** Reuse `admissible(cutoff, t0, due)` verbatim
   `[MEASURED]` `observer-live.ts:64`. A residual series whose samples predate
   `DEFAULT_MODEL_CUTOFF` `[MEASURED]` `= '2024-06-01'` is inadmissible for any
   run where a model chose the hyperparameters.
3. **Resolution.** When the true `y(t)` lands, score squared error. Replace the
   text-overlap fidelity with the §4.2 skill score.
4. **Power floor.** §4.3 asks for N ≥ 512 and ≥ 20 series, which is far above the
   `powerFloor = 8` `[MEASURED]` `observer-live.ts:247` used for prose forecasts.
   The 8-row floor is **not** sufficient for 𝒫 and must not be reused as-is.
5. **Spearman.** `[MEASURED]` `observer-live.ts:228` `export function spearman(a: number[], b: number[]): number {`
   is reusable unchanged for the rank-agreement checks in §4/§6.

### 5.4 The permitted exception, narrowly

A **synthetic-generator arm** is permitted as a *precondition*, never as
acceptance: series generated from a known process (AR(1), white noise, chirp)
with a seed fixed after the criteria were written. Its only legitimate use is
**negative control** — 𝒫 must show `S ≈ 0` on white noise. If 𝒫 shows skill on
white noise, the harness is broken and every other number is void. Positive
results on synthetic data are **not** acceptance and must never be reported as
such.

---

## 6. INTERACTION WITH KNOWN BROKEN GEOMETRY

Two known defects bound what parts of 𝒫 can be accepted. Both are being fixed by
other work-streams; here is precisely what is blocked on what.

### 6.1 Radial coordinate / `src/hyper.ts` — S1's territory

**At HEAD (`46085d4`)** `[MEASURED]` `git show HEAD:src/hyper.ts | sed -n '197,199p'`:

```
  const n = norm(f);
  if (n > 1) for (let i = 0; i < dim; i++) f[i] /= n;
  return f;
```

That projects every over-unit vector onto **exactly** norm 1. Combined with
`[MEASURED]` `sed -n '89p' src/hyper.ts`:

```
export function depth(x: number[]): number { return 2 * Math.atanh(Math.min(1 - BOUNDARY_EPS, norm(x))); }
```

and `[MEASURED]` `sed -n '166p' src/hyper.ts`:

```
const TANGENT_SCALE = 0.9;      // ψ(f) = exp₀(0.9·f̂): pure-feature points sit at depth ≤ 2·atanh(tanh 0.9)
```

depth collapses to the constant ceiling. `[READ — results file at HEAD, not
re-run here]` `docs/PAMI_DHNG_SIEGE_RESULTS.txt` at HEAD reported saturation
`100.0%` and `depth min 1.8000 max 1.8000 mean 1.8000 sd 0.000000` across all
five families, verdict `DEAD. Radial depth is CONSTANT`. The radial coordinate
carried zero bits.

**In the working tree (uncommitted, S1 in flight)** `[MEASURED]`
`sed -n '213,218p' src/hyper.ts`:

```
  const n = norm(f);
  if (n > 0 && Number.isFinite(n)) {
    const s = Math.tanh(n) / n;
    for (let i = 0; i < dim; i++) f[i] *= s;
  }
  return f;
```

a strictly-monotone radial squash. `[READ — results file, regenerated by S1, not
re-run here]` the working-tree `docs/PAMI_DHNG_SIEGE_RESULTS.txt` line 12 reads
`‖ripVector‖ saturated at 1 (⇒ depth pinned to the ceiling): 0.0%`, and depth now
varies (mean 1.7400, sd 0.036547).

**Impact on 𝒫: NONE for §4.** §4 is scored entirely in observation space
(§2.1) and never touches `hyper.ts`. §4 can be run and can pass or fail **today**,
against either version of `hyper.ts`. This is deliberate: the acceptance criteria
were designed to be independent of the broken geometry so that 𝒫 is not held
hostage to S1/S2.

**Blocked:** any claim that 𝒫 improves *hyperbolic depth* separation, or any
criterion phrased in terms of `depth()`. Such a claim was unmeasurable at HEAD
(sd 0.000000 — zero variance to improve) and is only measurable after S1's fix
lands **and is committed**.

### 6.2 The torn phase torus — S2's territory

`[READ — results file, not re-run here]` working-tree
`docs/PAMI_DHNG_SIEGE_RESULTS.txt`:

```
40:native  wrap/control ratio: 1.000   (≈1 ⇒ the native metric sees the wrap as the same tiny step — correct)
41:bridge  wrap/control ratio: 149.107   (≫1 ⇒ the bridge tears the torus)
63:Spearman ρ(pamiDistance, ball geodesic) = 0.5377
```

`[READ — results file at HEAD]` the same ratio read `148.372` at HEAD. (The task
brief rounded this to "148×"; the two values actually observed in this session
are **148.372** at HEAD and **149.107** in the working tree, and neither is
restated as "148" here.)

Note line 40: the **native** metric handles the wrap correctly (ratio 1.000). The
tear is in the *bridge* to the ball, which is S2's `src/pami-bridge.ts` (NEW,
not yet present).

**Impact on 𝒫:**
- **Not blocked:** §4 entirely, and F4's `pamiDistance` criterion — `[MEASURED]`
  `pami.ts:322` `export function pamiDistance(a: PamiIndex, b: PamiIndex): number {`
  is the *native* metric, and the native wrap ratio is 1.000, i.e. correct.
- **Blocked:** anything routing residual-derived indices through the hyperbolic
  embedding — retrieval-quality claims measured as ball geodesics, DHNG placement,
  or any use of `resonance` composed with the bridge. With rank fidelity at
  `ρ = 0.5377`, a change in ordering after the bridge cannot be attributed to 𝒫
  rather than to the bridge. **These claims are blocked until S2's
  `src/pami-bridge.ts` lands and the wrap/control ratio is re-measured near 1.**

### 6.3 Summary of blocking

| 𝒫 claim | blocked on |
|---|---|
| §4 A1–A3, F1–F3 (MSE skill) | nothing — runnable now |
| §4 A5 (`null` gates) | nothing |
| §4 F4 (`pamiDistance` movement) | nothing — native metric, wrap ratio 1.000 |
| "𝒫 improves depth separation" | **S1** (must be committed; at HEAD sd was 0.000000) |
| "𝒫 improves retrieval in the ball" | **S2** (`pami-bridge.ts`; ratio 149.107, ρ 0.5377) |

---

## 7. WHAT THIS SPEC DOES NOT ANSWER

Open questions, stated rather than papered over.

1. **What series is `signal` actually carrying in production?** `[MEASURED]`
   `router.ts:1462` passes LLM-authored JSON. This session found **no** production
   producer of a numeric window — only `src/phi-minimax-scorecard.ts`'s synthetic
   `memorySignalNeutral`. Without knowing the real data-generating process, the
   choice of EWMA in §3.3 is a guess with an argument attached, not a fitted
   answer. **§4 may well falsify it, and that is the correct outcome if so.**
2. **Is `λ` one value or per-series?** Not answered. §3.3 fixes one global `λ`
   chosen before the run. Whether a per-series `λ` is justified cannot be decided
   without the data in (1) — and per-series fitting reopens the contamination
   question in §5.
3. **Should the prior be precision-weighted?** `[READ]`
   `docs/PREDICTIVE_CODING_LITERATURE.md` §1 recommends precision-weighted
   prediction error, with **its own** caveat "FashionMNIST only, zero citations,
   2026. Unreplicated." This spec deliberately omits precision weighting: a
   variance term would add a second hyperparameter and a second failure mode
   before the one-parameter version has been shown to beat a running mean.
4. **The literature is UNVERIFIED.** `[MEASURED]`
   `docs/PREDICTIVE_CODING_LITERATURE.md` exists (211 lines). `[READ]` its own
   status line reads "literature survey, no code", and it contains **no
   verification record for any of its citations** — bare titles and arXiv IDs, no
   DOIs, nothing confirmed against a source. **Every claim drawn from it inherits
   UNVERIFIED status**, including the §0 caveat cited in §1.4 and the §1
   recommendation noted above. Nothing in §§1–6 of this spec depends on it.
5. **Should 𝒫 be hierarchical / multi-timescale?** The φ-spaced basis
   (`[MEASURED]` `pami.ts:55`, `scaleKMin: -4, scaleKMax: 8`) suggests a matching
   multi-scale predictor. Not specified here, because a 13-scale predictor cannot
   be falsified on 32-sample windows.
6. **What happens to κ?** `[MEASURED]` `pami.ts:365`
   `export function kappaCrossModal(narrative: number[], physiological: number[], cfg: PamiConfig = SPEC_CONFIG): number | null {`
   takes **two** windows. Whether both are residualised, and whether a shared or
   separate 𝒫 is used, is **not answered**. It materially changes what κ means and
   needs its own criteria.
7. **Does residualising break stored memories?** All existing rows were indexed
   under `𝒫 ≡ 0`. If 𝒫 ships, new indices and old indices are in different
   spaces, and `pamiDistance` between them is meaningless. Migration is not
   addressed here.
8. **Is `warmup = 8` right?** `[design choice, not measured]`. It costs 8 samples
   and raises the effective minimum window from 32 to 40. Not empirically justified.
9. **Are the §4.4 thresholds calibrated?** No. They are pre-registered judgement
   calls, chosen to be falsifiable rather than derived from a power analysis on
   real data — because no real data was available to this session.
10. **Was any of §4 run?** **No.** This is a design-only stream. Every value in §4
    is `[DESIGN — pre-registered, not yet measured]`. Nothing in this document
    reports a measurement of 𝒫, because 𝒫 does not exist.

---

*S4, run `elle-siege-fixes-2026-08-31`. No source file was modified by this
stream. No commit, no push.*
