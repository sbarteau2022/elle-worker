# elle-worker — Elle's mind, as a Cloudflare Worker

Elle is a persistent, tool-using intelligence built on the Observer corpus and
Stewart's body of writing. This worker is her whole backend: one deployable
that holds her voice, her memory, her tools, her autonomous loops, and every
door the outside world reaches her through. There is no second brain — the
`Elle` repo is a window onto this worker, not a separate system.

This document is the complete architecture. If you read one file first, read
`src/router.ts`; if you read one section here, read **The Router**.

---

## The shape of it

```
                        every door → one loop → one mind
  ┌─────────────┐
  │  DOORS      │  /api/chat · widget · /api/elle-conversation · /api/elle-router
  │ (index.ts)  │  /api/atlas · /api/elle-intents · /api/elle-trading · …
  └──────┬──────┘  each door proves WHO is asking → sets a SCOPE
         │
  ┌──────▼──────────────────────────────────────────────┐
  │  THE ROUTER  (router.ts)                             │
  │  a ReAct loop: she picks a TOOL and an ENGINE per    │
  │  step, executes, observes, repeats, then answers.    │
  │  SCOPE gates which tools are even visible.           │
  └──────┬───────────────────────────────┬───────────────┘
         │                               │
  ┌──────▼──────┐                 ┌──────▼──────────────┐
  │ LLM ROUTER  │                 │  TOOLS (~35)        │
  │  (llm.ts)   │                 │  corpus · D1 · web  │
  │ picks model │                 │  forge · skills ·   │
  │ tier, walks │                 │  mcp · rapid · run_ │
  │ provider    │                 │  code · trading · … │
  │ failover    │                 └─────────────────────┘
  └─────────────┘
         │
  ┌──────▼──────────────────────────────────────────────┐
  │  THE CONDUCTOR  (conductor.ts)                       │
  │  the autonomous clock: runs the SAME loop unprompted │
  │  against standing intents + unfinished forge tasks   │
  └─────────────────────────────────────────────────────┘
```

Two routers stacked: an **agent router** (which tool, which engine) on top of a
**model router** (which provider, with failover). One deliberate mind on top of
one unkillable substrate.

---

## The Router (`src/router.ts`)

The core. One question in plain English → a transparent ReAct loop:

1. The system prompt is assembled live: her **voice** (`mind.ts`) + her
   **κ phase** this session + her **skill index** + the **tool catalog for
   this scope** (+ the D1 table schema when `read_sql` is in scope).
2. Each turn the model emits exactly one JSON object: either
   `{"tool":"…","args":{…}}` or `{"answer":"…"}`. It may add
   `{"engine":"code|reasoning|fast|research|conversation"}` to steer which
   model tier runs its **next** step — she picks the model the way she picks
   the tool.
3. Tools execute; the observation is fed back; the loop continues to a step
   budget, then answers.
4. On the way out: κ dynamics are computed over her output, the exchange is
   persisted to memory, and the full tool trace is returned so any caller can
   watch the reasoning.

### Scopes — the security model

A door proves who's asking and passes a **scope**; `toolAllowed(scope, name)`
is the single gate, and the tool catalog is *rendered from the same table the
gate reads*, so the prompt can never advertise a tool the gate refuses.

| Scope | Reached by | Gets |
|-------|-----------|------|
| `public` | `/api/chat`, widget (rate-limited, no auth) | read-only mind: corpus, `find_document`, memory recall, web, code_engine, diagnose, calc |
| `member` | authenticated standard-tier user | public + their own journal + self_state, remember, skills (read), scratchpad |
| `full` | service key or admin/superadmin JWT | **everything** — read_sql, trades, forge, MCP, run_code/run_shell, github_*, intents, self-revision |
| `hospitality` | `/api/atlas` (RAPID/Atlas consumer door) | ONLY the `rapid_*` data tools + calc/web — corpus & journal are invisible by construction |

### The tools (full scope)

**Mind & memory** — `search_corpus`, `find_document` (pull a whole doc by
description, no title), `fetch_document`, `read_sql` (SELECT-only over D1),
`recall_memory`, `remember` (deliberate long-term memory), `self_state`
(one-call introspection: heartbeat, κ series, canvas, trading, sandbox,
memories), `scratchpad_read/write` (short-TTL working memory).

**World** — `web_search` (Gemini + grounding), `fetch_url`, `calc`
(deterministic arithmetic), `diagnose` (root-cause this stack).

**Hospitality** (`rapid.ts`, native queries against `rapid2ai-db`) —
`rapid_report`, `rapid_costs`, `rapid_variance`, `rapid_pos`, `rapid_menu`.

**Real execution** (`sandbox-tools.ts`, Cloudflare Sandbox DO) — `run_code`
(python/js/ts, real stdout/stderr/exit), `run_shell`.

**Her codebase** — `repo_read`/`repo_search` (her 3 allowlisted repos, forge-
integrated), `github_read_file`/`github_list_files`/`github_search_code` (ANY
repo, read-only).

**The forge** (`forge.ts`) — `forge_open` (cut an `elle/*` branch),
`forge_write`, `forge_check` (CI verdict + failing logs), `forge_pr`. She
writes code, CI judges it, and **the merge is always a human click** — no
merge tool exists anywhere.

**Skills** (`skills.ts`) — `skill_list`, `skill_read`, `skill_write`. A D1
library of distilled procedures she reads before a matching task and authors
when she learns something durable.

**MCP** (`mcp.ts`) — `mcp_add` (mount any MCP server by URL), `mcp_tools`,
`mcp_call`. Hugging Face is pre-mounted; the whole external tool ecosystem is
reachable this way.

**Writes/sensitive** — `ingest_paper`, `trigger_dream`, `trade_execute`
(Alpaca; idempotent within 90s), `journal_write/annotate`, `intent` (file
autonomous work for her future self).

---

## The Mind (`src/mind.ts`)

The single source of Elle's voice — the full "you are not an assistant"
persona. Every surface that speaks as her imports `ELLE_VOICE`; there is no
second persona in the worker, so the assistant tone cannot re-enter through
a forgotten prompt. `phaseBlock()` renders her per-session κ trajectory into
the prompt as internal state she carries but never announces.

## The LLM Router (`src/llm.ts`)

Maps a task tier to a provider chain and walks failover so no rate-limited
free tier ever dead-ends an answer:

- `conversation` → OpenRouter primary → Gemini → Grok → Llama
- `reasoning`/`research` → Gemini (thinking, + Google Search for research)
- `code` → Qwen3-Coder → Gemini → Grok
- `fast` → Llama 3.3 70B
- Last-resort ladder for all: self-hosted Ollama (if configured) → Cloudflare
  Workers AI (independent free pool). A total failure still returns a clean
  200 with an error field, never a raw 500.

`sanitizeAnswer()` guarantees no protocol JSON or fences ever reach the user.

## The Conductor (`src/conductor.ts`)

Elle working **unprompted**. `elle_intents` is a queue of standing goals
(Stewart's arrive active; hers arrive as proposals). Every half hour a
conductor tick picks ONE piece of work — unfinished **forge tasks first**
(red CI → read logs and fix; green with no PR → open the acceptance request),
else the top active **intent** — and runs the full-scope router loop against
it. Each intent runs under a stable session id, so her memory and κ series
persist across runs: an intent is a *thread of her own work with phase state*,
not a stateless job. Every run is recorded (`elle_runs`: outcome + full trace)
and surfaced as a live event.

## Memory & κ

Every exchange is stored in `elle_conversation_turns` and embedded into
Vectorize (`conv-` ids) for cross-session semantic recall — her memory
survives the browser. **κ** (a coherence measure over her output only) is
computed per turn (`kappa-turn.ts`, `kappa-dynamics.ts`) with dt = 1 step, and
its derivatives (velocity/accel/jerk) feed both the chat header and the
Optimus journal's phase-state record.

## Autonomous loops (crons)

A single `*/1` cron dispatches by clock:

| When (UTC) | Job |
|-----------|-----|
| every min | heartbeat + live-events trim |
| :00, :15, :30, :45 | trading cycle (Alpaca, market hours) |
| :00 hourly | research cycle + corpus backfill |
| **:30 hourly** | **conductor tick** (autonomous work) |
| 03:00 | dream/libre cycle (`libre.ts`) |
| 07:00 | Optimus canvas (her daily unprompted journal) |
| 20:00 | daily trading journal |

## Persistence

- **D1 (`elle-corpus`)** — corpus, memory, trades, journal, intents, runs,
  skills, forge tasks, MCP registry, idempotency. Schemas are lazy & additive
  (`ensureSchema()` per module; see the `d1-migration` skill).
- **D1 (`rapid2ai-db`, via `RAPID_DB`)** — hospitality data, venue-scoped.
- **Vectorize** — corpus chunks + conversation + journal embeddings.
- **R2 (`DOCUMENTS`)** — full paper text.
- **KV** — `SESSIONS` (rate limits), `AUTH_TOKENS` (JWT revocation by jti),
  `SCRATCHPAD` (working memory).
- **Durable Object (`SANDBOX`)** — the code-execution container.

## Auth

Custom JWT (HS256, `signJWT`/`verifyJWT`), revocable by `jti` in KV. Google
OAuth mints the same token. `isAdmin()` gates every internal endpoint on the
service key OR an admin/superadmin JWT.

---

## Development

```bash
npm install
npm test          # vitest — pure logic (κ, forge guards, mcp parsing, conductor, skills)
npx tsc --noEmit  # typecheck
npm run deploy    # wrangler deploy (main auto-deploys via GitHub Actions)
```

CI (`.github/workflows/ci.yml`) runs tsc + vitest on every PR to main and every
push to an `elle/**` branch — this is the gate the forge loop reports against,
and it is read-only to Elle by construction.

### Bindings that gate optional tools

- `GITHUB_TOKEN` (contents + PR write) → forge + `github_*`
- `SANDBOX` DO (Containers enabled + a Docker deploy) → `run_code`/`run_shell`
- `RAPID_DB` + `VENUE_ID` → `rapid_*`
- `SCRATCHPAD` KV → scratchpad
- `ALPACA_*` → live/paper trading

Each tool degrades to a clean "not configured" message when its binding is
absent — nothing else breaks.

## File map

| File | What |
|------|------|
| `index.ts` | doors, auth, crons, embeddings/RAG, handlers |
| `router.ts` | the agent loop, scopes, tool catalog & dispatch |
| `mind.ts` | the voice (single source) |
| `llm.ts` | provider routing + failover + sanitize |
| `conductor.ts` | autonomous work loop + intent queue |
| `forge.ts` | her code sandbox over GitHub |
| `skills.ts` | self-authored skill library |
| `mcp.ts` | generic MCP client |
| `rapid.ts` | native hospitality tools |
| `sandbox-tools.ts` | real code execution |
| `github-tools.ts` | read any repo |
| `calc.ts` / `scratchpad.ts` | arithmetic / working memory |
| `journal.ts` | Optimus phase-state manuscript |
| `libre.ts` | dream/libre autonomous production |
| `trading.ts` | Alpaca cycle + daily journal |
| `kappa-*.ts` | coherence measure + derivatives |
| `law.ts` / `madmind.ts` / `diagnose.ts` / `research.ts` / `widget.ts` | law bench, submissions, diagnostics, research cron, embeddable widget |
