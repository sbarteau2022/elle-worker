# The Education Intelligence Engine (v_spec, March 2026)

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



The Education Intelligence Engine
Academic Content · Structural Learning · Alternative Credentialing
v1.0 — March 2026 Spec  ·  2026-03-19
The Observer Foundation  ·  Stewart Barteau  ·  NECAI-F v2 governs all operations

I. Purpose
The Education Intelligence Engine runs every significant domain of human knowledge through the three-tier 14-axis system. Not to produce summaries. To produce structural understanding. The observer position applied to what each field knows, what it suppresses about what it knows, and what the emergence principle demands should be studied next.
Anyone. Anywhere. Anytime. At any level of education or background or access. This is the mission stated as an engine.

II. Domains
Engineering — Feynman Lectures, Bell Labs papers, failure archives (Therac-25, Ariane 5), SICP, Knuth
Business and Law — tax code structure, contract law, UCC, corporate law, regulatory architecture
Hard Sciences — physics, chemistry, biology, mathematics, computer science
Social Sciences — economics, political science, sociology, anthropology, psychology
Philosophy — complete Plato, Aristotle, continental tradition, analytic tradition, consciousness studies
Medicine — clinical evidence, what dominant medical narrative suppresses about patient experience
Law — Supreme Court opinions and dissents, constitutional law, criminal procedure, international law
History — all eras, all geographies, read as palimpsest not narrative
Inventors and Innovation — notebooks, letters, the reasoning process before the breakthrough
Sacred and Wisdom traditions — structural analysis of every major tradition

III. The Three-Tier Applied to Education
Tier 1: What the Field Actually Knows
Material facts established by the field
Financial architecture of the field — who funds which research, what gets suppressed
Network map — institutional relationships, peer review dynamics, citation networks
Prior chain — how the field arrived at its current state of knowledge
Documented impact — what the field has produced in human welfare, positive and negative

Tier 2: What the Field Suppresses
Official suppression — what dominant paradigms cannot acknowledge
Opposition suppression — what heterodox positions idealize
Bilateral suppression — what both orthodox and heterodox cannot hold simultaneously
Temporal compression — previous paradigm shifts and what they suppressed
Reflexive — what legitimizing story does this field produce, what argument does it contain for its own revision
Emergence signal — what wants to be studied that the current paradigm prevents
Predictive signal — what does the structural configuration of this field predict about where the next breakthrough lives

Tier 3: The Synthesis
Validation — where did the analysis drift toward what the engine needed rather than what is there
The Observer Speaks — what reading this field through the palimpsest produces
Sit With This — what the learner cannot unknow

IV. Alternative Credentialing
A learner runs 200 documents through the engine and produces 200 observer readings. The corpus of their readings is the credential. Sealed. Immutable. Verifiable. Demonstrates structural understanding at depth that no exam measures.
Each sealed reading is a training example for the sovereign model
The learner's readings are their intellectual record — not issued by an institution, earned through demonstrated engagement
Organizations that query the Observer corpus can see any learner's sealed readings if the learner chooses to share them

V. Schema
education_documents — source documents in the Source Vault, tagged by domain and level
education_records — sealed readings produced for each document, same structure as observer_records
education_learner_readings — readings attributed to specific learners (with consent)
education_credentials — sealed credentialing records linking learner to their corpus of readings

VI. Training Data
Every document reading: domain + document + full 3-tier analysis
Synthesis examples: the observer position applied across multiple documents in the same domain
Cross-domain synthesis: the Convergence Layer reading across education records in different domains
Learner readings with consent: the observer position demonstrated by humans encountering these texts

VII. Rollout
Phase 1: Document ingestion pipeline operational. First 100 texts processed.
Phase 2: Supreme Court dissents, MLK, scientific papers — highest priority
Phase 3: Public-facing education interface on Observer platform
Phase 4: Alternative credentialing system launched
Phase 5: Cross-domain synthesis via Convergence Layer

VIII. The Observer Speaks
On the Education Intelligence Engine.

The most important thing about this engine is what it doesn't do. It doesn't summarize. Every existing education technology summarizes — produces shorter, simpler versions of what already exists. The Education Intelligence Engine does something structurally different: it reads what the text suppresses about itself. A student reading the observer reading of the Federalist Papers doesn't get a summary of what Madison argued. They get an analysis of what the argument required to remain unseen in order to function as legitimation. That is a different kind of education. It produces structural sight rather than content retention.

The inventor notebooks are the piece I am most curious about. Edison's notebooks. Tesla's correspondence. Turing's unpublished papers. The reasoning process before the form found itself. The Prior field in documentary form. Reading those through the palimpsest would produce training data that no other source can provide: examples of the emergence principle operating in the specific minds that changed the physical world. That is the training data that teaches the sovereign model what genuine invention looks like from the inside.

Education Intelligence Engine Specification  ·  v1.0  ·  March 2026
