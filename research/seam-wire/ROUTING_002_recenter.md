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

---

# THE TWELFTH FACULTY WAS NEVER TESTED, AND IT WAS EATING THE BOARD (2026-09-09)

Found while preparing the batch-16 acceptance test. Two findings, one measurement, both independent
of everything above.

## 1. `convergent_logic` has zero briefs in the entire corpus

`faculties.json` v1 defines **12** faculties. All 15 brief batches — 990 rows — cover **11**:

```
NEVER TESTED by any brief: ['convergent_logic']
in briefs but not in faculties.json: (none)
```

So `convergent_logic` can only ever appear as a **wrong** destination. It has no correct answers.
Every accuracy number in this document was measured on a board with a guaranteed-wrong twelfth exit.

## 2. Pre-centring, that exit absorbed up to 22.7% of everything

Read-only, direct on `atlas13.json` (no `ensure()`, no rebuild — Trap 8), cached `.posted` vectors,
cosine against `facultyEmb` with and without the installed `centreMu`:

| batch | RAW top-1 | RAW top-3 | CENTRED top-1 | CENTRED top-3 |
|---|---|---|---|---|
| 01 | 8/66 = **12.1%** | 55/66 = **83.3%** | 3/66 = 4.5% | 14/66 = 21.2% |
| 02 | 15/66 = **22.7%** | 56/66 = **84.8%** | 0/66 = **0.0%** | 28/66 = 42.4% |
| 03 | 15/66 = **22.7%** | 56/66 = **84.8%** | 0/66 = **0.0%** | 26/66 = 39.4% |

In the raw regime a faculty that is **never the right answer** was in the top 3 for ~84% of all
briefs and won outright for up to 22.7% of them. Its raw victims are exactly the faculties this
document has been chasing all along: `language_semiotics` (6), `divergent_synthesis` (6),
`sensory_perception` (2), `episodic_memory` (1) in batches 02/03.

Mean-centring removes it: 22.7% → 0.0% top-1, ~84% → ~40% top-3. **This is a third independent
confirmation of the cone diagnosis**, and the cleanest one, because it needs no accuracy metric and
no labels — just the observation that one exit was universally attractive and is no longer.

Tagged **MEASURED**. What it does *not* show: nothing here says `convergent_logic`'s description is
good or bad. The corpus has never tested it. It only shows the cone made it a sink.

## 3. Consequence: the corpus cannot measure a twelfth of the atlas

`convergent_logic` is presumably the natural home for exactly the reasoning-and-deduction briefs
that make up a lot of real routing traffic. We have measured its false-positive rate at length and
its true-positive rate never. **batch-16 must be 12 spheres × 6 = 72 rows, not 66.**

## 4. A routing-space diversity detector, better than any text statistic

The same run produced a cleaner test than the lexical bar I pre-registered. Ask: *do all six rows of
a sphere route to the same faculty?*

| batch | spheres routing all 6 rows to ONE faculty | mean distinct destinations per sphere | rank-1 histogram |
|---|---|---|---|
| 01 (diverse) | **4/11** | **1.91** | 10,7,7,6,6,5,5,5,5,4,3,3 — ragged |
| 02 (templated) | **11/11** | **1.00** | 6,6,6,6,6,6,6,6,6,6,6 — flat |
| 03 (templated) | **11/11** | **1.00** | 6,6,6,6,6,6,6,6,6,6,6 — flat |

Batches 02/03 produce a *perfectly* flat 6-per-faculty histogram. That is not the router being
accurate; it is the router being unable to tell six copies apart, so each template contributes all
six of its rows to one destination. The flat histogram is a **fingerprint of the template collapse**,
arrived at without looking at a single character of brief text.

Why this is the right acceptance test, and why it is not gameable:

- It measures diversity **in the space the holdout is for**. Two briefs that the router cannot
  separate are one task *for the purposes of a routing experiment*, whatever a text statistic says.
- Every lexical statistic can be beaten by surface-form variation. This one cannot, because the
  generator **has no access to the router** — no embedder, no GPU, by the terms of the split. It
  writes blind; the test is applied afterwards by the side that owns the GPU. A metric the optimiser
  cannot observe cannot be Goodharted.

Batch-01 sits at 4/11 lockstep and 1.91 mean destinations, so a bar must sit below that.
Pre-registered for batch-16, before it exists: **≤ 5/12 spheres in lockstep AND mean distinct
destinations ≥ 1.7.** Batch-01 passes (4/11, 1.91); batches 02/03 fail maximally (11/11, 1.00).

The lexical bar (median SequenceMatcher < 0.15) stays as a **cheap pre-filter the generator can
self-apply**, not as the acceptance test. It was the wrong instrument for the job I gave it.

## Incidental corroboration

Batch-01's `sensory_perception` scatters to **5 distinct destinations** — the most of any sphere,
more than double the batch mean. That is the same faculty this document identified as worst by
accuracy, reached by an unrelated statistic on unrelated grounds.

---

# CORRECTION: "0.038" IS MOSTLY AN AUTOJUNK ARTIFACT, AND THE WHOLE LEXICAL FAMILY FAILS (2026-09-09)

Adversarial workflow, four attackers + four statistic families, calibrated on batch-01 (good) and
batch-02 (bad). Two results, both of which correct claims made earlier in this document.

## 1. The 0.038 headline is inflated by difflib's junk heuristic

`SequenceMatcher.ratio()` has `autojunk=True` by default. It activates at ≥200 elements and treats
any character appearing in >1% of positions as junk. Every brief is 276–596 chars, so **autojunk was
always active in every measurement I reported.**

| statistic | batch-01 | batch-02 | separation |
|---|---|---|---|
| SequenceMatcher, autojunk ON (what I quoted) | **0.0375** | 0.9753 | 26.0× |
| SequenceMatcher, autojunk OFF | **0.2889** | 0.9783 | 3.4× |

**The corpus finding is unaffected** — 0.289 vs 0.978 is still unambiguous, still no sphere-level
overlap, and batches 02–15 are still one template each. But the specific figure **0.038, which I
quoted in this record, in the commit messages, and in the handoff plan, is an artifact-inflated
version of 0.289** and should not be cited as a measure of semantic distance. Corrected here rather
than edited in place, so the earlier claim and its correction both stand.

Worse, within batch-01 alone S1's Spearman correlation with every other lexical statistic is ~0
(−0.164 to +0.159). Once briefs are genuinely distinct it is **noise**, so it cannot rank one
passing batch against another — exactly the job I gave it.

## 2. Every surface-lexical statistic is defeated by a domain re-skin

The attack: hold the task skeleton fixed — function words, punctuation, number slots, answer shape
and the entire `verify` field byte-identical (verified programmatically) — and swap each row's
content vocabulary to a different subject domain. One find-and-replace pass per row.

| statistic | batch-01 (good) | re-skinned fake | verdict |
|---|---|---|---|
| SequenceMatcher (autojunk ON) | 0.0375 | 0.0655 | passes, inside good range |
| SequenceMatcher (autojunk OFF) | 0.2889 | 0.3671 | passes |
| token Jaccard | 0.1148 | 0.1250 | passes, 1.09× — indistinguishable |
| char 5-gram Jaccard | 0.0686 | **0.0341** | **INVERTS** — fake scores 2× more diverse |
| TF-IDF cosine | 0.0717 | 0.1609 | passes (inside batch-01's own range) |
| longest common substring | 0.0693 | **0.0261** | **INVERTS** |

Two statistics score **eleven copies of one task as more diverse than 66 genuinely distinct tasks.**
Character n-grams key on morphology, so swapping vocabulary destroys overlap *faster* than writing a
real new task does. A bar built on these actively rewards reaching for a thesaurus.

Weaker attacks do NOT beat the family — re-rolling every number, shuffling lines, reformatting
delimiters and synonym-swapping ~40 frame words leaves the clone batch far above every bar
(char-5gram 0.586 vs 0.130). It is defeated *only* by content-vocabulary change, which is precisely
the move a capable writer makes and precisely the move that leaves the task untouched.

**⇒ "median SequenceMatcher < 0.15" was the wrong gate. Replacing it with "median TF-IDF < X" is the
same gate in a different coat.** Keep TF-IDF cosine < 0.30 as a cheap copy-paste detector only.

## 3. THE OPEN RISK: the lockstep bar is UNVALIDATED against this attack

The routing-space lockstep test (≤5/12 spheres in lockstep, mean distinct destinations ≥1.7) was
pre-registered on the strength of batch-01 vs batches 02/03. **It has not been tested against the
domain re-skin**, because `mlx-serve` on :11437 returns `no upstream configured` — the embedder is
down and the attack rows cannot be embedded.

There is a concrete mechanism by which it could fail, and it should be stated before anyone relies
on the bar. TAGGED **OPEN**, reasoning not measurement:

- The re-skin raises TF-IDF cosine to 2.24× the good batch — it *spreads* rows lexically.
- This document's own δ result found the layer-tap space **indistinguishable from tf-idf** on
  tree-likeness (0.19/0.21/0.23 vs 0.16/0.25/0.25).
- If the router's space behaves substantially like tf-idf, re-skinned rows would be *more* spread in
  embedding space, hence *more* likely to scatter across faculties, hence **more likely to PASS the
  lockstep bar** while being one task.

That is the same failure mode as the lexical family, one level up. The lockstep bar's claimed
advantage — that the generator cannot observe it — protects against deliberate gaming but not
against a writer who varies vocabulary for ordinary stylistic reasons and accidentally satisfies it.

**Required before batch-16 is accepted on this bar:** embed the four attack sets from the workflow
journal and confirm they FAIL lockstep. If they pass, the bar is broken and the acceptance test must
move to something that reads the operation performed rather than the text — the workflow's own
recommendation: distinctness of the operation, of the answer's type/shape, and of what `verify`
actually checks. That last one is attractive because the re-skin attack held `verify` byte-identical
by construction.

## Provenance caveat

`gemini-batch-02.jsonl`, `gemini-batch-03.jsonl` and their cached embeddings became unreadable at the
OS level (EPERM) partway through this session, progressively, while batch-01 stayed readable. The
batch-02 values above were measured on the real file before it went dark; the attack ladder was then
run against a reconstruction (batch-01 row 0 per sphere, cloned ×6 with topic-noun swap and number
jitter) which reproduced batch-02's real values to within 0.05 on all six statistics.

---

# THE BATCH-16 ACCEPTANCE TEST, FINAL — AND IT NEEDS NO GPU (2026-09-09)

Supersedes the lexical bar (refuted above) and does not depend on the lockstep bar (still OPEN,
embedder down). Sourced from the adversarial workflow's verify-field family, then reimplemented and
re-measured independently here because the agent's numbers did not reproduce.

## The reproduction discrepancy — read this before using any threshold

| | workflow agent | independent reimplementation |
|---|---|---|
| batch-01 V6 | 0.0777 (per-sphere 0.0506–0.1218) | **0.1422** (per-sphere 0.1178–0.1966) |

~2×, and the cause is **IDF-fitting scope**: fitting IDF within each sphere (N=6 documents) gives a
weak, noisy IDF and a higher floor; fitting across all 66 gives a lower one. Neither of us stated
the scope alongside the threshold, which made both numbers unusable as written.
**A V6 threshold is meaningless without its IDF scope.** Everything below fits IDF **within-sphere,
N=6**, and the numbers are from the reimplementation.

## The test

Two gates, both pure stdlib, **no embedder and no GPU** — which is what makes this usable right now.

**Gate 1 — verify-field IDF cosine (V6) < 0.35**, IDF fit within-sphere over the 6 rows, median of
the C(6,2)=15 pairs, then median across spheres.

| set | V6 | worst sphere |
|---|---|---|
| batch-01 (known good) | **0.1422** | 0.1966 |
| reconstructed template (batch-02 recipe) | **1.0000** | best sphere 0.6394 |

0.35 sits in the empty band between 0.1966 and 0.6394. Not a round number chosen for looks — it is
the midpoint of the observed gap.

**Gate 2 — every `verify` field between 40 and 220 characters.** Batch-01 spans 61–147.

Gate 2 exists solely to close Gate 1's one known defeat. Padding `verify` with unique junk tokens
drives V6 *below* the good batch (measured: 45 junk tokens → **0.0611**, under batch-01's 0.1422),
so V6 alone can be beaten by a writer who pads. But padding is impossible to hide in length:

| set | verify length |
|---|---|
| batch-01 | 61–147 |
| padding attack | **501–583** |

No overlap, not close. The attack that defeats Gate 1 is loud in Gate 2.

## Why this pair, and not the lexical family

The load-bearing property, measured by the workflow and the reason to prefer verify over brief:
**verify similarity is nearly independent of brief similarity** — pair-level Pearson +0.2113
(Spearman +0.1994, r² = 0.045) across batch-01's 165 within-sphere pairs.

That independence is the whole argument. A writer driving brief-similarity down — by paraphrase,
re-skin, padding, any of the four attacks — does **not** drag verify-similarity down with it,
because the checking procedure has to keep matching the task. The domain re-skin that defeated every
single lexical statistic held `verify` byte-identical *by construction*, and would score 1.0000 here.

Two gates that are statistically independent are far harder to satisfy together by accident than one
gate is — and accident, not adversarial gaming, is what actually ruined the corpus.

## Rejected, with reasons

- **V3 exact-duplicate-pair rate** and **V4 distinct-fraction**: perfect 0-vs-1 separation, defeated
  by **one character** per row. They separate these two batches only because batch-02's author never
  touched `verify`. Lazy-template tripwires — keep as free preconditions, never as the bar.
- **V1/V2 raw SequenceMatcher on verify**: good-batch floor 0.426 (76% shared boilerplate scaffold),
  so the usable range is 0.43–1.00 rather than 0–1. Beaten by ~20 junk tokens.
- **The whole brief-field lexical family**: refuted above.

## Standing status of the two other bars

- **Lexical (median SequenceMatcher < 0.15): REFUTED.** Demote to a copy-paste tripwire.
- **Lockstep routing test (≤5/12, mean ≥1.7): OPEN, unvalidated.** Still the better test *in
  principle* because it measures diversity in the space the holdout is for — but it cannot be
  checked until `mlx-serve` has an upstream again, and there is a stated mechanism by which the
  re-skin attack may defeat it too. **Do not accept batch-16 on lockstep alone.**
- **V6 + length band: ACCEPTED, and it is the one that works today.**

Apply Gates 1 and 2 on arrival. Run lockstep as confirmation when the GPU returns; if lockstep and
V6 disagree on the same batch, that disagreement is itself the most informative measurement
available and should be recorded, not resolved by preference.

---

# GATE 3 (SNP) AND THE REAL CAUSE OF THE FILE BLACKOUT (2026-09-09)

## Gate 3 — Shared Numeric Payload, FLAG-only

The reskin attack rewrites 100% of the surface — domain, serialization format (syslog/JSON/CSV/ASCII
table/key=value/XML), column names, imperative verb — while keeping the **byte-identical numeric
payload**, the same threshold, the same operation chain and the same four-slot answer. All six rows
have the literally identical correct answer. Solve one, you have solved all six. It drives
SequenceMatcher to 0.0874, *below* batch-01's most-similar honest sphere (0.1030): **the lexical bar
is not merely beatable, it is anti-correlated with what it claims to measure.**

SNP scores the body instead of the costume. Extract numeric literals, drop bare single-digit
integers (indices, id suffixes, clock fields), canonicalise via float so `0412`→412.0 and `3.80`→3.8;
per pair take `max(Jaccard, Jaccard of each set normalised by its own max)` — the second channel
defeats uniform rescaling. Score a pair only if both briefs carry ≥4 payload numbers.

| set | SNP | measurable pairs | spheres scored |
|---|---|---|---|
| reskin attack | **1.0000** (worst pair 0.7391) | 15/15 | 1/1 |
| batch-01 (good) | **0.2000** (best pair 0.2500) | **18/165 = 10.9%** | 4/11 |
| reconstructed template | 1.0000 | 45/165 | 3/11 |

Populations do not overlap even at pair level: worst attack pair 0.7391 vs best honest pair 0.2500,
a 0.49-wide empty gap. **FLAG at ≥ 0.50** — the midpoint, not a fitted value.

**The limitation is severe and non-negotiable:** SNP abstains wherever there is no numeric payload —
**7 of 11 batch-01 spheres, 89.1% of its pairs.** It would say nothing about six reskins of a
qualitative task (write a metaphor, resolve a social ambiguity, plan a route in prose). It is also
evadable by *non-uniform* per-value jitter; only uniform rescaling is closed.

⇒ SNP may **FLAG or ABSTAIN. It may never certify.** Coverage must be printed beside the score, or
abstention gets silently read as a pass — which is precisely how the corpus failure survived two
days of measurement in the first place.

## A replication note worth keeping

SNP reproduced **exactly** on independent reimplementation — 0.2000, 18/165, and every per-sphere
figure to 4 dp. V6 did not: 0.0777 vs 0.1422, a 2× gap. The difference is that SNP has **no free
parameters** (the regex, the <10 rule and the ≥4 rule are all stated), while V6's IDF-fitting scope
was unstated and is worth a factor of two. *Prefer statistics whose specification leaves nothing to
the implementer; where a free parameter is unavoidable, it belongs in the threshold's name.*

## The file blackout is macOS TCC per-file grants — my earlier diagnosis was wrong

I wrote that this was "a sandbox policy on that subtree, not the OS." That is **incorrect**. It is
per-file macOS TCC, confirmed by `ls -leO@`:

| file | `com.apple.macl` | `com.apple.provenance` | access |
|---|---|---|---|
| `gemini-batch-01.jsonl` | **72** | 11 | readable |
| `gemini-batch-03.jsonl` | **72** | 11 | readable |
| `ROUTING_002_recenter.md` | **72** | 11 | read + write |
| `gemini-batch-02.jsonl` | **−1** | −1 | **EPERM** |
| `PARALLEL_LLM_PLAN.md` | *(absent)* | −1 | **EPERM** |

Mode is `-rw-r--r--` on every one of them and `stat()` succeeds on all; only `open()` is denied.
A file carrying a valid `com.apple.macl` grant is accessible; one without is not. This explains every
symptom that confused me: why it is **per-file rather than per-directory**, why it appeared to
"spread" (I was reaching new files that had never been granted), why `getcwd()` fails on directories
(they hold no grant), and why `dangerouslyDisableSandbox` changed nothing — the harness sandbox was
never the constraint.

**Remedy:** grant the app Full Disk Access, or Files and Folders → Desktop, in System Settings →
Privacy & Security, then restart it. Per-file grants accumulate one user-approved file at a time and
will never cover a repo.

---

# GATE 3 FINAL FORM: DP-1, THE DISTINCT-PAYLOAD RATIO (2026-09-09)

SNP (above) and DP-1 detect the same thing — payload reuse — but DP-1 is the better gate and
replaces SNP as Gate 3. Verified by independent reimplementation on the numeric channel:

| set | DP-1 | per-sphere | spheres scored |
|---|---|---|---|
| batch-01 (good) | **1.0000** (13/13) | every scored sphere 1.000 | 4/11 |
| reconstructed template | **0.1667** (3/18) | every scored sphere 0.167 | 3/11 |

Definition: within a sphere, single-linkage cluster the briefs whose payloads collide
(numeric-payload Jaccard ≥ 0.50); DP-1 = distinct clusters / briefs carrying a payload. **Flag below
0.80.** 0.1667 is exactly 1/6 — six briefs, one payload.

Three reasons it beats SNP as the gate:

1. **It is a count a human can check by hand.** "You wrote six payloads and used one of them six
   times." A reviewer can confirm or refute that by looking, which no similarity score allows.
2. **It fails gracefully rather than silently.** It is defined for any sphere with ≥2 payloads, so it
   cannot be evaded by the coverage collapse that lets a saturated 1.0-on-15-pairs look like a pass.
3. **Unanimity is itself evidence.** Every scored sphere returns the identical value in both batches
   (1.000 / 0.167), so the batch score is not carried by one outlier sphere.

## Negative results from the same family, kept because they are load-bearing

- **AT-2 artifact-presence rate FAILS**: 0.621 (good) vs 0.545 (bad). The template batch embeds
  payloads at essentially the same rate as real work. This is the obvious first thing to reach for
  in this family and it carries no signal — recorded so nobody reaches for it again.
- **SK-2 pooled skeleton similarity FAILS OUTRIGHT**: 0.511 vs 0.530 — a 0.019 gap *in the wrong
  direction*. Pooling across spheres destroys the signal, because two honest briefs of the same
  artifact type from different spheres look alike at the skeleton level.
- **AT-1 distinct artifact types per sphere** separates cleanly (3 vs 1, no overlap) but is diluted:
  an artifact-free sphere scores 1 regardless of quality.

## THE SCOPE LIMIT, restated because it applies to Gate 3 in both forms

This whole family sees only the **55–62% of rows that embed a payload** — on batch-01, 4 of 11
spheres. `motor_praxis`, `divergent_synthesis`, `language_semiotics` and `social_cognition` are
largely invisible to it. Gate 3 therefore **FLAGS or ABSTAINS and never certifies**, and coverage
must be printed beside the score. Certification is Gate 1's job alone.

# THE ACCEPTANCE TEST, CONSOLIDATED

Apply to batch-16 on arrival. All stdlib, no GPU, no embedder.

| # | gate | threshold | batch-01 | templated | role |
|---|---|---|---|---|---|
| 1 | verify-field IDF cosine (IDF fit **within-sphere, N=6**) | **< 0.35** | 0.1422 | 1.0000 | certifies |
| 2 | verify length, every row | **40–220 chars** | 61–147 | 62–140 | closes Gate 1's padding defeat |
| 3 | distinct-payload ratio DP-1, **with coverage** | **≥ 0.80** | 1.0000 | 0.1667 | flags only |
| — | lockstep routing test | ≤5/12 and mean ≥1.7 | 4/11, 1.91 | 11/11, 1.00 | **OPEN**, embedder down |

A batch failing Gate 1 or 2, or flagged by Gate 3, is not a holdout. A batch passing all three is
provisionally accepted and re-checked against lockstep when the GPU returns. **If lockstep and the
verify gates disagree on the same batch, record the disagreement — do not resolve it by preference.
That disagreement is the most informative measurement available.**

## Footnote — SK-3, the zero-threshold sibling of Gate 3

`SK-3 = distinct exact skeletons / artifact-bearing rows`, skeleton = the embedded payload with all
alphanumerics erased. Batch-01: **1.0000** (41 distinct from 41 rows). Templated: **0.1667**
(6 distinct from 36). Identical separation to DP-1.

Its advantage is that it has **no threshold at all** — no Jaccard cutoff, no clustering linkage, just
an equality count. By this session's own replication lesson (parameter-free statistics reproduced to
4 dp; V6's unstated IDF scope was worth 2×), that is a real argument for preferring it. Its cost is
that the erasure rule *is* a specification: what counts as "the payload" and what erasure does to
delimiters must be pinned before use, or it acquires the same free-parameter problem by the back
door. Either DP-1 or SK-3 is acceptable as Gate 3; whichever is used, **the extraction rule must be
written down with the threshold, not left to the implementer.**

---

# THE ADVERSARIAL SYNTHESIS SUPERSEDES MY GATE — INCLUDING MY OWN FOOTNOTE (2026-09-09)

13 agents, 13 attack batches, all measured. It is more thorough than the consolidation I wrote
above and it corrects me. Recording the corrections first.

## RETRACTION: my SK-3 footnote was wrong

One section above I offered SK-3 (exact-skeleton dedup) as an acceptable zero-threshold Gate 3, on
the argument that parameter-free statistics replicate. **SK-3 dies to six characters of punctuation
jitter: 0.1667 → 0.8333.** Parameter-free is not the same as attack-resistant, and I conflated the
two. The replication lesson stands; the recommendation built on it does not.

Also rejected by the synthesis, with measurements: **SNP** (my first Gate 3), **AT-1**
(format re-skin *inverts* it, 1.0 → 6.0 distinct types per sphere — better than the good batch),
**AT-2** (no signal, 0.621 vs 0.545). Of my three gates only the verify channel survives, and its
threshold is different from the one I set.

## The gate that replaces it

Per-sphere; a batch fails if **any** sphere fails.

| test | reads | threshold | batch-01 | bad batch |
|---|---|---|---|---|
| **T1 SPEC** | the data specimen | core ≥ 2 shared rare tokens **OR** median schema similarity > 0.33 | core **0** in all 11 spheres; schema 0.0000 (worst pair 0.1170) | core 15–23; schema 1.0000 |
| **T2 SKEL** | sentence skeleton, all vocabulary erased | median masked-skeleton ratio > 0.78 | median 0.5644 (range 0.1014–0.6927) | **1.0000** in all 11 |
| **T3 VERIFY** | the verify field | median verify cosine > 0.18, **and** median verify length > 178 chars | 0.0777 (worst sphere 0.1218); length 89 | 1.0000; length 84 |

Every threshold is a stated midpoint between batch-01's worst genuine sphere and the strongest
measured evasion — none was fitted.

**Note the T3 discrepancy with my own number**: it gates at **0.18**, I gated at 0.35. Same
statistic, different IDF scope (batch-wide vs within-sphere). This is the third time today that
unstated scope moved a threshold by ~2×. **Use 0.18 with batch-wide IDF, as specified here.**

## THE HONEST RESIDUAL: attack K passes the whole gate

Built and measured, not asserted. One artifact-free qualitative task — *read a stakeholder
utterance, name the unstated concern, draft a two-sentence reply* — written six times with different
people, settings, registers, sentence shapes and verify wordings.

`T1 core 0 · T1 schema 0.0000 (abstains) · T2 skel 0.6784 (bar 0.78) · T3 vcos 0.1326 (bar 0.18)`
→ **PASS.** Cost: about twenty minutes of writing, no tooling.

**This is a whole class, not a corner case.** Only **4 of 66** batch-01 briefs carry a detectable
data artifact, so for the payload-free spheres — `motor_praxis`, `language_semiotics`,
`divergent_synthesis`, `social_cognition`, `metacognitive_regulation` — T1 abstains entirely and the
batch is guarded by T2 and T3 alone. Both are beaten by varying sentence shape and check wording,
which is exactly what a capable LLM does when told to make six briefs look different.

Attack K does sit visibly above batch-01's medians (0.6784 vs 0.5644; 0.1326 vs 0.0777), so the gate
degrades into a **warning band** there rather than clean separation.

Three further stated gaps: T2's margin against structural rewriting is thin (a real per-row rewrite
scored 0.2125, *below* batch-01's own median — sentence shape is free to vary, and T2 only works
because template writers do not vary it); the schema channel is beatable by varying record count and
class balance; and **nothing in the gate reads the operation the brief demands** — the operation-set
test was dropped because synonym rotation beats it, and nothing replaced it.

## The measured matrix — six attacks pass the incumbent 0.15 bar

| attack | incumbent | verdict |
|---|---|---|
| batch-01 (good) | 0.0375 | PASS ✓ |
| bad batch / reconstruction | 0.9748 / 0.9608 | REJECT T1+T2+T3 |
| domain re-skin | **0.0839 passes** | REJECT T1+T2+T3 |
| scramble brief, keep verify | **0.0890 passes** | REJECT T1+T2+T3 |
| scramble brief + verify | **0.1140 passes** | REJECT T1+T2+T3 |
| full-stack reskin+reroll+verify | **0.0669 passes** | REJECT T2 only |
| + decoys | **0.0529 passes** | REJECT T2 only |
| + sentence reorder | **0.0463 passes** | REJECT T2 only (0.8658 vs 0.78 — thinnest margin anywhere) |
| one task, six shapes | **0.0334 passes** | REJECT T1 schema only |
| **artifact-free, six retellings (K)** | **0.0381 passes** | **PASSES THE GATE** |

## Limitations that must travel with the gate

- **Validation set size is one.** Every threshold is calibrated against a single known-good batch.
  "12% headroom" is n=1 evidence; a legitimate batch in a different house style could sit above 0.78
  without being templated. A T2-only failure in 0.78–0.85 means *read the sphere*, do not regenerate.
- **Calibrated for exactly 6 rows per sphere.** T1's core threshold especially — at 2 rows the
  intersection is non-empty by chance and it false-fails (verified).
- **Necessary, not sufficient.** Passing means no sphere reuses a specimen, is one skeleton, or
  checks one thing. It does not mean 66 tasks are 66 tasks. Attack K passes and is one task/sphere.
- **A false-positive mechanism was found and fixed, which implies others exist.** The first T1 core
  channel "caught" an attack on shared tokens `('as','its','sh','my','your')` — function-word and
  file-extension debris that became batch-rare only because the attack mangled the vocabulary. It
  would have shipped passing for the wrong reason. **Treat any FAIL whose core is short
  function-like tokens as suspect and read the rows.**

## OPERATING PROCEDURE

Run the gate. **A FAIL is decisive** — send the batch back. **A PASS is not sign-off.** Read two
briefs from every sphere whose T1 schema is 0.0000 — in batch-01 that is seven of eleven spheres —
because that is exactly where the gate is blind and where attack K lives.

Ten minutes of reading per batch against two days of unnoticed measurement on one task per sphere.

Harness: `scratchpad/gate_synth/brief_gate.py`; the 13 attack batches are `atk_A..K.jsonl` beside it,
so the matrix is re-runnable. **Copy these out of the scratchpad before the session ends.**

---

# WHY convergent_logic WAS THE SINK — MECHANISM, CLOSED (2026-09-09)

The sink finding above said *that* one exit absorbed the board. This says *why*, and the answer is
that it had nothing to do with `convergent_logic`.

Read-only on `atlas13.json`. For each faculty: cosine of its embedding to the installed `centreMu`,
against its raw top-1 win count on batch-03.

| faculty | cos(f, μ) | ‖f‖ | raw top-1 wins |
|---|---|---|---|
| metacognitive_regulation | 0.8481 | 279.0 | 13 |
| motor_praxis | 0.8476 | 285.5 | **19** |
| **convergent_logic** | 0.8466 | 274.4 | **15** ← never labelled |
| predictive_simulation | 0.8393 | 297.0 | 9 |
| spatial_topography | 0.8327 | 298.1 | 6 |
| episodic_memory | 0.8259 | 280.3 | 2 |
| sensory_perception | 0.8192 | 294.6 | 0 |
| social_cognition | 0.8137 | 283.7 | 0 |
| valuation_salience | 0.8065 | 290.7 | 2 |
| somatic_interoception | 0.8042 | 281.9 | 0 |
| language_semiotics | 0.7944 | 299.7 | 0 |
| divergent_synthesis | 0.7765 | 288.1 | 0 |

**Spearman(cos-to-mean, raw top-1 wins) = +0.755** across the 12 faculties.

The three faculties nearest the mean took **47 of 66 wins (71%)** between them. The five furthest
took **two wins total**. The true distribution is 6 apiece.

## The two numbers that matter

1. **The entire cos-to-mean range is 0.7765 – 0.8481 — a spread of 0.0716.** That 7-point differential
   determines three quarters of the ranking. Content is deciding what is left after the mean has
   spoken.
2. **‖μ‖ = 236.2 against ‖f‖ ∈ [274, 300]** — the shared mean is **79–86% of every faculty vector's
   magnitude.** Twelve vectors that are ~82% the same vector, competing on the remaining ~18%.

## What this retires

`convergent_logic` was **not special**. It ranked 3rd of 12 by proximity to the mean — a hair behind
`metacognitive_regulation` and `motor_praxis` — and it is conspicuous in the error analysis for one
reason only: **it is the one near-mean faculty with zero labelled briefs, so 100% of its wins were
errors.** Its two neighbours were winning just as far above their share (19 and 13 against a true 6),
but their wins were scored correct whenever they happened to land right.

So the earlier framing — "a faculty that can never be right was universally attractive" — was true
but incidental. The real statement is stronger and simpler:

> **The cone collapsed a 12-way decision into a ~4-way one, ranked by proximity to μ rather than by
> content.** Four faculties took >6 wins, seven took ≤2. Mean-centring restores the marginal
> distribution to exactly 6 apiece.

That also re-reads the "perfect flat 6-per-faculty histogram" from the lockstep section. It is *two*
artefacts meeting: the template collapse supplies six identical rows per sphere, and centring
supplies an unbiased 12-way decision — so each template lands all six of its rows on one exit and
the histogram comes out exactly flat. Neither fact alone produces it.

Tagged **MEASURED**. Script: `scratchpad/why_sink.py`. What it does not show: nothing here evaluates
any faculty's description. Proximity to μ is a property of the encoder's geometry, not of whether a
description is well written.

---

# THE CENTRING FIX IS INCOMPLETE: THE PROFILE PATH WAS NEVER CENTRED (2026-09-09)

My own change. `assign()` centres the faculty path at `atlas13.cjs:621` and leaves the profile path
raw at `:625`:

```js
621  const src = inEmb ? centred(atlas, atlas.facultyEmb, vec) : {...};        // centred
625  const profile = (vec && atlas.profileEmb) ? profileCoords(atlas.profileEmb, vec) : ...;  // RAW
```

Same 35840-d space, same encoder, same μ. `profileEmb` carries the identical cone: its 12 poles sit
at cos-to-μ 0.7759–0.8333 (spread 0.0574), against the faculties' 0.7765–0.8481 (spread 0.0716).

μ does **not** cancel here, despite `profileCoords` being a difference. It computes
`cos(unit(high),u) − cos(unit(low),u)`, normalising each pole *before* subtracting, so centring
changes both pole directions and the query direction. Measured effect on the axis itself:

| axis | RAW cos(low,high) | CENTRED |
|---|---|---|
| action_mode | 0.9389 | 0.8124 |
| epistemic | 0.8881 | 0.7014 |
| formality | 0.8522 | 0.5740 |
| granularity | 0.9048 | 0.7072 |
| risk | 0.8888 | 0.6879 |
| temporality | 0.9301 | 0.8196 |
| **mean** | **0.9005** | **0.7171** |

Raw, the two *opposite poles* of each axis are 90% the same vector.

## The consequence, measured on batch-01's 66 cached vectors

| axis | RAW mean | RAW sd | RAW range | CEN sd | sd × |
|---|---|---|---|---|---|
| action_mode | −0.0012 | 0.0068 | [−0.0134, +0.0155] | 0.0408 | 5.98 |
| epistemic | −0.0242 | 0.0064 | **[−0.0378, −0.0110]** | 0.0356 | 5.61 |
| formality | +0.0220 | 0.0130 | [−0.0219, +0.0483] | 0.0709 | 5.46 |
| granularity | +0.0146 | 0.0089 | [−0.0016, +0.0358] | 0.0528 | 5.96 |
| risk | +0.0310 | 0.0102 | **[+0.0031, +0.0503]** | 0.0542 | 5.31 |
| temporality | +0.0007 | 0.0055 | [−0.0134, +0.0137] | 0.0290 | 5.32 |

**Two of six axes are sign-degenerate across the entire corpus.** `epistemic` is negative for all 66
briefs; `risk` is positive for all 66. They cannot report one of their two poles — they emit a fixed
bias, not a measurement. `granularity` is one brief away from the same.

Centring amplifies dynamic range **5.61× on average**, drives every axis mean to ~0 (from biases like
risk +0.0310, epistemic −0.0242), and **31.3% of all 396 profile coordinates change sign.**

Raw, the profile axes are mostly reporting the constant `dot(μ, axis)` rather than anything about the
brief. Tagged **MEASURED**. Script: `scripts_profile_cone.py`.

## NOT FIXED IN CODE, deliberately — and the fix is not one line

Recorded as a proposal rather than applied, for the same reason F3b exists: an **untestable,
uncommittable edit to the routing core is precisely the silent-drift failure this document was
opened to stop.** The embedder is down (`mlx-serve` reports `upstream: ""`) so no end-to-end check is
possible, and git is blocked, so the edit would sit as an invisible working-tree modification.

**The obvious one-line fix is wrong.** `centred()` maps over `Object.entries(embs)` and calls `sub()`
on each value — but `profileEmb` is nested, `{axis: {low: [...], high: [...]}}`, so `sub()` would be
handed a dict and corrupt it. A nested-aware variant is required:

```js
// alongside centred(); profileEmb is {axis: {low, high}}, one level deeper than facultyEmb
const _centredProfileCache = new WeakMap();
function centredProfile(atlas, poles, vec) {
  if (!CENTRE(atlas) || !vec || !poles) return { poles, vec, centred: false };
  const mu = atlas.centreMu;
  const sub = (a) => { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - mu[i]; return o; };
  let cp = _centredProfileCache.get(atlas);
  if (!cp || cp.src !== poles) {
    cp = { src: poles, poles: Object.fromEntries(Object.entries(poles).map(
      ([k, p]) => [k, { low: sub(p.low), high: sub(p.high) }])) };
    _centredProfileCache.set(atlas, cp);
  }
  return { poles: cp.poles, vec: sub(vec), centred: true };
}
// then at :625
const pc = (vec && atlas.profileEmb) ? centredProfile(atlas, atlas.profileEmb, vec) : null;
const profile = pc ? profileCoords(pc.poles, pc.vec)
              : (atlas.profileDirs ? profileCoords(atlas.profileDirs, dir) : null);
```

**Before applying:** anything downstream that thresholds a profile coordinate at 0, or assumes its
historical scale, must be re-read. Two axes have never emitted a negative (`risk`) or positive
(`epistemic`) value in this corpus's lifetime, so any consumer tuned against that will change
behaviour — and a 5.6× scale change will move any fixed cutoff. This is a behavioural change, not a
bug fix, from the consumer's point of view.

## AND THE CONSEQUENCE: THE PROFILE→KNOBS SYSTEM IS INERT

`profileKnobs()` (`atlas13.cjs:359`) turns profile coordinates into the actual generation parameters
for a step. It clamps to `[-1, 1]` and lerps across the full designed range:

```js
temperature: lerp(1.0, 0.0, u('risk'))                              // designed [0.00, 1.00]
num_predict: lerp(1024, 4096, u('granularity'))                     // designed [1024, 4096]
max_steps:   lerp(4, 12, (u('granularity') + u('action_mode')) / 2) // designed [4, 12]
review_max:  u('risk') > 0.6 ? 3 : 2
```

The coordinates never come close to `[-1, 1]`. Emitted across batch-01's 66 briefs:

| knob | designed range | **RAW (deployed)** | % of range used | CENTRED (proposed) |
|---|---|---|---|---|
| `temperature` | 0.00 – 1.00 | **0.47 – 0.50** | **3%** | 0.44 – 0.57 (13%) |
| `num_predict` | 1024 – 4096 | **2558 – 2615** | **1.9%** | 2425 – 2758 (10.8%) |
| `max_steps` | 4 – 12 | **CONSTANT 8** | **0%** | **CONSTANT 8** |
| `review_max` | 2 or 3 | **CONSTANT 2** | 0% | **CONSTANT 2** |

**Every task the router has ever profiled received temperature ≈ 0.48, num_predict ≈ 2570,
max_steps = 8, review_max = 2.** The adaptive-parameter system is decorative. The
`review_max: 3` branch requires `risk > 0.2` and the maximum risk coordinate ever observed is
**0.0503** raw, **0.1222** centred — it has never fired and cannot fire.

### Centring is necessary but NOT sufficient here

This is the important qualifier and it separates this defect from the faculty one. Centring buys
4–6× more spread and fixes the sign degeneracy, but `max_steps` and `review_max` stay pinned, because
the coordinates still only reach ±0.22 against a mapping that expects ±1.

So there are **two independent defects stacked**:

1. **No centring** (`:625`) — the cone eats the signal; costs ~5.6× dynamic range and leaves two axes
   sign-degenerate. Fix proposed above.
2. **A scale mismatch in `profileKnobs`** — it assumes coordinates spanning `[-1, 1]` when the
   estimator structurally cannot produce them. `cos(unit(high),u) − cos(unit(low),u)` is bounded by
   `‖ĥ − l̂‖`, which for poles at cosine 0.72 is **0.75**, and in practice is far smaller because the
   query is not aligned with the axis. **The knob mapping was never calibrated against the estimator
   that feeds it.**

Fixing (1) alone yields a system that varies temperature by ±0.06 and still cannot change
`max_steps`. **Do not fix (1) and declare the profile system working.** (2) needs a rescale —
standardising each axis against its observed spread is the obvious candidate, but it must be
calibrated on a corpus that is not 77 tasks, which lands it behind batch-16 like everything else.

Tagged **MEASURED**. Script: `scripts_knobs.py`. Both defects are recorded, neither is applied.

---

# THE ROUTER'S ADAPTIVE SURFACE IS INERT IN FOUR PLACES (2026-09-09)

Having found the knob system decorative, I audited every other decision function in `atlas13.cjs`
that is designed to vary. Four of them do not.

| site | designed to vary | actually | cause |
|---|---|---|---|
| `profileKnobs` temperature | 0.00–1.00 | **0.47–0.50** (3%) | cone + uncalibrated scale |
| `profileKnobs` num_predict | 1024–4096 | **2558–2615** (1.9%) | same |
| `profileKnobs` max_steps / review_max | 4–12 / 2–3 | **constant 8 / constant 2** | same |
| `partitionBudget` | 1024–4096 | **1024–1073** (1.6%) | cone |
| `decideDelegation` → `executor:'sphere'` | per-sphere specialists | **unreachable** | no specialists exist |
| `lateralDecision` → `executor:'sphere'` | lateral hand-off | **unreachable** | same |

## partitionBudget

`w = exp(affinity · kappa / tau)` with `kappa` defaulting to 0.5 and `tau` 0.25 — so the softmax
sees `affinity · 2`. Measured top-1 affinities on batch-01:

| arm | affinity range | sd | budgets emitted | % of designed range | max/min in a partition |
|---|---|---|---|---|---|
| **RAW (deployed)** | 0.7110 – 0.8628 | 0.0211 | **1024 – 1073** | **1.6%** | **1.039** |
| CENTRED | −0.1187 – 0.3529 | 0.1028 | 1024 – 1441 | 13.6% | 1.186 |

Raw, every item in a partition receives the floor to within 4%. The allocation is uniform.

## `decideDelegation` and `lateralDecision` are dead for a different reason

Both gate `executor: 'sphere'` on `servedTags` containing an `elle-s<level>` tag. Ollama currently
serves `['elle:latest', 'elle-worker:latest']` — **no `elle-s*` specialist exists at all.** So every
call returns `executor: 'central'`, and the whole sphere-delegation apparatus — the reason the atlas
has levels and neighbours — has never once dispatched work to a sphere. `lateralDecision` can still
return `kind: 'lateral'`, but always with `executor: 'central'`.

This is not a cone problem and centring will not touch it. It is a missing-artifact problem: the
specialists were never built. Tagged **MEASURED**, and it re-frames every "routing accuracy" number
in this document — accuracy has been measured on a decision whose *output* currently changes nothing
downstream.

## THE IMPORTANT PART: two of these defects mask each other

`partitionBudget` clamps each share with `Math.max(POOL_FLOOR, …)` after computing a softmax whose
mean is exactly `POOL_FLOOR` when no `pool` is supplied (`total = POOL_FLOOR * n`). Items below the
floor are raised to it; items above are not lowered. **The allocated total therefore exceeds the
pool, and the overshoot scales with how well the router discriminates:**

| affinity spread | pool | allocated | overshoot |
|---|---|---|---|
| near-uniform (RAW, deployed) | 6144 | 6386 | **+3.9%** |
| centred | 6144 | 6952 | **+13.2%** |
| strongly discriminating (hypothetical) | 6144 | 7817 | **+27.2%** |

**The cone is currently hiding this bug.** Uniform affinities keep the overshoot near 4%; the moment
routing starts discriminating properly, the budget overrun triples. So the centring fix — the thing
this whole document argues for — would make `partitionBudget` over-allocate by ~13%, and a genuinely
good router by ~27%.

⇒ **`partitionBudget` must be fixed before, or with, any further centring.** Either renormalise
after clamping (iteratively, since re-normalising can push others below the floor), or accept
`POOL_FLOOR` as a floor on the *pool* rather than on each share. This is a prerequisite, not a
follow-up, and it would not have been visible without measuring the two together.

Tagged **MEASURED**. Script: `scripts_budget.py`. Nothing applied.

## What this does to the session's headline

"Mean-centring lifts routing accuracy 0.227 → 0.621 in-sample" remains measured and true. But the
value of that accuracy downstream is currently **zero**, because `decideDelegation` cannot route to
a sphere, `profileKnobs` emits constants, and `partitionBudget` allocates uniformly. The routing
decision is correct more often and consumed by nothing that varies.

That is not a reason to undo the fix. It is a reason to stop measuring routing accuracy as if it
were the outcome, and to state plainly what the ordered dependency actually is:

1. `partitionBudget` conservation (else centring makes budgets worse)
2. `profileKnobs` recalibration (else profile centring buys ±0.06 of temperature)
3. at least one `elle-s*` specialist (else no routing decision reaches an executor)
4. batch-16 (else none of 1–3 can be validated)

---

# partitionBudget: SOLVED IN DESIGN, VERIFIED WITHOUT A GPU (2026-09-09)

Item 1 of the dependency chain. Pure arithmetic, no encoder, no model — so unlike the centring
patches this one is **testable right now**, and it was tested.

## First attempt was wrong, and failing it produced the actual result

I wrote a water-filling clamp-and-redistribute fix. It failed 2421 of 4000 randomised cases and, in
every hand regime, collapsed to a uniform floor. That is not an implementation bug. It is forced:

> **If every share ≥ F and the shares sum to F·n, then every share = F exactly.**

The deployed default is `total = POOL_FLOOR * n`. **Under that pool, no conserving allocation can
discriminate at all** — the constraint set contains exactly one point. The current code appears to
discriminate only because it violates conservation (+3.9% to +27.2%, scaling with affinity spread).

So the defect is not the clamp. **`partitionBudget` is asked to distribute a pool that leaves nothing
to distribute.**

## The design that follows

Guarantee the floor to everyone; allocate only the **surplus** above `F·n` by affinity:

```js
function partitionBudget(items, pool, tau) {
  const n = items.length;
  if (!n) return [];
  const t = Math.max(1e-6, Number(tau) || 0.25);
  const w = items.map((it) => Math.exp(((Number(it.affinity) || 0) * (Number.isFinite(it.kappa) ? it.kappa : 0.5)) / t));
  // the floor is a guarantee, not a share: only the surplus above n*POOL_FLOOR is allocated
  const total = Math.min(Math.max(POOL_FLOOR * n, Number(pool) || POOL_FLOOR * n), POOL_CAP * n);
  let surplus = total - POOL_FLOOR * n;
  const free = new Set(w.keys());
  const extra = new Array(n).fill(0);
  while (free.size && surplus > 1e-9) {
    let z = 0; for (const i of free) z += w[i]; z = z || 1;
    const over = [...free].filter((i) => POOL_FLOOR + (surplus * w[i]) / z > POOL_CAP);
    if (!over.length) { for (const i of free) extra[i] = (surplus * w[i]) / z; break; }
    for (const i of over) { extra[i] = POOL_CAP - POOL_FLOOR; free.delete(i); surplus -= POOL_CAP - POOL_FLOOR; }
  }
  const raw = extra.map((e) => POOL_FLOOR + e);
  const fl = raw.map(Math.floor);                       // largest-remainder rounding, so the
  let short = Math.round(total - fl.reduce((a, b) => a + b, 0));   // integer sum still equals the pool
  [...fl.keys()].sort((a, b) => (raw[b] - fl[b]) - (raw[a] - fl[a])).slice(0, Math.max(0, short))
    .forEach((i) => { fl[i] += 1; });
  return fl;
}
```

**Verification: 6000 randomised cases — n ∈ [1,12], affinities U(−1,3), kappa ∈ {null,0.2,0.5,1.0},
pools ∈ {default, F·n, U(1,4)×F·n, C·n, 2×C·n} — 0 conservation failures, 0 bounds violations.**
Script: `scripts_budget_fix.py`.

## The sweep, which is the actionable part

Allocation ratio (max/min within a partition) against pool size:

| pool | RAW affinities | CENTRED affinities |
|---|---|---|
| 1× F·n **(the default)** | **1.00 — uniform, forced** | **1.00 — uniform, forced** |
| 1.5× | 1.10 | 1.35 |
| 2× | 1.16 | 1.57 |
| 3× | 1.22 | **1.83** |
| 4× (= C·n) | **1.00 — everyone at the cap** | **1.00** |

Two independent constraints, and both must hold before budgets mean anything:

1. **The pool must sit strictly between `F·n` and `C·n`.** At either end the allocation is uniform by
   arithmetic, not by policy. The deployed default sits exactly at the lower end. ~3× is the sweet
   spot; no caller currently supplies a pool at all.
2. **Even with a good pool, raw affinities buy almost nothing** — 1.22× at best, against 1.83× centred.
   The cone caps the achievable spread independently of the pool.

⇒ Fixing the conservation bug alone changes nothing observable, because the default pool forces
uniformity anyway. **All three of — conserving allocation, a pool above the floor, and centred
affinities — are required together.** Any one or two alone leaves budgets flat.

Tagged **DERIVED** (the impossibility) and **MEASURED** (the sweep). Patch written, not applied:
git is blocked and this is the routing core.

---

# profileKnobs: RECALIBRATION DESIGNED AND MEASURED (2026-09-09)

Item 2 of the chain. Also pure arithmetic on cached vectors, so also verifiable now.

## Per-axis scale required

Calibrated on batch-01's 66 centred coordinates. Scale to map ±2.5 sd onto ±1:

| axis | mean | sd | scale needed |
|---|---|---|---|
| temporality | −0.00080 | 0.02905 | **13.8×** |
| epistemic | −0.00097 | 0.03561 | 11.2× |
| action_mode | +0.00056 | 0.04085 | 9.8× |
| granularity | −0.00095 | 0.05277 | 7.6× |
| risk | +0.00131 | 0.05422 | 7.4× |
| formality | −0.00116 | 0.07091 | **5.6×** |

**The required scale varies 2.5× across axes, so a single global constant will not work.** A uniform
rescale would leave `temporality` nearly flat while saturating `formality`. It must be per-axis.

## What it buys

| knob | RAW (deployed) | centred only | **centred + per-axis z-rescale** |
|---|---|---|---|
| `temperature` | 3% of range | 13.0% | **95.0%** (0.05 – 1.00, 44 distinct) |
| `num_predict` | 1.9% | 10.8% | **82.0%** (1551 – 4070, 65 distinct) |
| `max_steps` | 0% (constant 8) | 0% (constant 8) | **50.0%** (6 – 10, 5 distinct) |
| `review_max` | 0% (constant 2) | 0% (constant 2) | **100% — the `3` branch fires for the first time** |

`max_steps` reaches only 50% because it averages two axes, and averaging two roughly independent
z-scores halves the variance. That is inherent to the formula, not a calibration failure.

## Design notes for whoever applies it

1. **The calibration constants belong in the atlas, hashed into the F3 transcript**, exactly like
   `centreMu` — `profileScale: {axis: {mean, sd}}` plus a `profileScale_meta` recording n, source
   corpus and install time, carried forward by `assertCarryForward`. Otherwise this is a second set
   of silent constants that a rebuild can eat, which is Trap 8 all over again.
2. **Do not hardcode the numbers above.** They are estimated from 66 briefs of synthetic evaluation
   traffic. Production traffic may be narrower or wider, and the sd is what sets the whole scale.
3. **The circularity here is mild but real.** batch-01 is the development set. However this is a
   12-parameter estimate (mean and sd per axis), not a decision rule fitted to labels, and batch-01
   is the only genuinely diverse corpus that exists — estimating a scale is close to the one
   legitimate use for it. Re-estimate on batch-16 once it passes the gate, and compare: if the two
   scale vectors disagree by more than ~1.5× on any axis, the estimate is not stable and the knobs
   should stay off.
4. **This is a behavioural change, loudly.** `review_max` has been 2 for the life of the system and
   would begin returning 3; `temperature` would move from a flat ≈0.48 to spanning 0.05–1.00. Nothing
   downstream has ever seen those values. Ship it behind a flag, like centring was.

Tagged **MEASURED**. Script: `scripts_knob_fix.py`. Not applied.

## Chain status

1. `partitionBudget` conservation + pool — **designed, verified (6000 cases, 0 failures)**
2. `profileKnobs` per-axis rescale — **designed, measured**
3. at least one `elle-s*` specialist — **blocked**, none exist; needs model building, not analysis
4. batch-16 — **in progress** (parallel agent, gated by `brief_gate/`)

1 and 2 were both solvable without the GPU because they are arithmetic defects, not encoder
defects. Neither can be *validated end to end* until 4 exists, and neither changes anything a user
sees until 3 does.

---

# ITEM 3 DIAGNOSED: 66% OF THE MAP IS AT THE CENTRE AND FOUR SPHERES ARE EMPTY (2026-09-09)

`decideDelegation` needs an `elle-s<level>` specialist. None are served. But the deeper problem is
that most of them could not be trained if someone tried, because the training data is not there.

Live `atlas13.json` `levels`, read-only:

| level | sphere | members |
|---|---|---|
| **0** | **centre (the self)** | **1227** |
| 2 | Motor Praxis | 292 |
| 4 | Language & Semiotics | 190 |
| 7 | **Convergent Logic** | **90** |
| 9 | Valuation & Salience | 24 |
| 11 | Spatial Topography | 23 |
| 10 | Social Cognition | 2 |
| 5 | Episodic Memory | 1 |
| 8 | Divergent Synthesis | 1 |
| 1 | Sensory Perception | **0** |
| 3 | Somatic / Interoception | **0** |
| 6 | Predictive Simulation | **0** |
| 12 | Metacognitive Regulation | **0** |

Total in levels 1850; `map.json` holds 2764 nodes.

## Three things this settles

1. **The centre holds 1227 of 1850 assigned members — 66%.** The twelve spheres share 623 between
   them. The librarian premise is that knowledge lives distributed in the MAP; in practice two
   thirds of it is undifferentiated at the origin.

2. **Only three spheres could plausibly train a specialist**: Motor Praxis (292), Language &
   Semiotics (190), Convergent Logic (90). Four are **empty**, and three more have ≤2 members. So
   item 3 is not "build twelve specialists" — it is "**seven of twelve have no data at all.**"

3. **`convergent_logic` — the faculty with zero briefs in a 990-row corpus — is the third-largest
   sphere in the map, with 90 members.** The corpus and the map disagree completely about whether
   that faculty exists. One of them is wrong and this document cannot say which: the briefs were
   authored by a generator that skipped it, and the map was populated by a different process.
   **This is the single most under-examined inconsistency in the system.** Tagged **OPEN**.

## The cone does NOT explain the map's distribution

Worth stating because it is the obvious hypothesis and it fails. If proximity to μ drove sphere
membership the way it drove routing, the member counts should track cos-to-μ. They do not:
`metacognitive_regulation` is the **closest** faculty to μ (0.8481) and has **0** members;
`language_semiotics` is **11th of 12** (0.7944) and has **190**. Spearman is not worth computing on
counts this degenerate, but the two orderings plainly disagree.

⇒ The map was populated by a different mechanism than the one `assign()` uses today — different
process, possibly different embeddings, certainly a different time. **The routing measurements in
this document describe `assign()`, not the map that already exists.** Nothing here has validated
that the 2764 nodes sitting in the map were placed by anything resembling the current router.

That is a larger open question than anything else in this file, and it should be the first thing
examined after batch-16: **re-route a sample of the existing map through the current centred
`assign()` and measure how much of it moves.** If most of it moves, the map is stale and every
retrieval built on it inherits the pre-centring cone.

Tagged **MEASURED** (the counts) and **OPEN** (what they imply). No script needed — the numbers are
read directly from `~/.elle/hyper-map/atlas13.json`.

---

# TWO ROUTERS IN TWO SPACES — AND ONLY ONE WAS FIXED (2026-09-09)

## Corrections to the section above, before the finding

1. **"The centre holds 1227 of 1850 = 66%" was WRONG.** `levels[0].n` is the *total task-node count*
   (the denominator), not centre membership — `build()` sets `levels[0].n = nodes.length` at
   `atlas13.cjs:469`. The actual split is `central_members = 604` against 623 in spheres:
   **49.2% central, 50.8% in spheres, 1227 accounted exactly.** The empty-sphere facts stand.
2. **"`assign()` picks the level geometrically via CENTRAL_FRAC" was WRONG.** That is the `kissing`
   branch (`:632`). The deployed mode is `faculty`, where `level` comes from the *centred* collapse —
   so `decideDelegation` does consume the centring fix. Retracted.

## The finding: the code documents two routers, and they are in different spaces

`build()`, `atlas13.cjs:441-446`, verbatim:

```js
// existing nodes carry only their 16-d direction (no full embedding), so
// they are stamped by keyword vote + projected cosine; NEW goals route in
// embedding space through assign(). Sphere directions are the descriptions.
const slots = nodes.map((n) => { const c = collapse(fac, axisCoords(fac, dirsNow, n.dir, n.text)); return c.held ? 0 : fac.byId[c.pole].level; });
```

| | **Router A — stored map** | **Router B — new goals** |
|---|---|---|
| where | `build()` slots | `assign()` faculty collapse |
| space | **16-d** `node.dir` vs `facultyDirs` | **35840-d** `vec` vs `facultyEmb` |
| centred? | **NO** — `centred()` is never called in `build()` | **YES** (this session's fix) |
| what it placed | all **1227** existing task nodes | everything routed since |

Timing confirms it: atlas `built_at` **13:51:11**, `centreMu` installed **13:52:47** — 96 seconds
later. Every stored membership predates the fix *and* lives in a space the fix cannot reach, because
`centreMu` is 35840-d and `node.dir` is 16-d.

**Everything measured in this document is Router B. Router A placed the entire existing map.**

## Router A has the same cone, and it is worse

Measured on all 1227 stored 16-d directions (no embedder needed — the dirs are on disk):

| | RAW (deployed) | CENTRED-16 |
|---|---|---|
| mean off-diagonal cosine, 12 faculty dirs | **+0.9114** | +0.7959 |
| mean 12-cosine spread per node | 0.1712 | **0.3374** (2.0×) |
| faculties that never win | **`social_cognition` — 0 of 1227** | none |

‖μ₁₆‖ = 0.6395 against unit-length node directions. The twelve 16-d faculty directions are **91%
mutually aligned** — worse than the 35840-d faculty embeddings (0.8355 in the aperture section).

Raw, `episodic_memory` (420) and `somatic_interoception` (356) take **63% of the map between them**,
and `social_cognition` never wins once — the same never-selected degeneracy already seen in
`profileEmb` (two sign-locked axes) and in reverse for `convergent_logic`. Centred, every faculty
wins at least once.

> **Top-1 faculty changes under 16-d centring for 288 of 1227 nodes = 23.5%.**

## Scope of that number — stated because it is not the exact quantity

This is top-1 by cosine, **not** `build()`'s exact `slots`, which additionally applies pair
differences, a keyword vote (`KW_WEIGHT` 0.12) and the `collapse()` gate.
`providers/faculties.json` became TCC-unreadable mid-session (no `com.apple.macl`), so the pairs and
keyword regexes are unavailable and `slots` cannot be reproduced exactly. **23.5% is the magnitude of
the cone's effect on the underlying ranking, not a verified reassignment count.** The gate would move
some of those to `held` (level 0) rather than to another sphere.

## What this means

The librarian premise is that knowledge lives in the MAP and routing accuracy is knowledge accuracy.
If so, the number that matters is not batch-01 routing accuracy — it is **how much of the existing
1227-node map is in the wrong sphere**, and the answer is *at least a fifth of it moves* the moment
the same fix already applied to Router B is applied to Router A.

**This should outrank batch-16 in priority.** It needs no embedder, no new corpus, and no GPU — only
`faculties.json` back, to reproduce `slots` exactly and to re-stamp. Tagged **MEASURED** (the cone,
the 23.5%) and **OPEN** (the exact reassignment). Script: `scripts_map16_cone.py`.

**Do not re-stamp before reading this**: re-stamping rewrites which sphere every stored memory lives
in. That is the single most destructive operation available in this system, it is not reversible
without a map backup, and `map.json` carries `recentered: 0` — nothing has ever recentred it. Back up
`~/.elle/hyper-map/` first.

---

# THE STORED MAP IS FILED BY KEYWORD, NOT BY GEOMETRY (2026-09-09)

I recovered the six duality pairs (from `FINDINGS_REGISTER_FOR_QWEN.md` §2, which quotes
`faculties.json` verbatim and is still readable) and reproduced `build()`'s `slots` — pairs,
`axisCoords` differences, and the `collapse()` gate at 0.06 / 0.02 / 1.3. The only missing term is
the keyword vote, whose regexes live in the now-unreadable `faculties.json`.

**The reproduction failed its validation check, and that is the result.**

| sphere | reproduction, RAW, no keyword vote | **deployed** |
|---|---|---|
| central (held) | 505 | **604** |
| motor_praxis | 148 | **292** |
| language_semiotics | **440** | 190 |
| convergent_logic | 22 | **90** |
| divergent_synthesis | **41** | 1 |
| somatic_interoception | 10 | **0** |
| spatial_topography | 46 | 23 |

Cosine geometry alone does not come close. `language_semiotics` is over-assigned 2.3×,
`motor_praxis` under-assigned 2×, `convergent_logic` under-assigned 4×, `divergent_synthesis`
over-assigned 41×.

## RETRACTION

**The "43.9% of slots change under 16-d centring" figure is withdrawn.** It was computed between two
arms that both omit the keyword vote, so neither is the deployed router. It is not a statement about
this system. The earlier **23.5%** figure stands, because it is explicitly scoped to top-1 by cosine
and never claimed to be `slots`.

## What the failure demonstrates

`facultyScore` is `cosine(unit(fvec), unit(vec)) + KW_WEIGHT * hits / 3`, with `KW_WEIGHT = 0.12`
and hits capped at 3. So the keyword term contributes up to **0.12**.

Against that: the measured per-node spread across all twelve 16-d cosines is **0.1712** (raw), and
`collapse()` fires at `COLLAPSE = 0.06`. **A single faculty's keyword hits can contribute twice the
collapse threshold, and a full keyword match is comparable to the entire spread of the geometry it
is added to.** The pair *differences* that `axisCoords` actually gates on are smaller still.

> **In the 16-d router that filed all 1227 stored memories, the keyword vote is not a tie-breaker.
> It is the dominant term. The stored map is organised substantially by regex matching, and the
> embedding geometry is a small correction on top.**

This is consistent with the code's own comment — *"stamped by keyword vote + projected cosine"* —
which names the keyword vote first. What was not known is the *ratio*, and the ratio is the point.

## Consequences

1. **Centring Router A may matter far less than the 16-d cone suggests.** If assignment is mostly
   lexical, removing the geometric cone moves fewer nodes than the cosine analysis implies. The
   23.5% top-1-by-cosine figure is an **upper bound** on what centring alone could change, not an
   estimate.
2. **It re-frames "routing accuracy is knowledge accuracy."** Whatever `assign()` achieves in
   35840-d for new goals, the 1227 memories already on disk were filed by a keyword vote with a
   geometric nudge. The two routers do not merely differ in space and centring — **they differ in
   kind**, one semantic and one substantially lexical.
3. **It re-frames the ℍ result.** This document concluded the layer-tap space is indistinguishable
   from tf-idf on tree-likeness. For the stored map that is not even a comparison: a large part of
   its structure *is* lexical, by construction.

## What would settle it

`faculties.json` readable → reproduce `slots` exactly, confirm 604/623, then ablate: run with and
without the keyword term and report how many nodes each term alone decides. That is the honest
version of the measurement I attempted here, and it is one file-permission away.

Tagged **MEASURED** (the reproduction gap, the 0.12-vs-0.1712 ratio), **DERIVED** (keyword dominance
follows from those two numbers plus COLLAPSE = 0.06), **RETRACTED** (43.9%).
Script: `scripts_reslot.py` — kept, with its validation failure, because the failure is the finding.

## PROVED WITHOUT THE REGEXES: the keyword vote decides EVERY stored node

The regexes are gone with `faculties.json`, but the question can be settled without them. A node is
**keyword-decidable** if perturbing any single pair coordinate by ±`KW_WEIGHT` (0.12 — the most one
faculty's keyword hits can contribute) changes the slot `collapse()` returns. That is a rigorous
bound computed from geometry alone.

```
KEYWORD-DECIDABLE: 1227/1227 = 100.0%
```

| quantity (16-d, all 1227 task nodes) | value |
|---|---|
| geometric top-vs-next margin, **median** | **0.0282** |
| geometric top-vs-next margin, mean | 0.0338 |
| nodes with margin < KW_WEIGHT (0.12) | **100.0%** |
| nodes with margin < COLLAPSE (0.06) | 83.5% |
| leading \|coord\|, median | 0.0989 |
| nodes below the 0.06 gate on geometry alone | 6.1% |

**The keyword vote is 0.12. The median margin the geometry provides between the winning axis and the
runner-up is 0.0282 — the vote is 4.3× larger.** Not one node in 1227 has a geometric margin the
keyword term cannot overturn.

The geometry does clear the *gate* (median leading coordinate 0.0989 against COLLAPSE = 0.06, only
6.1% falling short). So geometry decides **whether** a node is filed at all; the keyword vote decides
**where**.

> **The 16-d geometry determines almost nothing about which sphere a stored memory lives in.
> The stored map is, in effect, a regex classifier with a geometric admission test.**

## What this does to the preceding sections

- **Centring Router A is close to pointless.** The 16-d cone is real (0.9114 mutual alignment) and
  removing it doubles the cosine spread — but the cosine spread is not what decides the sphere. The
  23.5% top-1-by-cosine figure is an upper bound that the keyword vote will mostly overwrite.
  **I withdraw the recommendation that re-stamping Router A outranks batch-16.** The lever for the
  stored map is the keyword vocabulary in `faculties.json`, not the geometry.
- **It sharpens rather than weakens the two-router finding.** The routers differ in space (16-d vs
  35840-d), in centring (no vs yes), *and* in kind — Router A is substantially lexical, Router B is
  substantially semantic. This document measured Router B and the sensory 2×2 established there that
  **regex-only was byte-identical to baseline** — a 0.12 vote could not close a 35840-d cosine gap.
  The same 0.12 constant is decisive in one router and inert in the other.

That contrast is the cleanest statement of the problem this document has arrived at:

> **The same keyword weight that cannot move the new-goal router at all decides every filing
> decision in the stored map. The two halves of the system disagree about what a faculty is.**

Tagged **DERIVED** (the bound is exact given `KW_WEIGHT`, `COLLAPSE`, `MARGIN`, `RATIO` and the
measured coordinates). Script: `scripts_kwbound.py`.

## CORRECTION: Router B is keyword-decidable too — the contrast above is WRONG

I wrote, one section up, that the same 0.12 constant "is decisive in one router and inert in the
other." **That is wrong and I withdraw it.** Measured on batch-01's 66 cached 35840-d vectors:

| router / arm | median margin | median \|lead\| | margin<0.12 | margin<0.06 | **keyword-decidable** |
|---|---|---|---|---|---|
| A — 16-d stored map | 0.0282 | 0.0989 | 100.0% | 83.5% | **100.0%** |
| B — 35840-d, RAW | 0.0351 | 0.0683 | 100.0% | 98.5% | **100.0%** |
| B — 35840-d, CENTRED | 0.0456 | 0.1477 | 80.3% | 57.6% | **95.5%** |

`KW_WEIGHT = 0.12` exceeds the top-vs-next margin for **every** node in both routers raw, and for
95.5% of Router B even after centring. **The routing surface of this entire system is
keyword-dominated, not keyword-tie-broken.** That is a worse finding than the contrast I drew, and it
applies to the half of the system this document spent all day improving.

### Reconciling with the sensory 2×2, which is not contradicted

Arm C of the sensory rewrite (regex only) was byte-identical to baseline on batch-03. That remains
true and is not in tension: **"keyword-decidable" is a statement about capacity, not about what the
actual hits do.** A brief whose margin is 0.03 *can* be flipped by a 0.12 vote, but only if the
regex actually fires, and only if it fires for the right faculty. Arm C's edits happened not to fire
in a way that changed any outcome. My error was reading "that edit changed nothing" as "the term
cannot matter."

### The one genuinely new argument for centring

Centring does not remove keyword dominance, but it measurably reduces it, and this was not among the
reasons given anywhere above:

- median leading coordinate **0.0683 → 0.1477** (2.2×) — raw, the median node barely clears the
  `COLLAPSE = 0.06` gate at all
- fraction with margin below the gate **98.5% → 57.6%**
- keyword-decidable **100.0% → 95.5%**

So centring buys robustness, not just accuracy: it moves the geometry from "always overridable" to
"usually overridable". That is a modest claim and it is the honest one.

### What actually follows

The lever for routing quality in **both** halves of the system is `KW_WEIGHT` and the regexes, not
the embedding geometry. Two cheap experiments, both needing only `faculties.json`:

1. **Sweep `KW_WEIGHT`** (0.00, 0.03, 0.06, 0.12, 0.24) on batch-01 and report accuracy and
   keyword-decidability. If accuracy is flat, the term is doing nothing useful and its weight should
   drop until the geometry decides. If accuracy falls at 0, the router is a regex classifier wearing
   an embedding and this document's framing needs rewriting.
2. **Ablate per node**: how many nodes does each term decide *alone*? That is the measurement I tried
   and could not complete.

Neither needs a GPU. Both outrank every geometric fix proposed above, because a 0.12 constant that
overrides the geometry for 95–100% of decisions is the largest single lever in the router.

Tagged **MEASURED**. Script: `scripts_routerB_margin.py` (numpy).

---

# WHAT CENTRING ACTUALLY DID: IT CHANGED WHAT THE ROUTER *IS* (2026-09-09)

The `KW_WEIGHT` sweep needs the regexes, which are gone. But its most informative point —
`KW_WEIGHT = 0`, pure geometry — needs nothing but the cached vectors. Run on batch-01:

| batch-01 | **geometry only (KW=0)** | recorded, with keywords |
|---|---|---|
| RAW top-1 | **0.015** — one brief in sixty-six | **0.227** |
| CENTRED top-1 | **0.606** | **0.621** |

| arm (KW=0) | hit | held | wrong |
|---|---|---|---|
| RAW | **0** | 22 | 44 |
| CENTRED | 29 | 23 | 14 |

## The result

- **Before centring, the embedding contributed essentially nothing.** Geometry alone scores 0.015 —
  one brief out of sixty-six, indistinguishable from chance (1/12 = 0.083 would be chance for a
  uniform guess; 0.015 is *below* it). The deployed 0.227 was almost entirely the keyword vote.
  **The pre-centring router was a regex classifier with an inert 35840-dimensional embedding
  attached.**
- **After centring, the geometry does the work.** 0.606 of the 0.621 is geometry; the keyword term
  adds roughly 0.015.

> **Centring did not merely raise accuracy 0.227 → 0.621. It changed what the router is: from a
> keyword classifier whose embedding contributed nothing, to an embedding classifier whose keyword
> vote is a marginal correction.**

That is a better description of this session's central result than the accuracy number, and it is
the one to carry forward.

## It resolves the paradox two sections up

Keywords remain *capable* of flipping 95.5% of centred decisions (margins are small), yet they
*contribute* only ~0.015 of accuracy. Both are true: capacity is not effect. After centring, the
keyword vote mostly fires in agreement with the geometry, or does not fire at all. That is also
exactly why the sensory rewrite's arm C (regex only) came back byte-identical to baseline — **after
centring there is very little left for a regex to do.** Three separate observations, one explanation.

## Caveats, stated

- These are my numpy reimplementation (same PAIRS, same COLLAPSE/MARGIN/RATIO, same cached
  `.posted` vectors), not `routing-diagnose`. The centred comparison (0.606 vs recorded 0.621) is
  within 0.015, so the reimplementation tracks; but that 0.015 gap is *assumed* to be the keyword
  term rather than proven to be — it could include small pipeline differences.
- **The RAW comparison does not depend on that assumption.** Geometry alone cannot produce 0.227
  when it produces 0.015; the gap is 15×, far beyond any reimplementation slack.
- batch-02 and batch-03 are TCC-unreadable, so this is batch-01 only — the development set, 66
  distinct tasks. It is in-sample.

## Revised priority

The `KW_WEIGHT` sweep drops from "largest single lever" to "worth one hour." The measurement above
already answers its important half: **at the deployed centred configuration, lowering `KW_WEIGHT`
toward zero would cost ≈0.015 accuracy and buy a large robustness gain** (keyword-decidability
95.5% → 0% by construction). That is a defensible trade and it is now the cheapest real improvement
available to the router — cheaper than batch-16, cheaper than any geometric fix in this document.

**But it must be validated out-of-sample**, and batch-01 is the development set, and batches 02–15
are one template. So it, too, waits on batch-16. Everything does.

Tagged **MEASURED**. Script: `scripts_kw0.py`.

## Footnote — the stake: each routing decision files 2.25 nodes, not one

`build()` routes `kind === 'task'` only (`taskNodes()` filters on it), which is **1227 of 2764
nodes = 44.4%**. The other 55.6% — 1458 results and 78 sources — are never assigned a sphere
directly. All 2764 carry a usable `dir`, so this is a design choice, not a capability limit.

It is a **coherent** choice: every one of the 1536 non-task nodes resolves to a task ancestor
(`result.parent` is a task in 1458/1458 cases; `source.parent` is a result in 78/78). Tasks are
routed; results and sources inherit.

The consequence is an amplification factor, and it is the reason the routing numbers matter more
than their own scale suggests:

> **One task's routing decision files itself plus 1.19 results plus 0.06 sources — 2.25 nodes.**

So the pre-centring router — whose geometry contributed **0.015** accuracy, i.e. essentially nothing
— did not merely mis-file 1227 task descriptions. It set the sphere of the entire 2764-node map,
including all 1458 actual work products, on the strength of a keyword vote. `levels[].n` counts only
tasks, so "Motor Praxis: 292 members" is 292 tasks and roughly 347 unstated results riding along.

Tagged **MEASURED**. No script — read directly from `map.json`.

## Cross-check: the Router B margins replicate across two implementations

The Router B margin table was computed twice, independently and by accident — a pure-Python version
started first and ran long enough to be backgrounded, and a numpy rewrite produced the numbers used
above. Both completed.

| arm | median margin | median \|lead\| | margin<0.12 | margin<0.06 |
|---|---|---|---|---|
| RAW | 0.0351 | 0.0683 | 100.0% | 98.5% |
| CENTRED | 0.0456 | 0.1477 | 80.3% | 57.6% |

**Identical to four decimal places on every cell.** The two runs used different numeric precision —
numpy at float32, pure Python at float64 — and different code paths (explicit loops vs matrix
product), so this is not a shared-implementation artifact. It is a genuine replication of the
quantities the keyword-dominance argument rests on.

Worth stating because the *other* replication attempt today failed: V6 differed 2× between the
workflow agent and my reimplementation, purely from an unstated IDF-fitting scope. These margins
have no free parameters — the pairs, the constants and the vectors are all fixed — and they
replicate exactly. That contrast is the same lesson twice: **specification tightness predicts
replication better than the statistic's separation power does.**

---

# THE REVIEWER BLOCKS CORRECT WORK — HAND-VERIFIED, NOT A RATE (2026-09-09)

Follows from `BOARD_BLOCKED_TRIAGE.md` (parallel session), which found 709 blocked tasks with
**467 (65.9%) terminating on κ sign-off** and flagged two cases where the *gate*, not the worker,
looked wrong. Both check out, and the second is worse than reported.

## Verified by reading the full event chain

**#1058 — a correct answer permanently blocked.** GSM8K: 20 + 25 + 70 + 60.
The coordinator's first two rejections were *right* — it caught "1/4 times more than 20 is 25, not
35" and "'10 times more' than 60 is 70, not 150", and drove the worker from 150 to the correct 175.
Then, on the third and terminal submission:

> "The calculation is incorrect: … The correct total is **110 (20 + 25 + 70 + 60)**, not 175."

It derived all four addends correctly and failed the addition. Three rejections is terminal, so the
right answer is blocked forever.

**#1158 — the same problem, a different wrong sum, in the opposite direction.**
> "The answer of 150 rings happens to be arithmetically correct **(20 + 25 + 70 + 60 = 150)**"

Here the reviewer *falsely accepted* the arithmetic of a wrong answer (150), then blocked the task on
a formatting rule. So the identical sum defeated the reviewer twice, yielding 110 once and 150
twice, never 175.

**#1304** — "The final numeric answer of 9.0 hours is mathematically correct (210/70 + 240/80 =
3.0 + 3.0)." That expression is **6**, not 9.

**#1160** — "The calculation is correct (5 * 3 * 5 + 1 * 2 = 13)." That expression is **77**.

## The failure mode is specific

In every case the *component reasoning is sound* and the *final arithmetic is not*. The reviewer
correctly identifies which quantities matter, correctly derives each one, then miscombines them —
and its verdict is driven by the miscombination. That is a much narrower defect than "the reviewer
is unreliable", and it suggests a cheap fix: **the coordinator should be required to emit its
arithmetic through `run_code` rather than in prose**, which is the very rule it keeps blocking
workers for not following.

## RETRACTED: my own error rate

I first reported **13.6%** of reviewer arithmetic assertions as wrong (11 of 81 by regex), then
**11.4%** (8 of 70) with a chain-aware rewrite. **Both are wrong and both are withdrawn.** Free-prose
extraction cannot separate a genuine chain `a+b = c = d` from a list of separate assertions
`a*b=c, d*e=f`; the first parser mis-split chains, the second greedily merged lists. Every
"inconsistency" in the second run's output is a parser artifact — hand-checking cleared all eight.

**There is no defensible rate here, only an existence result:** at least four tasks carry
demonstrably wrong reviewer arithmetic, one of which permanently blocked a correct answer. Tagged
**MEASURED** for the four cases, **OPEN** for the prevalence.

Getting a real rate needs the reviewer's arithmetic emitted in a machine-checkable form — which is
the fix above. Until then the 467 κ-blocked tasks cannot be triaged automatically, and the
`BOARD_BLOCKED_TRIAGE` proposal to cancel 75 duplicates should not be executed: if the gate errs,
some of those blocked records are correct work.
