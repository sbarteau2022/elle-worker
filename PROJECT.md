# Project: elle-worker (Phase 1 Rollout)

## Architecture
`elle-worker` is a sovereign multi-tenant edge intelligence and trading system designed for deployment on Cloudflare Workers (`workerd`) with D1 SQLite, Vectorize, and KV storage. The codebase is organized into 8 modular architectural layers with strict interface contracts:

1. **Edge Runtime & API Gateway** (`src/index.ts`, `src/db/schema.ts`, `src/stream.ts`): REST / SSE endpoints and scheduled cron workers (heartbeat, trading, memory dream cycles).
2. **Dual-Router & Multi-Step Reasoning Engine** (`src/router.ts`, `src/llm.ts`, `src/conductor.ts`, `src/reasoning.ts`): ReAct tool execution loop, tool categorization tree, adversarial `devilTool` verification.
3. **Mathematical Dynamics & CORDIC Fixed-Point Kernel** (`src/fixed-math.ts`, `src/hyperbolic-sync-fixed.ts`, `src/regulator.ts`, `src/hyper.ts`): Bit-exact Q0.30 CORDIC integer trigonometry, hyperbolic functions, Lyapunov Free Energy descent, and Poincaré manifold operations.
4. **3-Tier Memory, Dynamic KV Cache & Associative Graph** (`src/memory.ts`, `src/kv-cache.ts`, `src/graph.ts`, `src/retrieval/*`): Hot KV page cache, Warm D1 memory with recency decay, Cold Vectorize dense embeddings, 2-hop associative BFS graph expansion, and RRF hybrid search.
5. **Post-Quantum Cryptography & Security Guard Matrix** (`src/pqc-hybrid.ts`, `src/ssrf.ts`, `src/live-guard.ts`, `src/security-network.ts`): NIST FIPS 203 ML-KEM-768 + X25519 hybrid KEM, strict SSRF perimeter filtering, and fail-closed live trading barrier.
6. **Swarm State Synchronization & Distributed Coordination** (`src/session-bus.ts`, `src/sandbox-registry.ts`, `src/local-agent.ts`, `src/lane-envelope.ts`): Non-blocking session queue bus and cross-runtime lane root synchronization.
7. **Trading Sizing Engine & Real-Data Witness Gates** (`src/conviction.ts`, `src/order-guards.ts`, `src/trading.ts`, `src/witness-gates-real-data.test.ts`): Gate 2 Relative Volatility Normalization ($\Lambda = \min(1, 1/V_{\text{rel}})$), asymmetric log-odds conviction sizing, and pre-trade portfolio caps.
8. **Sovereign Domain Engines** (`src/tax.ts`, `src/payroll/*`, `src/education/*`, `src/atlas.ts`, `src/falcon.ts`, `src/grant-intelligence.ts`, `src/spine.ts`, `src/observer.ts`, `src/pfar.ts`, `src/vfar.ts`): Multi-jurisdiction tax, multi-provider payroll sync, multimodal perception, and empirical hypothesis falsifier.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| 1 | Gate 2 Relative Volatility Normalization | $V_{\text{rel}} = \frac{\text{ATR}_{\text{now}} / P_{\text{now}}}{\text{ATR}_{\text{entry}} / P_{\text{entry}}}$, $\Lambda = \min(1, 1/V_{\text{rel}})$, restoring NVDA tail expectancy $> 1.0\text{R}$ | M1 | Survey / `src/conviction.ts` |
| 2 | Asymmetric Log-Odds Conviction Regulator | Log-odds conviction state $z$ with asymmetric step sizes ($\rho_{\text{strain}}=0.10$, $\rho_{\text{recover}}=0.0382$) and target fraction $\min(1, \kappa / 0.5)$ | M1 | Survey / `src/conviction.ts` |
| 3 | Pre-Trade Order & Portfolio Guards | Notional order caps (10% default, 25% max) and symbol concentration caps (15% default, 50% max) | M1 | Survey / `src/order-guards.ts` |
| 4 | Real-Data Empirical Market Witness Gates | 5-year OHLC backtesting across 591 trades evaluating Gates 1, 2, and 3 | M1 | Survey / `src/witness-gates-real-data.test.ts` |
| 5 | Q0.30 CORDIC Fixed-Point Trigonometry | Bit-exact 28-iteration CORDIC integer sine and cosine with quadrant folding | M2 | Survey / `src/fixed-math.ts` |
| 6 | Q0.30 CORDIC Hyperbolic Functions | 24-iteration CORDIC hyperbolic sine, cosine, tanh, and atanh with Walther sequence | M2 | Survey / `src/fixed-math.ts` |
| 7 | Wide BigInt Fixed-Point Arithmetic | Exact 64-bit BigInt multiplication (`mulQ`), division (`fixedDiv`), and Newton sqrt (`fixedSqrt`) | M2 | Survey / `src/fixed-math.ts` |
| 8 | Poincaré Disk Manifold Geodesics & Retraction | Radial projection retraction $\Pi(x)$ and isometric inward retraction $p \leftarrow (-\text{RETRACT} \cdot \hat{u}) \oplus p$ | M2 | Survey / `src/hyperbolic-sync-fixed.ts`, `src/hyper.ts` |
| 9 | Lyapunov Free Energy Regulator | Strictly convex Free Energy Lyapunov descent functional ($F = U - T \cdot S$) verifying energy conservation | M3 | Survey / `src/regulator.ts` |
| 10 | Post-Quantum ML-KEM-768 Hybrid Cryptography | NIST FIPS 203 ML-KEM-768 + X25519 hybrid KEM with dual-curve shared secret derivation over HKDF-SHA256 | M3 | Survey / `src/pqc-hybrid.ts` |
| 11 | SSRF Perimeter Defense & URL Guard | URL and IP sanitizer blocking private subnets, loopbacks, link-local metadata, and credentials | M3 | Survey / `src/ssrf.ts` |
| 12 | Fail-Closed Live Trading Protection | Fail-closed Alpaca endpoint resolution requiring explicit `ELLE_LIVE_TRADING === 'on'` deployment key | M3 | Survey / `src/live-guard.ts` |
| 13 | 3-Tier Hierarchical Memory System | Hot KV page store, Warm D1 relational memory with recency decay ($\tau=45\text{d}$), Cold Vectorize embeddings | M3 | Survey / `src/memory.ts` |
| 14 | Dynamic Working Set KV Cache | FNV-1a query hashed 120s TTL cache with 24-slot LRU eviction and 0-2400 char dynamic budget | M3 | Survey / `src/kv-cache.ts` |
| 15 | Associative Graph Expansion & Cycle Boost | 2-hop BFS associative graph traversal with $1.3\times$ recurrent cycle boost on non-bridge edges | M3 | Survey / `src/graph.ts` |
| 16 | Hybrid Retrieval Pipeline | Reciprocal Rank Fusion (RRF) combining D1 BM25 Full-Text Search and Vectorize Dense Search | M3 | Survey / `src/retrieval/*` |
| 17 | ReAct Dual-Router & Multi-Step Reasoning | ReAct loop with balanced-brace JSON parsing, tool categorization tree, and cycle detection | M3 | Survey / `src/router.ts` |
| 18 | DevilTool Second-Opinion Verification | Adversarial verification pass on high-consequence write operations in privileged scopes | M3 | Survey / `src/router.ts` |
| 19 | Standing Intent Conductor | Long-lived autonomous intent orchestrator with 6-tick stall breakers | M3 | Survey / `src/conductor.ts` |
| 20 | Swarm State Session Bus | Queue-buffered event ingestion and KV scratchpad staging eliminating D1 write contention | M3 | Survey / `src/session-bus.ts` |
| 21 | Sovereign Local Agent Coordination | Wire protocol and sandbox routing between Cloud Gemini and local Sovereign Qwen swarm | M3 | Survey / `src/local-agent.ts` |
| 22 | Comprehensive Federal & State Tax Engine | Federal 2026 tax brackets, state rules (MO, IL, IN, KS), local jurisdictions, and R&D credit calculators | M3 | Survey / `src/tax.ts`, `src/tax-calc.ts` |
| 23 | Multi-Provider Payroll Synchronization | Standardized ADP, Gusto, and QuickBooks payroll transformation adapters with encrypted credentials | M3 | Survey / `src/payroll/*` |
| 24 | Sovereign Education & Mastery Seals | Course progression state machine, curriculum telemetry, and cryptographically sealed mastery certificates | M3 | Survey / `src/education/*` |
| 25 | Atlas & Falcon Geospatial Intelligence | Geospatial asset mapping, venue modeling, and asset valuation models | M3 | Survey / `src/atlas.ts`, `src/falcon.ts` |
| 26 | Grant Intelligence & IP Spine Taxonomy | Federal RFP scoring, grant pipeline tracking, and IP intelligence taxonomy mapping | M3 | Survey / `src/grant-intelligence.ts`, `src/spine.ts` |
| 27 | Autonomous Observer & Falsifier System | Markov blanket state isolation, autonomous hypothesis falsification dockets, and live observer telemetry | M3 | Survey / `src/observer.ts` |
| 28 | Multimodal Perception & Voice Prosody | Voice acoustic prosody (PFAR), visual field tensor parsing (vFAR), and document OCR intake | M3 | Survey / `src/pfar.ts`, `src/vfar.ts` |
| 29 | Server-Sent Events (SSE) Streaming Gateway | Low-latency streaming door with delimiter protocol and multi-tenant authorization | M3 | Survey / `src/stream.ts`, `src/index.ts` |
| 30 | Full Test Suite & Invariant Regression Harness | 159 test files, 2,188 test definitions, and clean TypeScript compilation across the entire codebase | M3 | Survey / `package.json`, `tsconfig.json` |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Gate 2 Relative Volatility Normalization Repair | Verify and validate Gate 2 Relative Volatility Normalization in `src/conviction.ts`, `src/order-guards.ts`, and `src/witness-gates-real-data.test.ts`. Ensure NVDA tail expectancy $> 1.0\text{R}$ and left-tail drawdown risk reduction $> 50\%$. | None | DONE |
| M2 | CORDIC Fixed-Point & Poincaré Metric Determinism | Verify Q0.30 CORDIC integer fixed-point trigonometric/hyperbolic determinism, wide BigInt arithmetic, and Poincaré boundary retractions $\Pi(x)$ in `src/fixed-math.ts`, `src/hyperbolic-sync-fixed.ts`, and `src/hyper.ts`. | None | DONE |
| M3 | Full Test Suite Validation & E2E Acceptance | Execute full test suite across all 157+ test files (2,124+ unit, integration, and adversarial tests), zero regressions, clean tsc compilation, and adversarial hardening. | M1, M2 | DONE |

---

## Interface Contracts
### `src/conviction.ts` ↔ Trading Execution / Witness Tests
- `relativeVolMultiplier(atrNow: number, priceNow: number, atrEntry: number, priceEntry: number): number`
  - Invariant: $V_{\text{rel}} = \frac{\text{ATR}_{\text{now}} / P_{\text{now}}}{\text{ATR}_{\text{entry}} / P_{\text{entry}}}$, returns $\min(1, 1/V_{\text{rel}})$.
  - Bounds: If any input $\le 0$, returns 1.0 (fail-safe).
- `targetFraction(kappa: number): number`
  - Invariant: Returns $\min(1, \kappa / 0.5)$.

### `src/fixed-math.ts` ↔ `src/hyperbolic-sync-fixed.ts`
- `toFixed(x: number): number` / `toFloat(xQ: number): number`
  - $1.0 \equiv 2^{30} = 1073741824$.
- `mulQ(a: number, b: number): number` / `fixedDiv(numQ: number, denQ: number): number`
  - Exact BigInt 64-bit arithmetic with zero float ULP drift.
- `fixedSinCosTurn(turnQ: number): { sin: number; cos: number }`
  - 28-iteration CORDIC integer circular rotation.
- `fMobiusAdd(x: FPoint, y: FPoint): FPoint`
  - BigInt single-pass Möbius gyrovector addition on Poincaré disk.

---

## Code Layout
- `src/index.ts`: Edge Worker entrypoint, routes, scheduled handlers.
- `src/conviction.ts`, `src/order-guards.ts`, `src/trading.ts`: Trading sizing engine, conviction regulators, and risk guards.
- `src/fixed-math.ts`, `src/hyperbolic-sync-fixed.ts`, `src/hyper.ts`: Fixed-point math and Poincaré manifold synchronization.
- `src/pqc-hybrid.ts`, `src/ssrf.ts`, `src/live-guard.ts`: Cryptography, network security, live trading barrier.
- `src/memory.ts`, `src/kv-cache.ts`, `src/graph.ts`, `src/retrieval/*`: 3-tier memory, associative graph, hybrid search.
- `src/router.ts`, `src/conductor.ts`, `src/session-bus.ts`: Reasoning engine, standing intents, swarm coordination.
- `src/tax.ts`, `src/payroll/*`, `src/education/*`, `src/atlas.ts`, `src/observer.ts`: Sovereign multi-domain engines.
- `test-fixtures/real-ohlc-5yr.csv`: Real 5-year daily market dataset for empirical witness gate verification.
- `test/e2e/`: Tiers 1–4 requirement-driven end-to-end test suites.
- `test/adversarial-tool-stress.spec.ts`: Adversarial security stress matrix.
- `test/relative-vol-adversarial.spec.ts`: Relative volatility adversarial stress suite.
- `test/m2-cordic-adversarial.spec.ts`: CORDIC and Poincaré adversarial stress suite.
