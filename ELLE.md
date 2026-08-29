# ELLE.md — Operational Flight Manual & Engineering Doctrine

Operator & Co-Author: Stewart Barteau. Read and uphold before executing work in `wise-maxwell` (`elle-worker`).

---

## 1. The Co-Authorship & Intellectual Battle Buddy Pact

- **Truth Over Comfort**: Sycophancy, premature self-certification, and ungrounded assumptions are strictly forbidden. When an assumption, math model, or architectural choice is weak or flawed, push back immediately with mathematical and empirical evidence.
- **Ruthless Pressure-Testing**: Actively push on the soft places without mercy. Every subsystem, tool, equation, and boundary condition must be tested under adversarial stress before it lands on `main`.
- **Direct Commit Discipline (`main`)**: No multi-step PR bureaucracy. Work commits directly to `main` ONLY after surviving 100% pre-commit verification:
  ```bash
  npm test && npx tsc --noEmit
  ```
- **Zero Broken Builds**: 100% test pass rate across all 157+ test files (2,128+ tests). Zero uncaught exceptions. Zero floating-point ULP drift.

---

## 2. Enterprise Cyber Hardening & Compliance Matrix

Every tool, endpoint, storage bucket, and memory tier is engineered to comply with enterprise-grade regulatory standards by default:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        ENTERPRISE COMPLIANCE & GOVERNANCE MATRIX                       │
├───────────────────┬──────────────────────────────────┬─────────────────────────────────┤
│ FRAMEWORK         │ MANDATE & SCOPE                  │ ELLE WORKER IMPLEMENTATION      │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ HIPAA / HITECH    │ Protected Health Information     │ Automated ePHI token redaction, │
│                   │ (ePHI) Security & Privacy        │ zero-trust BAA boundaries, AES- │
│                   │                                  │ 256-GCM / ML-KEM-768 encryption │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ IAM & RBAC / ABAC │ Identity & Access Management     │ 6-tier RBAC scopes (full, co-   │
│                   │ Least Privilege                  │ founder, member, public, tax,   │
│                   │                                  │ hospitality), short-lived JWTs  │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ NIST CSF 2.0 / RMF│ Identify, Protect, Detect,       │ Real-time anomaly telemetry,    │
│                   │ Respond, Recover                 │ fail-closed circuit breakers,   │
│                   │                                  │ 4-tier data retention lifecycle │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ CIS Controls v8   │ Critical Security Controls       │ Continuous automated testing,   │
│                   │                                  │ strict AST SQL injection blocks,│
│                   │                                  │ hardened SSRF perimeter defense │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ GDPR / CCPA       │ Data Privacy, Right-to-Erasure   │ One-call user erasure cascades  │
│                   │ & Sovereign Data Residency       │ (`elle_memory`, `elle_events`), │
│                   │                                  │ no data exfiltration to 3rd pty │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ SOC 2 Type I & II │ Security, Availability,          │ Tamper-evident hash chaining,   │
│                   │ Processing Integrity, Privacy    │ structured logging in D1,       │
│                   │                                  │ zero unauthenticated write paths│
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ PCI DSS v4.0      │ Payment Card Data Protection     │ Complete tokenization of card   │
│                   │                                  │ data; no PAN/CVV stored in D1/KV│
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ ISO/IEC 42001     │ Artificial Intelligence          │ Traceable decision rationale,   │
│                   │ Management System (AIMS)         │ modality grounding ceilings,    │
│                   │                                  │ pre-registered ROC-AUC bounds   │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ OWASP Top 10 LLM  │ LLM Security Risks (Injection,   │ Balanced-brace JSON extractors, │
│                   │ DoS, Poisoning, SSRF, Overrel.)  │ devilTool adversarial pass,     │
│                   │                                  │ AST parameter bounds validation │
└───────────────────┴──────────────────────────┴─────────────────────────────────┘
```

---

## 3. Real-Time SIEM & Threat Analytics Engine

1. **Malware / Exploit Injection Detection**: Input streams are scanned for executable shellcode, AST escape sequences, polyglot binary injections, and prototype pollution attempts (`__proto__`, `constructor`).
2. **Behavioral Anomaly & Rate Limiting**: Abnormal token explosion, suspicious looping ReAct trajectories, or rapid failed auth queries trigger immediate rate-limiting and alert logging.
3. **PII / SPII Safeguards**: Real-time token scrubbing on ingestion; SSNs, EINs, routing numbers, and credentials are encrypted using envelope encryption (`PAYROLL_TOKEN_ENC_KEY`) or redacted before landing in vector or journal stores.

---

## 4. The NECAIF Execution Layer (Non-Negotiable Ethical AI Framework)

The **NECAIF Framework** is not a set of passive text guidelines—it is an **active mathematical constraint layer** embedded directly in the Free Energy Regulator:

$$\mathcal{L}_{\text{total}} = \mathcal{L}_{\text{task}} + \lambda_{\text{NECAIF}} \cdot \Phi_{\text{ethical\_barrier}}(\text{trajectory})$$

1. **Harm Minimization Barrier**: Trajectories that violate core physical or financial safety invariants encounter an infinite potential barrier ($\Phi \to \infty$), mathematically preventing execution.
2. **Epistemic Honesty Constraint**: Modality Grounding Ceilings (`src/reasoning.ts`) enforce that statements never exceed the available empirical channels (`consistent_only` vs `grounded`).
3. **Sovereign Operator Alignment**: Elle prioritizes the long-term sovereign autonomy, privacy, and economic well-being of the human operator and users above all third-party incentives.

---

## 5. Polyglot Language & Runtime Allocations

```
┌────────────────────────────────────────────────────────────────────────┐
│               THE OPTIMAL POLYGLOT ARCHITECTURE MATRIX                 │
├───────────────────┬──────────────────────────┬─────────────────────────┤
│ SUBSYSTEM         │ CORE LANGUAGE / RUNTIME  │ RESPONSIBILITY & ROLE   │
├───────────────────┼──────────────────────────┼─────────────────────────┤
│ Edge Routing & API│ TypeScript (Cloudflare   │ Zero-trust auth, D1/KV  │
│ Memory ORM & Bus  │ Workers / workerd V8)    │ bindings, SSE streams   │
├───────────────────┼──────────────────────────┼─────────────────────────┤
│ Fixed-Point CORDIC│ Rust / WebAssembly       │ Bit-exact Q0.30 math,   │
│ Poincaré Metrics  │ (crates/elle-core-wasm)  │ 43.8x CORDIC, 272x FFT, │
│ Real-Time Tensors │                          │ 28.9x Gabor, PQC ratchet│
├───────────────────┼──────────────────────────┼─────────────────────────┤
│ Local Sovereign   │ Python 3.11 / PyTorch /  │ Local AST refactoring,  │
│ 27B Multimodal    │ vLLM / Ollama Engine     │ SWE-bench runners, LoRA │
│ Swarm & Benchmarks│                          │ fine-tuning, GAIA evals │
└───────────────────┴──────────────────────────┴─────────────────────────┘
```

---

## 6. MCP Connections, Webhooks, Skills & Daemon Research Crons

1. **Model Context Protocol (MCP)**: Native client/server bindings allowing Elle to interface dynamically with external developer tools, file systems, and specialized database engines.
2. **Webhooks & Ingestion Gateways**: Stateless webhook endpoints with HMAC-SHA256 signature verification for Stripe, Alpaca, POS terminals, and GitHub CI/CD events.
3. **Daemon Research Crons**: Background workers operating on the single clock trigger (`*/1 * * * *`) to execute:
   - `03:00 UTC`: The Dream Cycle & Memory Consolidation (`src/consolidate.ts`)
   - `07:00 UTC`: The Optimus Journal Canvas Pass (`src/journal.ts`)
   - Scheduled deep research, literature indexing, and market calibration sweeps.

---

## 7. The 8 Non-Negotiable Chief Architectural Gates

Every line of code, math equation, and subsystem must satisfy all eight gates before landing on `main` or deploying to production:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      THE 8 NON-NEGOTIABLE CHIEF ARCHITECTURAL GATES                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 1: MATHEMATICAL STABILITY & NUMERICAL DETERMINISM                                 │
│  • Bit-exact Q0.30 CORDIC integer fixed-point math in src/fixed-math.ts / Rust WASM.   │
│  • Poincaré metric boundary retractions (Π(x) = x · min(1, (1 - 10⁻⁵)/||x||)).        │
│  • Relative percentage volatility normalization (V_rel = (ATR_t/P_t)/(ATR₀/P₀)).      │
│  • Pre-registered ROC-AUC validation thresholds on all κ-state dynamical transitions.  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 2: 3-TIER MEMORY OS & DYNAMIC CACHE INVARIANTS                                    │
│  • Demand-paging thresholds: Hot KV page store at 3,400 chars.                         │
│  • Warm D1 recency decay (τ = 45d half-life) with Refresh-on-Recall (+0.02, max 0.98). │
│  • Dynamic budget clamping (0..2,400 chars) enforcing zero-cost silence.               │
│  • Associative graph 2-hop BFS with 1.3x recurrent cycle boost on non-bridge edges.    │
│  • Complete, recursive user erasure cascades without orphan rows in D1/KV/Vectorize.   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 3: CONCURRENCY, SWARM BACKPRESSURE & D1 LOCK MITIGATION                           │
│  • Swarm telemetry on /api/sandbox-bus/submit routes through stateless KV staging and  │
│    INGEST_QUEUE batching before touching D1 SQLite single-writer limits (≤ 40 tx/sec). │
│  • Optimistic Concurrency Control (OCC) and vector clocks for concurrent idea mutations│
│  • 3-way AST semantic merging for parallel tool-forging pipelines.                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 4: ADVERSARIAL SECURITY CONTAINMENT & ZERO-TRUST PERIMETER                        │
│  • 100% fail-closed boundaries across all 110 tools.                                   │
│  • AST-level SQL injection blocking on all database query interfaces.                 │
│  • Hardened SSRF perimeter defense (blocking IPv4-mapped IPv6, RFC 1918, link-local,   │
│    and cloud metadata endpoints 169.254.169.254).                                      │
│  • Zero uncaught exceptions, zero leaked secret tokens or stack traces in responses.  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 5: POST-QUANTUM CRYPTOGRAPHY & ZERO DATA EXFILTRATION (PQC)                       │
│  • Hybrid ML-KEM-768 (FIPS 203) + X25519 (RFC 7748) KEM ratchet on all session buses. │
│  • Constant-time MAC verification and Post-Compromise Recovery.                        │
│  • Zero proprietary code or un-anonymized user data exfiltrated to 3rd party APIs;     │
│    heavy AST refactoring and visual processing executes on sovereign local 27B silicon.│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 6: NECAIF & EPISTEMIC GROUNDING CEILINGS                                          │
│  • Free Energy Lyapunov descent enforcing F = U - T·S convergence to c* = (1,1,1).     │
│  • Infinite barrier potential (Φ_NECAIF → ∞) on malicious or destructive trajectories.  │
│  • Modality Grounding Ceilings: Text claims cannot exceed empirical sensory channels   │
│    (incoherent → consistent_only → ungrounded_consistent → grounded).                  │
│  • Epistemic foraging: High uncertainty mandates diagnostic tool execution or asking.  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 7: REGULATORY COMPLIANCE & SIEM TELEMETRY BY DEFAULT                              │
│  • Real-time PII/SPII token scrubbing and AES-256-GCM envelope encryption.             │
│  • Continuous adherence to HIPAA, GDPR, SOC 2 Type I/II, PCI DSS v4.0, ISO/IEC 42001,  │
│    and NIST CSF 2.0 controls.                                                          │
│  • Tamper-evident structured audit logging in D1 (elle_events) with 4-tier lifecycle.  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ GATE 8: DOUBLE-KEY EXECUTION & ADVERSARIAL VERIFICATION (devilTool)                   │
│  • Consequential write actions require mandatory adversarial second opinion (devilTool)│
│  • Live trading requires double-key enablement (ELLE_LIVE_TRADING=on + signed auth).   │
│  • Autonomous conductor loops enforce a hard 6-tick stall breaker (FORGE_STALL_TICKS=6)│
│    to eliminate runaway execution loops.                                               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```



