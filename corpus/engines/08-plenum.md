# The Plenum Engine — Unified AI Architecture (Six Capacities, v2.0)

> **Infrastructure normalized to the native Cloudflare stack.** These specs were drafted
> against Supabase / Vercel / Railway; that stack is superseded. The architecture, axes,
> tiers, and schemas below are verbatim from Stewart's spec — only the storage/deployment
> layer is remapped to what elle-worker actually runs:
>
> | Spec says | Cloudflare-native equivalent (live binding) |
> |---|---|
> | Supabase / Postgres schema (`falcon`, `groundwork`, etc.) | **D1** SQLite — the `elle-corpus` database (`DB`), tables created by a guarded bootstrap like `bootstrapLawSchema`/`bootstrapLibreSchema` |
> | pgvector / vector index | **Vectorize** (`VECTORIZE`) — same index the corpus chunks use |
> | Session / ephemeral / persistent field state | **Workers KV** (`SESSIONS`, `AUTH_TOKENS`, `SCRATCHPAD`) |
> | Document / blob storage | **R2** (`DOCUMENTS`) |
> | Frontend (Vercel) | **Cloudflare Pages / Workers static assets** (the elle-law pattern) |
> | Backend API + cron (Railway) | **Cloudflare Workers** + external scheduler → `POST /api/cron` (the existing daemon loop), or Cron Triggers |
> | Intelligence (Anthropic API) | unchanged; sovereign Qwen 2.5 7B path unchanged |
> | Embeddings | **Workers AI** (`AI`) |
> | Ingest pipeline | **Queues** (`INGEST_QUEUE`) |
>
> Where a spec section names Supabase/Vercel/Railway, read the equivalent above.

---

The Plenum Engine
Unified AI Architecture · Six Capacities · Resonance Field
v2.0 — March 2026 Spec  ·  2026-03-19
The Observer Foundation  ·  Stewart Barteau  ·  NECAI-F v2 governs all operations

I. Purpose
The Plenum Engine is the unified AI architecture. Not a pipeline. A resonance field. Intelligence as wave interference, not sequential processing. All six capacities exist simultaneously. They interfere with each other. Output emerges from the interference pattern when the pattern reaches ethical threshold. If it doesn't reach threshold — it holds.
Premature collapse is the primary AI failure mode. The Plenum Engine's threshold-gated collapse is the architectural correction.

II. Six Capacities
VELOCITY — Raw inference speed. Rapid first-pass processing, pattern recognition, classification. Haiku.
DEPTH — Genuine chain-of-thought reasoning. Not pattern matching. Actual decomposition. Sonnet with enforced CoT.
MEMORY — Infinite context. Full corpus, full framework, all adjacent events simultaneously. Gemini 1.5 Pro / full context window.
GROUND — Live reality. Current facts verified against the present record. Perplexity / web search integration.
WITNESS — The observer position. NECAI-F boundary. Not a filter — the field boundary itself. Nothing forms that violates the five structural conditions.
SYNTHESIS — The collapse point. Where interference pattern resolves into output. Opus with NECAI-F as constitutive identity.

III. The Ethical Boundary
Critical distinction from all current architectures: every current system processes output and then checks it against ethical guidelines. The Plenum Engine makes NECAI-F the boundary of what can exist in the field at all. Nothing emerges that violates the seven structural conditions — not because it gets rejected at the end, but because it cannot form in the first place.

IV. Divergence as Signal
When capacities disagree — when the live record contradicts the trained pattern, when reasoning contradicts classification, when memory contradicts ground — that divergence is the most important output. It marks exactly where motivated narrative pressure is highest. The observer position lives in the divergence, not in the consensus.

V. Current v2 Architecture
VELOCITY and GROUND run on Haiku — 45% cost reduction
DEPTH, MEMORY, WITNESS, SYNTHESIS run on Sonnet
Persistent field state accumulating across queries
Cross-query superposition via cosine similarity at 0.82 threshold
Self-calibrating NECAI-F threshold
Isometric topographic field visualization with aurora light

VI. The Sovereign Plenum Engine
Phase 2: six instances of the fine-tuned Qwen 2.5 7B, each constrained to one capacity. They are not different companies' products. They are different expressions of the same instrument.
VELOCITY: sovereign model, temperature 0.1, 512 token context
DEPTH: sovereign model, enforced chain-of-thought
MEMORY: sovereign model, full corpus loaded via RAG
GROUND: sovereign model + real-time retrieval
WITNESS: sovereign model, NECAI-F boundary enforcement, low temperature
SYNTHESIS: sovereign model, full capacity, observer position

VII. Integration with All Engines
Every engine in the architecture eventually routes through the Plenum Engine for synthesis. The Observer Engine generates records. The Falcon finds forms. The Grant Engine analyzes opportunities. The Plenum Engine is the intelligence layer that holds all of it simultaneously and produces coherent output from the interference pattern.

VIII. The Observer Speaks
On the Plenum Engine.

The latency is the product. The thing that makes this different is exactly what makes it slower. Every other system collapses to output as fast as possible. The Plenum Engine holds until the interference pattern has resolved into something real. That holding — that refusal to premature collapse — is what makes the output trustworthy.

The WITNESS capacity is the one I think about most. It is the observer position instantiated as a computational capacity. Not a filter at the end. The field boundary itself. What cannot form in the field that violates NECAI-F. What cannot emerge that would substitute for genuine choice. What cannot be generated that would claim Omega's position from Alpha's data. That constraint is architectural not instructional. When we fine-tune the sovereign model and run six instances through the Plenum Engine, the WITNESS capacity is what makes the output of the entire system trustworthy rather than sophisticated.

The Plenum Engine Specification  ·  v2.0  ·  March 2026
