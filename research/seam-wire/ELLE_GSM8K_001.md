# ELLE GSM8K 001 — the whole stack, in the harness, at the model's own limits

**2026-09-06.** 400 GSM8K problems (val 0–99, test 0–99, train_split 0–199 — the same rows as
every seam-wire fixture) posted to the agent bridge and worked by the **running Electron
app's own swarm**: watcher auto-spawn, 3 sovereign coordinator agents, 8 steps each, memory
on (k = 8 neighbourhood recall from the hyperbolic map, task commit after each brief, agent
ledger), mlx-serve serving stock `Qwen3.8-27B-4bit` at `num_ctx 262144`, `num_predict 32768`,
temperature 1.0 / top_p 0.95 / top_k 20 (the card's sampling), per-agent KV namespaces, and
the per-token surprisal sidecar. Nothing left the machine. Report:
`runs/elle_gsm8k_400_report.json`; briefs: `runs/elle_gsm8k_400_posted.json`;
Elle's own surprisal streams: `test-fixtures/tap-series-elle-gsm8k-n400.jsonl`.

## Result

| split | n | accuracy | refused by κ | of which correct | mean gen tokens | generations / task |
|---|---|---|---|---|---|---|
| val | 100 | **0.930** | 65 | 60 | 156 | 1.67 |
| test | 100 | **0.940** | 72 | 66 | 164 | 1.62 |
| train | 200 | **0.900** | 139 | 124 | 146 | 1.51 |
| **all** | **400** | **0.9175** | 276 | 250 | 151 | 1.57 |

Against the capped research evaluator on the same rows (greedy, raw weights, step-by-step
prompt): val 0.86 @512, test 0.63 @1024, train 0.63 @1024. The gap was the harness, not the
model: through her own loop Elle answers in ~150 tokens; the evaluator's prompt + greedy
decoding produced the 500-token essays whose truncation the last two days were built on.

## The regulator

276 / 400 briefs were **refused** by the κ gate (`stopped (kappa)`) — and 250 of them were
right. The gate fires on *ungrounded claim*: the final number is not backed by a tool output,
so it reads as strain. Read as a wrongness detector: 26 of 33 wrong answers refused
(**recall 0.79**), precision 0.094. Consequences, in order of weight: (1) every refused task
is committed to the map and the agent ledger as **strain** — 250 correct answers were
written into her memory as failures, and later tasks inherit that z; (2) the answer is not
delivered (blocker on the board); (3) retries double spend. The fix is a protocol, not a
weight: the brief should tell her to **verify the final number with `run_code` before
`done`** — one tool output grounds the claim, the gate keeps its teeth on real errors.
Pre-registered for the next run: refusals of correct answers fall below 10%, recall on
wrong stays ≥ 0.7.

## The cache, the map, the surprise — live

- mlx-serve namespaced KV across the run: **1,034 stores, 407 hits, 469K tokens served from
  cache, 601K prefilled, 0 evictions.**
- Hyperbolic map (`~/.elle/hyper-map`, the live one — the app's Application Support copy
  was a stale 24-node duplicate and the app was pointed at the live map by env):
  1,020 → **1,818 nodes**; every one of the 400 tasks has its node with z.
- Sidecar: every task has its per-token surprisal rows (628 generations), keyed by the
  agent's cache namespace `agentId:seq`.

## The seam wire on Elle's own streams — does not transfer as built

Only **148 / 400** first generations reach 96 tokens; she is concise. On those 148:
wrong n = 16 → INSUFFICIENT; refused: RESERVE AUC 0.463 (lo95 0.362) → KILL; control at
chance. The 96-token / 64-window readout that replicated three times on the evaluator's
long completions has **no purchase on Elle's real behaviour**, because that behaviour is a
150-token answer. The horizon ladder for the multi-map therefore runs **down** (heads 32,
48, 64 with a 32-token window), not up; that is the next pre-registration.

## What is validated after this run

- Elle in the harness at the card's limits: **91.75% on 400 GSM8K**, sovereign, with every
  layer live and observable. This is the baseline any distillation must beat, through the
  same door.
- The κ gate is a real error detector (recall 0.79) wired to a grounding rule that punishes
  mental arithmetic; fix the protocol before the map and ledger are used for training.
- The evaluator-derived length signal is an artifact of the evaluator. It stays recorded as
  what it is; it is not a property of Elle.

## ELLE_GSM8K_002 — pre-registered before the run (2026-09-06)

Change: the brief now says *"Before you finish, verify your final number by running a short
python calculation with run_code that prints it."* Nothing else changes: same app, same
agents, same limits, same test split rows 0–99, the κ gate untouched.

Claims: **R1** refused-but-correct < 10% of tasks (was 66%). **R2** recall on wrong ≥ 0.70
(was 0.79). Reported: accuracy (was 0.940), mean generations and tokens per task (cost of
the verify step), and how many refusals remain and why.
Falsifier: R1 fails → the grounding rule does not accept a tool-printed number as
grounding for the claim, and the rule itself (atlas-state `claimsOf`/grounding) is the
next thing to open, not the brief.

### ELLE_GSM8K_002 — VOID (server failure, not a verdict)

Ran 2026-09-06 19:07. 84 / 100 briefs died with `ollama HTTP 500: RuntimeError: [METAL]
Command buffer execution failed: Insufficient Memory` (66 such failures in the server log);
only 16 produced an answer. The machine was 8 GB into swap after the 400-run: the prompt
cache store had logged 1,034 stores and 0 evictions. The 16 that did answer were all
correct; 6 were accepted, 10 refused — and the refusals showed the real rule defect:
intermediate numbers and formatting (`200,000` vs a tool's `200000.0`) counted as
ungrounded claims. **Fix landed (Elle 045b212):** `groundClaims` now compares numbers by
value and treats the brief's own numbers as given. R1/R2 are re-run as 002b after the
server is restarted with a bounded cache; nothing about the 002 numbers is a result.

### ELLE_GSM8K_002b — pre-registered before the run (2026-09-06)

Server restarted with bounded caches (`MLX_CACHE_MAX_GB=3`, `APC_NUM_BLOCKS=512`); rule fix
045b212 live in the app's workers; brief v2 asks her to print the final number and every
intermediate she cites. Same 100 test rows, same app, 3 agents. Claims unchanged:
**R1** refused-but-correct < 10%; **R2** recall on wrong ≥ 0.70. Reported: accuracy,
generations and tokens per task, any server errors (a run with > 5% server errors is VOID).

### ELLE_GSM8K_002b — RESULT (2026-09-06, run completed after a laptop-transport pause)

Run: test split rows 0–99, seq 952..1051, 3 agents, Elle in the Electron harness on
mlx-serve (num_predict 32768 / num_ctx 262144, bounded caches). The pause reopened 2
claimed briefs; nothing was re-posted. Server errors: **0** (not VOID). All 100 tasks
mapped (map 1818 → 2192 nodes) and all 100 have sidecar rows (218 generations, mean
277 gen tokens/task — brief v2 makes her print intermediates, so longer than 001's ~150).

| | 001 (400, old rule) | 002b (100, rule 045b212 + brief v2) |
|---|---|---|
| accuracy | 0.9175 | **0.94** |
| refused | 276 (69%) | **6** |
| refused-but-correct / correct | 250/367 = 0.68 | 5/94 = **0.053** |
| recall on wrong (R2) | 0.79 | **1/6 = 0.17** |
| precision of refusal | 0.094 | 0.17 |

**R1 PASSES** (0.053 < 0.10). **R2 FAILS** (0.17 < 0.70).

Why R2 fails — read the six wrong answers (`runs/elle_gsm8k_002b_report.json`,
`wrong_rows`): five are self-consistent arithmetic on a wrong reading of the problem
(inclusive vs exclusive year count, a pension bonus applied to the wrong base, an
off-by-one). She ran the code, the code printed her numbers, every claim in the summary
was in an observation. The grounding gate is a citation check: it verifies that what
she says matches what she saw, and it cannot see that what she computed answers the
wrong question. 001's recall of 0.79 was not detection; it was a rule that refused
almost everything (precision 0.09). **R2 as pre-registered is not reachable by a
grounding gate; a correctness gate needs an independent second solve or a checker,
which is a different instrument. Recorded as a falsification of the claim that κ
grounding detects wrong answers.**

Why 5 correct answers were still refused (`refused_rows`, board events): two came from
possessive apostrophes read as a quoted string (`Suzy's … Ben's` → claim); fixed after
the run (atlas-state.cjs, negative word-boundary on the `'…'` branch, test added). Two
were factors she used but did not print (1.25, 0.9, 0.5) despite the brief; one cited
earlier task seqs (#919/#619) — genuinely unprinted numbers, the rule is right. The
apostrophe fix was applied AFTER 002b and is not reflected in its numbers.

Not trained on. The map/ledger now hold 001's 250 wrongful strain nodes plus 002b's
clean 100; training data for the DoRA step is 002b's 89 grounded-correct completions
only, until a larger clean run exists.

### Coordinator sign-off — first live result (2026-09-06, Elle 0a674a3)

Built after 002b: a worker's `done` is a submission; the coordinator (`elle` tag, same
27B weights) solves independently and approves or sends back (max 2, then blocked); workers
also pick up architect directives every step (the nudge). Live: honest tasks approved with
correct notes; a directive posted mid-run was acted on 3 s later.

Retest on the two 002b wrong problems (test #62 pension, gold 25000; test #85 quilt, gold
44): worker answered 75000 and 48 again, and the coordinator **approved both**, reproducing
the identical misreading in its own notes ("$50,000 + $25,000 = $75,000"; "23 to 34
inclusive is 12 years"). **Same weights, same prior, same error: a second solve by the same
model is not an independent check.** The sign-off loop is the right shape, but its reviewer
must be a different model from the worker (or the worker must be a different model from the
coordinator) for the two errors to decorrelate. This is the empirical case for the
specialist tier Stewart asked for: small hyper-specialised workers under a 27B coordinator
that reviews, not eight instances of the coordinator (ELLE_SWARM_SOVEREIGN=1 forces every
role onto the coordinator's weights — swarm.cjs status block — which is what 001/002b ran).

### ELLE_GSM8K_003 — pre-registered before the run (2026-09-06 22:39): specialist worker, coordinator reviewer

Sovereign OFF: the roster routes these briefs to the 3B coder (`qwen2.5-coder:3b`, 4-bit,
num_ctx 16384) as the worker; the 27B `elle` coordinator reviews every submission
(sign-off on, max 2 send-backs). Held-out rows: GSM8K test 100–199 (seq 1058..1157), never
used in 001/002b. Same brief v2, same app, 3 agents.

Claims: **C1** the reviewer's catch rate on wrong final submissions (blocked or sent back at
least once among tasks whose first submission was wrong) ≥ 0.50 — decorrelated weights
should catch what same-weights review caught 0/2 of. **C2** final accuracy after review
(approved-and-correct / 100) is reported against 002b's 0.94; no threshold, the 3B is
expected below the 27B. Reported: first-submission accuracy, send-backs, blocks, approved
wrong (reviewer false-approves), server errors (>5% ⇒ VOID).

### ELLE_GSM8K_003 — VOID (serving defect, not a verdict)

Stopped at 29 finals: 22 "empty reply from qwen2.5-coder:3b" / rambles to the 4096 cap, 2
coordinator blocks, 1 budget. Diagnosed on an idle server: **Qwen2.5-Coder-3B with kv_bits 4
on mlx-serve's sequential generation path is garbage** (0/8 trivial sums, "33391" for 17×23,
long prompts degenerating to "tototo"); the identical requests batched (the batch path does
not quantise the cache), or at kv_bits 8 / fp16, score 8/8. Two defects fixed on the way:
the roster's per-role token cap was being ignored (the 3B inherited 32,768 and one step ran
>300 s, tripping the client header timeout on every other agent), and the small tier's KV
default is now 8-bit everywhere (server, roster, worker, tests). Remaining 003 briefs
cancelled. Of the 8 send-backs the 27B reviewer issued before the stop, the one it blocked
outright was a genuine wrong answer (175 vs 110), so the decorrelated reviewer did fire.

### ELLE_GSM8K_003b — pre-registered before the run

Same claims as 003 (C1 reviewer catch rate on wrong first submissions ≥ 0.50; C2 final
accuracy reported vs 002b's 0.94), same held-out rows (test 100–199), 3B coder worker at
kv_bits 8 / 4096-token cap, 27B reviewer, sovereign OFF. VOID if > 5% server/model errors.

### Design change (2026-09-06, late): no stock small models — specialists are carved from the coordinator; the atlas13 region handoff

Stewart: delete Qwen2.5-Coder-3B and Phi-4-mini from disk; the 3B-equivalent must come from the
coordinator's own weights, without extra disk or GPU, materialised per agent and dissolved after;
the coordinator reads the goal, takes the floats from the 13-level map and assigns them to the
worker to stay in that area. Done: both models deleted (3.8 GB), retired from mlx-serve's roster
(it would have re-downloaded them) and from the Electron roster (elle-coder / elle-reasoner /
elle-math, coordinator fallback until a carved tag is served). **003b abandoned at 8 finals**
(stock 3B worker): 9 first submissions, 9 wrong/unformatted, the 27B reviewer caught 7 — the
decorrelated reviewer fires, on a sample too small to be a verdict.

Built (Elle, atlas13 commit): `atlas13.cjs` carves the live map into level 0 (central) + 12
regions (spherical k-means with restarts on the task nodes' 16-d tangent directions; centre =
probe point of the centroid, radius = 90th-pct member distance; labels from region words minus
corpus-frequent instruction words). The watcher embeds every open brief, assigns its region and
posts `REGION {level,label,radius,d,centre}` as an architect directive before it is claimable; the
worker anchors to the centre, recalls only inside the radius (hyper-map `within`), tells the model
its level, is nudged when its turns land beyond 1.25 radii (`atlas-state.outOfRegion`), and the
task node is written back with its level. First build of the real map: 1022 task nodes → 12
regions (four GSM8K sub-families 221/158/135/127, then shell/eval, prime, sha256, fizzbuzz,
count, fibonacci, search), 59 ms.

What the floats do and do not do: they bound where the worker thinks (anchor, recall, nudge) and
name which per-region adapter it runs under; they do not by themselves reduce compute. The
"3B-equivalent" is the next build: a depth-carved view over the coordinator's loaded layers
(64 = 48 GatedDeltaNet + 16 attention, dense, no experts) with a per-region DoRA heal, depth
chosen by measurement, served as elle-<role> tags sharing the coordinator's tensors.

### CARVE_DEPTH_001 — depth-carved views of the coordinator, unhealed (2026-09-07 00:xx)

The carve (Elle 00add33): a roster tag {"repo": coordinator, "layers": "depth:N"} serves a
VIEW of the loaded coordinator whose decoder runs N of the 64 layers (first and last quarter
of N kept whole, the middle spread evenly; hybrid masks need ≥1 attention + ≥1 linear layer).
Nothing copied: server RSS 15.3 GB with the base plus three views resident; each view carved
in 0.0 s; the base slot dissolved while the views held its weights. Probe: greedy, 512-token
cap, eight trivial sums + held-out GSM8K test 300–319, `carve_depth_probe.py`.

| tag | sums | GSM8K | hit cap | tok/s | mean gen |
|---|---|---|---|---|---|
| elle | 8/8 | 14/20 | 4 | 16.83 | 363 |
| elle-c48 | 2/8 | 0/20 | 9 | 20.5 | 288 |
| elle-c32 | 0/8 | 0/20 | 0 | 26.9 | 89 |
| elle-c24 | 0/8 | 0/20 | 19 | 37.95 | 494 |
| elle-c16 | 0/8 | 0/20 | 10 | 53.41 | 331 |
| elle-c8 | 0/8 | 0/20 | 14 | 87.62 | 406 |

Verdict: **an unhealed depth carve of this hybrid is dead below the full stack.** Even 48 of
64 (25% removed, spread through the middle) drops trivial sums to 2/8 and GSM8K to 0/20;
32 and below emit noise. Speed scales as expected (16.8 → 87.6 tok/s at 8 layers), so the
mechanism delivers the compute saving; the quality does not survive removal. Two readings
remain open until the diagnostic set answers them: (a) the view is subtly wrong for this
architecture (an identity view "0-63" must reproduce the full model exactly; a single dropped
linear layer must barely move it); (b) GatedDeltaNet stacks are far less tolerant of layer
removal than plain transformers, in which case the 3B-equivalent needs a healing step
(per-region DoRA on the kept layers, distilled from the full coordinator) before it can work
at any depth. CARVE_DIAG_001 runs next: elle-v64 (identity), elle-d30 (drop layer 30),
elle-d4 (drop 28–31), elle-b56 (drop 48–55), elle-b48 (drop 40–55), elle-a48 (drop 16 linear
layers, keep all 16 attention layers), sums + rows 300–309.

### CARVE_DIAG_001 — is it the view or the architecture? (2026-09-07)

Same probe, rows 300–309 (the harder half). `elle-v64` is the identity view (all 64 layers
through the view code path); the rest drop specific layers.

| tag | what | sums | GSM8K | hit cap | tok/s | mean gen |
|---|---|---|---|---|---|---|
|  elle full | 8/8 | 5/10 | 3 | 15.4 | 347 |
|  v64 identity view | 8/8 | 5/10 | 3 | 15.64 | 347 |
|  d30 drop linear layer 30 | 8/8 | 5/10 | 3 | 15.68 | 348 |
|  d4 drop 28–31 | 8/8 | 7/10 | 2 | 15.8 | 311 |
|  b56 drop 48–55 | 2/8 | 0/10 | 10 | 15.6 | 512 |
|  b48 drop 40–55 | 0/8 | 0/10 | 10 | 17.34 | 512 |
|  a48 drop 16 linear, keep all 16 attention | 6/8 | 3/10 | 3 | 16.91 | 282 |

Verdicts. **The view is exact**: v64 reproduces the full model token for token (same 5/10,
same 347 mean generation). **The architecture tolerates removal, but not everywhere**: one
linear layer costs nothing; four contiguous layers around 28–31 cost nothing; the eight
layers 48–55 are load-bearing (2/8 sums, 0/10, every answer to the cap) and 40–55 kills it.
**Attention layers are the expensive ones**: removing 16 linear layers while keeping all 16
attention layers keeps 6/8 sums and 3/10 GSM8K unhealed, where the evenly spread 48 (four
attention layers gone) had 2/8 and 0/20. Carve rule from this: keep every full-attention
layer; drop linear layers; choose which by measurement. CARVE_SCAN_001 runs next: 64 views,
each missing exactly one layer, 16 sums each, to rank every layer's removal cost.

### The 13-sphere atlas (Elle ee69d86, a181848)

atlas13 now defaults to the kissing design: twelve fixed spheres at the icosahedron vertices
in the map's top-3 principal directions, the frame fitted to the data (Kabsch), slot identity
matched to the previous build in 16-d so a sphere keeps its adapter and record. On the live
map (1025 task nodes) four spheres are populated — GSM8K 644, shell/eval 230, hashing/
fizzbuzz 76, primes/fibonacci 75 — and eight are empty; the frame's neighbour cosine is
exactly 1/√5. Delegation from the centre: per goal the coordinator decides the executor —
a sphere's served specialist (`elle-s<k>`) gets it; an empty or unserved sphere is run by the
coordinator itself but the task is still stamped with the sphere (seeding its distillation
set); a delegated task the reviewer sends back is escalated to the centre. `export_board.py
--sphere k` selects a sphere's stamped, approved tasks for its adapter.

### CARVE_SCAN_001 — every layer removed alone (2026-09-07)

64 views, each missing one layer, 16 trivial sums each (full model 16/16). Cost = sums lost:
layer 0 → 16 (all), 51 (attention) → 7, 52 → 3, 54 → 2, 55 (attention) → 2, 58 → 1; every
other layer, attention or linear, costs 0 on its own. Read: single-layer removal is nearly
free everywhere except the input layer and the block 51–58 (the diagnostic's 48–55 result was
this block). The flat middle means the scan cannot rank layers 12–47 against each other; joint
removal must be validated directly. CARVE_VALIDATE_001 runs next: drop k = 8/12/16/20/24/32
free linear layers, middle-first, every attention layer kept; 16 sums + GSM8K 300–309.

### CARVE_VALIDATE_001 — free linear layers dropped middle-first, all attention kept (2026-09-07)

| tag | dropped | kept | sums | GSM8K 300–309 | tok/s |
|---|---|---|---|---|---|
| elle | 0 | 64 | 16/16 | 5/10 | 17.3 |
| elle-k8 | 8 | 56 | 15/16 | 7/10 | 18.8 |
| elle-k12 | 12 | 52 | 15/16 | 5/10 | 21.7 |
| elle-k16 | 16 | 48 | 12/16 | 1/10 | 23.2 |
| elle-k20 | 20 | 44 | 1/16 | 0/10 | 25.1 |
| elle-k24 | 24 | 40 | 1/16 | 0/10 | 27.0 |
| elle-k32 | 32 | 32 | 0/16 | 0/10 | 32.9 |

**Unhealed frontier: twelve linear layers.** k8 and k12 match the full model on both probes
(7/10 and 5/10 against 5/10, n=10) at +8% and +25% speed with nothing trained. The cliff is
between 12 and 16 (12/16 sums but 1/10 GSM8K), and 20+ is dead. The 3B-equivalent (8 of 64
layers) is far beyond anything the unhealed view can reach; healing is where the rest of the
depth has to come from. HEAL_001 next: DoRA on elle-k16 (48 layers, spec `0-21,23,27,31,35,39,43-63`) distilled
from the full coordinator on sphere 1's 85 clean GSM8K rows (002b-clean + approved), 300
steps, rank 16, CE + KL(top-32); before/after on 16 sums + 4 valid rows; then served as
elle-s1 and delegated to through the app.

### HEAL_001 — the first sphere specialist (2026-09-07)

Student: the k16 carve (48 of 64 layers, spec `0-21,23,27,31,35,39,43-63`) of the coordinator,
LoRA rank 16 on the attention and recurrent projections of every kept layer (24.1M params;
DoRA was tried first and costs >100 s/step on the 27B because it re-norms every dequantised
4-bit matrix). Teacher: the same weights at full depth, top-32 targets cached. Data: 85
sphere-1 rows (002b-clean + approved GSM8K). 200 steps at 4 s/step, CE + KL: loss 2.10 → 0.44.
Trained on the mlx_vlm classes in train mode (the GatedDeltaNet kernel has no gradient; train
mode routes the differentiable chunked path, within 2.5e-4 of the kernel). Served as a view +
adapter (`{"repo": coordinator, "layers": spec, "adapter": dir}`), applied to the view only.

Server-path probe, rows 300–309 (the hard half), greedy, 512-token cap:

| tag | layers | sums | GSM8K | tok/s | mean gen |
|---|---|---|---|---|---|
| elle (full) | 64 | 16/16 | 5/10 | 18.0 | 347 |
| elle-k16 (unhealed) | 48 | 12/16 | 1/10 | 23.6 | 311 |
| elle-s1 (healed) | 48 | 6/16* | **4/10** | 19.8 | 242 |

\* the sums probe concatenated digits, so the specialist's "17*23 = 391 </think>" scored as
1723391; fixed after the run (last number, think tags stripped). The row score is the real one.
The heal recovered most of the cut (1/10 → 4/10, n=10) from 85 rows and thirteen minutes of
training, and the specialist answers shorter (242 vs 347 tokens). Observed on the way: the
served prompt ends inside an open `<think>` block (default template); the student learned to
close it and answer, which is the served behaviour anyway.

DELEGATE_001 next: elle-s1 served as sphere 7 (convergent logic) in the faculty atlas; the
coordinator delegates held-out GSM8K test 320–339 to it through the app; reviewer on.

### DELEGATE_001 — pre-registered while running (2026-09-07 02:06)

The faculty atlas (Elle 87ccf23): twelve canonical spheres as six dualities, routing in the
1024-d embedding space with a keyword vote, earned collapse; the healed k16 specialist served
as sphere 7, Convergent Logic (`elle-s7`). 20 held-out rows (test 340–359, seq 1281..1300),
posted through the app; the coordinator decided the executor per goal. First eight decisions:
all `sphere 7 / elle-s7`. Claims: **D1** the delegated tasks actually run on elle-s7 (server
request counts + the worker's model line), **D2** approved-and-correct rate reported against
002b's 0.94 (n=20, informational; the specialist is 48 of 64 layers, 85-row heal), **D3**
reviewer send-backs and escalations to the centre reported. Faculty routing on 40
re-embedded real tasks before the run: 20/20 GSM8K → convergent logic; code tasks held (motor
praxis ≈ convergent logic). The six operational profile coordinates are small in this space
(|c| < 0.03) so the knobs sit near neutral (temperature 0.49); noted, not yet a claim.

**DELEGATE_001 — VOID.** 9 of 9 finals were `[METAL] Insufficient Memory` from the server. D1
held on the way down (21 requests served by elle-s7, zero by the coordinator aliases): the
coordinator delegated and the workers drove on the specialist. Cause: mlx-serve never called
`eval()`, so every GatedDeltaNet layer ran the chunked reference path (`use_kernel = not
training`) — harmless on 100-token probes, fatal on 2,000-token agent prompts. Every carve
and heal probe above was therefore measured on the chunked path; the identity view matched
the full model on that same path, so the comparisons stand, but they will be re-run on the
kernel path (DELEGATE_002) before any number is quoted as the serving number.

**Kernel-path re-measurement (server in eval mode, 2026-09-07 02:2x):** full 16/16 · 5/10 ·
347 mean gen; healed elle-s7 4/10 · 242; unhealed elle-k16 12/16 · 1/10 · 311 — identical to
the chunked-path numbers, token for token on the full model. The carve and heal results
above stand as serving numbers. The specialist's 6/16 on the sums item is the probe's
24-token cap: on ten of sixteen it opened with "The user is asking for…" and was cut before
the number; every direct answer was right.

### DELEGATE_002 — pre-registered (server eval mode, caches 2 GB / 256 blocks)

Same claims as DELEGATE_001 (D1 runs on elle-s7; D2 approved-correct vs 0.94; D3 send-backs
and escalations), rows test 360–379. VOID if > 5% server errors.

**DELEGATE_002 — VOID** (6 Metal OOM in 12 finals with three agents and three view slots
resident). Partial, for the record: of the tasks that finished without error, the healed
specialist's approved answers were checked below; the three non-error blocks were the 8-step
budget running out without `done` — the specialist knows the arithmetic and not the protocol
(HEAL_001 trained on answers). Loop-distillation data is now captured (CONVO.jsonl per task,
Elle commit) for HEAL_002. **DELEGATE_003** pre-registered: two agents, 1 GB caches, only the
s7 view resident; rows test 380–399; same D1–D3; VOID if > 5% server errors.
