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
