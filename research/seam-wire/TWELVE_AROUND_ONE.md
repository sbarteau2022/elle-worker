# Twelve Around One
## Orchestrating Sub-Agents on a Kissing-Sphere Atlas

Stewart Barteau · Independent Research · Elle Cognitive Architecture · September 2026
*Revised draft: every number below is from a pre-registered run in `ELLE_GSM8K_001.md`; every
structural claim is a gate in `electron/native/readiness.cjs`. Claims that are neither are
labelled as such.*

### Abstract
We extend the phase-locked geometric substrate of Atlas 1.0 (M = Hⁿ × Tⁿ) to a multi-agent
orchestration architecture in which one coordinator and twelve specialists occupy the thirteen
charts of a kissing-sphere atlas: a central sphere at the hyperbolic origin and twelve around
it at the vertices of the vector equilibrium (cuboctahedron), so that each outer sphere touches
the centre and exactly four neighbours (R = 2r). The twelve are canonical cognitive faculties
arranged as six dualities on the six axes through the centre. A goal is placed by its signed
coordinate on each axis; the centre holds the six in superposition and collapses the goal onto
a pole only when one axis clearly leads — otherwise it runs the goal itself. Specialists are not
separate models: each is a depth-carved view over the coordinator's own loaded layers, healed by
a small adapter distilled from the coordinator on that sphere's approved work, served under its
own tag with no second copy of any tensor. We report what this measures on GSM8K in a live
harness: which layers of a 64-layer hybrid can be removed unhealed (twelve linear layers, no
attention layer), what healing recovers (a 48-layer view from 1/10 to 4/10 against the full
model's 5/10), that a reviewer on the same weights cannot catch the worker's misreadings while a
reviewer on different weights can, and that the grounding gate is a citation check rather than a
correctness check. Seven structural invariants are executable gates and pass; the settling-time
speedup of the earlier draft is carried as a conjecture until measured.

### 1. The atlas
**1.1 Frame.** Thirteen charts: U₀ at the origin (the coordinator: routing, stability, synthesis)
and U₁…U₁₂ at the twelve unit vectors of the cuboctahedron, permutations of (±1, ±1, 0)/√2, in
the map's top-three principal directions. Six antipodal pairs; 24 edges; 8 triangular and 6
square faces; every outer sphere kisses four neighbours at cosine ½. Centres are rigid under
load; a sphere's member count and 90th-percentile member distance render as fill and radius,
never as position (`atlas13.build`). Gate G1 checks all of this.

**1.2 Faculties.** The twelve charts are the canonical faculties as six dualities: sensory
perception ↔ motor praxis; somatic interoception ↔ language & semiotics; episodic memory ↔
predictive simulation; convergent logic ↔ divergent synthesis; valuation & salience ↔ social
cognition; spatial topography ↔ metacognitive regulation (`faculties.json`). Pair i is pinned to
antipodal vertex pair i; the frame's rotation is fitted to the description directions (Kabsch),
and slot identity is matched to the previous build in the map, so a sphere keeps its adapter and
record across rebuilds.

**1.3 Superposition and earned collapse.** For a goal with embedding q, the coordinate on axis
i is c_i = s(A_i, q) − s(B_i, q), where s is the cosine to the faculty's description embedding
plus a bounded keyword vote (≤ 0.12). The goal collapses to the pole of axis i* = argmax |c_i|
only if |c_{i*}| ≥ 0.06, exceeds the runner-up by 0.02, and by a factor 1.3; otherwise it is
held: the coordinator runs it and stamps it with the leading axis. *Measured:* routing must run
in the 1024-d embedding space. In the 16-d map projection all twelve descriptions are nearly
collinear (a word problem sits at cosine 0.73–0.86 with every faculty), and 639 of 1025 goals
were held with GSM8K mis-routed; in embedding space 20/20 GSM8K goals route to convergent logic
and code goals are held with motor praxis and convergent logic tied.

### 2. The regulator (discrete dynamics, not gradient descent)
Each agent carries the Atlas 1.0 state (u, θ, W, z, D): a Lorentz anchor u (the sphere's centre
when delegated), phase θ advanced by φ⁻¹ per turn, winding W, log-odds confidence z with
κ = σ(z), and lineage drift D. A verified act adds 1 to z; a failure subtracts φ²; each turn z
decays by (1 − ρ), ρ = 0.02, with fixed point |z*| = φ²/ρ ≈ 131, at which z is clamped so κ
stays strictly inside (0, 1) in float64 (gate G5; the first gate run reached κ = 0 under
undecayed failure). Holding loss L = e^{ρ D_h} − 1 stays below e − 1 (gate G6, measured sup
0.0098 over 2,000 strain steps). The winding check refuses any wrapped step of exactly half a
turn (gate G3). A turn whose embedding lands beyond 1.25 radii of the assigned sphere is nudged
back (out-of-region). These are difference equations on a recorded trajectory; the earlier
draft's natural-gradient traversal of a ridge in tangent space is a continuous model the code
does not run and is not claimed here.

### 3. Delegation from the centre
The coordinator embeds every open brief, places it, and posts the region — level, centre,
radius, coordinates, executor — as a directive before the brief is claimable. If the sphere has
a served specialist, the executor is the sphere; if it is empty or unserved, the coordinator runs
the goal itself but the task is still stamped with the sphere, seeding its distillation set. A
delegated task the reviewer sends back is escalated to the centre. Each task also carries six
operational coordinates (granularity, epistemic, temporality, action mode, risk, formality)
from the same embedding; they set the step's sampling temperature (risk), token budget
1,024–4,096 (granularity), step budget (granularity + action) and review depth (risk). Depth r
is reported 1.0 at the sphere and 0.0 on convergence. *Not built:* a cross-agent softmax
partition of a shared compute pool; budgets are per task.

### 4. Specialists carved from the coordinator
The coordinator is Qwen3.5 (27B, 4-bit): 64 layers, 48 gated-delta (linear attention) and 16
full attention at every fourth layer. A specialist is a view: shallow copies down to the decoder
whose layer list is a subset, sharing every tensor, with its own KV and prefix pools, dissolved
when idle. *Measured, unhealed, greedy, 512-token cap, held-out GSM8K rows 300–319 and 300–309:*
the identity view reproduces the full model token for token; one linear layer costs nothing;
28–31 cost nothing; 48–55 is load-bearing; the evenly spaced 48-layer cut is dead (2/8 sums,
0/20); removing sixteen linear layers while keeping every attention layer keeps 6/8 and 3/10;
a per-layer scan is flat except layer 0 and 51–58; dropping the twelve middle-most free linear
layers matches the full model (k8 7/10, k12 5/10 vs 5/10) at +25% speed, and sixteen is the
cliff (1/10). *Healed:* LoRA (rank 16, attention and recurrent projections, 24.1M parameters)
on the 48-layer view, teacher = the same weights at full depth (top-32 targets), 85 rows, 200
steps, 13 minutes: 1/10 → 4/10, at 242 mean tokens against the full model's 347. Served as a
view plus adapter under its own tag; the adapter is applied to the view only. The specialist's
remaining gap is protocol, not arithmetic: in the loop it exhausts its step budget without
calling done; the next heal trains on the coordinator's own approved exchanges.

### 5. Review and grounding
*Measured:* with the reviewer on the coordinator's own weights, both of the worker's misread
problems were approved with the identical misreading in the reviewer's notes (0/2). With the
worker on different weights, the reviewer caught 7 of 9 wrong first submissions. The grounding
gate (every number, hash, URL and quoted string in a summary must appear in a tool observation)
passed its own pre-registered target (refused-but-correct 5.3% < 10%) and failed the other
(recall on wrong 0.17 < 0.70): five of six wrong answers were self-consistent arithmetic on a
misread problem, fully grounded. Grounding is a citation check; correctness needs a second,
different mind.

### 6. Serving path
MLX modules start in training mode; the server never called eval(), so for a week the recurrent
layers ran the differentiable chunked reference path rather than the fused kernel. On short
probes the two agree to 2.5e-4 and produce identical answers; on the swarm's 2,000-token prompts
the chunked path exhausted Metal memory (nine of nine tasks). The server now serves in eval mode
and the numbers above were re-measured on the kernel path, token for token the same.

### 7. Gates
`node electron/native/readiness.cjs static` — G1 frame; G2 isometric transport (worst relative
norm change 1.4e-15 over 20 random transports); G3 winding; G4 φ² asymmetry; G5 κ ∈ (0,1);
G6 holding loss ≤ e − 1; G9 anti-starvation of the step budget: all pass. `… live [rows]`
adds the server, the bridge, the faculty atlas, and a delegated micro-run scored on executor
rate, approved-correct rate, server-error rate and reviewer activity. Ready is exit code 0.

### 8. Conjectures and next builds (stated as such)
- Settling-time speedup of φ⁻¹ over a Euclidean baseline: no drift-time experiment yet (G7 pending).
- Inter-sphere transport over the Rosen bridge (the ML-KEM-768 + X25519 lane envelope exists
  and is tested as a channel; delegation is in-process today). The lateral web is the 24 edges.
- Recursion: each sphere as the same architecture one level down.
- A shared compute pool partitioned across agents.

### References
Atlas 1.0 (Barteau, Aug. 2026); Cannon et al., Hyperbolic geometry (1997); Ungar, Analytic
Hyperbolic Geometry (2008); Nickel & Kiela (2017); Gu et al. (2019); Bridson & Haefliger
(1999); Hatcher (2002); FIPS 203 (2024); RFC 7748; RFC 5869; Giacon et al. (2018).
