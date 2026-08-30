# Project: Target B - Dual-Router Engine & Local Sovereign Swarm Protocol

## Architecture
`elle-worker` integrates an edge-native Dual-Router Architecture and Local Sovereign Swarm Protocol on Cloudflare Workers (`workerd`) with D1 SQLite, Vectorize, and KV storage.

Target B implements four core pillars:
1. **Dual-Router Task Allocator & Engine Selection (`src/router.ts`, `src/llm.ts`, `src/connect-sandbox.ts`)**: Ingress query classifier and in-loop dynamic routing allocating tasks between Cloud Frontier (Gemini 2.5 Pro/Flash) and Local Sovereign Swarm (Qwen-Coder via PQC session bus). Transparent fail-open demotion to hosted reasoning on sandbox unavailability.
2. **Stateless KV Staging Layer (`src/kv-staging.ts`)**: High-throughput write-through staging buffer backed by Cloudflare KV (`env.SESSIONS`) with 5-minute TTL (300s) protecting D1 single-writer limits. Atomically flushes staged entries into D1 in batches ($\le 50$ statements) and purges committed keys.
3. **INGEST_QUEUE Batching & Back-Pressure (`src/ingest-queue.ts`)**: Micro-batching queue for `/api/sandbox-bus/submit` and inbound ingest payloads. Batches up to 10 items or 500ms window, provides active back-pressure rejection at depth 100, and integrates with `src/ingest-gate.ts` deduplication.
4. **Zero-Regression Full Test Verification**: 100% pass across all 160+ test files and 2,190+ tests, clean `npx tsc --noEmit`, and comprehensive 4-tier unit and E2E test suites for all new modules.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| 1 | Dual-Router Ingress Classifier | Classifies incoming tasks by Section 4.2 workload allocation matrix (Search/Facts $\to$ Cloud Frontier, D1/Vectorize $\to$ Cloud Frontier, Code/AST/Duplex $\to$ Local Sovereign). | M1 | Survey / `src/router.ts` |
| 2 | Resilient Local Engine Selection & Demotion | Integrates classifier into `runRouter` ingress and step loop. Verifies `sandboxConfigured(env)` and `pathOpen(env)`; demotes to `'reasoning'` with telemetry note on offline/failure; never throws. | M1 | Survey / `src/router.ts` |
| 3 | Stateless KV Staging Layer | `src/kv-staging.ts` write-through buffer `stageEntry(env, key, payload)` with 5-minute TTL (300s) in `env.SESSIONS`. | M2 | Survey / `src/kv-staging.ts` |
| 4 | KV Staged Batch D1 Flusher | `src/kv-staging.ts` `flushStaged(env)` draining pending staged entries via `env.DB.batch()` chunked to $\le 50$ statements and purging committed keys; idempotent on empty; never throws. | M2 | Survey / `src/kv-staging.ts` |
| 5 | INGEST_QUEUE Batch Accumulator | `src/ingest-queue.ts` `enqueue(env, payload)` and `drain(env)` accumulating items up to batch size 10 or 500ms time window before single D1 batch write. | M3 | Survey / `src/ingest-queue.ts` |
| 6 | Queue Back-Pressure Limiter | Rejects inbound submissions with clear error when queue depth exceeds max depth 100. | M3 | Survey / `src/ingest-queue.ts` |
| 7 | Ingest Deduplication Gate Integration | Integrates with `src/ingest-gate.ts` dedup logic (`normalizeTitle`, `idempotencyKey`) dropping duplicate payloads before D1 persistence. | M3 | Survey / `src/ingest-queue.ts` |
| 8 | Full Regression & 4-Tier Test Suite Verification | All 160+ test files pass, 2,190+ tests pass, `npx tsc --noEmit` exits 0, comprehensive unit and E2E suites verify all acceptance criteria. | M4 | Survey / Test Track |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Dual-Router Classifier & Engine Selection | Implement `classifyEngineSelection` and integrate into `runRouter` in `src/router.ts`. Support Section 4.2 domains, local availability check, transparent demotion, and comprehensive unit tests. | None | DONE |
| M2 | Stateless KV Staging Layer | Implement `src/kv-staging.ts` (`stageEntry`, `flushStaged`, `getStagedEntry`, `clearStagedEntry`), 5-minute TTL, D1 batch flusher chunked to $\le 50$, fail-safe handling, and unit tests. | None | DONE |
| M3 | INGEST_QUEUE Batching & Back-Pressure | Implement `src/ingest-queue.ts` (`enqueue`, `drain`, `getQueueStats`, `resetQueue`), batch threshold (10), time window (500ms), backpressure (100), dedup gate integration, and unit tests. | M2 | IN_PROGRESS |
| M4 | Final Acceptance & Regression Verification | Verify 100% passing test suite across all 160+ test files and 2,190+ tests, clean `tsc --noEmit`, Tier 1-4 E2E test verification, Tier 5 Challenger coverage hardening, and Forensic Integrity Audit. | M1, M2, M3 | PLANNED |

---

## Interface Contracts

### `src/router.ts` (Dual-Router Classifier & Selection)
- `export function classifyEngineSelection(question: string, scope?: Scope, opts?: { prefer?: 'local'; surface?: Surface }, env?: Env): Engine`
  - Invariant: Evaluates prompt domains against Section 4.2. Returns `'local'` for code authoring, AST refactoring, and duplex tasks if local lane is open; otherwise returns appropriate cloud engine (`'reasoning'` or `'research'`).
  - Demotion guarantee: If `'local'` is selected but `env` indicates sandbox is unconfigured or path is closed, demotes to `'reasoning'`.
  - Never throws on null/broken env or empty prompt.

### `src/kv-staging.ts` (Stateless KV Staging Buffer)
- `export async function stageEntry<T = unknown>(env: Env, key: string, payload: T, opts?: { ttlSeconds?: number; prefix?: string }): Promise<{ ok: boolean; key: string; error?: string }>`
  - Invariant: Stores payload in `env.SESSIONS` with `{ expirationTtl: 300 }`.
- `export async function flushStaged(env: Env, opts?: { prefix?: string; batchSize?: number }): Promise<{ flushed: number; errors: number; status: 'ok' | 'partial' | 'error'; details?: string[] }>`
  - Invariant: Drains staged entries into D1 via `env.DB.batch()` chunked to $\le 50$ statements and deletes committed keys from KV. Idempotent on empty queue. Returns error status without throwing on D1/KV failure.

### `src/ingest-queue.ts` (INGEST_QUEUE Batching)
- `export async function enqueue<T = unknown>(env: Env, payload: T, opts?: IngestQueueOptions): Promise<EnqueueResult>`
  - Invariant: Enqueues payload into micro-batch buffer. Automatically drains when batch count reaches 10 or 500ms window expires. Rejects when depth $> 100$. Integrates with `ingest-gate.ts` deduplication.
- `export async function drain(env: Env, opts?: DrainOptions): Promise<DrainResult>`
  - Invariant: Immediately drains all enqueued items into D1 in a single transaction.

---

## Code Layout
- `src/router.ts`: Router ReAct loop, engine classification, step budget enforcement, tool execution.
- `src/kv-staging.ts`: Stateless KV write-through staging buffer and D1 batch flusher.
- `src/ingest-queue.ts`: Micro-batching ingest queue with back-pressure and dedup integration.
- `src/connect-sandbox.ts`, `src/session-bus.ts`: Local sovereign sandbox connectivity, PQC bus envelopes.
- `src/ingest-gate.ts`: Ingest payload deduplication and integrity gates.
- `src/kv-staging.test.ts`: Unit test suite for KV staging layer.
- `src/ingest-queue.test.ts`: Unit test suite for INGEST_QUEUE batching.
- `src/dual-router-classifier.test.ts`: Unit test suite for dual-router classifier and engine selection.
- `test/e2e/`: Tiers 1-4 requirement-driven end-to-end test suites.
- `test/dual-router-classifier.spec.ts`: E2E spec for dual router classifier.
- `test/kv-staging.spec.ts`: E2E spec for KV staging.
- `test/ingest-queue.spec.ts`: E2E spec for ingest queue.
- `test/target-b-e2e.spec.ts`: End-to-end integration suite for Target B.
