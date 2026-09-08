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

### READINESS gate (Elle 3fae959 + clamp fix) — "ready" as a test result

`node electron/native/readiness.cjs static|live [rows] [offset]`. Static gates, no model: G1 the
vector-equilibrium frame (12 unit vertices, 6 antipodal pairs, 24 edges, neighbour cosine ½ ⇒
R = 2r, 8 triangles + 6 squares), G2 isometric transport (relative norm change 1e-15 over 20
random chart transports), G3 winding (φ⁻¹ steps pass, the exact half-turn step is refused),
G4 φ² asymmetry, G5 κ ∈ (0,1), G6 holding loss ≤ e−1 (sup 0.0098 over 2000 strain steps), G9
anti-starvation of the float budget. G7 (the paper's φ⁻¹ settling speedup) is reported PENDING:
no drift-time experiment exists; it is a claim until one does. Live gates: mlx-serve, bridge,
faculty atlas with embeddings, and a delegated micro-run scored on executor rate (D1),
approved-correct (D2), server errors ≤ 5% (D3), reviewer activity (D4). First static run found a
real defect: κ underflowed to exactly 0 under 400 undecayed failures; z is now clamped at the
analytic bound φ²/ρ. All seven required static gates pass; G7 pending.

Paper note (Atlas 2.0 draft): "Rosen ridge" conflates the Rosenbrock ravine (optimisation) with
the Rosen bridge (the channel, rosen-bridge.cjs); G7/G8's concrete numbers are unmeasured here.

**DELEGATE_003 — VOID** (2 `fetch failed` in 7 finals, no OOM: the specialist's steps ran past
the client's 300 s header timeout — thousands of thinking tokens per step at 20 tok/s behind a
second agent and the reviewer). Five non-error finals: all step-budget/κ blocks, no arithmetic
error. Fixes: a delegated step is capped at 2,048 tokens; the profile's step budget is
1,024–4,096 (was up to 8,192); next, the client streams generations so headers arrive at once.

**DELEGATE_004** pre-registered: http client without the 300 s header limit, delegated steps capped at 2,048 tokens, two agents, only the s7 view; rows test 420–439; same D1–D3; VOID if > 5% server errors.

**DELEGATE_004 — truncated at n = 5 by decision.** Zero server errors (the http client holds;
D3 passes), all requests served by elle-s7 (D1 holds), and 5/5 finals were protocol blocks
(3 budget, 1 κ, 1 requirements) with no arithmetic error — the gap HEAL_002 exists to close.
Running the remaining fifteen would have re-measured a known result at the cost of the GPU.

### HEAL_002 data batch — pre-registered (2026-09-07 03:2x)
Sixty held-out rows (test 440–499, seq 1361..1420) run by the COORDINATOR (no specialist
served, executor central), three agents, reviewer on, every exchange captured as CONVO.jsonl.
Purpose: the approved exchanges are the loop-distillation set for HEAL_002 (multi-turn: every
assistant turn). Reported: approved count, approved-correct, exchanges captured, mean turns.

**G7 interim (settling_time.cjs, n = 6):** T_lorentz / T_euclid median 1.000. Uninformative:
the coordinator finishes these tasks in two or three turns, and on a two- or three-point
series both metrics settle at the last point. The settling-time claim needs trajectories of
eight or more turns (long multi-step tasks) before it can be measured either way. Recorded so
the number is not mistaken for a result.

### HEAL_002 data batch — RESULT (2026-09-07 04:0x)
60 held-out rows (test 440–499) run by the coordinator, three agents, reviewer on, zero server
errors: **56 approved, 54 of them correct (0.90 of 60; 0.96 of approved), 4 blocked**, 60 raw
exchanges captured (mean 5.2 messages), 128 generations. The reviewer sent one back. This is
the coordinator's own protocol on record: the loop-distillation set. Export: 56 rows, none
skipped (`specialists/data/sphere7-loop`, sha fe708c5d).

**G7 second interim (n = 54):** T_lorentz / T_euclid median 1.000, mean 0.991, 2% ≤ φ⁻¹. Still
not a test: two-to-five-turn tasks settle at the last point under both metrics. The claim needs
long-horizon tasks; recorded to keep the number honest.

### HEAL_002 — pre-registered (2026-09-07 04:1x)
Loop distillation: LoRA rank 16 (attention + recurrent projections) on the k16 view, teacher =
the full coordinator's top-32 targets over EVERY assistant turn of the 52 training exchanges
(mean 1,809 tokens, 251 trained positions each; a first attempt at a 1,024-token window trained
one position per row and was killed), 200 steps. Served as elle-s7; DELEGATE_005 = 20 rows
(test 500–519), two agents. Claims: **H1** delegated tasks that end in budget/κ blocks < 40%
(DELEGATE_004: 5/5); **H2** approved-and-correct reported against the coordinator's 0.90;
**H3** server errors ≤ 5%. VOID above 5% errors.

### HEAL_002 — two silent deaths, then gradient checkpointing (2026-09-07 04:4x)
The first two HEAL_002 launches (6,144-token window) logged "LoRA on 48 layers × 6 projections:
24.1M trainable params" and nothing else: no traceback, the python process simply gone after a
few minutes. macOS killed it for memory — 1,809-token rows through 48 layers with every layer's
activations held for the backward pass. Fix (Elle cc3fdec): `heal_carve.py` wraps each kept layer
in mlx_lm's `grad_checkpoint` (activations recomputed in the backward pass, default on,
`--no-checkpoint` to opt out) and defaults the window to 3,072 tokens, which still holds the whole
exchange for most rows (mean 1,809). Relaunched: teacher 218 s, unhealed view sums 10/16 (same as
before), **it 1/200 loss 1.564 (ce 0.880, kl 0.684) at 219 s/it** — the first iteration includes
compile/warm-up; steady-state timing recorded when it 2–5 land. If steady state stays near 200 s
the run is ~11 h and the pre-registered 200 steps will be cut to fit (recorded here before, not
after). Note for the next heal: LoRA only on the layers ABOVE the carve gap (43–63) would let the
backward pass stop at layer 43 — roughly half the cost — and is where the adaptation naturally
lives; untested.

### Rosen bridge as the transport — wired, live smoke (2026-09-07 04:5x)
`sphere-lanes.cjs` (Elle d07e082, G8 in 81861df): every hop of the hull is a geodesic lane; a
REGION is sealed on the lane of its hop and posted as `LANE {from,to,tick,path,wire}`; it opens on
that lane at that tick and nowhere else; non-edges have no lane; child atlases derive roots per
sphere. Unit tests 8 + worker round trip with a forged wire; readiness static gate READY 9/9.
**Live smoke through the real agent-bridge (no GPU needed):** task 1421 created, a sphere-7
region sealed on 0→7 (tick 0, 384-byte wire), sent as a directive, read back from the board,
opened → level 7, model elle-s7, via {0→7, tick 0}; task cancelled. The machine's lane root now
exists (`~/.elle/hyper-map/lane-root`, 0600) and lanes.json shows `0->7: 1`. First task to ride a
lane under a real worker: DELEGATE_005 (`run_delegate_005.sh` ends with a transport check that
counts LANE vs plain REGION on the posted tasks).

### G7 — pre-registered (2026-09-07 05:0x)
The settling-time claim has been unmeasurable because every recorded trajectory is two to five
turns (atlas_trajectories.cjs: 55 tasks, mean 2.1 turns, all sphere 7, all locked). New battery:
`gsm8k-in-app.cjs post test N OFFSET K` bundles K consecutive problems into one task worked in
order, one run_code verification per problem, so a trajectory has ≥ K+1 turns. Run
(`run_g7_chain.sh`): 10 tasks × 6 problems, test rows 520–579, worker step cap raised to 24,
coordinator weights (no specialist), reviewer on. Then `settling_time.cjs` over the new
ATLAS.jsonl files. **Claim under test:** median T_lorentz / T_euclid ≤ φ⁻¹ (0.618) on tasks with
≥ 8 turns. **VOID** if fewer than 6 tasks reach 8 turns, or if chain accuracy (all six right)
is below 0.5 (the model was not working the chain). Recorded before the run. Blocked on the GPU
until HEAL_002 finishes.

### Free energy made explicit per sphere; Rosen-HypDoRA built (2026-09-07 00:3x)
**F per sphere.** atlas-state.cjs now computes, every turn a worker has a region, F = KL[q‖p] + ½κε²:
ε = D_k / r_l (Lorentz distance from the sphere centre over its radius), precision π = κ, q = N(m, σ²)
over the recent D_k window (the worker's belief), p = N(0, r_l²) (the sphere prior); KL = ln(r/σ) +
(σ²+m²)/(2r²) − ½. Logged per turn in ATLAS.jsonl and on the worker's final `atlas:` line (Elle,
tests in atlas-state.test.cjs). It measures; it changes nothing yet. The claim to test once chain
tasks run: F falls along a trajectory (F_last < F_first) in most approved tasks and not in blocked
ones. atlas_trajectories.cjs aggregates it per sphere.

**Rosen-HypDoRA (specialists/rosen_adapters.py, `--adapter rosen-hypdora`, served by carve_view
under fine_tune_type rosen-hypdora).** Intra-blanket: Euclidean DoRA on attention q/k/v/o and the
DeltaNet projections with the row norms from the identity ‖w_i + s c_i‖² = n0_i² + 2s⟨w_i,c_i⟩ +
s²‖c_i‖² — one quantized matmul with r columns per step, no per-step dequantisation (the >100 s/step
that killed DoRA in HEAL_001; verified against the dequantised brute force to 2e-3). Bridge: Lorentz
HypDoRA on mlp.gate_proj/down_proj of the first kept layer after each carve gap (the throat across
the missing depth): exp_o → low-rank map on the space-like part → log_o, times a learned per-feature
throat width m_throat (init 1, B = 0 ⇒ exact at step 0). Finding while building it: the per-token
Lorentz normalisation in the formulation (u/‖u‖_L at the origin anchor) collapses exactly to the
Euclidean LoRA direction — asinh cancels — so the magnitude lives per output feature; per-token
geometry needs the v2 radial anchors and boost. Tests: 6 (identity, exactness, gradients incl. the
NaN at B = 0 fixed with a smooth norm, nonlinearity, folding, placement).

### HEAL_003 — pre-registered (2026-09-07 00:3x)
Same data as HEAL_002 (sphere7-loop, 52 exchanges), same k16 view, same 3,072 window and teacher,
100 steps each, two arms trained back to back after HEAL_002 finishes: **A** LoRA rank 16 on the top
21 kept layers (43–63, `--lora-layers 21`); **B** rosen-hypdora rank 16 on the same 21 layers
(bridges on the post-gap layers among them). Report: final train loss, held-out valid pass, sums
16, and — the one that matters — DELEGATE_006 = 20 rows (test 520–539… no: rows 540–559, since
520–579 are G7's) on each arm, H1/H2/H3 as HEAL_002's. **Claim:** B ≥ A on approved-and-correct at
equal or lower protocol-block rate. VOID above 5% server errors; a step time over 2× A's voids B on
cost grounds (the point of the cheap norm is that it is not slower).

### NoRA read; HEAL_003 amended before the run (2026-09-07 02:5x)
Kang, Yue, Zhan, Huang, Liu, "Normalized Low-Rank Adaptation" (arXiv 2608.31036, saved to
research-refs/adapters/). The method: normalise LoRA's down-projection along the rank dimension so
every input coordinate's latent vector has unit norm, Δy = αB·Norm(A)·x; a training constraint
(NoRA) or once at init (NoRA-init). Their argument: with B = 0 the early gradient is αG(A⁽⁰⁾)ᵀ, so
A's column scale sets the early dynamics; their Table 3 shows the rank-dimension norm is the one
that matters (row norm does nothing); Table 5 on Llama-3.2-3B SFT: NoRA average 42.1 vs DoRA 38.3,
and NoRA composed with DoRA lifts DoRA to 41.4; no inference cost. Built as `--nora init|on` for
every adapter type (rosen_adapters.nora_fn; the cheap norm identity is unchanged). **Amendment to
HEAL_003, recorded before it runs:** both arms get `--nora init` so the A/B stays a comparison of the
geometry (LoRA vs Rosen-HypDoRA) with the same normalised start. HEAL_002 (running) has no NoRA and
remains the un-normalised baseline. NoRA "on" (the constraint) is a later arm if init shows a gap.

### What Rosen-HypDoRA still needs to be a result, not a build (2026-09-07 09:2x)
Three claims, three measurements. Only the first is scheduled; the other two are pre-registered here.

**C1 — cost.** "DoRA's magnitude split without DoRA's price." `specialists/bench_adapters.py`
(4 steps, seq 1024, same carve, same rank, grad checkpointing, the same forward the heal trains
through) reports s/step, peak GB and trainable params for lora / cheap-dora / rosen-hypdora /
mlx_lm dora. **Claim:** cheap-dora ≤ 1.15× lora, rosen-hypdora ≤ 1.3× lora, mlx_lm dora ≥ 3× lora.
Runs first in the queue, before the app takes the GPU. Refuted if cheap-dora exceeds 1.3× lora.

**C2 — placement.** The bridge is claimed to belong AT the carve gaps (the throat across the
missing depth). That is an architectural claim and it needs the ablation: `--bridge-layers gap`
vs `all` vs `none` (= cheap-dora alone), same steps, same data. **Claim:** gap ≥ all and gap > none
on held-out valid pass and on the delegated protocol rate. If `all` ≥ `gap`, the gap story is wrong
and the honest finding is "a hyperbolic residual on the MLP helps, position immaterial". If `none`
≥ `gap`, the bridge does nothing and only cheap DoRA survives. ~5.6 h GPU per arm at 100 steps;
scheduled after HEAL_003 reports.

**C3 — generality.** One carve (k16), one dataset (52 loop exchanges), one base. A second carve
depth (k8) at minimum; ideally a second task family from the faculty briefs once those spheres
have approved exchanges. Without C3 this is a single-setting result and must be written as one.

Standing judgement, recorded so it is not revised after the fact: HEAL_003 alone (A vs B, n=1
setting) is NOT a paper. C1 + C2 + one more setting is a short, honest, replicable one.

### HEAL_002 — RESULT (2026-09-07 10:05)
Loop distillation of the coordinator's own protocol into the k16 carved view. 52 multi-turn
exchanges (mean 1,809 tokens, 251 trained positions each), teacher = the full coordinator's top-32
targets at every assistant position, LoRA rank 16 on all 48 kept layers, 3,072-token window,
gradient checkpointing, 200 steps at ~196 s/step, **11h 02m** wall.

| | unhealed k16 view | healed |
|---|---|---|
| in-script sums | 10/16 | **12/16** |
| held-out valid rows | 0/2 | **2/2** |
| train loss | 1.564 (it 1) | 0.094 (it 200), best 0.064 |

Loss fell 17× and both evaluations improved. Read it narrowly: sums is 16 items and valid is 2 rows
— this is evidence the distillation took, not a measurement of the specialist. The measurement is
DELEGATE_005 (20 held-out GSM8K rows through the full board loop), pre-registered above and now
queued. Adapter: `adapters/sphere7-loop-k16` (96 MB, git-ignored; heal.json tracked, data sha
fe708c5d). HEAL_002 carries NO NoRA and stands as the un-normalised baseline for HEAL_003.

### C1 (cost) — first run VOID, rerun scheduled (2026-09-07 10:1x)
`bench_adapters.py` ran four arms in one process. `carve_view` without an adapter SHARES the base
model's layer objects, so arm 1's `linear_to_lora_layers` wrapped them in place and every later arm
measured the previous one's modules: cheap-dora and mlx_lm dora errored outright, and
rosen-hypdora reported 0.7M trainable — the bridge alone, its attention projections already
LoRA-wrapped and therefore skipped. **The only valid number from that run is the LoRA arm: 24.4
s/step, 22.8 GB peak, 10.3M trainable** (48-layer carve, top 21 adapted, rank 16, seq 1024, grad
checkpointing). Everything else is void. Fixed: the bench now copies each kept layer and its
sub-blocks per arm (the same copy the server does when it applies an adapter to a view) and
asserts the base carries no adapter modules before each arm. Rerun is queued at the top of
run_heal_003.sh, where the GPU is free. C1's pre-registered thresholds are unchanged.

### ROUTING_001 — the twelve-faculty routing, measured (2026-09-07 10:4x)
66 briefs written per faculty (gemini-batch-01, 6 each × 11 faculties, sphere 7 excluded — it is the
only sphere with real history) posted to the board while the app was up; then re-assigned offline
with `electron/native/routing-diagnose.cjs`, which ranks all twelve faculties by the same signed
axis coordinate the collapse uses and reports the rank of the intended one.

| | |
|---|---|
| on the board (coordinator, live) | 15/66 = **0.23** |
| offline re-assignment | 27/66 = **0.41** |
| intended faculty ranked FIRST | 38/66 = **0.58** ← the ceiling of the current directions |
| intended in the top 3 | 55/66 = 0.83 |
| held at the centre | 28/66 |
| released onto a WRONG sphere | 11/66 |
| missed onto its own antipode | **0** — the six dualities separate cleanly |

**The bottleneck is the directions, not the gate.** An offline sweep of the three earned-collapse
constants (COLLAPSE × MARGIN × RATIO, 80 settings) tops out at 0.576 — exactly the rank-1 ceiling —
and buys it by releasing everything: at 0.02/0/1.0 the accuracy is 0.576 with 28 briefs on a wrong
sphere and none held. The current 0.06/0.02/1.3 trades 11 of those hits for 28 briefs held at the
centre and only 11 wrong. Since a held brief runs on the coordinator (safe, unspecialised) and a
released one runs on the wrong specialist, **the conservative gate is defensible and loosening it is
not the fix**. Live 0.23 vs offline 0.41 on the same briefs is a separate discrepancy — the live
path assigns through swarm.cjs with the budget partition and a possibly staler atlas; not yet
explained, logged as open.

Three faculties route well (motor_praxis, social_cognition, metacognitive_regulation, 4/6 each);
sensory_perception, language_semiotics, episodic_memory, divergent_synthesis and valuation_salience
score 0/6 live and are the ones dragging the ceiling. Next, in order, all offline and free: (1)
explain live vs offline; (2) per-faculty embeddings of description+keywords scored directly instead
of a signed projection onto six axes; (3) if the ceiling moves above ~0.75, re-run on batch 02 as a
held-out set before believing it.

### AUDIT of the Opus stretch (2026-09-07 13:5x) — three findings stand, two entries corrected
Audited: bench_adapters.py (fb4ded2, 8bc4782), routing-diagnose.cjs (b6f8e07), the HEAL_002 RESULT,
C1 VOID and ROUTING_001 entries, the queue edits. Verified against the code and by reproduction.

**A1 — the C1 "fix" would have errored on every arm (HIGH, caught before it ran).** The rewritten
bench chose `inner = view if hasattr(view, 'layers')` and then did `inner.layers = copies`. On the
mlx_vlm Qwen3.5 top-level Model, `layers` is a read-only @property forwarding to
language_model.model.layers, and mlx.nn.Module.__setattr__ raises "property has no deleter" when
you assign through it (reproduced). Every arm would have hit the arm-level except and reported an
error; the queue would have logged "bench failed (non-fatal)" and moved on with C1 still unmeasured.
Fixed (4696777): the copies are assigned on the DECODER, with an assert that the forward path's
layers ARE the copies. Rerun still queued at the top of HEAL_003.

**A2 — the "live 0.23 vs offline 0.41" discrepancy in ROUTING_001 had a cause, and the entry
guessed the wrong one (HIGH for the record).** faculty-briefs.cjs appends "Self-check before you
finish: <verify>" to every brief before posting; the live coordinator embeds title+brief AS POSTED
(swarm.cjs:358); the diagnose embedded the RAW brief. Re-run with `--posted` (the exact posted
text): **15/66 = 0.227 — identical to live.** So the two numbers were two experiments, and the
appended sentence is what separates them: with it, intended-ranked-first falls 38 → 28 (ceiling
0.58 → 0.42), held rises 28 → 36, wrong-sphere 11 → 15, and one antipode confusion appears. The
verify sentence's verbs (run, check, verify, count, compute) feed the keyword vote toward
motor_praxis / metacognitive / convergent_logic — the three "well-routed" faculties in the live
table are partly that artefact. ROUTING_001's attribution to "the budget partition and a staler
atlas" is withdrawn. **Corrected reading of ROUTING_001:** directions ceiling 0.58 on the task text
alone; 0.42 on what was actually routed. Fix in flight: post the raw brief and deliver the verify
sentence as the coordinator's first directive (the nudge path), so routing sees only the task.

**A3 — DELEGATE_005 stalled for 3 h (HIGH, operational).** The 20 tasks were posted and placed
(LANE directives) at 10:48 and none was claimed. The app's own mlx-serve supervisor, finding the
external server on the port, logged "server exited (1) → external server active → healthy →
down — ELLE_OLLAMA_URL restored to Ollama" and the app then died; the server released every hold.
Relaunched at 13:5x with ELLE_MLX_SERVE=0 (supervisor off; ELLE_OLLAMA_URL fixed) and
run_delegate.sh patched the same way for DELEGATE_006A/B. Not Opus's edit — it was my runner —
but it is what the queue was actually doing while the audit ran.

Minor: the first (void) bench wrote to Elle/elle-worker/… (wrong --out); moved to
runs/bench_adapters.void1.json and the stray tree removed. adapter_config.json for HEAL_002 was
untracked while heal.json was committed — committed. runs/*.log is git-ignored, so the copied heal
log is on disk but not in git; heal.json carries the full history, which is the record. The
routing-diagnose `ensure({})` call CAN rebuild and save the atlas under a running app if the map
has grown ≥ REBUILD_GROWTH since the build — it did not this time (atlas mtime unchanged), but the
diagnose should take a read-only path; noted, not yet changed. Everything else in the three
entries checked out against heal.json, the void bench JSON and the board.

### G7 — chain battery RESULT (2026-09-07 10:47): VOID on accuracy, and negative on settling
10 chain tasks × 6 problems from test 520. done 10, whole-chain correct 4 (0.40), refused 3;
individual problems 35/60. Pre-registration: VOID below 0.5 chain accuracy — **VOID**. And on the
65 trajectories it did produce, T_lorentz/T_euclid median 1.000, mean 0.992, 2% ≤ φ⁻¹: **no Lorentz
settling speedup is visible on 6-problem chains** either. Read both together: the chains were too
hard for the coordinator at max 8 steps (3 refusals, budget blocks) AND, on the trajectories that
exist, the settling claim is flat. A cleaner G7 needs longer step budgets so the chains complete,
and then the settling number stands on its own. Not scheduled yet; it competes with HEAL_003 for
the GPU.

### DELEGATE_005 — first attempt VOID at 2 rows: server Metal OOM (2026-09-07 13:50)
Rows 1498/1499 blocked in under two minutes with `[METAL] Insufficient Memory` from mlx-serve while
elle-s7 filled its prompt cache. Cause: **a second full copy of the coordinator was resident in
Ollama** (`elle:latest`, 17.4 GB GGUF Q4_K_M) — loaded this morning when the first DELEGATE_005 app's
supervisor "restored ELLE_OLLAMA_URL to Ollama" and its workers hit it — sharing unified memory with
mlx-serve's 16 GB (wired 34.5 of 48 GB). Unloaded (wired → 4.1 GB), the four affected rows
(1498–1501: two OOM-blocked, two claimed by the dead app) reopened on the board with an operator
note, bridge restarted, app relaunched with the supervisor off. No row ran a model step before the
reopen, so the 20-row measurement stands as posted. Both runners now unload anything Ollama holds
before serving.

### DELEGATE_005 — second attempt VOID at 4 rows; third attempt running (2026-09-07 14:0x)
With Ollama unloaded the rows still OOM'd, and a single 48-token request against elle-s7 with the
app STOPPED also OOM'd while the serving process sat at 40 GB wired. The process itself was holding
~24 GB of dead allocations left by the earlier failed requests (MLX never released them after the
Metal OOMs). Restarted mlx-serve fresh: wired 3.5 GB → one request to the healed view answers in
4.5 s, wired 17.7 GB (weights + caches, normal). Also new in the healed view's log: "batch_generate
failed (division by zero); falling back to sequential" — the unhealed view (DELEGATE_004) never fell
back, so the adapter-bearing view takes the sequential path; not yet explained, logged as open.
Rows 1498–1501 reopened a second time (no model step ran on any of them), app relaunched with ONE
worker on the fresh server. Rule for every serve step from now: fresh server process, Ollama
empty, one worker on an adapter-bearing view until the batch path is fixed.

### DELEGATE_005 direct + the batch path fixed (2026-09-07 15:1x)
**Direct eval of the healed elle-s7 on the DELEGATE_005 rows (test 500–519), no board:** 15/20 =
**0.75**, 0 server errors, 0 no-number, mean 457 reply tokens, 23.8 s/row (~28 tok/s: the 12 GB
of kept weights per token at this machine's bandwidth). H2's comparator is the coordinator's 0.90
on the same protocol; the unhealed k16 view was 5/10 on sums. The board-loop run (protocol
dimension) restarts on top of this.

**The batch path.** mlx_lm's BatchGenerator.stats() divides prompt_tokens by prompt_time in its
`finally`; a fully prefix-cached prompt has prompt_time 0 → ZeroDivisionError AFTER generation →
mlx-serve dropped the batch and fell back to sequential (the "division by zero" line on every
adapter-view run). Guarded (patches/mlx_lm_batch_tps_guard.py, re-applied by run.sh). Measured on
elle-s7, 200-token replies: 1 stream 10.6 s, 4 concurrent 13.4 s → **3.2× throughput**. Two workers
are back on for the board loop; the direct eval will use concurrency next.

### RESULTS 2026-09-07 17:0x — C1, DELEGATE_005 (board loop), and the open blocker
**C1 cost (bench_adapters.json, valid run: per-arm copies, forward-path assert):** 48-layer carve,
top 21 adapted, rank 16, seq 1024, grad checkpointing, 4 steps, s/step median:

| arm | s/step | × LoRA | peak GB | trainable |
|---|---|---|---|---|
| LoRA (mlx_lm) | 28.3 | 1.00 | 22.8 | 10.3M |
| cheap DoRA (ours) | 53.7 | **1.90** | 22.8 | 10.7M |
| Rosen-HypDoRA (cheap DoRA + bridge) | 75.6 | **2.67** | 22.8 | 11.4M |
| DoRA (mlx_lm, dequantises per step) | 119.4 | **4.22** | 22.8 | 10.7M |

Pre-registered thresholds: cheap-dora ≤ 1.15× **REFUTED** (1.90×); rosen ≤ 1.3× **REFUTED** (2.67×);
mlx_lm dora ≥ 3× confirmed (4.22×). Honest reading: the row-norm identity halves DoRA's cost
(119 → 54 s) but it is not "LoRA's price" — the quantized matmul of A's r columns and its backward
through every adapted projection cost ~25 s/step on their own. The bridge adds another ~22 s. The
"DoRA without DoRA's price" sentence is withdrawn; the defensible one is "DoRA at 2.2× less than the
reference implementation on 4-bit weights, no dequantisation". Memory is identical across arms.

**DELEGATE_005, board loop, healed elle-s7 (test 500–519).** Third attempt on the batched server
with two workers: rows 1499–1506 **approved, 8/8 correct by hand against gold**; row 1498 blocked
on the 8-step budget (protocol block); rows 1507–1517 blocked on a server Metal OOM again — 11 rows
void. On the 9 valid rows: **H1 protocol-block rate 1/9 = 11%** (DELEGATE_004: 5/5 = 100%) — met;
**H2 approved-and-correct 8/9 = 0.89** vs the coordinator's 0.90 — parity at n = 9; H3 server
errors 11/20 — the run is VOID by its own rule, so H1/H2 are reported as the partial they are. The
direct eval on the same 20 rows: 15/20 = 0.75, 0 errors. The loop (tools, run_code verification,
reviewer) beats the bare model on the rows it completes. gsm8k-in-app's grader scored the run
correct 0 / refused 20 / unplaced 20: it does not survive rows that were reopened by editing the
board — grader bug, logged; the hand grade above is the record.

**OPEN BLOCKER:** the serving process accumulates memory across board-loop requests on the adapter
view and OOMs after ~8–9 long tasks even with Ollama empty (the direct eval's 20 short sequential
requests never did). Dead allocations are never released after the first OOM. Not yet root-caused
(candidates: per-request cache_store of 16k-token DeltaNet/KV states on the view's pool escaping
MLX_CACHE_MAX_GB; batch-path buffers; the LoRA fp32 intermediates at 16k × 2 streams). Mitigation
for the next board run: restart the server every 8 tasks, or ELLE_SWARM_MAX_STEPS lower, until the
health `cache.bytes` per tag is read across a run. HEAL_003 arm A (lora21, NoRA-init) started
15:58 local; arm B follows; DELEGATE_006A/B will each hit this unless the restart is in place —
run_delegate.sh should be given a per-8-tasks server restart before they run.

### HEAL_003 — BOTH ARMS VOID, causes reproduced (2026-09-08 06:4x)
Arm A (LoRA r16, top 21 layers, NoRA-init): loss 1.56 → 0.41 but the healed view fell to **sums
1/16** (from 10/16 unhealed); direct eval on test 540–559: 2/20. Cause: NoRA-init raises the initial
‖x·A‖ from 2.6 to 79 (31×, measured); with mlx_lm's LoRA scale 20 and HEAL_002's learning rate the
gradient on B is 31× larger and the view is destroyed, not healed. NoRA's paper tunes α and the
rate around it; the amendment bolted it onto unchanged ones. Arm B (rosen-hypdora, NoRA-init):
**loss NaN from step 1**. Cause: the bridge's lift exp_o takes sinh of the MLP input's norm — 71.6
after RMSNorm — which is inf in float32 above ~70 (finite at 30, inf at 70, measured). v1 had no
curvature scale on the lift; HypLoRA has one. The bench never checked the loss for NaN, so it
timed a broken adapter. Fixes (not yet run): a curvature scale on the lift (lift x/√d, ‖·‖ ≈ 1),
learning rate divided by the NoRA gain (or NoRA off), and a NaN + step-0 exactness check in the
bench before any arm trains. HEAL_002 (plain LoRA, all 48 layers, no NoRA) remains the only good
adapter. DELEGATE_006A/B are void with their arms; the watchdog worked (OOM rows retried).

### The breathing window implemented from Stewart's StrataKV benchmarks (2026-09-08 07:0x)
Elle/benchmarks/ (Stewart, live against mlx-serve): tailored preamble in a shared namespace,
surprisal-classified intake, exhale of the fringe, 2% leak, invariant pinning — System B kept the
key and the sha at 276 prefilled tokens vs System A's 1,947, 4.6 s vs 9.1 s. The server already had
namespaces, /api/cache/evict and the per-token surprisal in the reply; the policy is now in the
worker loop (Elle a4fbcbc): tiers by κ_intake = σ(2 − s̄) on the reply that read the observation,
Tier 3 (< 1/π) exhaled to a digest once outside the last two exchanges, Tier 1 invariants pinned,
2% leak of the lowest-κ Tier 2 per exhale; exhaled/leaked counts and the coherence phase space
(K = Σκ, dκ, d²κ, regime, runaway) logged per turn. Not yet measured on a board run — the next
board run reports exhaled/leaked in ATLAS.jsonl and whether the ~8-task OOM moves. Stewart's
DeepResearch gate suite (G1–G8 numeric, standalone) and the lemniscate ledger simulation both pass
as written; their constants match atlas-state where they overlap (κ ∈ (0,1), holding ≤ e−1, φ²).
Not implemented from the paper: the Jitterbug ejection (κ_break ≥ 0.75), tailored tool
allocation (the catalog is one fixed text), PLV 2:1 on real trajectories, the G8 margin gate.

### The paper's remaining mechanisms, implemented (2026-09-08 08:xx, Elle 3848aa4)
- **Jitterbug pulse (§3.3).** Trigger made operational: shock = 1 − κ_intake of the coordinator's own
  review turn (mean surprisal of the reply that read the submission); κ_break = 0.75 ⇔ κ_intake ≤ 0.25.
  On a shocked rejection the centre ejects for that task: a JITTERBUG directive on the task, the lane
  ring goes direct for non-kissing pairs (handoffs bypass the centre), the coordinator works it as the
  13th sphere on the task's axis. Approval of the pulsed task collapses it and deposits the submission's
  invariants (bracketed keys, shas) into the root cache (jitterbug.json, last 24), which every later
  worker carries pinned (Tier 1 in the breathing window) and the reviewer sees. Not yet fired live.
- **Tailored tool allocation (§6.6).** Core four always; web tools when the brief asks for research;
  the cloud catalog only when the brief names one of its tools; faculty defaults. The worker's
  catalog is filtered and full/tailored char counts logged per task (ATLAS.jsonl anchor). The paper's
  49.6% latency claim is measured by the shared-prefix prefill delta on the next board run.
- **Phase-Eight PLV (G7).** Hilbert phase of the run's depth series vs the φ⁻¹ generation phase,
  PLV_2:1 with a 500-shift surrogate p; readiness G7b over the last 200 trajectories, pending below
  64 turns. Synthetic lock/drift/noise reproduce the paper's separation; the live number is whatever
  the trajectories say.
- **Post-quantum margin (G8).** q lane messages on the board × Ω (the ratchet's skipped-key store,
  2000) × 2⁻¹²⁸ ≤ 2⁻⁶⁴; readiness G8b.
- **The eight composite gates.** readiness composes PG1–PG8 from measured ids (PG4 = κ∈(0,1) ∧ the
  live phase-space gate: reserve, no fall below the line, Φ ≤ 0.30) and prints ATLAS-CONFORMANT k/8.
- **Heal fixes for HEAL_004.** The bridge lift is curvature-scaled (learned √c, starts 1/√d; finite at
  ‖x‖ = 300); NoRA's √(3d/r) gain compensated in the LoRA scale for every adapter type and in the
  throat width; the bench asserts step-0 exactness and a finite loss per arm before timing.
  HEAL_004 = HEAL_003's design rerun with these; not scheduled until the review of 3848aa4 lands.

### G7 (Phase-Eight) on the real trajectories — NEGATIVE (2026-09-08 07:4x)
readiness G7b over the last 183 task trajectories (528 turns with a depth reading): **PLV_2:1 = 0.020,
p = 0.18**. The paper's 0.990 (p = 0.001) is the synthetic Phase-Eight benchmark; the live runs show
no 2:1 lock between the φ⁻¹ generation rhythm and the depth wander. Read with G7-settling (median
ratio 1.000) this is the second flat result for the torus-time claims on 2–8-turn tasks; whether
longer runs change it is what the breathing window and the chain battery at a higher step budget
would show. Not a bug in the measurement: synthetic lock/drift/noise separate as the paper's own
test does (plv.test.cjs). PS (the phase-space gate) is pending until a board run logs K.
HEAL_004 (both arms with the fixes, DELEGATE_007A/B) launched 07:41; the bench's exactness and
finite-loss asserts gate the arms before any step trains.
