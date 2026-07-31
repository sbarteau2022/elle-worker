# Service keys & secrets — master reference

One place to see **every service-key tag each repo, worker, and static asset
needs** so you can fill in the values. This file only lists the *tag names*
(and what each is for) — **no values live here.** Set real values with
`wrangler secret put <NAME>` (Workers), a gitignored `.env` / `.dev.vars`
(frontends & local dev), or your repo's GitHub Actions secrets (CI deploy).

Covers all 16 repos in the fleet. This copy lives in **elle-worker** because
it's the hub, but it documents the whole set.

## Legend

| Mark | Kind | Where the value goes |
|---|---|---|
| 🔐 | **Secret** — real credential, never commit | `wrangler secret put NAME` · gitignored `.dev.vars`/`.env` |
| ⚙️ | **Config var** — not secret (URL, model id, flag) | `wrangler.toml [vars]` · `.env` |
| 🔗 | **Binding** — Cloudflare resource, not a value you type | `wrangler.toml` (create the resource, paste its id) |
| 🚀 | **CI / deploy secret** — for GitHub Actions | repo → Settings → Secrets → Actions |

**Required** = app is broken / closed without it. **Optional** = feature stays
cleanly disabled ("not configured") until set.

---

## Quick index

| Repo | Deploy target(s) | Required keys to provide |
|---|---|---|
| [elle-worker](#elle-worker) | Worker `elle-worker` | `JWT_SECRET`, `ELLE_SERVICE_KEY`, one LLM key |
| [Elle](#elle) | Worker `elle` (web) + Expo mobile | `VITE_ELLE_WORKER_URL` |
| [FlockIntelligence](#flockintelligence) | Worker `flockintelligence` + web | `FLOCK_TOKEN` (+ `FLOCK_TOKEN_ENC_KEY` for social) |
| [RAPIDAi](#rapidai) | 3 Workers + Pages `rapidai` | per-worker tokens (see below) |
| [MOTaxIntelligence](#motaxintelligence) | Worker `mo-tax` | `TAX_SERVICE_KEY` |
| [CustomCourseBuilder](#customcoursebuilder) | Worker `customcoursebuilder` | none (only a D1 binding) |
| [elle-dev-console](#elle-dev-console) | Pages `elle-dev-console` | none (runtime JWT login) |
| [elle-law](#elle-law) | Worker `elle-law` (assets) | `VITE_ELLE_WORKER_URL` |
| [GrantIntelligence](#grantintelligence) | Worker `grant-intelligence` (assets) | none (static) |
| [culinary-compass](#culinary-compass) | Worker `culinary-compass` | none |
| [Dynanic-Hyperbolic-Neural-Graph](#dynanic-hyperbolic-neural-graph) | Node publisher scripts | `ATLAS_SERVICE_KEY` (only to push) |
| [Harmonizer](#harmonizer) | Vercel (SPA + `/api`) | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` |
| [EthicalIntelligenceProject](#ethicalintelligenceproject) | Astro (Netlify/Vercel/Docker) | none secret (public build vars) |
| [madmind-journal-home](#madmind-journal-home) | Vite SPA | `VITE_ELLE_WORKER_URL` |
| [AtlasEduIntelligence](#atlaseduintelligence) | placeholder (README only) | none |
| [MadMindMap](#madmindmap) | placeholder (README only) | none |

---

## elle-worker

**Worker `elle-worker`** — the backend/API and Elle's mind. The biggest key
surface in the fleet. Set every secret with `wrangler secret put <NAME>`.

### 🔐 Secrets

| Tag | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | ✅ | Signs/verifies user JWTs (login, all authed reads). |
| `ELLE_SERVICE_KEY` | ✅ | Full-scope service bearer — the god credential other workers present. |
| `LLM_OPENROUTER_KEY` | ✅¹ | OpenRouter (free frontier models) — primary LLM lane. |
| `LLM_GEMINI_KEY` | ✅¹ | Gemini 2.5 Flash + Google Search grounding (web search) + LLM. |
| `SANDBOX_AGENT_KEY` | optional | Shared secret for the connect-back laptop sandbox; must equal Elle's `ELLE_SANDBOX_KEY`. Unset ⇒ sandbox doors 503. |
| `GOOGLE_CLIENT_ID` | optional | Google sign-in allowlist (web + iOS client IDs, comma-separated). |
| `RESEND_API_KEY` | optional | Contact-form email via Resend. Unset ⇒ form still logs, just no email. |
| `GITHUB_TOKEN` | optional | GitHub corpus ops. |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | optional | Alpaca trading (paper by default). |
| `ELLE_LIVE_TRADING` | optional | Second key for real money — must be exactly `on` or live trading is refused. |
| `LLM_GROK_KEY` | optional | xAI Grok fallback lane. |
| `LLM_GROQ_KEY` | optional | Groq free-tier fallback lane. |
| `LLM_GITHUB_MODELS_KEY` | optional | GitHub Models free-tier fallback lane. |
| `LLM_OLLAMA_KEY` | optional | Auth for a self-hosted Ollama, if it needs one. |
| `ANTHROPIC_API_KEY` | optional | Legacy/advisor Anthropic lane. |
| `LLM_API_KEY` | optional | Legacy generic OpenAI-compatible key (pairs with `LLM_BASE_URL`). |
| `FLOCK_IMAGE_KEY` / `FLOCK_VIDEO_KEY` | optional | Bearer for sovereign self-hosted image/video endpoints. |
| `PAYROLL_TOKEN_ENC_KEY` | optional | AES-256 key encrypting stored payroll OAuth tokens — required before *any* payroll provider works (`openssl rand -base64 32`). |
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | optional | QuickBooks payroll OAuth. |
| `GUSTO_CLIENT_ID` / `GUSTO_CLIENT_SECRET` | optional | Gusto payroll OAuth. |
| `ADP_CLIENT_ID` / `ADP_CLIENT_SECRET` | optional | ADP payroll OAuth (also needs the `ADP_MTLS_CERT` mTLS binding). |

¹ **At least one LLM key** is needed for real reasoning. Both are typed as
required in `LLMEnv`; if neither is set the worker falls back to the always-on
Workers AI pool (`env.AI`, no key) but with reduced capability.

### ⚙️ Config vars (`[vars]` / `.dev.vars`, not secret)

`ENVIRONMENT`, `VENUE_ID`, `OBSERVER_AUTODRAIN_USER`, `ELLE_CONVICTION_ENFORCE`,
`ELLE_MAX_ORDER_FRAC`, `ELLE_MAX_SYMBOL_FRAC`, `ALPACA_BASE_URL`,
`JOURNAL_INCLUDE_PRIOR_PROSE`,
`LLM_BASE_URL`, `LLM_MODEL_PRIMARY`, `LLM_MODEL_FAST`, `LLM_MODEL_CODE`,
`LLM_MODEL_REASONING`, `LLM_MODEL_OLLAMA`, `LLM_MODEL_GROQ`, `LLM_MODEL_GITHUB`,
`LLM_MODEL_ADVISOR`, `LLM_OLLAMA_URL`, `LLM_GITHUB_MODELS_URL`,
`FLOCK_IMAGE_PROVIDER`, `FLOCK_IMAGE_URL`, `FLOCK_IMAGE_MODEL`,
`FLOCK_IMAGE_MODEL_EDIT`, `FLOCK_VIDEO_PROVIDER`, `FLOCK_VIDEO_URL`,
`FLOCK_VIDEO_MODEL`, `QUICKBOOKS_REDIRECT_URI`, `QUICKBOOKS_ENVIRONMENT`,
`GUSTO_REDIRECT_URI`, `GUSTO_ENVIRONMENT`.

### 🔗 Bindings (create the resource, paste id into `wrangler.toml`)

`AI` (Workers AI) · `DB` (D1 `elle-corpus`) · `RAPID_DB` (D1 `rapid2ai-db`) ·
`SESSIONS`, `AUTH_TOKENS`, `SCRATCHPAD` (KV) · `DOCUMENTS` (R2 `elle-documents`) ·
`VECTORIZE` (`elle-corpus-vectors`) · `INGEST_QUEUE` (Queue) ·
`RAPID_AI`, `CUSTOMCOURSEBUILDER` (service bindings) ·
`ADP_MTLS_CERT` (mTLS certificate, uploaded separately).

### 🚀 CI / deploy secrets (GitHub Actions)

`CLOUDFLARE_API_TOKEN`, `ELLE_SERVICE_KEY` (+ `CLOUDFLARE_ACCOUNT_ID` for
`wrangler` if not pinned in config — the id is already pinned in code, not secret).

---

## Elle

Two deploy targets in one repo.

### Worker `elle` (web renderer, `.env` → build)

| Tag | Kind | Required | Purpose |
|---|---|---|---|
| `VITE_ELLE_WORKER_URL` | ⚙️ | ✅ | Base URL of elle-worker. |
| `ELLE_SANDBOX_KEY` | 🔐 | for sandbox | Shared secret the local agent sends; **must equal** the worker's `SANDBOX_AGENT_KEY`. |
| `VITE_ELEVENLABS_API_KEY` | 🔐 | optional | ElevenLabs voice (ships in the browser bundle — local use only). |
| `VITE_ELEVENLABS_VOICE_ID` / `_MODEL_ID` / `_MAX_CHARS` | ⚙️ | optional | Voice, model, per-reply char cap. |
| `ELLE_SANDBOX_LANES` / `ELLE_SANDBOX_POLL_MS` | ⚙️ | optional | Sandbox lane names / poll interval. |
| `ELLE_OLLAMA_URL` / `ELLE_LOCAL_MODEL` / `ELLE_EMBED_MODEL` / `ELLE_DUPLEX_INTERVAL_MS` | ⚙️ | optional | Sovereign local-model duplex lane. |

### Expo mobile (`mobile/.env`)

All optional and **public identifiers, not secrets**: `EXPO_PUBLIC_ELLE_WORKER_URL`,
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`,
`GOOGLE_IOS_URL_SCHEME`.

🚀 **CI:** `CLOUDFLARE_API_TOKEN`.

---

## FlockIntelligence

**Worker `flockintelligence`** (serves its own `web/` SPA too). Full grouped
reference with scopes/review gates lives in `FlockIntelligence/SECRETS.md`.

### 🔐 Secrets — core

| Tag | Required | Purpose |
|---|---|---|
| `FLOCK_TOKEN` | ✅ | App gate bearer; API is closed (503) until set. |
| `FLOCK_TOKEN_ENC_KEY` | ✅ for social | AES key encrypting stored per-channel OAuth tokens + signing OAuth state. |

### 🔐 Secrets — LLM / Elle (optional, self-host vs. service-to-service)

`LLM_GEMINI_KEY`, `LLM_OPENROUTER_KEY`, `ELLE_SERVICE_KEY`, `JWT_SECRET`.

### 🔐 Secrets — social app registrations (one app per platform, optional)

`META_APP_ID` / `META_APP_SECRET` (Instagram + Facebook) ·
`THREADS_APP_ID` / `THREADS_APP_SECRET` ·
`X_CLIENT_ID` / `X_CLIENT_SECRET` (write) + `X_API_KEY` / `X_API_SECRET` (media) ·
`TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` ·
`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` ·
`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` ·
(Bluesky: none — per-account app password). ·
Sovereign media: `FLOCK_IMAGE_KEY`, `FLOCK_VIDEO_KEY`.

### ⚙️ Config vars / 🔗 bindings

Vars: `FLOCK_OAUTH_REDIRECT_BASE`, `ELLE_WORKER_URL`, `FLOCK_IMAGE_*`,
`FLOCK_VIDEO_*`, `LLM_MODEL_*`, `LLM_WORKERS_AI_MODEL`. ·
Bindings: `AI`, `DB` (D1), `DOCUMENTS` (R2), `ASSETS`, `INGEST_QUEUE`. ·
**web frontend** (`web/.env.local`): `VITE_FLOCK_WORKER_URL` (⚙️ optional).

---

## RAPIDAi

Three Workers plus a Pages UI (`rapidai`). The UI needs no keys.

### Worker `rapid2ai-ingestion` (repo-root `wrangler.jsonc`, main API)

| Tag | Kind | Purpose |
|---|---|---|
| `INGEST_API_TOKEN` | 🔐 | Bearer guarding the ingest API. |
| `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` | 🔐/⚙️ | Cloudflare Access (Zero Trust) app audience + team domain guarding admin. |
| `VENUE_ID` / `VENDOR_ID_US_FOODS` | ⚙️ | Tenant / vendor ids. |
| `DB`, `R2` | 🔗 | D1 `rapid2ai-db`, R2 `rapid2ai-raw`. |

### Worker `rapid2ai-ai-worker`

| Tag | Kind | Purpose |
|---|---|---|
| `RAPID_API_TOKEN` | 🔐 | Bearer for this worker's API. |
| `ELLE_SERVICE_KEY` | 🔐 | Calls back into elle-worker. |
| `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` | 🔐/⚙️ | Cloudflare Access guard. |
| `ELLE_URL` / `VENUE_ID` | ⚙️ | elle-worker origin / tenant id. |
| `DB`, `VECTORIZE`, `AI`, `ELLE` | 🔗 | D1 + vectors + Workers AI + service binding. |

### Worker `rapid2ai-email-ingest`

| Tag | Kind | Purpose |
|---|---|---|
| `INGEST_API_TOKEN` | 🔐 | Must match the ingestion worker's token. |
| `INGEST_URL` / `ALLOWED_SENDERS` | ⚙️ | Ingestion endpoint / sender allowlist. |
| `FORWARD_ON_FAIL` / `MAX_EMAIL_BYTES` | ⚙️ | Optional forward address / size cap. |

🚀 **CI:** `CLOUDFLARE_API_TOKEN`.

---

## MOTaxIntelligence

**Worker `mo-tax`.**

| Tag | Kind | Required | Purpose |
|---|---|---|---|
| `TAX_SERVICE_KEY` | 🔐 | ✅ | Guards `/admin/ingest`, `/admin/verify`, `/admin/stats`. |
| `AI`, `VECTORIZE`, `DB` | 🔗 | ✅ | Workers AI + `mo-tax-vectors` + D1 `mo-tax`. |

🚀 **CI:** `TAX_SERVICE_KEY`, `INGEST_URL` (used to seed/verify after deploy).

---

## CustomCourseBuilder

**Worker `customcoursebuilder`** — course DB ingester/server.
**No secrets.** Only a binding: `DB` (🔗 D1 `customcoursebuilder-courses`).
`/ingest` is currently open (no service-key guard).

---

## elle-dev-console

**Cloudflare Pages.** **No build-time env vars** — auth is a per-user JWT
obtained at runtime via the login screen; worker URLs are hardcoded in
`src/targets.ts`.

🚀 **CI:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.

---

## elle-law

**Worker `elle-law`** (static SPA assets). Build-time `.env`:

| Tag | Kind | Required | Purpose |
|---|---|---|---|
| `VITE_ELLE_WORKER_URL` | ⚙️ | ✅ | elle-worker origin. |
| `VITE_ELLE_SERVICE_KEY` | 🔐 | optional | Service bearer for direct worker calls. |
| `VITE_SOVEREIGN` | ⚙️ | optional | Sovereign-mode flag. |
| `VITE_OLLAMA_URL` / `VITE_OLLAMA_MODEL` | ⚙️ | optional | Local Ollama lane. |

🚀 **CI:** `CLOUDFLARE_API_TOKEN`.

---

## GrantIntelligence

**Worker `grant-intelligence`** — assets-only static site. **No keys** (no
Worker script, no API surface yet).

---

## culinary-compass

**Worker `culinary-compass`** — SSR app served from `dist/`. **No secrets or
env vars** in the codebase. Only implicit bindings for its own assets.

---

## Dynanic-Hyperbolic-Neural-Graph

Node/TypeScript project with publisher **scripts** (no deployed worker). Env is
only read by `scripts/publish.ts` when pushing to Atlas:

| Tag | Kind | Purpose |
|---|---|---|
| `ATLAS_SERVICE_KEY` | 🔐 | Bearer to push snapshots to Atlas. |
| `ATLAS_PUSH_URL` / `ATLAS_PULL_URL` | ⚙️ | Atlas push/pull endpoints. |
| `ATLAS_EVENTS_PATH` | ⚙️ | Local events file (defaults to `data/events.json`). |

Nothing is required for normal local build — only to actually publish.

---

## Harmonizer

**Vercel** SPA with serverless `/api` functions (`chat.js`, `embed.js`, `infer.js`).

| Tag | Kind | Required | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 🔐 | ✅ | Claude calls in `/api`. |
| `VOYAGE_API_KEY` | 🔐 | ✅ | Voyage embeddings in `/api/embed`. |
| `VITE_APP_URL` | ⚙️ | optional | App base URL. |

Set the two secrets as **Vercel Environment Variables**.

---

## EthicalIntelligenceProject

**Astro** site (Netlify / Vercel / Docker). Only **public build-time vars** —
no server secrets in the app:

| Tag | Kind | Purpose |
|---|---|---|
| `PUBLIC_GOOGLE_CLIENT_ID` | ⚙️ | Google sign-in client id (public). |
| `PUBLIC_RAPIDAI_CHAT_API_URL` | ⚙️ | RAPIDAi chat endpoint. |

🚀 **CI:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `PUBLIC_GOOGLE_CLIENT_ID`.

---

## madmind-journal-home

**Vite SPA.** One var — everything else routes through elle-worker:

| Tag | Kind | Required | Purpose |
|---|---|---|---|
| `VITE_ELLE_WORKER_URL` | ⚙️ | ✅ | elle-worker origin (auth + storage). |

> `DATABASE_URL` / `STRIPE_SECRET_KEY` appear only as **commented examples** in
> `src/lib/config.server.ts` — not wired up, not required.

---

## AtlasEduIntelligence

Placeholder repo (README only, no code). **No keys.**

---

## MadMindMap

Placeholder repo (README only, no code). **No keys.**

---

### Cross-repo keys that must match

- `ELLE_SANDBOX_KEY` (Elle web) **=** `SANDBOX_AGENT_KEY` (elle-worker).
- `ELLE_SERVICE_KEY` is the **same god credential** shared into FlockIntelligence
  and rapid2ai-ai-worker — sharing it widens where that credential lives; prefer
  a narrower per-capability token where possible.
- `INGEST_API_TOKEN` must match between `rapid2ai-ingestion` and
  `rapid2ai-email-ingest`.
- Every Cloudflare deploy needs `CLOUDFLARE_API_TOKEN` (+ account id where the
  id isn't pinned in config) as a GitHub Actions secret.
