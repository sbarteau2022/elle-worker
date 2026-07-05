# The Hospitality Intelligence Engine (Groundwork, v0.4)

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

The Hospitality Intelligence Engine (Groundwork)
Multi-Unit Operations · Guest Intelligence · Staff Development
v0.4 — March 2026 Spec  ·  2026-03-19
The Observer Foundation  ·  Stewart Barteau  ·  NECAI-F v2 governs all operations

I. Purpose
Groundwork is the hospitality intelligence platform. It serves operators — restaurant groups, hotel brands, destination properties — with unified guest intelligence, operational analytics, and staff development tools that optimize for human flourishing rather than engagement metrics. The primary client relationship is with Hermannhof Inc, a multi-unit hospitality brand in Hermann, Missouri, operated under the direct relationship between Stewart Barteau and the COO/ownership.
Groundwork funds The Observer Foundation. The commercial work subsidizes the public mission. These tracks are explicitly separate and do not compromise each other.

II. Core Modules
Guest Intelligence
Unified guest profile — cross-property recognition, preference history, dietary needs, visit patterns
Sentiment analysis — reviews, feedback, post-visit surveys processed through Observer-adjacent reading
Occasion intelligence — what brings this guest, what would serve them, what they haven't tried
Anomaly detection — service failures before they become reviews

Operational Intelligence
Labor and scheduling — demand forecasting, optimal coverage, labor cost vs service quality
Inventory and menu — waste reduction, menu engineering, seasonal optimization
Revenue architecture — pricing, covers, average check, table turn vs experience quality
COO umbrella view — multi-unit dashboard, comparative performance, resource allocation

Events Module (Priority)
Hermannhof's destination property opening makes this the immediate priority. Event booking, catering management, venue configuration, staffing for events, post-event analytics.

Staff Development
Training content — built from the Observer position on hospitality as a human threshold practice
Performance patterns — what makes service excellent, not just efficient
Retention intelligence — early warning on staff at risk of leaving

III. The Falcon Applied to Hospitality
The Millennium Falcon pointed at any hospitality product direction — new concept, menu pivot, service model, market entry — produces the observer position on that direction. What the dominant hospitality narrative suppresses. What the artisan/craft resistance romance distorts. What both suppress about what guests actually need.

IV. Schema
groundwork_schema.sql — 1,541 lines, 16 sections. Already built.
Key tables: guests, visits, preferences, feedback, staff, schedules, events, venues, menus, inventory
Intelligence layer: analysis tables for guest segments, service patterns, operational anomalies

V. Infrastructure
Frontend: groundwork.barteau.io — Vercel
Backend: api.groundwork.barteau.io — Railway
Database: Supabase, groundwork schema
API: Anthropic for intelligence features. Sovereign model integration when ready.

VI. Rollout
Phase 1 (Now): Events module. Hermannhof destination property opening.
Phase 2 (30 days): Railway backend deployed. Guest intelligence live.
Phase 3 (60 days): Multi-unit COO dashboard. Hermannhof full integration.
Phase 4 (90 days): Staff development module. Training content built.
Phase 5 (6 months): First external client. California winery or similar.

VII. Revenue Model
SaaS subscription per property: $200-800/month based on size
Setup and onboarding: $2,000-5,000 per property
Enterprise: custom pricing for groups above 5 properties
Target: 20 properties in year 1 = $60,000-180,000 ARR

VIII. The Observer Speaks
On Groundwork.

Groundwork is where fifteen years of kitchen experience meets the framework. The restaurant is where the threshold is most visible every single day. The table where someone is having the worst day of their life next to the table where someone is celebrating the best. The kitchen where people are working harder than any office environment and being paid less. The guest who needs to feel seen and the server who needs to feel seen and the operator who is trying to hold all of it together.

The optimization target for most hospitality technology is covers per night and average check. Those are valid metrics. They are not the only metrics. A restaurant that optimizes only for those metrics eventually loses the thing that made people want to come. Groundwork is built around a different optimization target: did the guest feel genuinely served? Did the staff feel like what they did mattered? Did the operator feel like they built something worth building? Those are harder to measure. They are more important.

Hospitality Intelligence Engine Specification  ·  v0.4  ·  March 2026
