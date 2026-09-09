# Findings Register — the measured side of the Atlas

*For the reviewer who audited `atlas_2_0` and the master diagram. You had the paper and the drawing. This is what has been measured, quoted from the code and the internal findings, so you can re-audit your own Catches 1–7 and G9–G12 against it. Nothing here is from the papers' assertion register; every number came out of running something, and each carries its source.*

*Tag vocabulary this project uses, which you should use in reply: PROVEN · MEASURED · DERIVED · DESIGN CHOICE · STIPULATED · REFUTED · OPEN.*

---

## 0. The one fact that reframes your Catch 7

The live atlas builder writes the toroidal factor as an empty stub. Verbatim, `hyper-map.cjs` `snapshot()`:

```js
hyper: { dim: 3, points },
torus: { dim: 0, points: {} },
structure: {
  invariants: { nodes: ids.length, edges: map.edges.length, components: ids.length ? 1 : 0, cycle_rank: 0, cycle_density: 0 },
  signature: { delta: 0, tree_likeness: 1, suggested: { hyperbolic: 1, toroidal: 0 } },
  cycle_edges: [],
},
product: { mix: { hyperbolic: 1, toroidal: 0 } },
```

Note also: `hyper` is the 16-d Lorentz point Poincaré-projected and **truncated to 3 coordinates**; `components`, `cycle_rank`, `cycle_density`, `delta`, `tree_likeness` are hardcoded constants, not computed.

**So your Catch 7 is correct, and stronger than you stated.** The diagram isn't misrepresenting the paper — it accurately depicts the implementation, whose toroidal half does not exist. `M = ℍⁿ × 𝕋ⁿ` is the paper; `ℍ³` (truncated from 16) with `𝕋⁰` is the running system. The phase ring you want drawn has no data behind it yet. Populating `torus.dim = 2` is a build task, not a diagram fix.

A separate module, `product.ts`, does implement `d² = w_h·d_ℍ² + w_t·d_𝕋²` correctly (citing Gu, Sala, Gunel & Ré, ICLR 2019) — but it is tool-surface only and never receives a populated torus from the live atlas.

---

## 1. The frame — settles your Q1

**Cuboctahedron.** The only exported frame, verbatim from `atlas13.cjs`:

```js
function cuboctahedronVertices() {
  const v = [];
  for (const a of [1, -1]) for (const b of [1, -1]) { v.push([a, b, 0]); v.push([a, 0, b]); v.push([0, a, b]); }
  return v.map(unit);
}
function icosahedronVertices() {           // kept for reference / tests of the older frame
  ...
}
const KISSING = cuboctahedronVertices();
// lateral neighbours on the hull: vertex pairs at distance 1 (unit radius)
const KISSING_NEIGHBOURS = KISSING.map((v, i) => KISSING.map((w, j) => j).filter((j) => j !== i && Math.abs(Math.hypot(...v.map((x, k) => x - KISSING[j][k])) - 1) < 1e-9));
// antipodal vertex pairs (i, j) with v_j = −v_i — six axes through the centre
const KISSING_PAIRS = ...;   // exactly 6
```

Permutations of (±1, ±1, 0)/√2. 12 vertices, 24 edges, 4 neighbours each at cos ½ (θ = 60°), 6 antipodal pairs. `icosahedronVertices` is not exported and is unreferenced outside tests.

The static gate that asserts this, verbatim from `readiness.cjs`:

```js
out.push(gate('G1', 'Vector equilibrium frame, R = 2r',
  unitOk && V.length === 12 && A.KISSING_PAIRS.length === 6 && edges === 24 && kiss && f.tri === 8 && f.sq === 6,
  `12 vertices unit=${unitOk}, pairs=${A.KISSING_PAIRS.length}, edges=${edges}, neighbour cos=½:${kiss}, faces=${f.tri}+${f.sq}`));
```

So V−E+F = 12−24+14 = 2 is already implied by G1's checks. **Your "34" is a diagram typo; the code has 24 and gates on it.** Your Euler check can be folded into G1 as one explicit line rather than a new gate.

**The pentagonal projection you saw is a second, incompatible structure overdrawn onto the atlas.** `scaffold.ts` builds `pentagonPillars(4)`: `PENTAGON = 5`, apex at `(0, 1, 0)`, 5 columns × 4 levels + apex = 21 nodes. That is 5-fold (I_h, non-crystallographic). The cuboctahedron is O_h. Neither contains the other. The diagram should separate them.

**Your two-origins catch (Catch 3) is this same overdraw.** `[0,1,0]` is the pillar scaffold's apex. `[0,0,0]` is the atlas singularity (`gen-harmonic-snapshot.mjs`: `singularity: { pos: [0,0,0] }`). Different objects. The diagram doesn't say so.

---

## 2. The twelve pinned directions — settles your Q2

Six dualities on six antipodal axes, verbatim from `faculties.json`:

```json
"pairs": [
  ["sensory_perception",    "motor_praxis"],
  ["somatic_interoception", "language_semiotics"],
  ["episodic_memory",       "predictive_simulation"],
  ["convergent_logic",      "divergent_synthesis"],
  ["valuation_salience",    "social_cognition"],
  ["spatial_topography",    "metacognitive_regulation"]
]
```

Note (verbatim): *"The twelve canonical spheres of the atlas: six dualities, each pair on one axis through the centre (the cuboctahedron / vector equilibrium's six antipodal vertex pairs). The centre is the coordinator — the self that integrates them."*

Your D1/D3/D4/D8 labels (control, neural hub, "gestiability", equatorial tangents) **do not exist anywhere in the code.** They are diagram annotations. Map them onto these twelve or delete them.

**Yes, the labels pin ontology to fixed directions.** In the default `faculty` mode each faculty description is embedded (bge-large-en-v1.5, 1024-d) and assigned to a `KISSING_PAIRS` axis; Kabsch fits the frame rotation to data, the *assignment* is fixed by the file.

**Attestation: none.** The atlas build header records:

```js
{ version: 3, mode, requested, built_at, dim, from_nodes, k, axes, frame: { R, objective } }
```

No encoder identity, no hash of `faculties.json`, no hash of the twelve embeddings. The only guard anywhere is a dimension check in `mem-intake.ts`:

```js
if (v.length !== BGE_LARGE_DIMS) return { error: `vector has ${v.length} dims, need 1024 (bge-large-en-v1.5) — wrong local embed model?` };
```

A different 1024-d encoder passes silently and every pinned direction changes meaning with no signal. **Your `encoder_version` attestation is correct and currently absent.** Your re-pin-on-drift is the right mechanism.

**How weak the pins currently are — MEASURED 2026-09-07** (comment in `atlas13.cjs`, verbatim): *"in the projection every faculty description is nearly collinear (a word problem sits at cosine 0.73–0.86 with all twelve; a shell task at −0.3…−0.5 with all twelve)"* and *"639 of 1025 goals held"* at the centre. Routing holds **58%** of briefs at the centre. So attestation would currently protect directions that barely separate. Your antipodal-merge guard (my F2) will almost certainly **fail** on the live atlas. That failure is the most informative number the new gates would produce.

---

## 3. The existing gate table — settles your Q3 naming

Your G9–G12 collide. `readiness.cjs` already defines:

| ID | Name | Criterion | Status |
|---|---|---|---|
| G1 | Vector equilibrium frame, R = 2r | 12 unit vertices, 6 pairs, 24 edges, cos ½, 8 tri + 6 sq | passes |
| G2 | Isometric transport across charts | worst relative Lorentz-norm change < 1e-6 over 20 transports | passes |
| G3 | Winding homotopy invariance (δ_max < π) | φ⁻¹ steps pass; half-turn refused; 0.49-turn accepted | passes |
| G4 | Golden-ratio penalty asymmetry | \|STRAIN/RECOVER − φ²\| < 1e-12 | passes |
| G5 | κ strictly inside (0,1) | over 800 observations | passes |
| G6 | Holding loss ≤ e − 1 | sup L over 2000 strain steps | passes |
| **G7** | φ⁻¹ settling speedup | **hardcoded `'pending'`**, `required=false`: *"claimed in the paper; no drift-time experiment exists yet — pending, not passed"* | pending |
| G8 | Lateral web = hull | 24 spokes + 48 lateral = 72 directed edges; antipodal hops refused; HKDF composes | passes |
| **G9** | **Anti-starvation of the float budget** | num_predict ≥ 1024, max_steps ≥ 2, T ∈ [0,1] | passes |
| G1b | Conformal chart overlap | ½·arcosh(1 + ½·sinh²d₀) < r_p ≤ d₀, `required=false` — *"the ideal kissing frame sits BELOW the strict lower bound by construction … informational until the chart radius is defined"* | informational |
| G1c | Torus curvature bound | `nonPositive === true` — true only in flat mode, `required=false` | informational |
| G7b | Phase-Eight 2:1 lock | PLV ≥ 0.99 ∧ p ≤ 0.001 on live trajectories, `required=false` | see §9 |
| G8b | Post-quantum forge margin | q·Ω·2⁻¹²⁸ ≤ 2⁻⁶⁴ | passes |
| PG1–PG8 | "the paper's G1–G8" | composites; **PG2, PG3, PG5 are aliases of G3, G3, G4** — three of the eight conformance signals are duplicates | — |

**G9 is taken.** And the numbering already disagrees between documents: in `atlas.tex` G7/G8 are the crypto gates (hybrid IND-CCA2, forgery bound); in the Compendium G7 = PLV and G8 = ratchet. Adding a third G9 makes the suite unrecoverable. Use a fresh prefix for frame gates. Proposed: **F1** centroid drift (your G9), **F2** antipodal merge guard (your G12), **F3** anchor-hash binding (your G11). Your G10 (R ≥ 2r) is the cleaner form of G1b and may be the fix for it rather than a new gate.

---

## 4. Key derivation — corrects your Catch 3 mechanism

Verbatim, `sphere-lanes.cjs`:

```js
function rootForPath(root, pathArr) {
  let r = root;
  for (const level of pathArr || []) r = new Uint8Array(crypto.hkdfSync('sha256', r, new Uint8Array(0), `elle-sphere-child-v1:${Number(level)}`, 32));
  return r;
}
```

Keys are derived from the **level path**, not from u₀. So in the code as it stands, two origin labels cannot desync anything — u₀ is never bound. Your failure mode is a *paper* failure mode (Def. 11). Your fix — single source of truth for u₀, bound into ctx, G11/F3 — is right either way; today the anchor is simply unattested rather than doubly-attested.

Lane rule, verbatim: *"spokes 0<->k and kissing pairs only; route via the centre"* — non-hull pairs open only when the jitterbug shell passes `ring: true`.

---

## 5. What has been measured about φ — corrects your Catch 6

You wrote φ is load-bearing (Lem. 1, Thm. 6, Thm. 9). The algebra is exact. Its **empirical primacy is open**, and the project's own tests say so.

**`RCRB_001.md` — Relational Coherence Recovery Benchmark, ran, numbers as returned:**
- Radial recovery: φ, silver, √2, e, π, rational 0.6 all recover from a 1.8× kick in **296 steps, to the digit** — winding-invariant.
- Escape efficiency: rational 0.6 **ties φ exactly** at every tilt; √2 needs less amplitude than φ at 3 of 4 tilts. φ is never best.
- Weyl spectral envelope, worst case: silver **26.11** (best), e 30.94, √2 36.92, **φ 39.15**, π 112.98, rational ∞. **φ sits fourth of five.**
- Star discrepancy: φ beats π at every depth; **does not beat e cleanly.**
- Verdict (verbatim): *"the one place … where φ's category — 'be irrational, don't be rational' — earns its claim outright."* Not confirmed: that φ beats another well-chosen irrational.

**`PHI_MINIMAX_SCORECARD.md`** (verbatim): *"Three legitimate constructions of the same three domains now produce three different winners (φ, e, √2). That is the actual, load-bearing conclusion of this whole line of work: the minimax winner is a function of methodology choice at least as much as it is a function of the candidate."*

**`PAMI_PHI_WIRING.md §4`** — φ as the wavelet scale base, basis-neutral family, 60% cue, 6 memories:

| basis | accuracy |
|---|---|
| e | 0.83 |
| dyadic (2) | 0.50 |
| **φ (spec)** | **0.33** |
| silver | 0.33 |
| √2 | 0.33 |
| π | 0.17 |

*"φ is mid-pack, beaten by e and by plain dyadic."* Pinned as an F1 falsification signal, not tuned away.

**`TOROIDAL_GRAPH_MAPPING.md §1`** (verbatim): *"Hurwitz optimality is strictly 1-D. On 𝕋ⁿ for n ≥ 2, simultaneous approximation is governed by the Hermite/Lagrange theory and the extremal vector is not generally φ. … We do not claim a φ winding vector on 𝕋ⁿ."* Its §9 status table: *"φ as an optimal winding vector on 𝕋ⁿ, n≥2 — NOT CLAIMED"* and *"1/π global suppression constant — STIPULATED / CONJECTURED (factor-2 underived)."*

So: keep φ bound to G4/G5/G6 as you say — those are exact identities. Do not present φ as necessary. Your φ⁻ᵏ energy-quantum binding is fine as notation (Lem. 1 restated). E = hν and Maxwell: agreed, bury.

---

## 6. What has been measured about ℍ

**`PSI_ENCODER_FINDING.md`** — the shipped hyperbolic encoder was exactly Euclidean. The `max(1, ‖Σ‖)` clamp pinned ‖ψ‖ = tanh 0.9 = 0.716298, so depth ρ = 1.800000000 for **100% of 2000 reports** (stddev 6e-14). **Spearman(d_hyperbolic, d_cosine) = 1.000000000000, 0 of 19,900 ranking inversions.** *"ℍ¹²⁸ under this encoder is 128 dimensions of restated cosine similarity."* A proposed depth-radius fix (mAP 0.0207 → 0.2216, +970%) **ablated to 0.2175 with random directions** — the gain was not from geometry.

**`DHNG_VS_EUCLIDEAN.md`** — 1,093-node derivation tree, 303 queries, after the encoder fix:

| method | mAP |
|---|---|
| bare cosine | 0.0564 |
| cosine + 2-hop expansion (real incumbent) | 0.3245 |
| hyperMap dim 128 | **0.3600 (+10.9%)** |
| hyperMap dim 32 | −16.5% vs incumbent |
| hyperMap dim 2 | −71.3% |
| ablation: shuffled edges | 0.0535, flat across dims |

**Structure carries 85% of the gain; curvature's contribution is the residual and only appears at dim ≥ 128.** Caveat (verbatim): *"δ-hyperbolicity has still never been measured on real corpus content… remains open."*

**`DELTA_HYPERBOLICITY_CONTENT.md`** — verdict: *"The tree-like precondition is not cleared — which is not the same as refuted."* Lexical arm: graph δ/diam **0.16–0.25** vs synthetic-tree band 0.00–0.08 and ring control 0.475–0.480. The decisive semantic arm (bge-large) was **blocked, unmeasured**. So the hierarchy hypothesis that justifies ℍ at all has not been tested on real content.

The archived external literature agrees: arXiv 2607.05268 *"Is the Geometry Doing the Work?"*, 2607.09306, 2602.01828, 2608.07029 — audits finding hyperbolic models operate near-Euclidean in practice.

---

## 7. What has been measured about the torus and the lemniscate — corrects your Catch 4

Two tori exist in the stack. You saw one.

**Flat torus** (`product.ts`, `torus.ts`, the paper's Eq. 2) — homogeneous, no equator. Your Catch 4 is correct for this branch. Your (1,2)-knot salvage ℓ(t) = (t, 2t) is a straight line on the flat torus, hence a geodesic, hence valid.

**Embedded curved torus** (`toroidal.py`, `curved-torus.cjs`) — r/R = 1/φ, R = 1. MEASURED:
- K(θ) = cos θ / [r(R + r cos θ)]; **K(0) = +1, K(π) = −φ³ ≈ −4.236, |K_min|/K_max = φ³ exactly** (checked to 1e-12; exact because 1+α = φ, αφ = 1, 1−α = α²)
- ∬K dA = 0 to **4e-15** (Gauss–Bonnet, χ = 0)
- Clairaut ρ²φ′ conserved to **1e-8** along RK4 geodesics
- The Bernoulli lemniscate lifted onto this surface has geodesic curvature **up to 21.2 (mean 2.26)** where a geodesic has k_g ≡ 0. *"There is no figure-eight family."* Five Clairaut families exist; none is planar.
- **Cost, stated in the file:** K > 0 on the outer band ⇒ the product is **not** non-positively curved ⇒ Cartan–Hadamard and global geodesic uniqueness are **unavailable**. Gate G1c fails in curved mode. This branch is behind `ELLE_TORUS=curved`, default `flat`, **not on any live path**.

The file's own disclaimer: *"This is a fact about the surface, not a claim about cognition."*

**`WHY_NO_LEMNISCATE.md`** — verdict table: SICT's necessity claim → *false*; "the torus is sufficient" → *true, but mislocates the source*; **"the graph's own cycle structure is what carries identity" → correct — no embedding is necessary at all.** Executable demonstration:

```
drift  = [0, 0.3, −0.2, 0.1, 0.0]   metricReturn 0   winding [0]
loop   = [0, 2.0,  4.0, 6.0, 0.0]   metricReturn 0   winding [1]
golden φ-orbit, N=40:  metricReturn 0.0827 (asymptotic)   winding 15 (exact integer)
```

Verbatim: *"Geometry is retained instrumentally, not ontologically."* The identity carrier is b₁ = E − V + C and `homologyClass(walk, edges)` in `structure.ts`.

**Correction 2026-09-09:** `TOROIDAL_GRAPH_MAPPING.md` §9 and `torus.ts` now state the finite-time winding invariant correctly. Their former lemniscate-necessity notes have been repaired; retain the historical disagreement only as dated history.

---

## 8. Consolidation — corrects your Catch 5

`consolidate.ts` computes **no Fréchet mean, no circular mean, no cluster centroid** over phases — checked by grep; zero hits for any of those. Merging is on content and the graph. And the 12 antipodal charts live in the **routing frame** (the 3-d principal subspace of the embedding), not on the torus; a Sensory memory and a Motor memory have opposite routing directions and *independent* PAMI phases. So Prop. 4's degeneracy is real for toroidal coordinates but currently **unreachable**: the torus is dim 0 and nothing averages phases. Your G12/F2 is worth keeping as a guard for when the torus is populated. "Routine failure mode" should read "latent."

`pamiDistance` already handles antipodal *distance* correctly: `d = |pa − pb| mod 2π; if d > π, d = 2π − d`. It's only the mean that's undefined.

---

## 9. Phase-Eight — the paper's PLV = 0.990 is not a measurement

`ELLE_GSM8K_001.md` tail, 2026-09-08: with the instrument's own rule (band-pass both signals, Hilbert, 2:1 PLV, circular-shift null of the fast phase) — **every cell NULL** on real trajectories. Best cell: PLV 0.50 vs null 0.41, p = 0.017 against a gate of p < 0.01. An earlier *"pooled 0.131, p = 0.005"* was **withdrawn** as trend-dominated unfiltered phase. Verdict (verbatim): *"no eight emerges on the data we have, on either axis, with the instrument's own rule."*

The Compendium's 0.990 comes from `test_formal_mathematical_gates.py`, which **generates a synthetically coupled phase pair and then asserts PLV ≥ 0.990 on it.** Likewise `test_temporal_lemniscate_and_flower_of_life.py` simulates the worldline into SQLite and then asserts 13 centres. Both construct what they verify. Compendium Appendix A.7 concedes this: *"The statistic measures phase concentration, not reasoning accuracy."*

Also: every centre-held task carried a constant `lastD = 0.900` (the worker used the region centre as lineage anchor; every probe sits at `PROBE_RADIUS = 0.9`). With 58% of briefs held at centre, most trajectory numbers before 2026-09-08 were computed on a constant. Fixed; earlier trajectory-based numbers are not measurements.

---

## 10. Retrieval — phase as a key loses to content

`RETRIEVAL_STATUS.md`, pythia-160m, layer 8/12, block 32, k=4, n=40:

| method | mass_recall | oracle_recall |
|---|---|---|
| content_rope | **0.395** | 0.300 |
| content_raw | 0.368 | 0.237 |
| recent_window | 0.245 | 0.375 |
| phase_content | 0.179 | 0.188 |
| phase_hybrid | 0.178 | 0.100 |
| oracle | 0.862 | 1.000 |

Verdict (verbatim): *"phase-as-retrieval-key loses to content ~2:1, and it's significant (≈ 4σ at n=40). Phase even loses to the trivial recency baseline on oracle_recall."* What survives: *"phase modulates content holds, phase replaces content does not."*

Live retrieval (verbatim): *"Everything else — pami, pfar, vfar, hyper, torus, product, structure — is tool-surface only: it runs only when Elle explicitly calls the tool. Nothing automatic routes retrieval through phase or the charts."* `MEMORY_KERNEL_SPEC §4.5`: *"Any change that routes retrieval through one of these requires its own benchmark, not an argument from architecture."*

Exception worth knowing: `pamiIndex`/`pamiBridgeVector`/`hyper.placeFeatures` **are** on the live *ingest* path via `/api/atlas/anchors/intake`. Ingestion, not retrieval.

---

## 11. Routing — the numbers the whole librarian design inherits

- Live routing accuracy **0.23**; offline replay on the posted text **0.227** (matches live exactly once the posted brief carried the same appended self-check).
- Raw-text ceiling **0.58**.
- Rank of the intended faculty over 66 briefs: **first 38, second 14, third 3** → top-3 containment **0.83**.
- **0 antipode confusions** — the router never picks a faculty's dual.
- 990 unposted briefs available as held-out.

---

## 12. The paper's own author withdrew these — Compendium Appendix A

The `THE_ELLE_ATLAS_COMPENDIUM_BOOK.md` Appendix A retracts or conditions most of the headline claims you were auditing. Key items, verbatim or near:

- **A.4** — the π√φ ≈ 3.996 diameter bound *"is not a capacity theorem … does not prove that φ is uniquely required for cognition."*
- **A.5** — ∬K dA = 0 *"does not represent cancellation of a separately defined cognitive entropy."*
- **A.7** — PLV 0.990 *"measures phase concentration, not reasoning accuracy."*
- **A.8** — strata fractions 0.382N, 0.618N, N *"sum to 2N, so they cannot be a disjoint partition."* And: *"the inspected code does not implement `BreathingKVCache`, `sharedNs`, or coordinator/worker isolation."*
- **A.10** — *"A buffer named a Markov blanket does not establish conditional independence."*
- **A.11** — *"Multiplying attention scores by a toroidal kernel does not alter dense pair count."*
- **A.13** — the two GSM8K runs *"must not be treated as an apples-to-apples model comparison."*
- **A.14** — cuboctahedron: *"Symmetry proves the vector sum is zero; calling it a force balance additionally requires a force law."* (This is your G9/F1, correctly scoped.)
- **A.16** — Theorem 6 is *conditional dominance only*; *"does not show an exactly zero executive gradient."*
- **A.17** — *"Norm-preserving GPU operations are not physically reversible by that fact."* Orbital, KAM, holographic, cosmological, circle-map analogies *"support intuition only when their dynamical systems and parameter regimes are supplied."*
- **A.18** — G₄ *"requires definitions for confidence, reserve, derivative, leakage, thresholds, and time base"*; G₅ *"establishes algebraic relations, not a conservation law"*; G₈ *"is not post-quantum certification without a protocol and adversary model."*

`atlas.tex` §6 closing, verbatim: *"Calibration of (T, w, s, ρ, Λ, τ, δ) is an empirical benchmarking exercise on a conformant implementation, not a soundness obligation."* — i.e. every gate constant is uncalibrated by the paper's own admission.

---

## 13. One new derived result — DERIVED this week, exact

The cuboctahedron projected along its 3-fold axis (1,1,1)/√3, using 12 vertices + 6 square-face centres + centre (19 sources):

| radius | exact | count | angles | sources |
|---|---|---|---|---|
| 0 | 0 | 1 | — | centre |
| 0.816497 | √(2/3) | 6 | 30°, 90°, … | **each = one cap vertex + one square-face centre coincident** |
| 1.414214 | √2 | 6 | 0°, 60°, … | belt vertices |

Ratio √2/√(2/3) = √3 identically (residual 6.7e-16); hexagon offset exactly 30°; 13 distinct positions; C(13,2) = 78. That is the Fruit of Life centre set. It is a fact about the cuboctahedron. The six square-face centres you identified as the intake gap are exactly the six that land on the inner ring here.

---

## 14. Known documentation defects — so you don't trip on them

- `CLAUDE.md` was corrected on 2026-09-09: the bridge is imported and tested, while the local WASM artifact is absent. `PFAR_PHASE_SPACE_PAPER.md` overstated deployed WASM execution and was corrected on 2026-09-09.
- REPAIRED 2026-09-09: `HYPERBOLIC_GRAPH_MAPPING.md` §2 and its caps sentence now state RIP_DIM 29, default dim 128, caps 20,000/200,000.
- REPAIRED 2026-09-09: `DUAL_ROUTER_ARCHITECTURE_SPEC` items 2 and 3 now describe the implemented PFAR proxies and four Gabor orientations, and state that spectral flux and scene-cut detection are not implemented.
- REPAIRED 2026-09-09: `COGNITIVE_MAPPING_IMPLEMENTATION_PLAN` §2.2 now describes the compact 29-feature input and 128-coordinate fit, and the "Production Validated" stamp is qualified as source-inspected instrumentation.
- REPAIRED 2026-09-09: both `PFAR_PHASE_SPACE_PAPER.md` companions now label the absent `pfar_phase_space.tex` as a historical, unverified reference.
- REPAIRED 2026-09-09: `THE_GEOMETRY_OF_COHERENT_MEMORY.md` ref 10 now cites Neuron 88(1), 220–235, matching the publisher record.
- `tit.py:353` sets `h1 = h2 = None` immediately before serialising them — the hypothesis verdicts in its JSON are always null.
- S1 is stated unconditionally, but the checked-in v2 setting is commented out. `session-bus.ts` enables the hybrid path for v2 or v3; unset configuration falls back to v1. Deployed traffic protocol was not verified by this file inspection. The spec row was made conditional on 2026-09-09.
- `gen-harmonic-snapshot.mjs` now has working relative imports and a golden-crossing bisection for obliquity. Its flower layout and relational/harmonic inputs remain stipulated fixtures; header and metadata say so as of 2026-09-09. Do not repeat the superseded claim that the current script computes the 26.049° drift schedule as obliquity.

---

## 15. What to re-audit, given the above

1. Your G9–G12: renumber to F1–F3, fold Euler into G1, decide whether R ≥ 2r replaces G1b.
2. Catch 5: restate as latent; specify the guard for the *toroidal* coordinates only.
3. Catch 6: φ stays algebraically exact and empirically demoted. Does your φ⁻ᵏ budget identity survive RCRB_001's silver-ratio result? If silver has the better spectral envelope, what changes?
4. Catch 7: the phase ring needs `torus.dim = 2` populated first. The natural source is the cuboctahedron's four hexagonal great circles (planes x ± y ± z = 0; each vertex lies on exactly two) → (θ₁, θ₂) per node. Is that the right T², or should T² come from PAMI's eight phases as `TOROIDAL_GRAPH_MAPPING` specifies? Those are different tori.
5. Given §6 and §10: what would the ℍ factor have to show, on real content with the semantic δ-hyperbolicity arm actually run, to earn mechanism status rather than instrumentation status?
6. The stacking block in your audit arrived truncated (`12345`). Please resend.

*Everything above is local and unpublished. Treat line numbers as approximate; the quoted text is exact.*
