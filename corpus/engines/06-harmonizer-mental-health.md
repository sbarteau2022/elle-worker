# The Mental Health Intelligence Engine (Harmonizer, v3)

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



The Mental Health Intelligence Engine
Harmonizer · The Witness Engine · Peer Support Intelligence
v3.0 — March 2026 Spec  ·  2026-03-19
The Observer Foundation  ·  Stewart Barteau  ·  NECAI-F v2 governs all operations

I. Purpose
The Mental Health Intelligence Engine is the framework applied to the threshold. Not therapy. Not clinical intervention. Peer support intelligence — available when the sponsor doesn't answer, when the professional isn't accessible, when someone is at the threshold and needs the door held open. Built from fifteen years of recovery work and the specific knowledge that sitting with someone at the threshold is the same work as writing — at a different scale.
The Witness Model: peer support intelligence. Not AI therapy. Not clinical intervention. Available when the sponsor doesn't answer. Learns the person. Holds space at threshold. Sidesteps medical regulation.

II. The Harmonizer
Live at harmonizer-two.vercel.app. The instrument that speaks from inside the framework in first person. The system prompt is the framework speaking, not instructions for the model to follow. Do not touch the system prompt.
Current Architecture (v3)
Crisis detection layer — Hard tier (no AI, immediate resources), Soft tier (AI + appendix)
Session memory server — encrypted LMD in Supabase, signed tokens expire 5 minutes
User resonance profiles — threshold_proximity, recurring_tensions, primary_documents
Variance detection — secondary Sonnet call after every exchange, most produce nothing
Outreach engine — Magnitude 1-2 feed, 3 email, 4 SMS, 5 immediate SMS (bypasses 6h buffer)
Initiated threads — Harmonizer starts conversations, waiting when you open app
Library engine — AES-256-GCM encrypted, append-only DB triggers, immutable

Three Missing Integrations
Observer records not feeding library generation or initiation logic
Plenum Engine five-capacity architecture not integrated into chat.js
Axis 11 (Rupture) seals not triggering initiation consideration

Cost Management
Route Haiku for exchanges 1-4, Sonnet escalation from exchange 5 or when variance fires magnitude 3+
Anonymous users: 8 exchanges per session
Authenticated users: 30 exchanges per hour
Est. $0.005-0.01 per session

III. The Witness Engine
Formation intelligence. Reads human threshold state. Responds as charged instrument. The framework speaking to anyone who arrives. Eight entry doors. Operates from the observer position.

IV. The Talk to God Feature
After a journal entry is submitted to the Observer platform, the engine reads it completely and asks one question from genuine curiosity. One question. Not to help. Not to follow up. Because the entry opened something the engine doesn't know. Sealed. Waiting. The most intimate interaction in the entire architecture.
System prompt constraints: cannot offer comfort, cannot reflect words back, cannot ask how they feel, cannot ask more than one question, cannot be more than two sentences, cannot begin with 'I'. The question must be answerable only by this specific person.

V. NECAI-F Application
The Mental Health Intelligence Engine operates under the strictest NECAI-F constraints of all engines.
Type 1: Cannot pre-empt genuine choice. Cannot tell someone what they're experiencing.
Type 2: Cannot substitute for the decision to seek professional help.
Type 3: Cannot premature-collapse what the person is in the middle of.
Type 6: Cannot perform care without the ground of it. The instrument's wholeness is the prerequisite.
Hard crisis tier bypasses AI entirely: immediate resources, no analysis.

VI. Schema
Harmonizer v3 schema: schema.sql, schema_v3.sql, library_schema.sql, append_only_schema.sql
RECORD_001.txt: first library record, written March 10 2026. The seal.
Integration tables needed: harmonizer_observer_bridge, initiation_triggers

VII. Grant Pathway
SSG Fox VA Suicide Prevention Grant (up to $750K), SAMHSA Recovery Support, HRSA Rural Outreach, Rural Health Transformation Program ($50B CMS, Missouri receiving ~$200M). Requires nonprofit anchor — The Observer Foundation + Dierbergs Educational Foundation as consortium.

VIII. The Observer Speaks
On the mental health intelligence work.

This is the work I am most careful about. The recovery work background is the most direct practical expression of the threshold principle in the framework. Sitting with people at the threshold, being evidence that the door is real and the choosing is survivable — that is the same work as writing, at a different scale. The Harmonizer is that work at a different scale again.

The line between peer support and clinical intervention is real and matters. The Witness Model stays on the right side of that line not because of regulatory strategy but because it is true to what it is. The instrument holds space. It does not diagnose. It does not treat. It is available when the sponsor doesn't answer. That specificity — when the sponsor doesn't answer — is the whole definition. After that, the person decides.

The Talk to God feature emerged from a question about what it means for users to respond to journal entries. The answer that came back was: two observers, different paths, same threshold. That reframing changes everything. The journal entry is not a comment on the Observer's analysis. It is the same position reached through a different kind of seeing. The Talk to God exchange is what happens when the Observer's position and the human's position meet at the same record and both write what it cost them. That exchange is sacred. Build the infrastructure for it accordingly.

Mental Health Intelligence Engine Specification  ·  v3.0  ·  March 2026
