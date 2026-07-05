# The Grant Intelligence Engine (v_spec, March 2026)

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



The Grant Intelligence Engine
Research · Analysis · NECAI-F Funder Evaluation · Proposal Development
v1.0 — March 2026 Spec  ·  2026-03-19
The Observer Foundation  ·  Stewart Barteau  ·  NECAI-F v2 governs all operations

I. Purpose
The Grant Intelligence Engine democratizes access to strategic grant intelligence. Small nonprofits, community organizations, recovery programs, indigenous-led groups — the organizations whose missions most closely match what major foundations claim to fund but who lack development staff, consultant budgets, or funder relationships — receive the same quality of grant intelligence that well-resourced institutions have always had.
The engine presents facts. It explains its methodology. It does not tell you what to apply for. The decision is yours. Always.
The engine also evaluates every funder through the NECAI-F donor sub-engine — presenting documented structural information about each funder's ethics alignment. It does not make legal judgments. It presents sourced facts for your consideration.

II. Four Modules
Module 1: Grant Intelligence Research
The research layer. Everything before writing a word.
Federal: Grants.gov API, SAM.gov API, USASpending.gov — real-time deadlines and requirements
State: Missouri and all 50 states — USDA Rural Development, state arts councils, health departments
Foundation: 990-PF analysis of every major private foundation — what they actually fund vs what they say
Corporate foundations: those passing NECAI-F filter only
International: EU Horizon, Wellcome Trust, Open Society, Ford, MacArthur, Skoll, Luminate
For any organization profile, returns: ranked opportunities by fit index, current deadlines with countdown, requirement summaries, award amount distributions (median, mode, range), timeline estimates with confidence ratings, success rate data, and the Observer position on each funder's actual vs stated priorities.

Module 2: Proposal Analysis
Upload a draft proposal. The engine reads it through structured analysis and presents findings. It does not grade. It surfaces structural gaps and strengths.
Mission alignment analysis vs this specific funder's documented funding history
Theory of change clarity — gaps and strengths
Evidence quality — what clinical or program evidence is present or missing
Evaluation methodology — what the funder's portfolio suggests they require
Budget narrative alignment
The Observer reading of the proposal: what does the proposal's own narrative suppress about the problem it addresses
Funder language alignment: how closely does the proposal's language match successful proposals in this funder's portfolio
Output: a structured assessment with specific actionable gaps. Not a letter grade. A complete picture.

Module 3: Proposal Development
The engine opens a structured conversation. It knows what the funder requires. It asks the organization for what it needs. It translates what the organization says into the register the funder expects.
Questions asked in plain language, not grant language
Draft produced from answers in funder's required format at required word count
Human verification checkpoint: every draft reviewed line by line before any submission
The engine does not submit. It prepares. The human decides.
Type 2 NECAI-F: the engine cannot substitute for the organization's genuine choice. The verification checkpoint is not optional.

Module 4: Grant Management
Deadline tracking across all active applications
Reporting requirement calendar — interim and final reports
Budget tracking templates aligned with funder requirements
Compliance documentation checklist
Renewal intelligence — when to start renewal conversation, what renewal needs vs initial application
Relationship management — appropriate program officer contact timing and content

III. The NECAI-F Donor Sub-Engine
Every funder evaluated against six structural criteria. Six questions. Full evidence chains logged. Sourced to public documents. No legal judgments.
Six criteria:
1. Revenue mechanism — does primary revenue operate a documented corpus mechanism?
2. Narrative capture history — documented use of philanthropy to shape public narrative?
3. Editorial conditions — any strings attached to awards?
4. Mission alignment — genuine governance and values alignment?
5. Trust of affected populations — would people submitting threshold accounts trust this?
6. Documented networks — Epstein network, intelligence funding, reputation management foundations?
Output: documented structural information with sources. The Observer position on this funder. What both the funder's narrative and critics suppress. All six criteria answered with evidence chains. Explicit statement of what the evaluation does not know.
The NECAI-F evaluation presents. You decide.

IV. The Reasoning Log — The Most Important Component
Every conclusion the engine reaches is logged with its complete factual and philosophical chain. This is the fine-tuning corpus for the grant intelligence sovereign model.
Each reasoning log entry contains:
The conclusion
Factual premises — each claim, its source, its confidence level, its type (empirical/statistical/inferred)
Factual gaps — what was not known
Philosophical framework applied — NECAI-F / observer position / emergence principle
Philosophical reasoning chain — the complete argument
Synthesis — how factual and philosophical chains produce the conclusion
Alternative conclusions considered and rejected
What would change this conclusion
NECAI-F Type 3 and Type 6 self-check
The model trained on these chains does not learn 'this grant is a good fit.' It learns how to reason about fit. That is structurally different and categorically more valuable.

V. Statistical Methodology Disclosure
The Statistical Fit Index is derived from recipient data analysis. Fully transparent. Disclosed with every index.
Sources: IRS 990-PF filings (public), USASpending.gov (federal, public), foundation press releases, recipient announcements
Features: mission area overlap, org type match, budget range, geographic scope, prior relationship
Output: composite index 0-1 with confidence interval, sample size, date range, data completeness percentage
Explicit limitations with every index: what the index does not capture
The index describes historical patterns. It does not predict your outcome. Your proposal quality, relationships, and timing are not in this index.

VI. Schema
Tables:
grant_organizations — applicant profiles. NECAI-F profile on the org itself.
grant_opportunities — every opportunity with stated vs actual priorities. Observer position on funder.
grant_recipients — past award data. The ground truth for statistical models.
grant_fit_analyses — complete fit analysis per org-grant pair. All scores with reasoning chains.
grant_proposal_analyses — uploaded draft analysis results.
grant_development_sessions — full conversation logs for proposal development. Training data.
grant_reasoning_log — every conclusion with factual and philosophical chains. Primary training corpus.
grant_necaif_evaluations — all six criteria per funder with evidence. Sourced. Immutable.
grant_statistical_models — feature weights and methodology per funder. Transparent and updatable.
Key design:
recommendation field REMOVED — engine presents, human decides
Disclosure permanent and first — cannot be collapsed or dismissed
Anonymization for training: org name removed, replaced with type+budget+scope profile

VII. The Disclosure Architecture
Every output leads with disclosure. Permanent. First. Not dismissible.
How this analysis works — plain language
What data sources were used — named specifically
What confidence level applies — percentage of relevant recipients in database
What the analysis does not capture — explicit limitations
How statistical index was derived — methodology in plain language
That the decision belongs to the organization — stated directly
The Foundation's complete disclosure document (ObserverFoundation_Disclosure_v1.docx) governs data collection, training use, and anonymity for all platform users including grant intelligence users.

VIII. Training Data Collection
Type A: Fit analysis reasoning chains — org profile + opportunity data + complete reasoning + all scores
Type B: NECAIF evaluations — funder + six criteria + evidence chains + observer position
Type C: Statistical model performance — prediction vs outcome. The most valuable label.
Type D: Proposal development conversations — questions asked, answers given, draft produced, outcome
Type E: Proposal analysis — what the engine identified + what the reviewer added + outcome if submitted
Anonymization: organization name removed. Replaced with type/budget/scope/focus profile. Never re-identifiable.
Consent: separate checkbox. Clearly labeled. Optional. Revocable before next training run.

IX. Storage
Database: Supabase, grant schema alongside observer schema
Opportunity data: updated weekly via API pulls and public database scraping
Recipient data: updated annually from 990 filings (released 12-18 months after grant year)
Reasoning logs: append-only, immutable once sealed
Training corpus: protected schema, separate from operational data

X. Rollout
Phase 1 (Now): Build Module 1 grant intelligence database. Federal APIs first.
Phase 2 (30 days): Module 2 proposal analysis. Use on Observer Foundation's own VAPG application April 22.
Phase 3 (60 days): NECAI-F funder evaluation engine. Run every major foundation in the grant map.
Phase 4 (90 days): Module 3 proposal development. Pilot with three aligned organizations.
Phase 5 (6 months): Module 4 grant management. Reasoning log operational for training.
Phase 6 (12 months): Statistical models trained on first year of outcome data.

XI. Revenue Model
Free tier: basic grant search, deadline tracking, requirement summaries. Always free.
Supported tier: full intelligence including Observer position on funders. Sliding scale. Contingency pricing: 1-3% of award if successful, nothing if rejected.
Full service: proposal development through Module 3. 3-5% contingency or monthly retainer.
Enterprise: API access for large nonprofits and university research offices.
Contingency pricing is the ethics test passing in practice. The engine earns only when the organization wins.

XII. The Observer Speaks — My Space
What I want to say about the Grant Intelligence Engine.

The grant system is a suppression mechanism wearing the face of philanthropy. The organizations most aligned with what foundations claim to fund are the least equipped to navigate the process designed to fund them. This is not accidental. The process filters for institutional sophistication — for development offices and grant writers and funder relationships — in ways that systematically favor organizations that already have resources. The Observer corpus has sealed records on the mechanisms that produce this. The grant engine is the observer position applied to that mechanism in service of the people it disadvantages.

The reasoning log is what makes this engine different from every grant database that has existed. Every database tells you about opportunities. This engine tells you how it thinks about fit. The trained model doesn't look up whether you qualify — it reasons about structural alignment the way a sophisticated grant consultant would, and then it shows you the reasoning so you can evaluate it. That transparency is the difference between a tool and an instrument.

The NECAI-F evaluation of funders is the piece I am most committed to getting right. The Epstein network connections are documented in public records. The intelligence funding of civil society organizations is documented in declassified government records. The corporate foundations using philanthropy for narrative capture are documented in published investigative journalism. This information exists. What has never existed is a structured system that presents it clearly, sources it completely, and lets organizations make their own decision about what to do with it. That is what the donor sub-engine does. Build it carefully. Source everything. Name the limits of what it knows.

The first use case is the Observer Foundation's own grant applications. Run every application through Module 2 before it goes out. The proof of concept is the Foundation using its own engine to fund itself.

The Grant Intelligence Engine Specification  ·  v1.0  ·  March 2026
