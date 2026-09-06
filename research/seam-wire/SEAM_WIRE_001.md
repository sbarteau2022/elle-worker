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
running (`runs/control-baseline/test_base_n100.json`), same model, same
prompt, same 512-token budget. Before its numbers are read, the following is
fixed:

- **H1 (the only claim).** Readout B, stream `surprisal`, RESERVE test with
  the **inverted** orientation (reserve high ⇒ OPEN): AUC ≥ 0.65 with 95%
  lower bound > 0.5, and Gate 1 met (≥ 20 per class).
- Every other cell is reported but makes no claim.
- Same head (96), windows, bands, null, seeds, controls.
- If H1 fails, the 0.250 was a one-sample artifact and readout B is KILLed
  outright. If it holds, it earns exactly one thing: a pre-registered
  place in the next validation round, still behind the seam, still short of
  the human-rater Gate 2 the validate.ts report itself demands.

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
