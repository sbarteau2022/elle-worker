# Twelve Around One — Deck (revised 2026-09-07)

Stewart Barteau · Independent Research · Elle Cognitive Architecture

Slides 1–8 are Stewart's, kept where the build agrees and corrected where it does not (marked
✎). Slides 9–16 are what the sessions measured. Status words are exact: **built** (in code),
**measured** (a pre-registered run), **conjecture** (stated, not yet tested).

---
## 1 · Architecture blueprint — built
Coordinator / Self at U₀ (routing, stability, synthesis). Twelve faculty spheres at the
cuboctahedron's unit vectors (R = 2r, four kissing neighbours each). Fill, not position:
member counts and 90th-percentile dispersion render as density; coordinates never move.
Gate G1 passes: 12 unit vertices · 6 antipodal pairs · 24 edges · 8 + 6 faces · neighbour cos ½.

## 2 · Six canonical dualities — built
sensory ↔ motor · somatic ↔ language · episodic ↔ predictive · convergent ↔ divergent ·
valuation ↔ social · spatial ↔ metacognitive (`faculties.json`). Pair i pinned to antipodal
vertex pair i; frame Kabsch-fitted; slot identity kept across rebuilds.
✎ Figure caption: cuboctahedron, not icosahedron.

## 3 · Tangent-space traversal — ✎ model, not mechanism
The natural-gradient argument (g⁻¹ = λ⁻²I cancels the horizon blow-up) is correct Riemannian
optimisation. The agents do not descend a loss in the ball. What runs: Lorentz-distance drift
from the sphere's centre with a ±0.35 gate, an out-of-region bound at 1.25 radii, and the κ
regulator. Keep this slide as "the continuous model the discrete regulator approximates".
✎ "Rosen ridge" → the Rosenbrock ravine; "Rosen bridge" is the channel.

## 4 · Float profile — built, differently
Built: six operational coordinates per task (granularity, epistemic, temporality, action,
risk, formality) → temperature, step token budget 1,024–4,096, step count, review depth; depth r
1.0 out / 0.0 back. κ̇ = κ(1−κ)ż: built and gated (G5). ✎ Barycentric α ∈ Δ¹¹ and the
cross-agent softmax quota Cᵢ: not built; budgets are per task. Anti-starvation (G9) passes for
what exists.

## 5 · Fourteen faces & winding — ✎ half built
The faces exist and are counted (G1). The winding check exists and refuses the half-turn step
(G3). "Persistence by construction over the faces" is not something the code asserts; the faces
are the adjacency the lateral web will use.

## 6 · φ² dynamics & settling — ✎ split
S_C/S_R = φ² and sup L < e−1: built, gated (G4, G6; measured sup 0.0098). The settling speedup
T_atlas ≤ φ⁻¹ T_euclid: **conjecture**. No drift-time experiment exists; the gate reports it
pending. "Certified > 38.196%" must go until measured.

## 7 · Rosen bridge (COROS-MA) — the lanes ARE the hull's edges now
ML-KEM-768 + X25519 hybrid, HKDF ratchet, lane envelope: in code with tests. Since 2026-09-07
every region handoff rides the geodesic lane of its hop: 72 directed lanes (spokes + kissing
edges), `LANE` directives on the board, opens only on its own hop and tick, no lane for a
non-edge, child roots per sphere (recursion). In-process and unit-tested (G8); not yet a
cross-machine mesh, and the 384·q·2⁻¹²⁸ bound is still a proof statement.

## 8 · The gates — with status
| Gate | Invariant | Status |
|---|---|---|
| G1 | frame R = 2r, faces | **passes** (`readiness.cjs`) — ✎ the conformal-overlap radius form is not what's checked |
| G2 | isometric transport | **passes** (1.4e-15) |
| G3 | winding δ_max < π | **passes** |
| G4 | φ² asymmetry | **passes** |
| G5 | κ ∈ (0,1) | **passes** after clamping z at φ²/ρ (first run reached κ = 0) |
| G6 | holding ≤ e−1 | **passes** (sup 0.0098) |
| G7 | settling speedup | **pending** — unmeasured |
| G8 | forgery bound | not in the gate; channel tests only |
| G9 | anti-starvation | **passes** |

---
## 9 · Specialists are carved, not downloaded — built, measured
A specialist is a view over the coordinator's own loaded layers: shared tensors, own KV and
prefix pools, dissolved when idle. Server resident set with four views: 15.3 GB. Unhealed depth
frontier on a 64-layer hybrid: one linear layer free; twelve middle-most free linear layers =
full model (k8 7/10, k12 5/10 vs 5/10, +25% speed); sixteen is the cliff (1/10); attention
layers load-bearing; layers 48–55 critical; evenly spaced cuts dead.

## 10 · Healing — measured
LoRA rank 16 on the 48-layer view, teacher = same weights at full depth (top-32), 85 rows,
200 steps, 13 minutes: 1/10 → 4/10 against the full model's 5/10, at 242 vs 347 mean tokens,
on the serving path. DoRA rejected: >100 s/step (re-norms every dequantised 4-bit matrix).

## 11 · Review must be a different mind — measured
Same-weights reviewer: 0/2, reproducing the worker's misreading in its own notes.
Different-weights reviewer: 7/9 wrong first submissions caught. Grounding gate: refused-but-
correct 5.3% (pass), recall on wrong 0.17 (fail) — five of six wrong answers were fully
grounded arithmetic on a misread problem. Citation ≠ correctness.

## 12 · Routing lives in the embedding, not the projection — measured
16-d map projection: every faculty description at cosine 0.73–0.86 with a word problem;
639/1025 goals held, GSM8K mis-routed. 1024-d embedding + bounded keyword vote: 20/20 GSM8K
→ convergent logic; code goals held (motor ≈ convergent). Earned collapse: lead ≥ 0.06,
margin 0.02, ratio 1.3.

## 13 · Serving path — measured
MLX modules start in training mode; the server never called eval(): the recurrent layers ran
the chunked reference path for a week. Identical answers on short prompts (2.5e-4); Metal OOM
on 2k-token agent prompts (9/9). Eval mode now; kernel path re-measured token for token.

## 14 · Delegation end to end — built, partially measured
Coordinator embeds the brief → places it → posts floats + executor → worker anchors, recalls
inside the sphere, drives on the sphere's specialist → reviewer signs off or sends back →
escalation to the centre. D1 held in every run (all delegated requests served by the
specialist). Three delegated runs voided by infrastructure (OOM ×2, client 300 s header
timeout ×1), each fixed; the fourth is running with the fixes.

## 15 · The specialist's remaining gap — measured
It knows the answers and not the protocol: budget/κ blocks without `done`. The raw exchange
of every task is now captured (CONVO.jsonl); the next heal distils the coordinator's own
approved action transcripts, every assistant turn.

## 16 · From conjecture to measurement — the plan and its cost
| Item | What makes it non-conjectural | Est. |
|---|---|---|
| G7 speedup | drift-time experiment: consensus distance vs turns on recorded trajectories, atlas vs Euclidean baseline; report the measured factor, whatever it is | 1 session |
| G1 overlap radius | derive r_p from chart geometry, check the inequality in the gate | hours |
| Compute partition / G9 as stated | shared pool, softmax over κ·affinity, gate on Cᵢ > 0 | 1 session |
| Rosen-bridge mesh / G8 wired | DONE in-process 2026-09-07 (sphere-lanes.cjs, G8 static+live); remaining: first live task over a lane, cross-machine mesh | hours (live) / 1 session (mesh) |
| HEAL_002 (protocol) | 100-task coordinator batch → approved exchanges → multi-turn heal → DELEGATE_005 | 1 session (GPU-bound) |
| Falcon "fire" verb | fan-out to all spheres, validation, synthesis last | 1–2 sessions |
| Recursion | a sphere as the same architecture one level down | 2–3 sessions |
| Twelve populated spheres | task families beyond math/code — product traffic; seeding exists | depends on use |
