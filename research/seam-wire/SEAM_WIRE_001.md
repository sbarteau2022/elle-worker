# SEAM WIRE 001 — two candidate ż producers, one gate, real series

**Question.** The regulator κ̇ = κ(1−κ)·ż has a free input ż, fed today by
evidence counts. Two candidates were named for what ż should be, and the
paper (`Elle/docs/pfar_phase_space.tex` §6, on `origin/main` only) says they
are unrelated constructions sharing a word:

- **Readout A — seam sense (b).** Disagreement between the two factor
  residuals of the product-manifold predictor: window → `pamiIndex` →
  (`pamiBridgeVector` ∈ 𝔹²⁹, phases ∈ 𝕋⁸) → `ProductPredictor.step` →
  d_t = |unit(z_ℍ) − unit(z_𝕋)|. Inside kappa-memory's own geometry.
- **Readout B — seam sense (c).** The sandboxed coupling detector
  `research/seam-rip/rip.py`, ported byte-for-semantics to TypeScript:
  κ_c = |corr(slow-band signal, fast-band envelope)| with a circular-shift
  null; precision = 1 − p.

Both were built, run on the same windows of the same live series, and scored
by the same pre-registered kill-tests (`src/kappa-memory/validate.ts`,
unchanged). Numbers decided.

Code: `src/seam-wire.ts` · unit: `src/seam-wire.test.ts` (16) · real data:
`src/seam-wire-real-data.test.ts` (5) · producer:
`research/seam-wire/tap_series.py` · fixture:
`test-fixtures/tap-series-gsm8k-n100.jsonl` · raw report:
`research/seam-wire/SEAM_WIRE_001.json` · 2026-09-05

## The producer — the first live numeric window this stack has had

`PREDICTION_OPERATOR_SPEC.md` §7.1 and the PAMI siege's L1 both recorded
that no production producer of a numeric series existed. `tap_series.py`
is one: a teacher-forced pass of Qwen3.8-27B-4bit (the same weights, taps
and chat-template prompt as the GSM8K control baseline) over the 100
baseline completions in `hybrid-HNPA-active-inference-LLM/runs/control-baseline/val_base_n100.json`,
emitting three per-token scalar streams for the completion tokens only:

| stream | definition |
|---|---|
| `surprisal` | −log p(token_t \| prefix), nats, from the final logits |
| `norm12` | ‖h‖₂ after block 12 (early tap) |
| `norm48` | ‖h‖₂ after block 48 (late tap) |

Labels (`correct`, `truncated`) are carried from the eval JSON untouched.
Runtime: ~70 s for 100 rows on the M-series box with mlx-serve stopped.

## Pre-registered before the first run

| item | value | why |
|---|---|---|
| label | `settled_open = truncated ? 1 : 0` | validate.ts defines OPEN as "a turn that did not close"; a truncated generation is exactly that |
| head | first **96** completion tokens per row | Gate 1 needs 100 rows; the shortest baseline completion is 97 tokens. Fixed after the producer's first pass (head 128 left 97 rows) and **before any readout ran**. Equal length for every row: length cannot leak the label |
| windows | 64 tokens, stride 4 → 9 windows/row | 64 is the PAMI floor ×2 and a power of two for the FFT |
| bands (B) | slow [1/64, 4/64), fast [8/64, 32/64) cycles/token | rip.py's 1:12 ratio, scaled to the window |
| null (B) | 200 circular shifts, seeded | rip.py uses 1000; 200 bounds p at 0.005 |
| gate | validate.ts verbatim | VELOCITY AUC ≥ 0.70, RESERVE AUC ≥ 0.65, 95% lower bound > 0.5, ≥ 20 per class |
| controls | (i) labels shuffled, (ii) tokens shuffled within row, fixed seeds | either BUILDing voids the run |
| class balance | 23 OPEN / 77 SETTLED | from the baseline eval |

## Harness validity (must hold before any number counts)

- The TypeScript port reproduces rip.py's own HARNESS VALID triple at rip.py's
  geometry scaled to fs = 1: coupled → p < 0.01, white noise → null,
  uncoupled tones → null.
- Readout A is causal index-for-index: reversing every token after the
  prefix leaves the prefix scores bit-identical.
- Readout B is translation-invariant and seed-deterministic.
- Both readouts on white noise with random labels: not BUILD, every AUC
  within 0.15 of chance. Fewer than 100 rows: INSUFFICIENT.
- On the real fixture, all 12 control arms: KILL.

## Result

| readout | stream | VELOCITY auc (lo95) | RESERVE auc (lo95) | overall |
|---|---|---|---|---|
| A | surprisal | 0.595 (0.459) | 0.444 (0.307) | KILL |
| B | surprisal | 0.585 (0.448) | **0.250 (0.125)** | KILL |
| A | norm12 | 0.590 (0.453) | 0.497 (0.362) | KILL |
| B | norm12 | 0.431 (0.301) | 0.509 (0.375) | KILL |
| A | norm48 | 0.436 (0.305) | 0.493 (0.358) | KILL |
| B | norm48 | 0.522 (0.386) | 0.601 (0.474) | KILL |

Readout A rejected exactly 2 of 9 windows per row (predictor warm-up) and
logged 2–3 "seam events" per row (a factor residual past the paper's
0.20 / 0.70 thresholds). Readout B scored every window.

**Verdict, as pre-registered: KILL on all six arms.** Neither candidate ż,
on any live stream, discriminates the label at the gate's bar. The seam
stays closed. Nothing in `seam.ts` changes.

### Cross-implementation parity (Rust gate)

The identical 600 TraceRows (`research/seam-wire/trace_rows.json`, dumped by
`dump_trace_rows.ts`) were run through the Rust port of the gate,
`Elle/elle_rust_harness/crates/harness-dhng/src/swarm_eval.rs`
(`run_validate_kappa`), via the example `seam_wire_parity.rs`. Every AUC,
lower bound and verdict agrees with the TypeScript gate to four decimals
(e.g. B/surprisal RESERVE 0.2496 / 0.1254 KILL; A/surprisal VELOCITY
0.5954 / 0.4588 KILL). Two independent implementations, one answer.

## The one number that is not chance — and why it is not a pass

Readout B on `surprisal`, RESERVE test: AUC **0.250**, 95% interval roughly
0.125–0.375. That is 3.9 standard errors *below* 0.5. Its own two controls on
the same arm read 0.461 (labels shuffled) and 0.410 (tokens shuffled). No
other cell in 24 is outside 0.41–0.60.

Read literally: accumulated slow/fast coupling in the model's surprisal over
the first 96 tokens is **higher** in generations that later fail to close.
More cross-scale structure in the surprise, not less, marks the trajectory
that never settles. That is the *opposite* sign from the pre-registered
reading (reserve high ⇒ SETTLED). Inverted, the point estimate would be
0.75 with a lower bound near 0.63, which would clear the 0.65 bar.

It is **not** a pass, and it is not being reported as one:

1. The sign was fixed before the run. Flipping it after seeing the data is
   the exact move `RECOVERY_VS_ATR.md` and the siege re-audit exist to stop.
2. One cell in 24 at that level is a hypothesis, not a finding.
3. `PREDICTIVE_CODING_LITERATURE.md` §0 warns that per-step signals fail to
   order long-horizon outcomes. Truncation at 512 tokens is a long-horizon
   outcome of a 96-token window. Cheap wins here are suspect by default.

## Pre-registered replication (launched, not yet read)

A fresh 100-problem baseline generation on the GSM8K **test** split is
running (`runs/control-baseline/test_base_n100_1024.json`), same model, same
prompt, **1024-token budget**. Before its numbers are read, the following is
fixed:

- **Why 1024, not 512.** The val baseline ran at 512 and 23% of it truncated,
  with every wrong answer among the truncated. The HNPA re-checks had already
  moved to 1024 for that reason. A 512-budget replication would have made
  "did not close" mostly mean "wrote a long solution". At 1024 the same event
  is still observable — `open_at_512` = the completion's full length is ≥ 512
  tokens, which is *exactly* what val's `truncated` recorded — and two more
  become observable: `truncated` at 1024 (never closed even with double the
  room) and `!correct` (closed on the wrong number).
- **H1 (the only claim).** Readout B, stream `surprisal`, RESERVE test with the
  **inverted** orientation (reserve high ⇒ OPEN), OPEN = `open_at_512`:
  AUC ≥ 0.65 with 95% lower bound > 0.5, Gate 1 met (≥ 20 per class).
- **Secondary labels, reported, not claimed:** the same cell against
  `truncated@1024` and against `!correct`. Both will probably miss the
  20-per-class floor; INSUFFICIENT is then the honest cell.
- Every other cell is reported but makes no claim.
- Same head (96), windows, bands, null, seeds, controls.
- **What each outcome means.** H1 fails → the 0.250 was a one-sample
  artifact; readout B is KILLed outright. H1 holds and the secondaries are
  INSUFFICIENT → readout B predicts *length* of the coming solution from its
  first 96 tokens; that earns one pre-registered seat in the next round and
  nothing more — it is not yet evidence about closing or correctness. H1
  holds and `truncated@1024` or `!correct` also clears → then, and only then,
  is there a candidate signal about failure to close, still behind the seam,
  still short of the human-rater Gate 2 the validate.ts report demands.


### The regulator's closed form — what ż has to be, and what it is (recorded before the replication is read)

κ̇ = κ(1−κ)·ż integrates exactly: **logit κ(T) = logit κ₀ + ∫ż dt**, i.e. κ(T) = σ(z(T) + c).
So the regulator is a monotone squash of the accumulated evidence z. Two consequences:

1. **What ż has to be.** For κ to be a probability of settling, ż must be the
   per-window increment of the *log-odds* of settling — a log-likelihood-ratio
   increment (sequential probability ratio test). Any feature can play ż only
   after calibration to log-odds; the regulator adds no discrimination of its own.
2. **What it is.** Wiring readout B through the regulator with
   ż_t = a·κ_c,t·(1−p_t) + b/9 gives z(T) = a·S + b with S = Σ_t κ_c,t(1−p_t) —
   exactly readout B's `reserve`. The ranking, and therefore the AUC, is
   identical to the reserve cell by construction. Fitted on val (in-sample,
   100 rows): **a = −0.893, b = 6.054**; 5-fold a ∈ [−1.01, −0.72], b ∈ [4.97, 6.87].
   κ(T) then spans 0.34–0.99, median 0.67 on OPEN vs 0.85 on SETTLED.
   d′ = 0.978 (means 5.95 vs 4.84, pooled sd 1.13) → AUC 0.750 for OPEN-high.

What the gate needs, under an equal-variance Gaussian model (AUC = Φ(d′/√2)):
RESERVE 0.65 ⇒ total d′ ≥ 0.544; VELOCITY 0.70 ⇒ d′ ≥ 0.741. On val the
coupling evidence has d′ ≈ 0.98, in the direction opposite to the registration.

So "make it work" reduces to one question, not a search: does the coupling
evidence replicate with that sign on held-out data. That is H1. If it does,
the wire is κ(T) = σ(a·S + b) with a, b frozen above (or refit on val+test
under pre-registration); if it does not, no choice of ż built from these
readouts reaches the bar, because the regulator cannot add what ż lacks.


## Replication result (held-out GSM8K test split, read 2026-09-06)

Generation: plain Qwen3.8-27B, 100 test problems, 1024-token budget —
accuracy 0.63, parse 0.98, **44 ran past 512 tokens, 28 past 1024, 37 wrong**.
All three labels clear Gate 1 (≥ 20 per class). Fixture:
`test-fixtures/tap-series-gsm8k-test-n100.jsonl`; raw:
`research/seam-wire/SEAM_WIRE_001_replication.json`.

**H1 HOLDS.** Readout B / `surprisal` / RESERVE, inverted (reserve high ⇒ ran
past 512): **AUC 0.741, 95% lower bound 0.641, n = 44 / 56 → BUILD** at the
pre-registered 0.65 bar. Val gave 0.750 on 23 / 77. Same sign, same
magnitude, fresh problems, coefficients untouched. The Rust gate on the
identical rows: 0.7411 / 0.6414 BUILD.

| arm (inverted) | RESERVE auc (lo95) | verdict |
|---|---|---|
| **B / surprisal** | **0.741 (0.641)** | **BUILD** |
| B / norm12 | 0.631 (0.520) | KILL (below 0.65) |
| B / norm48 | 0.456 (0.343) | KILL |
| A / any stream | 0.42–0.56 | KILL |

Secondary labels, same cell, reported not claimed:

| label | RESERVE auc (lo95) | verdict |
|---|---|---|
| ran past 1024 (never closed) | 0.610 (0.483) | KILL — bound straddles 0.5 |
| wrong answer | 0.613 (0.496) | KILL — bound straddles 0.5 |

All 12 label-shuffle controls on the replication fixture: KILL, AUCs 0.42–0.58.
Readout A is at chance in every orientation on both fixtures.

**What this licenses, exactly as pre-registered.** Accumulated slow/fast
coupling in the model's own surprisal over the first 96 tokens predicts that
the solution ahead will run past 512 tokens, on held-out problems, at the
gate's bar. It does *not* yet predict failure to close at 1024 or a wrong
answer: both secondaries are above chance but their lower bounds do not clear
0.5 at n = 28 / 72 and 37 / 63. Readout B has earned one seat in the next
round as a **length-of-solution** signal. The seam stays closed:
`KAPPA_VALIDATED` is unchanged, and validate.ts's own report says a BUILD
here is the internal proxy, necessary not sufficient, ahead of a human-rater
Gate 2.

**The wire, now with a replicated input.** κ(T) = σ(a·S + b), S = Σ_t
κ_c,t(1−p_t) over the nine windows, a = −0.893, b = 6.054 fitted on val.
Applying the val coefficients to the test rows is the next pre-registrable
step (calibration transfer), and refitting on val+test is allowed only if
declared before a third split is generated.

**Note on the base model.** The test split at 1024 tokens scored 0.63 with 28%
truncation against val's 0.86 at 512 with 23% truncation. That is a harder
draw of problems, not a change in the model, and it is why the class balance
moved from 23 / 77 to 44 / 56.


## Pre-registered third split — the failure label (declared 2026-09-06 before generation)

Generation: plain Qwen3.8-27B, **200** problems from `benchmarks/gsm8k/train_split.jsonl`
(rows 0–199, never used by any training run in this repo), 1024-token budget, chat-template
prompt, same producer settings (head 96, 64/4 windows, bands, 200-shift null, seeds).
Output `runs/control-baseline/train_base_n200_1024.json`, fixture
`test-fixtures/tap-series-gsm8k-train-n200.jsonl`.

Claims, each scored on the pooled test+train rows (n = 300) with validate.ts unchanged:
- **H2 (length, confirmatory):** B / surprisal / RESERVE inverted vs `open_at_512`: AUC ≥ 0.65,
  lo95 > 0.5. Expected to hold (replicates twice already).
- **H3 (never closes):** same cell vs `truncated` at 1024: AUC ≥ 0.65, lo95 > 0.5.
- **H4 (wrong answer):** same cell vs `!correct`: AUC ≥ 0.65, lo95 > 0.5.
- **Calibration transfer:** κ(T) = σ(−0.893·S + 6.054) applied unchanged to the 200 new rows;
  report Brier vs settled(=!open_at_512) and vs correct. No refit before these are read.
Controls: label shuffle on every claimed cell. Any BUILD on a control voids the run.
If H3 and H4 KILL at n = 300, readout B is recorded as a length signal only and the seam
stays closed on that basis; the evidence floor in `calibratedKappa` still applies.


## Contraction protocol (paper §7) — run 2026-09-06, FAIL

`research/seam-wire/contraction_protocol.ts`, definitions fixed in its header before the run:
per-window κ_c with stride 1 (33 samples per head), target = mean of the last 5 windows,
u_t = |κ_c,t − target|, OLS of ln u_t on the first 60%, held-out NRMSE on the last 40%,
PASS = median NRMSE < 0.15 and r > 0 in ≥ 90% over ≥ 200 closed trajectories.

| rows | n | median held-out NRMSE | r > 0 | median r | verdict |
|---|---|---|---|---|---|
| CLOSED (val+test) | 133 | 1.191 | 63.2% | 0.018 | UNDER-N, and far from the bar |
| OPEN | 67 | 1.150 | 62.7% | 0.028 | — |
| ALL | 200 | 1.191 | 63.0% | 0.021 | **FAIL** |

The coupling trajectory over the first 96 tokens is not an exponential relaxation toward a
settled value: prediction error on the held-out tail is larger than the tail itself, and the
sign of r is near a coin flip. Under the paper's own criterion the `r_estimate` contraction
model is **falsified for this signal as defined** and must stay descriptive-only. This is the
second reason the seam stays closed, independent of the AUC result: readout B carries
length information as an accumulated level (S), not as a contracting trajectory. The 200
train-split rows will be added when they land; the verdict is not expected to move.


## Readout A2 — the two-observation seam (run 2026-09-06)

Readout A was degenerate by construction (ball chart = a function of the torus chart). A2
gives the ball factor an independent observation: the block-48 hidden state through a fixed
random chart (`proj48`, 29-d, seed 29, unit-normalised then tanh-squashed into the ball),
window-averaged, while the torus factor keeps the surprisal phases. `ProductPredictor(29, 8)`,
same disagreement score. Pre-registered claim: only that A2 is no longer degenerate.

| fixture | rejected/row | seam events/row | registered VEL / RES | inverted VEL / RES | shuffled VEL / RES |
|---|---|---|---|---|---|
| val | 2.00 | 0.34 | 0.617 (0.481) / 0.480 | 0.383 / 0.520 | 0.422 / 0.553 |
| test | 2.00 | 1.23 | 0.477 / 0.531 | 0.523 / 0.469 | 0.548 / 0.470 |

All KILL. A2 now produces seam events (the paper's per-factor thresholds fire, more on the
harder test draw), so the construction is live — but the disagreement between the late-tap
ball chart and the surprisal torus chart over the first 96 tokens carries **no length
information**: every cell is inside the label-shuffle band. Two conclusions, both recorded:
(1) the degeneracy of A was real and is fixed; (2) fixing it did not make sense-(b) a ż
candidate. Readout B remains the only replicated producer.


## On the map — the trajectories placed in DHNG's hyperbolic model (2026-09-06)

`Dynanic-Hyperbolic-Neural-Graph/scripts/seam_trajectories.ts` (pre-registered in its header):
200 rows (val + test) as nodes, kNN graph k = 5 on the 9-window coupling trace, `hyperMap`
dim 16, 600 epochs, seed 42, labels never shown to the embedding.

| k | purity(open) Euclidean | purity(open) ball geodesic | Δ | purity(correct) Euclid / ball |
|---|---|---|---|---|
| 5 | 0.722 | 0.730 | +0.008 | 0.655 / 0.665 |
| 10 | 0.689 | 0.687 | −0.001 | 0.649 / 0.657 |

P1 (map preserves label information, Δ ≥ −0.02 at both k): **PASS**. Depth (radius) alone:
AUC 0.535 vs open, 0.485 vs wrong — the radial coordinate carries nothing here; the
information lives in neighbourhoods, not depth. Pooled S vs open on all 200: AUC 0.768.
hyperMap loss 13.15, mean edge distance 1.66, depth 1.41–2.13. So "moved into the hyperbolic
model" is earned in the narrow sense measured: the coupling trajectories sit on the atlas
without losing what they know, and the atlas's own metric retrieves length-neighbours as
well as the raw trace does. No claim beyond that.

## Two things learned about the instruments

- **rip.py's null has a resolution floor of ~1/(slow period).** Circular
  shifts by a multiple of the slow period reproduce the real correlation, so
  a perfectly periodic slow component floors p at about period⁻¹. rip.py's
  own self-test passes at p < 0.01 partly because its slow period is 100
  samples. On 64-token windows with the slow band at 1–4 cycles/window the
  floor is 0.02–0.06. The precision weight 1 − p is unaffected; a p < 0.01
  criterion would be.
- **Readout A's warm-up costs 2 of 9 windows** at this head. A longer head
  or a shorter stride buys more scored windows; neither was changed after
  the run.

## What was not tested

The `correct` label (17 negatives, below the 20-per-class floor). Any head
other than 96. Any readout parameter sweep (deliberately). The two readouts
combined. Any stream other than the three above. Anything on the torus
vessel, the regulator, or `kappa-dynamics.ts` — those are downstream of a ż
that has not yet earned its place.

*No file outside `research/seam-wire/`, `src/seam-wire*.ts` and the fixture
was modified. `seam.ts` untouched. Local commit only.*
