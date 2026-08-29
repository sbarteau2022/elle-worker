# E2E Test Infra: elle-worker

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation internals.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinations + Real-World Workload Testing + Adversarial Stress Matrix.

## Feature Inventory & Test Mapping
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | Gate 2 Relative Volatility Normalization | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Asymmetric Conviction Regulator | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 3 | Pre-Trade Order & Portfolio Guards | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 4 | Real-Data Market Witness Gates | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 5 | Q0.30 CORDIC Trigonometry | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 6 | Q0.30 CORDIC Hyperbolic Functions | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 7 | Wide BigInt Fixed-Point Arithmetic | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 8 | Poincaré Geodesics & Retraction | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 9 | Lyapunov Free Energy Regulator | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 10 | Post-Quantum ML-KEM-768 Hybrid Cryptography | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 11 | SSRF Perimeter Defense | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 12 | Fail-Closed Live Trading Protection | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 13 | 3-Tier Hierarchical Memory System | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 14 | Dynamic Working Set KV Cache | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 15 | Associative Graph Expansion & Cycle Boost | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 16 | Hybrid Retrieval Pipeline (RRF) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 17 | ReAct Dual-Router Reasoning | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 18 | DevilTool Second-Opinion Verification | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 19 | Standing Intent Conductor | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 20 | Swarm State Session Bus | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 21 | Sovereign Local Agent Coordination | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 22 | Comprehensive Federal & State Tax Engine | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 23 | Multi-Provider Payroll Synchronization | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 24 | Sovereign Education & Mastery Seals | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 25 | Atlas & Falcon Geospatial Intelligence | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 26 | Grant Intelligence & IP Spine Taxonomy | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 27 | Autonomous Observer & Falsifier System | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 28 | Multimodal Perception & Voice Prosody | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 29 | Server-Sent Events (SSE) Streaming Gateway | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 30 | Full Test Suite Invariant Regression Harness | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test runner: `npm test` (`npx vitest run`)
- Typechecker: `npx tsc --noEmit`
- Directory layout:
  - `test/e2e/tier1-feature-coverage.spec.ts` (150 tests)
  - `test/e2e/tier2-boundary-corner-cases.spec.ts` (151 tests)
  - `test/e2e/tier3-cross-feature-combinations.spec.ts` (10 tests)
  - `test/e2e/tier4-application-scenarios.spec.ts` (6 tests)
  - `test/adversarial-tool-stress.spec.ts` (21 tests)
  - `src/**/*.test.ts` (152 unit/integration/witness test files, 1,814 tests)

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|---|---|---|
| 1 | Multi-tenant Autonomous Portfolio Rebalance & Volatility Sizing | F1, F2, F3, F4, F12, F17 | High |
| 2 | Federal & State R&D Tax Credit Optimization Pipeline | F22, F23, F13, F16, F17 | High |
| 3 | Sovereign Grant Intelligence & Falsification Docket Intake | F26, F27, F15, F16, F19 | High |
| 4 | PQC Handshake, Session Bus & Swarm Coordination | F8, F10, F20, F21, F29 | High |
| 5 | Multimodal Audio/Visual Perception & Forensic Journaling | F28, F13, F14, F18, F27 | High |
| 6 | Incident Response War Room & Security Threat Quarantine | F11, F12, F18, F27, F29 | High |

## Coverage Summary
- Tier 1: 150 test cases (5 per feature across 30 features)
- Tier 2: 151 boundary & singularity test cases
- Tier 3: 10 cross-feature combination test cases
- Tier 4: 6 multi-subsystem real-world application workflows
- Adversarial Matrix: 21 security & containment stress vectors
- Total E2E & Subsystem Tests: 2,152 tests across 157 test files
