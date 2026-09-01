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

*(empty at declaration time — filled by the harness run, and by nothing else)*
