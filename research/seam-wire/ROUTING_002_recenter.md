# ROUTING_002 — the routing ceiling was a cone artifact (2026-09-09)

Pre-registered by Qwen Max + Fable 5.1 before running; decision rule fixed at **held < 30% after
mean-centring ⇒ cone artifact; ≥ 30% ⇒ semantic.** No constant was changed to reach a branch.
Script: `Elle/electron/native/routing-recenter.cjs`. Zero model calls — arithmetic on the cached
brief embeddings (`gemini-batch-01.jsonl{,.posted}.emb.json`) and `~/.elle/hyper-map/atlas13.json`
(faculty mode, built 2026-09-08T02:06). Scoring reuses `atlas13.axisCoords` and `atlas13.collapse`
unchanged (COLLAPSE 0.06, MARGIN 0.02, RATIO 1.3).

## Reproduction first
The raw arm on the raw-text cache reproduces the ROUTING_001 table **to the digit**:
held 28, hit 27 (0.409), intended-first 38 (0.576), top-3 55 (0.833), wrong-sphere 11, antipode 0.
The raw arm on the posted-text cache gives 15/66 = **0.227 = live**, as the earlier replay found.

## Correction to the record
"58% held" (carried by both Qwen's audit and mine) was the **ceiling** (38/66 intended-first), not
the hold. Offline hold on raw text is **42.4%** (28/66); on posted text **54.5%** (36/66). The
"639 of 1025 goals held" in `atlas13.cjs:375` is a different dataset. The appended self-check makes
briefs more generic — 8 more holds and 12 fewer hits than the raw text on the same 66.

## The embedding space
D = 35,840 = **7 layer taps × 5,120** — `local-embed.cjs` `reduceLayers`, the coordinator's own
hidden states at seven depths, concatenated, not bge-large. ‖μ_briefs‖ = 236 against a mean brief
norm of 248: **the common direction carries ~95% of every vector's norm.** The twelve faculty
vectors: mean off-diagonal cosine **0.8355**, λ₁/12 of the cosine matrix **0.849** — one cone.

## Result (both text variants; μ_LOO = each brief centred by the mean of the OTHER 65)

| text | arm | held % | acc | ceiling (rank-1) | top-3 | antipode | wrong sphere | off-diag cos | λ₁/12 |
|---|---|---|---|---|---|---|---|---|---|
| posted | raw | 54.5 | 0.227 | 0.424 | 0.773 | 1 | 14 | 0.8355 | 0.849 |
| posted | μ_fac (12-sample mean) | 48.5 | 0.061 | 0.167 | 0.515 | 0 | 30 | −0.090 | 0.152 |
| posted | μ_briefs (in-sample) | 22.7 | 0.621 | 0.788 | 0.909 | 0 | 10 | 0.496 | 0.539 |
| posted | **μ_LOO** | **22.7** | **0.621** | **0.788** | **0.909** | 0 | 10 | 0.496 | 0.540 |
| raw | raw | 42.4 | 0.409 | 0.576 | 0.833 | 0 | 11 | 0.8355 | 0.849 |
| raw | μ_fac | 47.0 | 0.152 | 0.227 | 0.652 | 0 | 25 | −0.090 | 0.152 |
| raw | μ_briefs | 22.7 | 0.667 | 0.758 | 0.970 | 0 | 7 | 0.493 | 0.537 |
| raw | **μ_LOO** | **24.2** | **0.652** | **0.773** | **0.970** | 0 | 7 | 0.494 | 0.537 |

Rank of intended, posted text: raw `{1:28, 2:15, 3:8, 4:6, 5:1, 7:1, 8:1, 9:1, 10:3, 11:1, 12:1}` →
μ_LOO `{1:52, 2:6, 3:2, 4:1, 5:1, 6:2, 7:2}`. The tail collapsed.
Residual holds after centring: `ratio` 7, `margin+ratio` 8 — ratio-limited, i.e. genuinely
two-way briefs, not cone.

**Verdict: CONE ARTIFACT.** Out of sample, both variants, held falls to 22.7–24.2%. Accuracy
0.227 → 0.621 on the text the coordinator actually saw; the rank-1 ceiling 0.42 → 0.79; top-3
0.77 → 0.91. Wrong-sphere releases *fell* (14 → 10), so the gain is not bought by loosening — the
ranking got fixed, the gate is unchanged. Antipode confusions 0. The six dualities were never the
problem; the shared mean direction was.

## Which mean
μ_fac (the mean of the twelve faculty vectors) **destroys** routing (acc 0.061). Twelve samples
cannot estimate the encoder's offset — subtracting it removes 1/12 of each faculty's own signal and
leaves near-orthogonal residuals (off-diag −0.09). μ_briefs (66 samples) works; cos(μ_fac, μ_briefs)
= 0.891, just under the 0.9 the plan set as the agreement bar, consistent with μ_fac being the
under-sampled one. **Use a brief-population mean, and re-estimate it as the population grows.**

## F1b (Qwen's identifiability floor) — passes, and is invariant
σ₁ = 154.5, σ₂ = 140.2, σ₃ = 132.6 of the mean-centred faculty set; **σ₂/σ₁ = 0.907, σ₃/σ₁ = 0.858.**
Well-conditioned — the frame is identifiable. And identical in every arm, because mean-centring
translates the origin and cannot touch the spread. That is the `COGNITIVE_OBLIQUITY.md` point made
numerically: the **mean offset** (removed) and the **variance structure** (untouched) are separable.
Qwen predicted F1b "expected REFUTED today"; it is not — the cone was never a conditioning problem.

## What it does not show
- 66 briefs, 11 faculties × 6. The 0.79 ceiling carries roughly ±0.10. Batch-02 (uncached; needs the
  layer-tap embedder, not the 27B decode) is the held-out confirmation before it goes live.
- Off-diagonal cosine is still 0.49 after centring — a large common component remains. The next
  correction is the top-PC removal `COGNITIVE_OBLIQUITY.md` warns against; not run, by design.
- Nothing here touches `atlas13.build()`. Applying centring live is a separate, flag-gated change.

## Next
1. Flag-gated centring in `atlas13.build()` / `axisCoords` (`ELLE_ATLAS13_CENTRE=1`), μ from the
   brief population, stored in the atlas header beside the encoder hash (F3).
2. Batch-02 held-out with the layer-tap embedder.
3. Send this table to Qwen for ledger v3; it asked for exactly this.

## LIVE (2026-09-09 13:5x) — installed, and one persistence bug found on the way
- `atlas13.cjs`: `CENTRE(atlas)` / `centred(atlas, embs, vec)`; `assign()` centres both sides when
  `atlas.centreMu` is present. Presence is the opt-in; `ELLE_ATLAS13_CENTRE=0` is the kill switch.
  Centred faculty vectors cached per atlas object in a WeakMap (never serialised).
- `routing-recenter.cjs --install` writes `centreMu` (n=66, ‖μ‖=236.23) + `centreMu_meta` into
  `~/.elle/hyper-map/atlas13.json`. Backup: `atlas13.pre-centre.backup.json`.
- `routing-diagnose.cjs` now routes through `atlas13.centred()` so the diagnostic matches the board.
- Verified through the REAL `atlas13.assign()`: held 15/66 = 22.7%, hit 41/66 = 0.621, wrong 10.
  Kill switch: held 36/66, hit 0.227 — clean revert. `routing-diagnose --posted`: placed 41,
  ranked-first 52, held 15, ceiling 0.788.
- **Bug:** the first install was erased 90 s later. `routing-diagnose` calls `ensure()`; the atlas
  was >24 h old (`REBUILD_AGE_MS`), so `needsRebuild` fired and `build()` — which carries
  `facultyEmb` forward from the previous atlas — did not carry `centreMu`, then `save()`d over it.
  Silent unattested-constant drift, the exact defect class Qwen's F3 names. Fixed: `ensure()` and
  `build()` now carry `centreMu`/`centreMu_meta` like `facultyEmb`. Re-verified: survives `ensure()`.
- Not yet done: batch-02 held-out (needs the layer-tap embedder = 27B forward passes; paused).
  The 66-brief μ is the installed one; re-estimate from the population when batch-02 is embedded.

## Qwen's two zero-GPU checks (2026-09-09) — both answered, one from data already on disk

**1. LOO leak on the installed register: ~zero.** The μ_LOO arm above already is the requested
protocol — a fresh mean from the other 65 for every brief. Posted text: 0.621 / 22.7% / 0.788,
identical to in-sample at three decimals. Raw text: 0.652 vs 0.667 (−0.015). Qwen's trip threshold
was −0.07. **Transductive but negligible**; a single direction carrying 95% of norm is pinned to a
couple of degrees at n=66 even in 35,840 dims, exactly as predicted.

**Which population the installed mean came from:** the **66 posted-text briefs only** —
`centreMu_meta = {n: 66, D: 35840, source: "gemini-batch-01.jsonl.posted.emb.json", norm: 236.226}`.
Not the 1025 goals. Not the raw-text variant. That is now stamped in the atlas for F3.

**2. The {miss} × {off-ceiling} contingency, under the installed register:**

```
                on-ceiling(rank1)  off-ceiling  total
  hit                    41            0         41
  miss                   11           14         25
  total                  52           14         66
```

**Off-ceiling hits are 0 by construction, not by luck.** `collapse()` picks the pole of the
max-|coord| axis; the rank-1 pole in the signed 12-pole ranking *is* that pole (max signed score
over 12 poles = max |coord| over 6 axes). So hit ⟺ released ∧ rank==1, always. The 2×2 can only
ever be triangular. Qwen's "if all 14 off-ceiling briefs are misses" is therefore not a contingency
— it is a theorem about the scorer. What the table actually decides is **how the 25 misses split**.

- routable fraction 52/66 = **0.7879**; accuracy-on-routable 41/52 = **0.7885**.
  Near-equal, not identical: 52² = 2704 vs 41×66 = 2706. A genuine numerical coincidence, off by 2.
- **11 held at ceiling** (intended ranked first, gate refused): held by `ratio` alone ×6,
  `margin+ratio` ×5. Leads are healthy (0.14–0.28) with runners-up inside 1.3×.
  **Concentrated in social_cognition (4 of 11).**
- **14 off-ceiling**: 4 held, 10 misrouted. **Concentrated in sensory_perception (6 of 14)** —
  "Extract Metric Values from Log Lines", "Parse Multi-System Sensor Payload", "Inspect ASCII Disk
  Map Grid" going to episodic_memory / somatic_interoception / spatial_topography / language_semiotics.

**So the 25 misses are two different failures**: the gate costs 11, the directions cost 14, and one
faculty (sensory_perception) owns 43% of the direction failures. That is the (a)/(b) split
`routing-diagnose.cjs` was built to make, now cleanly separated for the first time.

## Collapse sweep on CENTRED coordinates (free; the question changed meaning after centring)

| COLLAPSE | MARGIN | RATIO | hit | held | wrong | acc |
|---|---|---|---|---|---|---|
| 0.08 | 0 | 1.0 | 52 | 2 | 12 | **0.788** |
| 0.02–0.06 | 0 | 1.0 | 52 | 0 | 14 | 0.788 |
| 0.08 | 0.005 | 1.0 | 51 | 4 | 11 | 0.773 |
| **0.06 | 0.02 | 1.3 (current)** | **41** | **15** | **10** | **0.621** |

Before centring the sweep topped out at 0.576 and bought it with **28** wrong-sphere releases.
Now the ceiling is 0.788 and costs **+4** wrong for **+11** hits. The trade went from 11:17 to 11:4.
`0.08/0/1.0` dominates the other loose settings — same 52 hits, 2 fewer wrong, 2 held.

**Not changing the gate.** The pre-registration covered centring only; moving two things at once
destroys attribution, and held-vs-wrong is a safety trade (a held brief runs on the coordinator,
a released one runs on the wrong specialist) that is Stewart's call, not a sweep's. Logged as the
next A/B, to be run with the same kill-switch protocol that made the centring result clean.

## F3b — Trap 8 becomes a gate (2026-09-09)
`assertCarryForward(prev, next)` in `atlas13.cjs`, called in `ensure()` between `build()` and
`save()`. A rebuild that drops any non-null key the previous atlas carried **throws**, unless the
key is declared in `ATLAS_RETIRED` (currently `rebuilt`, set post-save and never persisted). The
carry-forward list is now schema rather than a habit. Negative-tested: catches a dropped `centreMu`,
passes when carried, honours `ATLAS_RETIRED`. Live path re-verified green after the change.
Qwen's framing was right — the per-field patch fixed one field and left the defect class intact.

## Trap for whoever reads the error corpus
sensory_perception's 6 direction failures are tempting to fix by rewriting its description in
`faculties.json` (12 embeddings, trivial cost). **That would burn the test set** — these 66 briefs
are the labeled evaluation, and the descriptions are what the briefs were written from. Any
description edit must be validated on batch-02, not on batch-01.

## BATCH-02 HELD OUT (2026-09-09) — confirmed, 9.6× on the primary metric
66 briefs, 11 faculties × 6, embedded once with the layer-tap embedder (24 s total; the server
batches, so the 4 s single-call figure does not scale linearly). Raw vectors persisted to
`gemini-batch-02.jsonl.posted.emb.json` BEFORE any register was applied. Acceptance (a) one entry
per row all 35840 — PASS; (b) no zeros, all norms > 1 — PASS.

Scored through the real `atlas13.assign()` against the **FROZEN batch-01 mean** (`centreMu`,
n=66, installed 13:52, never refit on batch-02):

| | held | acc | wrong |
|---|---|---|---|
| centring ON | 14/66 = **21.2%** | 48/66 = **0.727** | 4 |
| centring OFF (kill switch) | 47/66 = 71.2% | 5/66 = **0.076** | 14 |

**9.6× improvement, out of sample, on a mean estimated from a disjoint batch.** The register
transfers. Batch-02 scores *better* than batch-01 (0.727 vs 0.621) while its uncentred baseline is
*worse* (0.076 vs 0.227) — batch-02 is harder in raw form and the centring more than rescues it.

Contingency, frozen mean:
```
                on-ceiling(rank1)  off-ceiling  total
  hit                    48            0         48
  miss                    5           13         18
```
routable 53/66 = 0.803; accuracy-on-routable 48/53 = **0.906**.

**sensory_perception replicates as the worst faculty**: 6 of the 13 off-ceiling misses, exactly as
in batch-01 (6 of 14). Two disjoint batches, same faculty, same failure. That is now a measured
property of the description, not a batch artifact — and the only faculty for which a description
rewrite is justified. Batch-03..15 remain untouched as the validation set for any such edit.

Caveat on the in-script arms: `routing-recenter.cjs`'s `μ_briefs`/`μ_LOO` arms compute the mean
from whatever batch is loaded, so on batch-02 they are transductive (both 0.727, coincidentally
equal to the frozen-mean result). Only `--verify` / `--contingency` use the installed frozen mean.
The held-out claim rests on those two paths.

Note: batch-02 rows carry titles ending "Batch 01" — a generation artifact in the source jsonl, not
a mix-up. Row content and `sphere` labels are batch-02's own.

## DHNG 2×2 — REFUTED as specified, and a δ measurement in its place (2026-09-09)

The proposed test was: re-run the DHNG benchmark with centred embeddings, on the hypothesis that
the +10.9% hyperbolic win at dim 128 might itself be a cone artifact. **It cannot be.** Three
independent reasons, the first two measured:

1. **The DHNG corpus is isotropic by construction.** `docs/experiments/bench.mjs` builds unit
   Gaussians with drift inheritance: root `unit(gauss)`, children `unit(parent*(1-drift)+noise*drift)`.
   Rebuilt at seed 7 (1365 nodes, D=256): **‖μ‖/mean‖v‖ = 0.0270** and **mean off-diagonal cosine
   0.0008** — against 0.95 and 0.8355 in the layer-tap space. There is no cone. Subtracting a mean
   of norm 0.027 from unit vectors is a no-op.
2. **`hyperMap` is given no features at all.** `docs/experiments/dhng_bench.test.ts.txt:93` —
   `hyperMap(nodes.map(n=>({id:n.id})), edges, {dim, epochs:300, seed:42})`. Ids and edges only; the
   coordinates are fit from graph structure. There are no input vectors to centre.
3. The content vectors enter only the cosine baseline arm (`cosDist = 1 − dot(a.content,b.content)`),
   and those are the isotropic Gaussians of (1).

**Status: REFUTED.** The +10.9% stands or falls on its own terms — a result about genuinely
tree-shaped data, unaffected by encoder anisotropy. `DHNG_VS_EUCLIDEAN.md:74` already said the
corpus was synthetic; what is new is the measurement that it is also *isotropic*, which is what
makes the centring question inapplicable rather than merely awkward.

The live map cannot substitute: 2,764 nodes / 2,763 edges, **every edge kind `child`** — exactly a
spanning tree, b₁ = E−V+C = **0**, no cycles, and nodes carry no `dir` field. Re-embedding it is GPU
work and 27B testing is paused.

### What was run instead: δ-hyperbolicity on real content in the routing space
132 real briefs (batch-01 + batch-02), D = 35,840, cosine-distance metric, Gromov 4-point δ over
191,398 sampled quadruples (deterministic LCG, seed 12345). ‖μ‖/mean‖v‖ = 0.9566.

| | mean pair dist | diam | δ_max | δ_mean | δ_max/diam | δ_rel = 2δ/diam |
|---|---|---|---|---|---|---|
| raw (uncentred) | 0.0862 | 0.2179 | 0.0266 | 0.00492 | **0.1221** | 0.2442 |
| centred | 1.0070 | 1.4130 | 0.2956 | 0.05959 | **0.2092** | 0.4184 |

Reference bands (`DELTA_HYPERBOLICITY_CONTENT.md`): synthetic tree 0.00–0.08 · lexical arm
0.16–0.25 · ring control 0.475–0.480.

**Two findings, and the second is uncomfortable for ℍ.**

(a) Raw content sits at δ/diam **0.122** — below the lexical arm's 0.16–0.25, above the tree band
0.00–0.08. Consistent with `DELTA_HYPERBOLICITY_CONTENT`'s verdict of *"not cleared, which is not
the same as refuted"*, measured now in the layer-tap space rather than tf-idf.

(b) **Centring makes the geometry LESS tree-like, not more** — δ/diam 0.122 → 0.209, moving from
below the lexical band to its top edge. The raw figure was flattered by the cone: when 95% of every
vector points the same way, all pairwise distances are compressed into a narrow shell (mean 0.086,
diam 0.218), and small distances make δ look small. Remove the cone and the true spread appears
(mean 1.007, diam 1.413) along with the true δ.

So the same operation that **fixed routing** (0.076 → 0.727, held out) **weakened the case for the
hyperbolic factor**. Those are not in tension — routing wants angular separation, ℍ wants tree-likeness,
and the cone was faking the second while suppressing the first. This is the first measurement that
prices them against each other, and it prices them in opposite directions.

**Status of ℍ: still INSTRUMENTATION.** It has not produced a measurement a flat build could not,
and the one precondition that would justify it (tree-likeness of real content) reads *worse* in the
corrected space than in the uncorrected one. The decisive semantic arm remains blocked on the
`/api/search` service key.

### CORRECTION (2026-09-09, same day) — the δ conclusion above is RETRACTED

Two commensurability checks were demanded before the δ number entered any document. Both were run.
The result invalidates the inference I drew from it. The measurement stands; the conclusion does not.

**Exhaustive, not sampled.** All C(132,4) = 12,082,785 quadruples, no subsampling:
raw **0.1584** (was 0.1221 at 1.6% sample), centred **0.2742** (was 0.2092). Subsampling the max
biased both low, as predicted. δ_max is the statistic; δ_mean/diam is also reported below.

**Controls re-run in THIS estimator, exact metrics, no embedding:**

| point set | δ_max/diam | mean/diam | note |
|---|---|---|---|
| exact TREE, branching 4 | **0.0000** | 0.776 | trees are 0-hyperbolic — estimator validated |
| SEGMENT, 1-D uniform | 0.0000 | **0.338** | degeneracy A (predicted 1/3) |
| SIMPLEX, all pairs equal | 0.0000 | **1.000** | degeneracy B |
| random Gaussian cloud, D=2048 | **0.0811** | 0.938 | **inside the cited "tree" band 0.00–0.08** |
| same cloud + cone at ‖μ‖/mean‖v‖ = 0.956 | **0.0802** | 0.919 | cone alone changes nothing |
| real briefs RAW | 0.1584 | 0.395 | |
| real briefs CENTRED | 0.2742 | 0.713 | |
| exact RING C₁₃₂ | **0.5000** | 0.504 | textbook — estimator validated |

**Three findings, in order of consequence.**

1. **The band citation is invalid, and worse than "different estimator family."** A random Gaussian
   cloud scores **0.0811** in this estimator — inside the 0.00–0.08 synthetic-tree band. The band
   does not separate tree from noise here, so quoting it made 0.122 look meaningful when it was not.
   Qwen's commensurability check was right and the answer is that the comparison had no content.

2. **Both proposed mechanisms are REFUTED.** Mine ("compressed distances make δ look small") was
   wrong on Qwen's grounds — δ is homogeneous of degree 1, so δ/diam is scale-invariant. But Qwen's
   ("the cone collapses the metric to ~1-D along c, and 1-D metrics are trees") is refuted by direct
   test: injecting a cone into isotropic noise at the *identical* anisotropy (‖μ‖/mean‖v‖ = 0.956)
   leaves δ/diam at 0.080 and mean/diam at 0.919 — the **shell** signature, not the segment. A mean
   shift leaves the residual isotropic; it does not create one-dimensionality. The raw briefs' segment
   signature (mean/diam 0.395 vs segment 0.338) is real but comes from a dominant **variance**
   direction, not from the mean — which is exactly the offset-vs-axis distinction
   `COGNITIVE_OBLIQUITY.md` insists on, now measured from the other side.

3. **δ = 0 has two degenerate causes**, and this estimator cannot tell them apart: SEGMENT
   (mean/diam 0.338) and SIMPLEX (mean/diam 1.000) both give exactly 0. So δ alone never establishes
   tree-likeness; it needs mean/diam as a companion statistic. At N = 132 in D = 35,840 the points
   are near-equidistant, which pushes δ toward the simplex degeneracy regardless of hierarchy.

**Therefore: the claim "centring makes content less tree-like, and this weakens the case for ℍ" is
RETRACTED.** 0.1584 → 0.2742 is a real change in a real statistic, but that statistic does not
measure tree-likeness at this N and D — noise scores inside the tree band and both degeneracies
collapse to the same value. **ℍ's status is unchanged and unmeasured by this: still INSTRUMENTATION,
still awaiting the semantic δ-arm on real corpus content with a graph-geodesic metric** (blocked on
the `/api/search` key), which is a different estimator on a different object and remains the
decisive one.

What survives: the estimator is validated (tree 0.0000, ring 0.5000 exactly), the exhaustive numbers
are correct, the cone-injection null is a reusable control, and the 0.00–0.08 band must not be cited
for embedding four-point δ again.

## Stale rows and the generator (2026-09-09) — cleared

**`gen-harmonic-snapshot.mjs` — obliquity now derived, and the script now RUNS.**
Two defects, one of them the reason the first was never caught:
- Line 62 computed `0.5·sin(2π·tSnap)·180/π = 26.0495°` — that is `timescaleSeparation()`'s slow
  DRIFT SCHEDULE sampled at t = 1/π, a different quantity from the crossing, and it predated
  `cognitive-obliquity.ts`. Replaced with the bisection the deployed snapshot describes:
  `integrated_preferred(θ) = integrated_preferred(0°)·φ⁻¹` over `runObliquity`. Verified to
  reproduce the deployed object **field for field** — thetaDeg **38.669184**, aligned **0.000999**,
  at_theta **0.000618**, analytic_ideal_deg **38.172708** (= arccos√(1/φ), the closed form of the
  same crossing under an exact cos²θ law). The emitted object now carries all six fields.
- **The script could never have run as documented.** Its imports read `'./src/…'`, which ESM
  resolves relative to `scripts/`, i.e. `scripts/src/scaffold.ts` — which does not exist. The header
  said "run from the elle-worker repo root", but cwd is irrelevant to relative ESM specifiers.
  Rewritten to `'../src/…'`; the script now runs and emits (flower 19 nodes, architecture 21).
  **This is how the deployed snapshot drifted unchecked**: the one thing that calls itself "the
  source of truth, locked" was unrunnable, so nobody could notice it disagreed with the artifact.

**Stale rows, all three corrected:**
- `src/torus.ts:24-30` — the SCOPE note claimed a plain torus gives only asymptotic identity-return
  and that the lemniscate layer is therefore needed. Corrected: the winding number in π₁(𝕋ⁿ)=ℤⁿ is
  exact at every finite time; SICT tested metric return, which is the wrong test. Points at
  `WHY_NO_LEMNISCATE.md` and `product.ts`'s header.
- `docs/TOROIDAL_GRAPH_MAPPING.md:228` — the §9 status row read "Torus alone carries
  identity-continuity | FALSE … needs the lemniscate (Option B)", contradicting §7 and §10 of its
  own document. Corrected to TRUE with the reason and a dated note.
- `CLAUDE.md` "Known state" — the bullet was wrong in **both** directions. "Nothing imports the
  bridge" is false (`src/pfar.ts` imports it lazily; `src/pfar-fft.test.ts` exercises it). But
  `PFAR_PHASE_SPACE_PAPER.md` overcorrected to "confirmed live": **`public/wasm/` does not exist**
  (verified), so the fast path cannot engage and the float-DFT fallback is what runs. Bullet now
  states the measured state and names both errors.

**Still open:** F3 config-transcript hash (F3b, the carry-forward gate, is done; the hash itself is
not). Semantic δ-arm, blocked on the `/api/search` service key.

## The semantic δ-arm is not blocked the way the register says (2026-09-09)

`DELTA_HYPERBOLICITY_CONTENT.md` records the decisive arm as blocked by an auth gate on
`/api/search` (service-key gated, `src/index.ts:2837`). Checked: that is no longer the binding
constraint, and the arm as *specified* has gone stale in a more interesting way.

- **bge-large is not installed on this machine.** Ollama holds exactly two tags, `elle:latest` and
  `elle-worker:latest` — both the 27B. mlx-serve's roster has no embedding model. So "the production
  bge embedding" cannot be reproduced locally at all; it is an `ollama pull` away, not an auth token.
- **More to the point, the atlas no longer routes in bge space.** `local-embed.cjs` defaults to
  `/api/embed/layers` — the coordinator's own hidden states at seven depths, 7 × 5120 = 35,840-d
  (Stewart, confirming: *"we have the embedder that we pulled from the multimodal qwen"*). The
  installed `facultyEmb` and `centreMu` are both 35,840-d. bge-large 1024-d survives only in
  elle-worker's cloud memory path (`mem-intake.ts` validates that width).

So the arm as written would measure a space the local system has migrated off. The question it was
asked to settle — *is real content tree-like enough to justify ℍ* — still stands, but it has to be
asked in the space the atlas actually uses.

**Run instead, and reported below: the graph-geodesic arm in the layer-tap space.** Same corpus
(`corpus/**/*.md`), same production chunker (`semanticChunks` ported verbatim from `src/index.ts:385`,
1030 chunks against the register's 1021 — one file added since), same estimator family as the
lexical arm (symmetrized k-NN at k = 3/5/8, BFS hop metric, 4-point δ, R = 5 seeded relabelings).
Directly comparable to the lexical arm's δ/diam of 0.1607 / 0.2500 / 0.2500.

Note the register already warned off the estimator I used this morning: *"Direct metric 4-point δ on
the angular distances (no graph in the loop): δ/diam median 0.0361. That number is not usable as
evidence of tree-likeness — see Limitation 2."* Today's controls independently reproduced that
warning (random noise scores 0.0811, inside the tree band). The graph is not optional.

### Pre-registration — written before the numbers, 2026-09-09
Decision rule for the graph-geodesic arm in the layer-tap space, fixed in advance:

- **δ/diam ≤ 0.08 at every k** → TREE-LIKE. The precondition for ℍ is cleared in the space the
  atlas actually routes in. This would be the first positive evidence for the hyperbolic factor
  anywhere in the corpus, and would move ℍ from INSTRUMENTATION toward MECHANISM pending a
  retrieval win.
- **0.08 < δ/diam ≤ 0.30** → NOT CLEARED, which is not refuted. Same verdict the lexical arm
  reached (0.1607 / 0.2500 / 0.2500), now in the live space. ℍ stays INSTRUMENTATION.
- **δ/diam > 0.30** → NOT TREE-LIKE. Approaching the ring control (0.475–0.480). ℍ should be
  dropped for this space and the product mix set toroidal-or-flat on evidence rather than taste.

Companion statistics reported regardless, because δ alone is insufficient (today's controls: δ = 0
has two degenerate causes): component count, giant-component fraction, graph diameter, |E|, and
‖μ‖/mean‖v‖. A result with one component at 100% and a diameter under ~6 is a small-world graph
where δ has little room to vary — that would make the number uninformative rather than negative,
and it must be said if it happens.

Both arms (raw and mean-centred) are run because centring is now live in `assign()`; if they differ
materially, the register that routing uses is not the register ℍ would be built in, and that is
itself a finding.

### RESULT — graph-geodesic δ in the layer-tap space (2026-09-09)

1030 corpus chunks, production chunker, layer-tap embedding (7×5120), symmetrized k-NN,
BFS hop metric, 4-point δ, R=5 seeded relabelings (`0xA11C0DE0+r`), 150k quadruples each.
‖μ‖/mean‖v‖ = 0.9215. Zero embed failures.

| arm | k | \|E\| | comps | giant % | diam | δ median | **δ/diam** | relabelings |
|---|---|---|---|---|---|---|---|---|
| RAW | 3 | 2183 | 5 | 95.8 | 24 | 4 | **0.1667** | 4,4,4,4,4 |
| RAW | 5 | 3638 | 2 | 99.2 | 15 | 2.5 | **0.1667** | 2.5 ×5 |
| RAW | 8 | 5772 | 1 | 100.0 | 12 | 2.5 | **0.2083** | 2,2.5,2.5,2.5,2.5 |
| CENTRED | 3 | 2124 | 8 | 91.7 | 26 | 5 | **0.1923** | 4.5,5,5,5,5 |
| CENTRED | 5 | 3530 | 3 | 96.5 | 14 | 3 | **0.2143** | 3 ×5 |
| CENTRED | 8 | 5603 | 1 | 100.0 | 11 | 2.5 | **0.2273** | 2.5 ×5 |

Register's lexical arm, same estimator: **0.1607 / 0.2500 / 0.2500**. Bands: tree 0.00–0.08,
ring 0.475–0.480.

**Verdict, by the rule fixed before the run: NOT CLEARED.** Every cell falls in 0.08–0.30.
The informativeness check passes — diameters are 24/15/12 and 26/14/11, far above the ~6 floor
where δ would have no room to vary — so this is a real negative, not a degenerate one. Relabeling
spread is negligible (four of six cells are identical across all five seeds).

**The finding that matters is the comparison, not the number.** The layer-tap space —
35,840 dimensions of a 16 GB multimodal model's own hidden states at seven depths — is
**indistinguishable from tf-idf** on tree-likeness: 0.167–0.208 against 0.161–0.250. A bag of word
counts and a frontier model's internal representation agree, to within the estimator's resolution,
that this corpus is not hierarchical.

That makes three independent spaces with the same verdict: **tf-idf 0.161–0.250, PAMI 0.200–0.286,
layer-tap 0.167–0.208.** The register recorded ℍ's precondition as *"not cleared — which is not the
same as refuted"*, with the decisive arm blocked. The arm is no longer blocked and the verdict did
not move. Tree-likeness is not a property of the embedding one picks; on this corpus it is absent
from every space tried.

**ℍ's status: INSTRUMENTATION, now on evidence rather than for want of a measurement.** It has
produced no measurement a flat build could not, and its precondition has failed in three spaces
including the live one. This does not refute hyperbolic embedding in general — a genuinely
tree-shaped corpus would read differently, and `DHNG_VS_EUCLIDEAN`'s +10.9% on a synthetic tree
stands. It refutes the assumption that *this* content is that shape.

**Centring costs a little tree-likeness in the valid estimator too** — +0.026 / +0.048 / +0.019
at k = 3/5/8, and it fragments the k-NN graph (5→8 and 2→3 components at k = 3 and 5). Same
direction as this morning's retracted 4-point reading, but about half the magnitude, and now from
an estimator that survives its controls. The routing register and the ℍ register genuinely pull
against each other; the trade is real but small, and routing's side of it is 9.6× measured.

Artifacts: `/tmp/corpus_chunks.json` (1030 chunks), `/tmp/corpus_emb.json` (480 MB raw layer-tap
vectors — persisted unmodified, so any later register applies without re-embedding),
`/tmp/delta_graph.cjs`. The embedding cost 18.6 min of 27B forward passes and need not be repeated.

---

# THE BRIEF CORPUS IS 77 DISTINCT TASKS, NOT 1056 (2026-09-09)

Found while validating the parallel session's `sensory_perception` proposal, which warned that
batch-02's six sensory rows looked like one template. That warning was right and it generalises far
beyond sensory. Median within-batch pairwise brief similarity, per faculty:

| | batch-01 | batches 02–15 |
|---|---|---|
| median across all 11 faculties | **0.038** | **0.975** |

Batch-01 is 66 genuinely distinct tasks. **Every batch from 02 to 15 is the same 11 templates —
one per faculty — with the topic noun swapped**, six copies each. Row-aligned similarity between
batch-02 and batch-03 is **0.967**: batch-03 is not a new sample, it is batch-02 relabelled
("Parse Writing Payload Batch 01" → "Parse Writing Payload Batch 02").

Effective distinct tasks in the whole 1056-brief corpus: **66 (batch-01) + 11 (the template set) = 77.**

## What this corrects

**The batch-02 held-out result stands but its power does not.** 0.076 → 0.727 is a real transfer
from batch-01's diverse tasks onto unseen text, and the direction is not in doubt. But the effective
n is **~11 distinct tasks counted six times each**, not 66 independent trials. Every confidence
interval quoted on batch-02 in this document is too narrow by roughly √6. The centring result's
strength rests on **batch-01's 66 diverse tasks**, where it is in-sample-but-LOO-validated, plus a
directionally consistent transfer to 11 template families. That is still a good result. It is not
66 independent held-out confirmations, and I described it as if it were.

**"sensory_perception is the worst faculty in both batches (6 of 13 and 6 of 14)" was inflated.**
Batch-01's six sensory failures are six *independent* failures (similarity 0.055) — that is the real
evidence. Batch-02's six are one failure counted six times.

**The four-arm validation below is not an independent holdout.** Batch-03's sensory rows are the
same template as batch-02's. Reported for the record, not as confirmation.

## The four-arm result, correctly scoped

Untouched batch-03, n=66, frozen batch-01 `centreMu`, live atlas read-only and never rebuilt.
Candidate description embedded exactly as `swarm.cjs:329` builds faculty vectors.

| arm | acc | hit | held | wrong | sens rank-1 | sens hit | false-into-sens |
|---|---|---|---|---|---|---|---|
| A baseline | 0.742 | 49 | 13 | 4 | **0** | 0 | 0 |
| B description only | 0.667 | 44 | 18 | 4 | 2 | 0 | 0 |
| C regex only | 0.742 | 49 | 13 | 4 | 0 | 0 | 0 |
| D both | **0.758** | 50 | 12 | 4 | **6** | 6 | 0 |

Against the parallel session's own pre-registered rule (sensory rank-1 **and** total correct
releases both up, no increase in wrong releases, no new false releases into sensory): B FAIL,
C FAIL, **D PASS**.

The interaction is the interesting part and is probably real: **neither change works alone.**
The regex alone changes nothing at all — identical numbers to baseline — because a ≤0.12 keyword
vote cannot close the cosine gap. The description alone improves sensory ranking (0→2 rank-1) but
costs five hits elsewhere, and those five go to *held*, not to wrong releases (held 13→18): the new
description makes five non-sensory briefs more ambiguous. Adding the regex tips those back out.
So the description repositions and the regex breaks the resulting ties.

But **"0/6 → 6/6" is really "0/1 → 1/1" on one template**, and that template is batch-02's.
The +1 net hit and −1 held across all 66 rows are the honest headline, and they are within noise.

## Decision: DO NOT INSTALL the sensory rewrite

Not because it failed — it passed the rule — but because **no valid holdout exists.** Batch-01 is
the only diverse sensory data and it was the development set; batches 02–15 are one template.
Installing on this evidence would be tuning to a single task shape.

**This is now the binding constraint on the whole routing programme, not just on sensory.** The
next useful thing anyone can do is generate genuinely diverse briefs — batch-01's construction is
the model (median similarity 0.038); whatever produced batches 02–15 collapsed to a template and
nobody noticed for two days of measurement. Until that exists, routing changes can only be
validated on batch-01, which every proposal has now seen.

Credit where due: the parallel session flagged the template risk for batch-02 from source inspection
alone, before any of this was measured, and explicitly declined to claim its twelve predicted flips
as demonstrated. Its caution was better calibrated than my headline.
