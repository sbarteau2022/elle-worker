# Test Infrastructure Specification: `elle-worker` Target B

**System Target:** `elle-worker` (Cloudflare Workers, D1 SQLite, Vectorize, Cloudflare KV, Workers AI, Sovereign Local Swarm)  
**Target B:** Dual-Router Engine & Local Sovereign Swarm Protocol  
**Document Classification:** Test Architecture, Test Infrastructure & Feature Matrix  

---

## 1. Test Philosophy & Architecture

The test suite for `elle-worker` Target B enforces a strict **opaque-box, requirement-driven, 4-tier testing methodology**. The testing infrastructure verifies system invariants, mathematical properties, and distributed state transitions across both Cloud Frontier engines and Local Sovereign execution lanes without polluting runtime isolates.

### Testing Methodology:
1. **Tier 1: Feature Coverage (Isolation):** Each feature is exercised across $\ge 5$ distinct test cases covering primary happy paths, interface contracts, and core domain classifications.
2. **Tier 2: Boundary & Corner Cases:** Rigorous verification under stress conditions including empty payloads, buffer saturation, expired TTLs, disconnected sandbox sockets, broken D1/KV fail-safes, and protocol repair loops.
3. **Tier 3: Cross-Feature Combinations:** Pairwise and multi-subsystem integration flows verifying data pipelines across KV staging, Ingest Queue buffering, Ingest Gate deduplication, and Dual-Router demotion cascades.
4. **Tier 4: Real-World Application Workloads:** High-throughput end-to-end scenarios simulating 50 concurrent sovereign agents, AST code refactoring task allocations, and multi-turn duplex voice/text sessions.

---

## 2. Target B Feature Inventory & Test Mapping

| # | Feature | Requirement Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Workloads) | Test Suite File |
|---|---|---|:---:|:---:|:---:|:---:|---|
| **R1** | **Dual-Router Classifier & Engine Selection** | `ORIGINAL_REQUEST §R1`<br>`DUAL_ROUTER_SPEC §4.2` | 8 | 9 | ✓ | ✓ | `test/dual-router-classifier.spec.ts` |
| **R2** | **Stateless KV Staging Layer** | `ORIGINAL_REQUEST §R2`<br>`SWARM_INGESTION_PLAN §3.3` | 6 | 7 | ✓ | ✓ | `test/kv-staging.spec.ts` |
| **R3** | **INGEST_QUEUE Batching & Backpressure** | `ORIGINAL_REQUEST §R3`<br>`SWARM_INGESTION_PLAN §3.4` | 5 | 5 | ✓ | ✓ | `test/ingest-queue.spec.ts` |
| **E2E** | **Target B Integrated Swarm Lifecycle** | `DUAL_ROUTER_SPEC §4`<br>`SWARM_INGESTION_PLAN §3` | — | — | 4 | 3 | `test/target-b-e2e.spec.ts` |

---

## 3. Test Runner & Verification Commands

### Standard Test Execution:
```bash
# Run the entire test suite across all 165+ test files (2,290+ tests)
npm test

# Run Target B test suites specifically
npx vitest run test/dual-router-classifier.spec.ts
npx vitest run test/kv-staging.spec.ts
npx vitest run test/ingest-queue.spec.ts
npx vitest run test/target-b-e2e.spec.ts

# Run static TypeScript typecheck
npx tsc --noEmit
```

---

## 4. Test Suite Directory Layout

```
test/
├── dual-router-classifier.spec.ts      # R1: Classifier, Engine Selection, ReAct Loop (17 tests)
├── kv-staging.spec.ts                  # R2: Stateless KV Staging, TTL, Batch Flush (13 tests)
├── ingest-queue.spec.ts                # R3: Ingest Queue Batching, Backpressure, Dedup (10 tests)
├── target-b-e2e.spec.ts                # Tiers 3 & 4 Integrated Swarm Lifecycle (47 tests)
├── adversarial-tool-stress.spec.ts     # Security & containment stress vectors (21 tests)
├── m2-cordic-adversarial.spec.ts       # CORDIC and Poincaré manifold adversarial suite (25 tests)
├── relative-vol-adversarial.spec.ts    # Relative volatility adversarial stress suite (11 tests)
└── e2e/
    ├── tier1-feature-coverage.spec.ts          # Core system Tier 1 suite (150 tests)
    ├── tier2-boundary-corner-cases.spec.ts     # Core system Tier 2 suite (151 tests)
    ├── tier3-cross-feature-combinations.spec.ts# Core system Tier 3 suite (10 tests)
    └── tier4-application-scenarios.spec.ts     # Core system Tier 4 suite (6 tests)
```

---

## 5. Tiered Specification Details (Target B)

### Tier 1: Feature Coverage (Isolation)
- **R1 Dual-Router Classifier (`test/dual-router-classifier.spec.ts`):**
  - `T1.1`: Search & Real-Time Facts classified to Cloud Frontier (`fast`/`research`).
  - `T1.2`: Multi-Tenant Relational Data (D1) classified to Cloud Frontier (`reasoning`/`fast`).
  - `T1.3`: Dense Vector Embeddings (Vectorize) classified to Cloud Frontier (`reasoning`/`research`).
  - `T1.4`: Iterative Code Authoring classified to Local Sovereign Swarm (`local`, fallback `reasoning`).
  - `T1.5`: AST Tree-sitter Refactoring classified to Local Sovereign Swarm (`local`, fallback `code`).
  - `T1.6`: Continuous Duplex Dialogue classified to Local Sovereign Swarm (`local`, fallback `conversation`).
  - `T1.7`: ReAct loop initiation with `prefer: 'local'` option.
  - `T1.8`: Dynamic per-step engine hand-off via `parsed.engine`.
- **R2 Stateless KV Staging (`test/kv-staging.spec.ts`):**
  - `T1.1`: `stageEntry` writes payload to KV with unique nonce.
  - `T1.2`: 5-minute (300s) default TTL enforcement.
  - `T1.3`: `getStaged` JSON payload retrieval and validation.
  - `T1.4`: `listStagedKeys` prefix filtering (`stage:bus`).
  - `T1.5`: `flushStaged` atomic D1 batch insertion via `env.DB.batch()`.
  - `T1.6`: Post-commit KV staged key deletion.
- **R3 INGEST_QUEUE Batching (`test/ingest-queue.spec.ts`):**
  - `T1.1`: `enqueue` buffering without immediate D1 lock.
  - `T1.2`: `MAX_BATCH_SIZE` (10) threshold auto-drain trigger.
  - `T1.3`: `drain` chunked batch execution.
  - `T1.4`: `ingest-gate` title normalization deduplication.
  - `T1.5`: `connect-sandbox` payload integration.

### Tier 2: Boundary & Corner Cases (Fail-Safe Resilience)
- **R1 Classifier & Router:**
  - `T2.1`: Offline sandbox socket transparent demotion to hosted `reasoning` without throwing.
  - `T2.2`: Demotion persistence for all remaining steps in the turn.
  - `T2.3`: Null/empty/undefined query safe fallbacks.
  - `T2.4`: Plain prose conversational answer acceptance (no JSON parse errors).
  - `T2.5`: Malformed JSON single-retry self-healing repair loop.
  - `T2.6`: `NO_TOOL_SENTINELS` (`none`, `null`, `noop`) correction.
  - `T2.7`: Scope step ceiling enforcement ($\le 10$ unprivileged, $\le 25$ privileged).
  - `T2.8`: `TOOL_TREE` 16-category exact partition verification.
  - `T2.9`: Scope-filtered prompt compression (up to 82% token savings).
- **R2 KV Staging:**
  - `T2.1`: Idempotent flush on empty KV staging buffer.
  - `T2.2`: Automatic TTL expiration after 300 seconds.
  - `T2.3`: D1 `SQLITE_BUSY` fail-safe: retains uncommitted KV keys on write contention.
  - `T2.4`: Broken KV exception handling without throwing.
  - `T2.5`: Corrupted non-JSON payload recovery.
  - `T2.6`: 100KB oversized AST payload staging.
  - `T2.7`: Concurrent write nonce collision prevention.
- **R3 Ingest Queue:**
  - `T2.1`: Backpressure rejection at `MAX_QUEUE_DEPTH` (100 items).
  - `T2.2`: Ingest-gate structural validation (rejection of non-prose and short stubs).
  - `T2.3`: Idempotent empty queue drain.
  - `T2.4`: Retains uncommitted items on D1 database lock error.
  - `T2.5`: High-concurrency 100-burst enqueue processing.

### Tier 3: Cross-Feature Combinations
- `T3.1`: End-to-end KV Staging $\to$ INGEST_QUEUE $\to$ D1 Batch Transaction pipeline.
- `T3.2`: INGEST_QUEUE + Ingest Gate Deduplication filtering duplicate research papers before database queueing.
- `T3.3`: Dual-Router Classifier $\to$ Local Sandbox Execution $\to$ KV Staging $\to$ D1 Trace Persistence.
- `T3.4`: Router Demotion on Offline Socket $\to$ Ingest Queue Telemetry Buffering $\to$ D1 Audit Logging.

### Tier 4: Real-World Application Workloads
- `T4.1`: **Scenario 1 (High-Volume Swarm Bursts):** 50 concurrent sovereign agents emitting AST patches, tool executions, and step telemetry; batched into D1 via KV staging + Ingest Queue with 0 lock contention.
- `T4.2`: **Scenario 2 (Sovereign AST Code Refactoring):** End-to-end AST tree-sitter task allocation to Local Sovereign Qwen Swarm, sandbox execution, step frame streaming, and atomic commit.
- `T4.3`: **Scenario 3 (Multi-Turn Duplex Session with Cloud Fallback):** Continuous duplex voice/text session maintaining KV working sets across turns, classifying conversational queries, and handling local engine disconnect mid-session without conversation interruption.

---

## 6. Global Coverage & Pass Summary

- **Total Test Files:** 165 test files
- **Total Test Definitions:** 2,298 passing tests (0 failed, 24 skipped)
- **TypeScript Static Verification:** 0 errors (`npx tsc --noEmit`)
- **Execution Time:** ~2.5 seconds total runtime
