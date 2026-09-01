# TOKEN OPERATOR SPEC — 𝒯

Shipped alongside `src/token-operator.ts`, `src/token-operator.test.ts`. Not design-only —
code and tests exist and pass (`npx vitest run src/token-operator.test.ts` → 16/16;
`npx tsc --noEmit` → clean; full suite → 184 files / 2578 passed at the time of writing).

Evidence discipline follows `docs/PREDICTION_OPERATOR_SPEC.md`: `[MEASURED]` = a command
was run and its output read in this session; `[READ]` = read out of the tree, not executed;
`[RESEARCH]` = an external, citable claim, not verified against a primary source in this
session and inheriting that caveat.

## 0. What was already shipped, and what this is NOT redoing

Before writing anything, this session read `docs/PREDICTION_OPERATOR_SPEC.md` and
`src/predict.ts` (the shipped 𝒫) to check whether the requested "token prediction
operator" was an extension of it. `[MEASURED]` It is not, and should not pretend to be:

- 𝒫 (`src/predict.ts`) forecasts the **next point of a numeric time series** on the
  cognitive manifold (ℍⁿ×𝕋ᵈ) and scores itself against a residual. It has no notion of
  tokens, latency, or energy.
- The request — TTFT, inter-token latency, tool calls, step count, energy, all logged,
  deterministic, computed outside the worker, handed back read-only — is a **telemetry/
  instrumentation operator over a generation run**, not a forecaster. "Based off the
  prediction operator" is honored here as *discipline carried over* (spec before code,
  evidence-tagged, falsifiable/checkable claims, explicit unknowns), not as shared math —
  there is no shared math, and inventing some to force a resemblance would be the wrong
  kind of reuse.

What **is** direct reuse, because the shipped code already does the job:

- **Step count and tool-call logging already exist.** `[MEASURED]` `src/events.ts` —
  `elle_events`, one append-only table, one dispatch point in the router loop
  (`step_index`, `kind IN ('tool_call','answer',...)`, `tool`, `duration_ms`). 𝒯 does
  **not** build a second tool-call ledger. It cross-references the existing one by
  `run_id` and reports agreement or disagreement (`src/token-operator.ts`
  `ingestTokenOperatorRun`'s crosscheck block) — this is the literal answer to "before we
  waste time and compute redoing math I just did."
- **The read-only, computed-outside-the-worker pattern already exists and is tested.**
  `[MEASURED]` `src/atlas.ts` — the memory graph is computed on a separate on-device repo,
  pushed through a service-key-gated `POST /api/atlas/ingest`, and the LLM's entire
  surface onto it (`atlasRoute`) is read-only by construction (no snapshot/edge/point
  parameter exists in `AtlasToolInput`, checked directly in `atlas.test.ts`). `src/
  token-operator.ts` mirrors this file near line-for-line: same R2+D1 split, same
  content-addressing by hash, same read-only tool-input-shape guarantee, same
  service-key ingest gate (`isServiceRequest`, `[MEASURED]` `src/index.ts:474-478`).

## 1. Why the compute boundary is not a design choice — it's a platform fact

`[MEASURED]` `grep -n "stream" src/llm.ts` → `src/llm.ts:548` `stream: false`. Every LLM
call this worker makes today awaits the full completion; workerd never observes a
first-token timestamp or an inter-token gap, because it never receives tokens
incrementally in the first place. TTFT and inter-token latency are **not observable**
inside this worker's current code path regardless of how 𝒯 is written.

Energy is a harder wall, not a code-path gap: `workerd` runs as a V8 isolate on
Cloudflare's edge. There is no syscall surface to Intel RAPL (`/sys/class/powercap/
intel-rapl`), no `powermetrics`, no `nvidia-smi --query-gpu=power.draw` — no code
running inside this worker can ever read a watt, on any request, under any design. This
is why the request specifies "computed in the Elle workbench/ide" and "given back...
read only": that phrasing describes the only architecture that is physically possible,
not a preference. `src/token-operator.ts`'s header states this explicitly rather than
leaving it implicit, because the reasoning is load-bearing for every design choice below
(no partial-computation fallback inside the worker is attempted; none is possible).

**Scope note.** The Elle workbench/IDE that would run this instrumentation is a
separate repository (`CLAUDE.md` names `../Elle`) outside `sbarteau2022/elle-worker`,
which is the only repository this session has access to. This spec and the shipped code
define **elle-worker's half of the contract** — the record shape, validation, storage,
and read surface. Porting the matching capture code into the workbench repo is
out-of-scope for this session and is called out here rather than silently skipped.

## 2. The metric definitions — grounded, not invented

`[RESEARCH]` These are standard LLM-serving metrics, not new definitions:

- **TTFT (time to first token)** — wall-clock time from request submission to the first
  generated token. Standard in vLLM's own benchmarking suite and in serving-systems
  literature, e.g. Zhong et al., *DistServe: Disaggregating Prefill and Decoding for
  Goodput-optimized Large Language Model Serving* (OSDI 2024), which treats TTFT and
  TPOT as the two metrics serving systems are actually judged on.
- **TPOT / inter-token latency (ITL)** — time per output token after the first. The same
  literature warns against collapsing this to one mean: tail latency (p95/p99) is where
  serving-system regressions actually show up, because a few slow tokens dominate
  perceived responsiveness even when the mean looks fine. `src/token-operator.ts`'s
  `InterTokenStats` therefore carries `mean_ms, p50_ms, p95_ms, p99_ms, max_ms,
  stddev_ms`, not a bare average — and rejects a record where the percentiles are not
  monotone (`p50 <= p95 <= p99 <= max`), the cheapest possible corruption check.
- **Energy per phase** — `[RESEARCH]` Luccioni, Jernite, Strubell, *Power Hungry
  Processing: Watts Driving the Cost of AI Deployment?* (FAccT 2024) measures inference
  energy by sampling hardware power draw and integrating over the request window; the
  CodeCarbon/ML CO2 Impact tooling family uses the same sample-and-integrate approach
  (trapezoidal integration of watts over elapsed seconds → joules). 𝒯 adopts the same
  shape — the workbench is expected to sample power and integrate per phase
  (TTFT / generation / tool-calls), not report a single opaque number — but 𝒯 does not
  re-run that integration itself (§3). This whole paragraph is `[RESEARCH]`: none of
  these sources were re-verified against a primary text in this session, matching the
  caveat `docs/PREDICTION_OPERATOR_SPEC.md` §7.4 already put on its own literature
  references.

## 3. Determinism — what it actually means here

𝒫's causality invariant (I1, `docs/PREDICTION_OPERATOR_SPEC.md` §2.3) does not transfer:
𝒯 has no "future" to leak from, because it is not a forecaster. The determinism this
task actually asked for is narrower and is what got built:

- **Content addressing.** The workbench computes a hash over its own canonical JSON
  (`record.hash`, 16 lowercase hex — the same address form `atlas.ts` already uses and
  `getAtlasByHash`'s `HASH_RE` already validates against). The same run ingested twice
  lands at the same R2 key; any bit-level change to the record changes the address. This
  is tamper-evidence, not re-derivation.
- **𝒯 does not recompute TTFT/ITL/energy from raw samples.** Redoing that arithmetic
  server-side would be exactly the wasted, duplicated compute the task asked to avoid —
  the workbench already computed it once, on the only hardware that can see it (§1).
  `validRecord` in `src/token-operator.ts` checks **internal consistency** instead:
  finite/non-negative numerics, monotone percentiles, and `energy_j.total_j` agreeing
  with the sum of its own parts to float tolerance. A workbench bug that reports a total
  disagreeing with its own components is caught at the boundary and the whole record is
  rejected (`token-operator.test.ts`: "rejects an energy total that disagrees with its
  own components").
- **What IS independently re-derived: step count and tool-call count**, because
  elle-worker already has an authoritative source for both (`elle_events`, §0). This is
  the one place 𝒯 can check the workbench's arithmetic against ground truth it owns, and
  it does — `ingestTokenOperatorRun` queries `elle_events` by `run_id` and returns
  `{events_steps, events_tool_calls, matched}` alongside the ingest result, never
  silently trusting the submitted `steps`/`tool_calls.length`.

## 4. What was built

| File | Role |
|---|---|
| `src/token-operator.ts` | Schema (`elle_token_operator_runs`, append-only via `token_op_no_update`/`token_op_no_delete` triggers — same shape as `duplex.ts`'s `elle_duplex_ledger` guard), `validRecord`, `ingestTokenOperatorRun`, `getTokenOperatorRun`/`listTokenOperatorRuns`, `tokenOperatorRoute` |
| `src/token-operator.test.ts` | 16 tests: storage round-trip, four rejection cases (malformed shape, bad hash, non-monotone percentiles, inconsistent energy total), three crosscheck cases (match / mismatch / no run_id), all four read modes, and a structural read-only-surface test mirroring `atlas.test.ts`'s |
| `src/router.ts` | `token_operator` tool registered under "Provenance & self-audit" next to `provenance`, dispatch wired |
| `src/index.ts` | `POST /api/token-operator/ingest` (service-key gated, mirrors `/api/atlas/ingest`), `GET /api/token-operator/{latest,recent,at}` (authenticated reads, mirror `/api/atlas/{latest,history,at}`) |

Record shape (`TokenOperatorRecord`): `hash`, `version`, optional `run_id` (correlates to
`elle_events`), `model`, `provider`, `created_at`, `ttft_ms`, `inter_token{n,mean_ms,
p50_ms,p95_ms,p99_ms,max_ms,stddev_ms}`, `steps`, `tool_calls[]{tool,started_at_ms,
duration_ms}`, `energy_j{ttft_j,generation_j,tool_calls_j,total_j}`, `host{device_id,os}`.

## 5. What this spec does not answer

Stated rather than papered over, per the repo's own convention (`PREDICTION_OPERATOR_
SPEC.md` §7):

1. **No workbench-side capture code exists yet.** This session shipped elle-worker's
   half of the contract only (§1 scope note). Nothing has ever actually POSTed to
   `/api/token-operator/ingest` outside the test's fakes — `[MEASURED]` `d1Rows`/`r2` in
   `token-operator.test.ts` are in-memory fakes, not a real D1/R2 round trip.
2. **The energy-integration method is specified by reference (§2), not pinned.** Whether
   the workbench should sample power at a fixed rate, what rate, and trapezoidal vs.
   rectangular integration are workbench-repo decisions this spec does not make.
3. **`run_id` correlation is opportunistic, not enforced.** A workbench-only generation
   with no corresponding router run has `run_id` unset and `crosscheck` reports `null`
   for all three fields — by design (a run that never went through `elle_events` has
   nothing to check against), but it means an unset `run_id` and a genuinely-uncheckable
   record currently look identical. Nothing here treats "no run_id" as a rejection
   reason; it may deserve to be, once real ingest volume exists to judge from.
4. **No dashboard/visualization was built.** `GET /api/token-operator/{latest,recent,
   at}` exist for one to consume; none exists in this session's scope.
