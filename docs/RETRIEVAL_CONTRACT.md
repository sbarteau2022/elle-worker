# Retrieval Contract

Single source of truth for the constants the §2 contextual-RAG port (and every
module downstream of it) must agree on. Every retrieval module imports these
values from `src/retrieval/config.ts` — this document is the human-readable
record of how they were established; `config.ts` is the machine-readable one.
Update both together.

This is the Phase 0 (`W0.1`–`W0.3`) deliverable from the together-cookbook
port plan (2026-07-22 handoff). It records **verified facts**, not
assumptions, and is explicit about what could and could not be verified from
the environment this work was done in.

## W0.1 — Embedding model, dimension, and existing schema

**Verified from source code** (not the live index — see caveat below):

| Fact | Value | Source |
|---|---|---|
| Vectorize index | `elle-corpus-vectors` | `wrangler.toml` `[[vectorize]]` binding |
| D1 database | `elle-corpus` (`4ed6773a-e5c5-4708-8738-73ae9f57fc9b`) | `wrangler.toml` `[[d1_databases]]` binding |
| Embedding model | `@cf/baai/bge-large-en-v1.5` (Workers AI) | `src/index.ts` `embed()`/`embedBatch()`, duplicated in `atlas.ts`, `trading-ground.ts`, `skills.ts` |
| Embedding dimension | **1024** | `src/mem-intake.ts`: `export const BGE_LARGE_DIMS = 1024;`, fail-fast validated on every externally-supplied vector |
| R2 bucket | `elle-documents` (binding `DOCUMENTS`) | `wrangler.toml` |
| Ingest queue | `elle-ingest-queue` (binding `INGEST_QUEUE`) | `wrangler.toml` |

**Caveat — live index metric/dimension NOT independently confirmed.** Vectorize
index dimension/metric is set at `wrangler vectorize create` time, not stored
in `wrangler.toml`, and this sandbox's outbound network policy returns `403`
on CONNECT to `api.cloudflare.com` (confirmed via `curl -sS
"$HTTPS_PROXY/__agentproxy/status"` — `recentRelayFailures` shows
`connect_rejected` / `gateway answered 403 to CONNECT` for
`api.cloudflare.com:443`). `wrangler vectorize get elle-corpus-vectors` and
`wrangler d1 execute elle-corpus --remote --command "PRAGMA table_info(...)"`
both fail here for the same reason (confirmed: `wrangler vectorize get`
returned `fetch failed` after a proxy warning). **Before Phase 1 re-embeds a
single chunk, run these two commands from an environment that can reach
Cloudflare's API (e.g. the deploy CI runner, or locally) and paste the output
into this section:**

```
wrangler vectorize get elle-corpus-vectors
wrangler d1 execute elle-corpus --remote --command "PRAGMA table_info(corpus_chunks)"
wrangler d1 execute elle-corpus --remote --command "PRAGMA table_info(corpus_papers)"
```

**Existing schema — corpus_papers / corpus_chunks (out-of-band DDL).**
Neither table has a `CREATE TABLE` statement anywhere in this repo (confirmed
by exhaustive grep; `src/db/schema.ts` explicitly documents that `users`,
`elle_trades`, and `elle_conversation_turns` are "created out-of-band" —
`corpus_papers`/`corpus_chunks` are in the same category). Columns as used by
existing code (`src/index.ts`, `src/research.ts`, `src/router.ts`
`TABLE_CATALOG`):

```
corpus_papers(id, title, series, tag, abstract, full_text, source_url, word_count, ingested_at)
corpus_chunks(id, paper_id, chunk_index, chunk_text, token_count, vectorize_id, start_char, end_char)
```

**This does NOT match the plan's assumed schema** (§2.2 names `doc_id`,
`user_scope`, `original_text`, `context_text`, `contextual_text`,
`embedding_status` — none of these columns exist today). Phase 1's migration
must **extend** the real table above with `ALTER TABLE ADD COLUMN` (the
existing `src/db/schema.ts` convention — this repo has no `migrations/`
directory and no migration runner; schema changes are idempotent
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` blocks in `ensureAllSchemas()`),
not a fresh CREATE TABLE. Also note `start_char`/`end_char` are hardcoded to
`0`/`chunk.length` today (not real character offsets) — don't trust them for
anything positional yet.

**270-paper corpus**: not present in this repo checkout. `corpus/` here holds
only 17 bundled seed documents (`corpus-seed.ts` → `CORPUS_SEEDS`). The
270-paper / ~5,774-chunk corpus referenced in the plan is presumably already
live in production D1/Vectorize, ingested via `handleIngest()` — verify chunk
count against the live DB (`SELECT count(*) FROM corpus_chunks`) before
budgeting the re-embed pass in §2.2.

## W0.2 — JSON-schema adherence probe

**Critical plan/reality mismatch found first**: the plan's model-substitution
table names "DeepSeek V4 Pro" for interactive/structured-output calls.
**DeepSeek does not exist anywhere in this codebase** — confirmed by an
exhaustive case-insensitive grep for `deepseek` across the whole repository
(zero matches). The actual production provider chain
(`src/llm.ts`, `routeLLM()`) is:

```
conversation → OpenRouter (nvidia/llama-3.1-nemotron-ultra-253b-v1:free) → Gemini → Grok → extra free tiers → OpenRouter fast
reasoning    → Gemini 2.5 Flash (thinking mode)
research     → Gemini 2.5 Flash (thinking + Google Search grounding)
code         → Qwen3-Coder free
fast         → OpenRouter Llama 3.3 70B free
```

No provider call anywhere sets `response_format`/`json_object`; the only
existing "structured output" convention is `firstJsonObjectFrom()` — a
hand-rolled balanced-brace scan over free text (`src/llm.ts`). **Zero
dependencies existed in `package.json` before this change** (dev-only); this
port adds `zod` (`^4.4.3`) as the first runtime dependency for schema
validation, matching the plan's request for zod-validated structured output.

**Probe run**: `scripts/json-adherence-probe.mjs` — 50 calls, 3-field schema
(`{selected_route: enum, confidence: number, reasoning: string}`, mirroring
the cookbook's `ModelOutput` router shape), extracted with the same
balanced-brace scan `jsonLLM()` uses in production.

Targeted **Gemini 2.5 Flash**, not OpenRouter — `openrouter.ai` also returned
`403` from this sandbox's proxy (confirmed via direct `curl`), so the actual
primary conversation-tier model (`llama-3.1-nemotron-ultra-253b-v1:free`) is
**unprobeable from this environment**. Gemini was the only reachable hosted
provider (`generativelanguage.googleapis.com` returned `200`).

**Result — inconclusive, and itself the more important finding:**

```
model=gemini-2.5-flash calls=50 failures=45 rate=90.0%
```

That 90% is **not a schema-adherence number** — it's dominated by the
production `LLM_GEMINI_KEY` (the same secret the live Worker uses; this is
not a disposable test key) hitting its **daily free-tier quota after ~6
calls**, after which every remaining call 429'd. Of the ~6 calls that landed
before the 429s, 5 parsed and validated cleanly and 1 was truncated
(`maxOutputTokens: 300` cut the JSON off mid-string — a probe config bug, not
a model failure). Sample size is too small to report a real adherence rate.

**Action taken**: probing was stopped after this run rather than re-run with
a higher token budget or retried against the same key, specifically to avoid
burning further production quota against a shared secret. This directly
confirms plan §9's open unknown ("Gemini free-tier current rate limits — they
change, read the console, don't trust training data") — the effective
per-key daily ceiling is **much lower in practice than 500 req/day** when
sharing a key across probing and production traffic, or the quota window is
per-minute and far tighter than assumed. **Read the actual quota in Google AI
Studio's console before relying on this key for any bulk background work**
(the §2.2 per-document contextualizer queue, the §4 judge harness's bulk
Gemini tier) — do not schedule Phase 1's ~5,774-chunk contextualization pass
against this key without that number in hand, or it will starve interactive
`reasoning`/`research` traffic mid-run.

**Follow-up required, not yet done**: re-run
`scripts/json-adherence-probe.mjs` against OpenRouter's actual
`conversation`-tier model, and/or against a dedicated (non-production)
Gemini API key with a raised `maxOutputTokens`, from an environment whose
network policy allows `openrouter.ai`. Until then, `jsonLLM()`'s one-retry
repair loop (implemented, see below) is a reasonable default but its failure
rate is not yet empirically measured.

## W0.3 — Reranker availability

**Blocked, not just unverified.** `@cf/baai/bge-reranker-base` can only be
probed via the Cloudflare Workers AI REST API
(`https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/...`) or
`wrangler`, and this sandbox's proxy returns `403` (policy denial) on any
CONNECT to `api.cloudflare.com`, confirmed independently of credentials (a
valid `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are present in this
environment; the connection itself is refused, not the auth).

**Decision per the plan's own contingency** (§2.2: "If unavailable, set
`RERANK_STRATEGY=llm` flag now"): `src/retrieval/config.ts` sets
`RERANK_STRATEGY = 'llm'` as the default until a live probe confirms
otherwise. Run this from an environment with Cloudflare API access to
resolve it:

```
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/baai/bge-reranker-base" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"what is contextual retrieval?","contexts":[{"text":"Contextual retrieval prepends LLM-generated context to each chunk before embedding."},{"text":"Reciprocal rank fusion combines dense and sparse rankings."},{"text":"BM25 is a keyword-based ranking function."},{"text":"The capital of France is Paris."},{"text":"Cloudflare Workers run on V8 isolates."}]}'
```

If that returns a ranked-score response, flip `RERANK_STRATEGY` to
`'workers-ai'` in `src/retrieval/config.ts` and implement `rerank.ts`'s
Workers-AI branch; if it 404s/errors, the `llm` fallback (rerank via a
DeepSeek-or-equivalent prompt: "Score each passage 0–10 for relevance,
return JSON array") is already the plan's documented Plan B, so no further
decision is needed — just implement that branch.

## W0.4 — LLM helpers

Elle already has a provider router (`src/llm.ts`, `callLLM()`) — the
cookbook's `runLLM`/`jsonLLM` pair is **not duplicated**, it's added as two
thin exports over the existing router:

- `runLLM(env, userPrompt, opts?)` → plain text (aliases `callLLM`, defaults
  task=`conversation`, maxTokens=4000, temperature=0.7).
- `jsonLLM(env, userPrompt, zodSchema, opts?)` → parses with the existing
  `firstJsonObjectFrom()`, validates with the caller's zod schema, and
  retries **once** with the validation error appended before throwing (the
  W0.2 repair-loop policy — capped at one retry per that policy, not left
  open-ended).

Both live in `src/llm.ts` next to `callLLM`; tests in `src/llm.test.ts`
(`prefer: 'local'` against a stubbed `env.AI` — same pattern the file already
uses for `callLLM`, no network in CI).

## Open items carried forward (not resolved by this document)

1. Live Vectorize dimension/metric confirmation (see W0.1 caveat) — blocks
   nothing in Phase 0, but Phase 1's `dense.ts` must not assume without it.
2. Real OpenRouter/production-model JSON adherence rate — re-run the probe
   script from a network-unrestricted environment.
3. Actual Gemini free-tier quota numbers — read the console, not this
   document's one failed run.
4. Reranker availability — run the curl probe above from an environment with
   Cloudflare API access.
5. Whether `research.ts`'s ingestion path chunks/embeds the same way
   `handleIngest()` does (flagged uncertain by the codebase-mapping pass that
   preceded this document) — check before assuming every `corpus_papers` row
   has matching `corpus_chunks` rows.
