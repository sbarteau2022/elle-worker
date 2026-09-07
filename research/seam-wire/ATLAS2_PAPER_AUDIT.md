# Atlas 2.0 draft — audit against the build (2026-09-07)

Every claim in the draft, in three columns: **built** (exists in code, path given), **measured**
(a number from this log, with the run), **neither** (theory, conjecture, or decoration). The
rule of this repo is that a claim is pre-registered before its data exists; the paper should
hold to the same rule.

## Title
"Atlas 2.0: Continuous Multi-Agent Orchestration via Tangent-Space Traversal of the Rosen
Ridge on a 13-Sphere Mixed-Curvature Atlas" is a sentence. Proposed:
**Twelve Around One — Orchestrating Sub-Agents on a Kissing-Sphere Atlas.**
Alternatives: *Vector Equilibrium*; *The Kissing Number*; *Superposition Held*.

## Terminology to fix before anything else
- **"Rosen ridge"** conflates two objects. The ill-conditioned ravine of §2 is the *Rosenbrock*
  valley (optimisation). The *Rosen* bridge (Einstein–Rosen) is, in this stack, the secure
  geodesic channel: `Elle/electron/native/providers/rosen-bridge.cjs` (lane envelope),
  `pqc-hybrid.cjs`, `lane-ratchet.cjs`. Keep "Rosen bridge" for the channel; call the ravine
  the Rosenbrock ravine or simply the ill-conditioned ridge.
- **Icosahedron vs cuboctahedron.** §1.1 correctly names the cuboctahedron (vector
  equilibrium); Figure 1's mindmap caption says icosahedron. The build is the cuboctahedron
  (`atlas13.cjs`, `cuboctahedronVertices`): 12 unit vertices, 6 antipodal pairs, 24 edges,
  8 triangles + 6 squares, neighbours at cosine ½ (gate G1). The icosahedron was the first
  frame and is kept only as a reference function.

## §1.1 Definition 1, Proposition 1 — BUILT, and gate-checked
- Chart U₀ at the origin = the coordinator; twelve charts at the cuboctahedron vertices
  in the map's principal 3-space; centres rigid; member dispersion as radius/fill only
  (`build()` in atlas13: `centre` fixed per level, `radius` = 90th-percentile member
  distance, `n` = members). Proposition 1's "fill, not position" is exactly the code.
- R = 2r: neighbour cosine ½ ⇒ centre distance 1 with unit radius ½ — checked by
  `readiness.cjs` gate G1 (passes).
- **Not built:** the conformal-overlap radius condition of gate G₁ in the paper's table
  (½·arcosh(1 + ½·sinh²d₀) < r_p ≤ d₀). Radii are empirical percentiles, not conformal
  overlap radii. Either derive r_p from members and *check* the inequality, or drop the gate.

## §1.2 Six dualities — BUILT
`faculties.json`: the twelve faculties as six pairs; pair i pinned to antipodal vertex pair i
(Kabsch with fixed correspondence). Superposition rule: signed coordinate per axis, collapse
to a pole only when the leading axis clears 0.06, beats the runner-up by 0.02 and by ×1.3;
else HELD at the centre. **Measured:** routing must run in the 1024-d embedding space — in the
16-d map projection every faculty description is nearly collinear (a word problem sits at
cosine 0.73–0.86 with all twelve; a shell task at −0.3…−0.5 with all twelve), so the 16-d
differences are ~0.05 and route badly (639/1025 held, GSM8K → Language). In embedding space
with a bounded keyword vote: 20/20 GSM8K → Convergent Logic; code tasks held (Motor Praxis ≈
Convergent Logic). The paper should state the space routing runs in; it matters.

## §2 Tangent-space kinematics, Theorem 1 — THEORY, not what the code does
Theorem 1 (natural-gradient preconditioning by g⁻¹ = λ⁻²I cancels the conformal blow-up) is a
standard and correct statement about Riemannian gradient descent in the Poincaré ball. The
build does not run gradient descent on a task loss in the ball. What it runs: Lorentz-distance
drift of each turn's embedding from the task anchor (`atlas-state.measureDrift`), a smoothed
delta with a ±0.35 gate, an out-of-region bound at 1.25 radii, and the κ regulator. Present
§2 as the continuous-time model the discrete regulator approximates, or move it to an
appendix. Do not imply the agents traverse a ridge by natural gradient; they do not.

## §3.1 Fourteen persistent faces — DECORATION as written
The faces exist (G1 counts them) and the winding check exists (`windingCheck`: steps wrap to
half a turn; the exact half-turn step is refused; gate G3). But nothing in the build attaches
persistence to faces, and "faces carry topological persistence by construction" is not a
statement the code makes. Say: the frame is fixed and the winding vector is a homotopy
invariant of each agent's phase trajectory (Atlas 1.0, Lemma 2); the faces are the
adjacency structure the lateral web (Rosen-bridge handoffs) will use.

## §3.2 Continuous float parameterisation — PARTLY BUILT, differently
- Built: a task's six operational coordinates (`profile-axes.json`: granularity, epistemic,
  temporality, action mode, risk, formality), computed like the faculties; knobs from them
  (temperature ← risk, step budget 1,024–4,096 ← granularity, max steps ← granularity +
  action, review depth ← risk); depth r reported 1.0 out at the sphere and 0.0 on
  convergence; delegated steps capped at 2,048 tokens (DELEGATE_003).
- The paper's α ∈ Δ¹¹ barycentric weights and the softmax compute partition Cᵢ across agents
  are **not built** (budgets are per task from the profile; there is no cross-agent pool).
  Either implement the partition or describe what exists.
- The κ regulator with φ² asymmetry is built and gate-checked (G4, G5, G6) — with one
  correction made tonight: z is clamped at the analytic holding bound φ²/ρ ≈ 131 so κ stays
  strictly inside (0,1) in float64 (the first gate run reached κ = 0 under 400 undecayed
  failures).

## §4.1 Theorem 2, the φ⁻¹ settling speedup — UNMEASURED
No drift-time experiment exists. `readiness.cjs` reports G7 as *pending* and will not pass it.
Until an experiment compares settling time on the atlas against a Euclidean baseline, this
is a conjecture, and "certified ≥ 38.196%" should not appear.

## §4.2 Distributed Rosen bridge — BUILT as a channel, NOT YET the inter-sphere transport
The envelope, ML-KEM-768 + X25519 hybrid and ratchet exist and have their own tests. Tonight's
delegation is in-process: the coordinator posts a REGION directive on the board; nothing
crosses an envelope. The multi-point extension and the 384·q·2⁻¹²⁸ bound are not exercised
here. State the channel as implemented and the multi-agent mesh as the next build.

## Table 1 — what the gates are now
`node electron/native/readiness.cjs static` runs G1 (frame), G2 (transport isometry, 1e-15),
G3 (winding), G4 (φ²), G5 (κ ∈ (0,1)), G6 (holding loss ≤ e−1; measured sup 0.0098), G9
(anti-starvation). G7 pending. G8 not in the gate. The paper's table should cite the gate and
its output rather than proof references alone.

## What the paper does not say and the log measured
These are the results a reader can check, and they are stronger than the asserted ones:
1. The coordinator's own weights carve: a depth view sharing every tensor; unhealed, twelve
   free linear layers can go with no loss (k8 7/10, k12 5/10 = full 5/10); attention layers
   are load-bearing; 48–55 is critical; the evenly spaced cut is dead (CARVE_DEPTH/DIAG/SCAN/
   VALIDATE_001).
2. Healing works: LoRA on the 48-layer view, 85 rows, 200 steps: 1/10 → 4/10 against 5/10,
   at +11% speed, measured on the serving path (HEAL_001).
3. A reviewer on the same weights does not catch the worker's misreadings (0/2); the
   decorrelated reviewer does (7/9 on the stock-3B run). Reviewer ≠ worker is a requirement.
4. The κ grounding gate is a citation check, not a correctness check (ELLE_GSM8K_002b).
5. The serving path matters: the server ran the recurrent layers on the chunked reference path
   for a week because MLX modules start in training mode; the fused kernel path reproduces the
   same numbers token for token and stops the OOMs.
6. The specialist's remaining gap is protocol, not arithmetic: it runs out its step budget
   without calling done. The next heal trains on the coordinator's own action transcripts.
