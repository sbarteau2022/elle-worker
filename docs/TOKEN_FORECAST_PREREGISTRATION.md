# TOKEN FORECAST GATE — PRE-REGISTRATION

**Declared BEFORE the harness was run. Nothing in §§1–5 may be edited after the
first run.** Results land in §6 and nowhere else. This file follows
`.swarm/RUN.md`'s protocol (declare, then run) and
`docs/PREDICTION_OPERATOR_SPEC.md` §4's thresholds, which are reused verbatim
where they apply rather than re-derived.

---

## 0. THE QUESTION, STATED HONESTLY

**What shipped in PR #347 (`src/token-operator.ts`, 𝒯) is not a predictor.** It
measures a generation run and stores the record read-only. It forecasts nothing.
Asking "how effective is the token predictor" has no answer, because no such
operator was built.

The answerable question is the one underneath: **𝒯 produces an observation
stream — is forecasting the next run from it worth anything over a trivial
baseline?** If the answer is no, 𝒯 is still a useful instrument (you can read
what a run cost) but there is no predictive layer worth building on it, and this
document should end that line of work rather than launder it.

The candidate forecaster is **already shipped and tested**: `EuclidPredictor` in
`src/predict.ts` — persistence / EMA / per-dimension AR(2), best-of selected by
running one-step MAE. Nothing new is written for the operator side. That is
deliberate: a new predictor invented for its own benchmark is unfalsifiable.

### 0.1 The structural advantage that must be declared up front

`EuclidCore.choose()` (`src/predict.ts:184`) selects among persistence / EMA /
AR(2) by running MAE — **and persistence is one of its own candidates.**
So beating B-PERSIST is structurally favored: in the limit the selector should
converge to persistence whenever nothing beats it, making large *negative*
skill nearly impossible. This is stated before the run because it changes how a
pass must be read:

- **Beating B-MEAN is nearly free** on any autocorrelated series — plain
  persistence does it. A1 passing proves almost nothing.
- **A2 (beating B-PERSIST) is the load-bearing criterion.** It is the only one
  that asks whether EMA/AR(2) found structure persistence missed.
- A2 passing *by a small margin* is consistent with "the selector correctly fell
  back to persistence and gained a little at the edges" — a real but modest
  result, and it must be reported as that, not as a win.

### 0.2 What a synthetic pass can and cannot license

`docs/PREDICTION_OPERATOR_SPEC.md` §5.4 is binding here: a synthetic-generator
arm is permitted **as a precondition, never as acceptance**. 𝒯 has ingested zero
real records (`docs/TOKEN_OPERATOR_SPEC.md` §5.1). Therefore:

- A **failure** here is decisive: if the predictor cannot beat persistence on
  synthetic series *built to contain* exactly the structure serving systems are
  known to have, it will not do better on real traffic. Falsification is real.
- A **pass** here licenses exactly one sentence: *the operator extracts the
  autocorrelation this generator put in.* It does **not** license any claim
  about real Elle traffic, and no such claim may be made until real ingested
  traces exist.

---

## 1. THE SERIES GENERATOR

Seeded (`mulberry32`), so a red run is reproducible rather than a lottery
ticket — the `src/hyper-b1.test.ts` convention. **Parameters below are
plausible order-of-magnitude values for a local 27B-class model on consumer
hardware (Elle's sovereign lane), NOT measurements.** They are declared here so
they cannot be tuned after seeing results.

Each series is one simulated session of consecutive generation runs. Four
channels are emitted per run, matching `TokenOperatorRecord`'s numeric fields:

| channel | units | generator |
|---|---|---|
| `ttft_ms` | ms | `base_ttft · load(t) · prefill(t) · straggler(t)` |
| `itl_mean_ms` | ms | `base_itl · load(t) · straggler(t)` |
| `energy_total_j` | J | `power(t) · duration(t)`, duration from ttft + itl·tokens |
| `steps` | count | Poisson-ish integer, weakly coupled to prompt complexity |

The structure the generator injects — each item is a documented property of real
LLM serving, and is the *only* reason a forecaster could beat persistence:

1. **Latent load autocorrelation.** `load(t)` is AR(1), φ = 0.85, driving both
   TTFT and ITL. Queueing/contention varies slowly; this is the dominant real
   signal.
2. **Prompt-length drift.** Conversation context grows within a session, so
   prefill cost trends. TTFT is roughly linear in prefill tokens.
3. **Regime shifts.** With p = 0.02 per step, a step change in the latent
   (cold start, model swap, cache eviction).
4. **Heavy-tailed stragglers.** With p = 0.05, a multiplicative log-normal
   spike (GC, preemption, thermal throttle).
5. **Energy–duration coupling.** Energy is `power × time` with power itself
   mildly load-dependent, so energy inherits TTFT/ITL's predictability rather
   than getting its own free structure.

Base values: `base_ttft = 320 ms`, `base_itl = 22 ms`, idle→load power
`38→65 W`, `steps ∈ [1, 8]`.

### 1.1 Control arms (declared now, run alongside)

- **WHITE** — every channel iid log-normal, same marginal mean/variance as the
  structured arm, **zero temporal structure.**
- **SHUFFLED** — the structured arm's own series, permuted in time by the
  seeded RNG. Identical marginal distribution, autocorrelation destroyed.

---

## 2. BASELINES

Both causal, parameter-free, run on the **identical index set** as the operator
(`docs/PREDICTION_OPERATOR_SPEC.md` §4.1):

- **B-MEAN** — `ŷ(t) = mean(y[0..t−1])`
- **B-PERSIST** — `ŷ(t) = y(t−1)`

## 3. THE METRIC

Per channel, per series, one-step MSE on the identical index set:

```
MSE(P) = (1/N) Σ ( y(t) − ŷ_P(t) )²
S_B    = 1 − MSE(P) / MSE(B)
```

`S_MEAN` and `S_PERSIST` are reported **separately — never a max, a mean, or a
best-of.** Beating one and losing the other is a real, reportable outcome.

**Per channel, never pooled.** The four channels differ by two orders of
magnitude in scale (`ttft_ms ≈ 320` vs `steps ≈ 3`); a pooled L2 residual would
be a report about `ttft_ms` wearing three other channels as a costume. Each
channel gets its own dim-1 predictor and its own skill score.

Aggregate across series by **median skill and the count of series with S > 0**,
not pooled MSE (pooling lets one high-variance series dominate).

## 4. SAMPLE SIZE

- **20 independent series** per arm (different seeds).
- **N ≥ 512 scored one-step predictions** per series.
- Only indices where **all three** predictors emit a forecast are scored.

## 5. PRE-REGISTERED THRESHOLDS

**PASS** requires all of:

| id | criterion |
|---|---|
| **A1** | `median S_MEAN ≥ 0.10` on the structured arm (weak — see §0.1) |
| **A2** | `median S_PERSIST ≥ 0.05` on the structured arm (**load-bearing**) |
| **A3** | `S > 0` against **both** baselines in **≥ 14 of 20** series |
| **A4** | **Negative control:** `\|median S_PERSIST\| < 0.05` on WHITE. Skill where none exists ⇒ harness broken, every other number void |
| **A5** | **Ablation:** `median S_PERSIST` on SHUFFLED drops by **≥ 50%** vs the structured arm. If skill survives time-shuffling, it is not temporal structure and the result is an artifact |

A1–A3 are `PREDICTION_OPERATOR_SPEC.md` §4.4's thresholds unchanged. A4 is its
§5.4 negative control. **A5 is new to this run** and is the criterion carried
over from the psi finding (`CLAUDE.md`): a headline number that survives
ablating the thing it supposedly measures is not a result. A5 exists because
it is the criterion most likely to fail.

### 5.1 What FALSIFIES

- **F1** A2 fails ⇒ the operator finds nothing persistence missed. Honest
  conclusion: log the cost, do not forecast it. No predictive layer on 𝒯.
- **F2** `median S < 0` on either baseline ⇒ actively worse than doing nothing.
- **F3** A3 fails ⇒ any positive median is a small-sample artifact.
- **F4** A4 fails ⇒ harness broken, all results void (not "weak" — void).
- **F5** A5 fails ⇒ the skill is not temporal structure; the number is an
  artifact of the marginal distribution and must be withdrawn.

---

## 6. RESULTS

Harness: `src/token-forecast-gate.test.ts`, seeded, 20 series × 512 scored
one-step predictions per channel per arm. Reproduce with
`npx vitest run src/token-forecast-gate.test.ts --reporter=verbose`.

### 6.1 The structured arm

| channel | S_MEAN | S_PERSIST | S>0 both | A1 ≥0.10 | A2 ≥0.05 | A3 ≥14/20 |
|---|---|---|---|---|---|---|
| `ttft_ms` | 0.4256 | **0.1998** | 18/20 | ✅ | ✅ | ✅ |
| `energy_total_j` | 0.4980 | **0.2846** | 20/20 | ✅ | ✅ | ✅ |
| `itl_mean_ms` | 0.8152 | 0.0027 | 10/20 | ✅ | ❌ | ❌ |
| `steps` | 0.0264 | 0.4283 | 11/20 | ❌ | ✅ | ❌ |

**Verdict: the gate passes for `ttft_ms` and `energy_total_j`, and fails for
`itl_mean_ms` and `steps`.** Pooled across channels the medians were
S_MEAN 0.4533 / S_PERSIST 0.2700, which would have read as a clean pass — §3's
"per channel, never pooled" rule is the only reason the two failures are
visible at all. The pooled number is not reported as a result.

The two failures are interpretable, not noise:

- **`itl_mean_ms` ties persistence** (S_PERSIST 0.0027 ≈ 0). This is
  `EuclidCore.choose()` behaving *correctly*: it evaluated EMA and AR(2),
  found neither beat persistence, and fell back to persistence. §0.1 predicted
  exactly this shape. There is no forecasting value in inter-token latency
  beyond "it will be roughly what it just was."
- **`steps` ties the running mean** (S_MEAN 0.0264). The channel is nearly iid
  by construction (only the rare regime shift touches it), so the mean is
  already near-optimal and there is nothing for a temporal model to add. Its
  large S_PERSIST (0.4283) is the free win described in §6.3 — not skill.

### 6.2 Controls and ablation

| arm | S_MEAN | S_PERSIST |
|---|---|---|
| STRUCTURED | 0.4533 | 0.2700 |
| WHITE (iid) | **−0.0817** | 0.4514 |
| SHUFFLED (time destroyed) | **−0.0886** | 0.4447 |

**The ablation is the strongest evidence in this document.** SHUFFLED has the
identical marginal distribution to STRUCTURED — only time was destroyed — and
S_MEAN collapses from **+0.4533 to −0.0886**. The skill was entirely temporal.
This is the psi-finding's ablation applied here, and unlike the psi case, the
signal did not survive the ablation: it is real structure, not a restatement of
the marginals.

On WHITE the operator is *slightly worse than a running mean* (−0.0817), which
is the correct and expected outcome: it pays a small selection-noise premium
for entertaining EMA/AR(2) candidates that have nothing to find. No skill was
manufactured where no structure exists.

### 6.3 Two pre-registered criteria were mis-posed. Both are reported as failed.

**A4 as written FAILED** (`|median S_PERSIST| < 0.05` on WHITE; observed
**0.4514**). **A5 as written FAILED** (S_PERSIST should drop ≥50% when
shuffled; it *rose*, 0.2700 → 0.4447).

Neither failure indicts the operator or the harness. Both criteria were written
against the wrong baseline, and the error is mine. On iid data persistence has
MSE ≈ 2σ² while the optimal causal predictor (the running mean) has MSE ≈ σ²,
so `S_PERSIST` has a **structural ceiling of 0.5 that any competent forecaster
approaches for free**. Observed 0.4514 is that ceiling, not skill. Shuffling
*creates* iid data, so it *raises* S_PERSIST rather than lowering it.

The criteria carry their intent when posed against `S_MEAN`, the optimal causal
predictor on iid data, and posed that way both pass decisively — WHITE −0.0817
and SHUFFLED −0.0886, versus +0.4533 structured. That corrected form is what
`src/token-forecast-gate.test.ts` asserts, labelled as the corrected control
rather than as A4/A5. **The original A4/A5 are recorded here as failed and are
not quietly replaced.**

### 6.4 The sensitivity sweep rejected its own proposed shortcut

With the prefill random walk disabled so the AR(1) latent is the driver:

| φ | variance ratio | S_PERSIST (`ttft_ms`) |
|---|---|---|
| 0.00 | 0.5049 | 0.3855 |
| 0.30 | 0.5147 | 0.3770 |
| 0.60 | 0.5177 | 0.3556 |
| 0.85 | 0.5200 | 0.2260 |
| 0.95 | 0.5218 | 0.0296 |
| 0.99 | 0.5219 | 0.0331 |

Two findings, the second more useful than the first:

1. **Skill falls as autocorrelation rises.** This inverts the intuition the
   sweep was written to confirm — the first version of the assertion demanded
   the opposite and went red. Persistence is the *optimal* predictor of a
   random walk, so the more walk-like a series is, the less any forecaster can
   take from it. The payoff lives in **mean reversion**, not autocorrelation.
2. **The Lo–MacKinlay variance ratio does NOT track that payoff, and is
   rejected.** Skill moved 0.3525 across this sweep; VR moved 0.0170 — 20×
   less. VR sits pinned near 0.5 (the iid value) because `ttft`'s first
   differences are dominated by straggler spikes and jitter, so it measures
   the observation noise rather than the predictable component. Shipping "check
   VR before building" would have been a plausible-sounding statistic that does
   not measure the thing — the psi-finding failure mode exactly. The harness
   asserts the rejection (`vrSpread * 4 < sSpread`) so it cannot be quietly
   re-adopted.

**There is therefore no summary statistic to hand over.** The deliverable is
the horse race itself: `scoreChannel()` runs the operator against both
baselines on an identical index set and can be pointed at a real ingested
series the moment 𝒯 holds ~512 records.

### 6.5 An unrelated defect this surfaced

`src/predict.ts`'s `PredictStep.skillVsPersistence` is `chosenMAE /
persistenceMAE` — **lower is better, 1.0 is parity**. The spec's skill score
(§3 here, and `PREDICTION_OPERATOR_SPEC.md` §4.2) is `1 − MSE_P/MSE_B` —
**higher is better, 0.0 is parity**. Different direction, different error
measure. Anyone reading the shipped field as a spec skill score will invert
every conclusion. This gate computes S itself from raw predictions and never
reads that field. The field is not wrong, but it is a live footgun and should
be renamed (`maeRatioVsPersistence`) or documented at its definition.

### 6.6 What this run does and does not license

**Licensed, exactly:** *on synthetic series built to contain the structure real
serving systems are known to have, the shipped `EuclidPredictor` beats both a
running-mean and a persistence baseline on TTFT and energy by the
pre-registered margins, and that advantage is entirely temporal — it does not
survive shuffling the series in time.*

**Not licensed:** any claim about real Elle traffic. Per §0.2 a synthetic pass
is a precondition, never acceptance. 𝒯 has ingested zero real records, so the
honest status of a forecasting layer on 𝒯 is **"worth trying on TTFT and
energy, not on ITL or step count, pending real data"** — and the sweep in §6.4
shows the answer on real data cannot be guessed in advance, only raced.
