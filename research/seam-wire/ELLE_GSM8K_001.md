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
