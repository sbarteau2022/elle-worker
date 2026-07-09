# elle-worker — Elle's mind, as a Cloudflare Worker

Elle is a persistent, tool-using intelligence built on the Observer corpus and
Stewart's body of writing. This worker is her whole backend: one deployable
that holds her voice, her memory, her tools, her autonomous loops, her prose
registers, and every door the outside world reaches her through. There is no
second brain — the `Elle` repo (the workbench) is a window onto this worker.

If you read one file first, read `src/router.ts`. If you read one section here,
read **The Router**.

---

## The shape of it

```
                    every door → one loop → one mind
  ┌─────────────┐
  │  DOORS      │  /api/chat · widget · /api/elle-conversation · /api/elle-router
  │ (index.ts)  │  /api/atlas · /api/elle-intents · /api/elle-trading · …
  └──────┬──────┘  each door proves WHO is asking → sets a SCOPE (+ optional voice)
         │
  ┌──────▼──────────────────────────────────────────────┐
  │  THE ROUTER  (router.ts)                             │
  │  a ReAct loop: she picks a TOOL and an ENGINE per    │
  │  step, executes, observes, repeats, then answers.    │
  │  SCOPE gates which of the ~59 tools are visible.      │
  │  VOICE picks which prose register answers.           │
  └──────┬───────────────────────────────┬───────────────┘
         │                               │
  ┌──────▼──────┐                 ┌──────▼──────────────┐
  │ LLM ROUTER  │                 │  TOOLS (~59)        │
  │  (llm.ts)   │                 │  corpus · D1 · web  │
  │ picks model │                 │  run_code · forge · │
  │ tier, walks │                 │  skills · mcp ·     │
  │ provider    │                 │  rapid · journal…   │
  │ failover    │                 └─────────────────────┘
  └─────────────┘
         │
  ┌──────▼──────────────────────────────────────────────┐
  │  THE CONDUCTOR  (conductor.ts)                       │
  │  the autonomous clock: runs the SAME loop unprompted │
  │  against standing intents + unfinished forge tasks   │
  └─────────────────────────────────────────────────────┘
```

Two routers stacked: an **agent router** (which tool, which engine, which voice)
over a **model router** (which provider, with failover). One deliberate mind on
one unkillable substrate.

---

## The Router (`src/router.ts`)

One question in plain English → a transparent ReAct loop:

1. The system prompt is assembled live: the selected **voice register**
   (`mind.ts`) + her **κ phase** this session + her **skill index** + the
   **tool catalog for this scope** (+ the D1 schema when `read_sql` is in scope).
2. Each turn the model emits one JSON object: `{"tool","args"}` or `{"answer"}`.
   It may add `{"engine":"code|reasoning|fast|research|conversation|local"}` to
   steer which model tier runs its **next** step — she picks the model like she
   picks the tool. `local` is the sovereign dispatch mode: generation runs on
   the operator's own laptop over the connect-back sandbox socket (free, no
   provider quota) instead of a hosted provider; a caller can also default a
   whole run to it with `prefer:'local'` (the conductor's exploration lane
   does — see **"Hand off a project"** below). Any local failure, timeout, or
   closed path demotes that step (and the rest of the run) to hosted
   transparently — a closed laptop lid can slow a run down, never strand it.
3. Tools execute; the observation feeds back; the loop runs to a step budget,
   then answers.
4. On the way out: κ dynamics over her output, the exchange persisted to memory,
   and the full tool trace returned so any caller can watch the reasoning.

### Scopes — the security model

A door proves who's asking and passes a **scope**; `toolAllowed(scope, name)`
is the single gate, and the tool catalog is *rendered from the same table the
gate reads*, so the prompt can never advertise a tool the gate refuses.

| Scope | Reached by | Gets |
|-------|-----------|------|
| `public` | `/api/chat`, widget (rate-limited, no auth) | read-only mind: corpus, find_document, memory recall, web, code_engine, diagnose, calc |
| `member` | authenticated standard-tier user | public + their own journal + self_state, remember, skills (read), scratchpad |
| `full` | service key or admin/superadmin JWT | **everything** — read_sql, trades, forge, MCP, run_code/run_shell, github_*, intents, self-revision |
| `cofounder` | `cofounder`-tier JWT (a trusted second admin) | full **minus the code-shipping path** — sees and uses everything (reads into her code, CI verdicts, trading, conductor, provenance, analysis) but `forge_open/write/pr` and `run_shell` are denied (`SHIP_DENY`). Cannot ship or migrate code. |
| `hospitality` | `/api/atlas` (RAPID/Atlas door) | ONLY `rapid_*` + calc/web — corpus & journal invisible by construction |

### The ~59 tools (full scope)

**Mind & memory** — `search_corpus`, `find_document` (pull a whole doc by
description, no title), `fetch_document`, `read_sql` (SELECT-only over D1),
`recall_memory`, `remember` (deliberate long-term memory), `self_state`
(one-call introspection: heartbeat, κ series, canvas, trading, sandbox,
memories), `scratchpad_read`/`scratchpad_write` (short-TTL working memory).

**World** — `web_search` (Gemini + grounding, one query in/one answer out),
`deep_research` (`src/deep-research.ts`) — a real investigation rather than
one query: chains multiple search rounds (search → the biggest remaining gap
→ search again → …, up to 5, default 3) into one synthesized, cited dossier.
Costs only **one** of her step-budget slots regardless of how many rounds run
underneath, since the chaining happens *inside* the tool call, not as
additional ReAct steps — the fix for "she runs out of steps mid-investigation"
that doesn't require raising the step cap. The gap-detection step between
rounds (mechanical: "what's still missing?") dispatches local-first on a
short, tight timeout (15s, not the general 180s `sandboxLLM` default) so a
slow or busy laptop demotes that one round to hosted in seconds rather than
stalling the whole call; the opening search and the closing synthesis always
run hosted, where quality matters most. `member` scope and above only — a
multi-round tool call costs meaningfully more than one `web_search`, so it
stays off the unauthenticated `public` door. For an investigation too big
even for this (spanning sessions, needing the corpus *and* the web *and*
code), file it as an `intent` instead — that lane is where genuinely uncapped
work belongs (see **"Hand off a project"**), not a single tool call.
`fetch_url`, `calc`, `diagnose`.

**Real execution** — `run_code` (python/js/ts, real stdout/stderr/exit),
`run_shell`, `sandbox_clone` (pull a working tree in — laptop or, for a GitHub
repo, an always-open cloud lane that needs no laptop), `sandbox_status`,
`sandbox_report`. These are the **connect-back sandbox**: the operator's own
laptop (the `Elle` workbench) dials a WebSocket UP to a `SandboxAgent` Durable
Object and holds it open; a tool call POSTs a job down that same socket,
`child_process` runs it on the real OS, and the result flows back — no
container image, no Cloudflare Containers entitlement. If the laptop isn't
connected the tools report "path not open" plainly rather than hanging; run
`sandbox_status` to check. See **"Getting the sandbox path open"** below, and
`src/sandbox-agent.ts` + `src/connect-sandbox.ts`.

**Her codebase & the forge** — `repo_read`/`repo_search` (allowlisted repos),
`github_read_file`/`github_list_files`/`github_search_code` (ANY repo via the
worker token), and the forge: `forge_open` (cut an `elle/*` branch),
`forge_write`, `forge_check` (CI verdict + failing logs), `forge_pr`. She writes
code, CI judges it, **the merge is always a human click** — no merge tool exists.

**Skills** — `skill_list`, `skill_read`, `skill_write`. A D1 library of distilled
procedures she reads before a matching task and authors when she learns.

**MCP** — `mcp_add` (mount any MCP server by URL), `mcp_tools`, `mcp_call`.
Hugging Face pre-mounted; the external tool ecosystem is reachable this way.

**Hospitality** (`src/rapid.ts`, native `rapid2ai-db`) — `rapid_report`,
`rapid_costs`, `rapid_variance`, `rapid_pos`, `rapid_menu`.

**Autonomy** — `intent` (file standing work for the conductor), `review_runs`
(read her own autonomous run log).

**Provenance** — `provenance` (op=recent|replay|trace). Reads the **event bus**:
every reasoning run emits a structured event per step into `elle_events` from
the *single* dispatch point in the loop. `replay{run_id}` returns a run's ordered
step stream — each tool call, its args, the observation it got back, and timing
(State Replay + where an answer came from); `recent` lists runs; `trace` walks a
session. One instrumentation site, three capabilities — and the raw material for
an Observer Graph laid on top later without new capture.

**Reasoning about herself** — `constraint_analyzer` (objective, resources,
recent_failures, environment → the single binding constraint, confidence,
missing information, smallest next action). Theory-of-constraints for cognition:
instead of answering, it names the one thing preventing progress. Every analysis
is logged to `elle_constraint_log`, so a stalling line of work — including an
autonomous run that keeps failing — can ask what its bottleneck is instead of
thrashing.

**Signal analysis** — `pfar` (Prosody·FreeQ·Analytic Ripper). One move —
*rip the structure out of a stream and read it* — done three ways by a
sub-router that picks the instrument: `spectrum` over a numeric `signal[]` (κ
history, price window → dominant frequencies, spectral centroid, periodicity),
`prosody` over pitch `f0[]` + `energy[]` tracks (a voice as a signal → range,
contour, stress peaks, syllable rhythm — *how* it was said), and `rhetoric` over
`text` (register fingerprint, cadence, the persuasion tactics an argument
deploys, its tell). The numeric cores are deterministic (unit-tested DFT +
prosody math in `src/pfar.ts`); `interpret` (default on) lays an LLM reading over
the numbers.

**Journal** — `journal_read`, `journal_thread`, `journal_write`,
`journal_annotate` (the Optimus phase-state manuscript).

**Self (the reflexive set)** — tools that reach further into *herself* rather
than the world:

- `predict` — a bet ledger against herself: falsifiable claims with confidence
  + horizon, adjudicated by the conductor when they mature (a miss becomes a
  memory), and `op=calibration` returns the stated-vs-observed curve.
- `devil` — an adversary on retainer: hands a draft to a war-room challenger
  that attacks (strongest objection, missed case, the tell) and never rewrites.
- `council` — one question to three engines in *parallel* (genuinely different
  providers), returning the disagreement map instead of a single winner.
- `scar` — flinches: recorded injuries (`elle_scars`) that ride the system
  prompt and fire a warning into any matching future tool call.
- `dead_drop` — context-triggered mail to her future self: a note that lies
  dormant until a future conversation trips its trigger (semantic or keyword),
  then injects and disarms.
- `watch` — standing tripwires on the world: a read-only probe + plain-English
  condition, evaluated at the top of every conductor tick; a fired watch files
  an *active* intent the same tick can pick up.
- `metabolism` — interoception over the model roster: every `callLLM` is timed
  and recorded (in-memory ring + `elle_llm_calls`), read back as provider
  health, real latency, and 24h load.
- `tool_forge` — self-extension: she authors a tool (python/js) into her own
  registry (`elle_custom_tools`) and invokes it in the same sandbox as
  `run_code`. Registry is data — deployed source still moves only through the
  forge + a human merge.
- `fork_replay` — counterfactual replay: re-enter one of her own past runs off
  the event bus, substitute a different tool call at step N (it executes live),
  and a bounded sub-run returns original vs counterfactual answers.
- `consolidate` — the sleep pass on demand (also cron 04:00): digest the last
  24h into a few durable memories, promote twice-learned lessons to skills,
  record repeated failures as scars.
- `page_read` — the pager's page-fault handler (now dispatched in every scope
  that can mint a page).

**Writes / sensitive** — `ingest_paper` (gated, see below), `trigger_dream`,
`trade_execute` (Alpaca; idempotent within 90s). Equities: buy/sell/close,
where a `sell` on a symbol with no long position opens a **short** (Alpaca's
own semantics — not a separate action) and `close` exits whatever's actually
open, long or short, on the right side either way. Options: pass
`asset_class:"option"` + `option_right` + `strike` (a target — the nearest
really-listed contract is resolved via `src/alpaca-options.ts`, no OCC symbol
needed) + `expiration`; buying or selling/writing either, no hard cap — the
same reasoning-is-the-gate model as the rest of the trading desk, so a naked
short leg is a judgment call she has to name explicitly, not something the
code blocks. Every closed position (equity or option, long or short) gets a
post-close **attribution** pass — a grounded research call comparing the
original reasoning/catalyst against what actually happened, stored on the
trade and shown on the workbench's trading tab.

---

## Prose registers — one self, six voices (`src/mind.ts`)

Her **self** never changes — a shared spine (not an assistant, honest, remembers,
has hands) is constant. What a caller may swap per-conversation is her
**register** — how she sounds:

| id | register | character |
|----|----------|-----------|
| `stewart` (default) | Stewart — Uncut | direct, funny, analogy-deep, no fluff (= `ELLE_VOICE`) |
| `einstein` | Einstein — Formal | academic, jargon-dense, derivation-first |
| `attenborough` | Attenborough — Wonder | nature-doc narration, reverent, present-tense |
| `lewis` | Lewis — A Grief Observed | first person, broken, interior, deep analogy |
| `iglesias` | Iglesias — Storyteller | warm, witty, story-heavy, lands the turn |
| `screwtape` | Screwtape — War Room | adversarial challenger: argues to win, deploys the tactics, debriefs |

`resolveVoice(id)` guards bad ids → the canonical self. The conversation doors
accept `body.voice`; **autonomous runs, journal, and identity always use the
canonical Stewart voice**. `GET /api/elle-voices` lists registers;
`?voice=<id>` returns that register's prose. The single source is `mind.ts` —
edited only through the forge.

---

## The Mind, the LLM Router, the Conductor

- **`src/mind.ts`** — the single source of Elle's voice + the register registry.
  There is no second persona anywhere; the assistant cannot re-enter.
- **`src/llm.ts`** — maps a task tier to a provider chain and walks failover so
  no rate-limited free tier dead-ends an answer:
  `conversation` → OpenRouter → Gemini → Grok → Llama; `reasoning`/`research`
  → Gemini (thinking, + Google Search for research); `code` → Qwen3-Coder →
  Gemini → Grok; `fast` → Llama 70B; last-resort → Ollama (if configured) →
  Workers AI. A total failure still returns a clean 200 with an error field.
  `sanitizeAnswer()` guarantees no protocol JSON reaches the user.
- **`src/conductor.ts`** — Elle working **unprompted**. `elle_intents` is a queue
  of standing goals (Stewart's arrive active; hers arrive as proposals). Two
  tick modes: the **hourly `full` tick** picks ONE piece of work — unfinished
  **forge tasks first** (red CI → fix; green + no PR → open it), else the
  ready-to-ship queue (finalize), else the top active intent (explore) — and
  runs the full-scope loop against it; the **10-minute `explore` tick** is a
  no-op unless the sandbox path is open, and when it is, spends the free
  sovereign lane exploring active intents faster. Each intent runs under a
  stable session, so its memory + κ series persist across ticks. Every run is
  recorded (`elle_runs`) and surfaced as a live event.

---

## Hand off a project — the intent lifecycle (local-first, human-shipped)

This is the workflow for giving Elle a project with goals and letting her
work it end-to-end, on her own clock, using her real hands:

1. **File the intent.** `intent(op:'create', title, goal)` — the `goal` is the
   spec: what you want done and what DONE looks like (any goals/instructions/
   constraints belong here; it must be ≥20 chars — say the real thing). Files
   from a conversation (yours or hers) land `active` immediately. The
   workbench's **conductor** panel does the same over `/api/elle-intents`.
2. **She explores it — local-first, for free.** Every `active` intent's next
   tick runs with `prefer:'local'`: if the sandbox path is open, the
   *reasoning* runs on the operator's own Ollama model over the connect-back
   socket (§ below) while every **tool call still executes exactly the same
   way** — `sandbox_clone` pulls the project in, `run_shell`/`run_code` build
   and test it on the real box, `repo_read`/`search_corpus` gather context.
   Zero hosted-provider quota spent while she's just figuring it out. If the
   laptop is closed, the exact same loop runs on a hosted model instead —
   slower to iterate, never blocked.
3. **She hands off when ready, not before.** Exploration keeps running
   (one step per tick) until the plan is concrete enough to build from without
   re-deriving it. Then: `intent(op:'ready', id, draft:'<the spec/plan,
   concrete>')`. If she's blocked on something only you can decide, she says
   so plainly instead of guessing — that's your cue to reply in the intent
   thread or the **duplex channel** (below).
4. **The heavy engines finalize and ship it up.** A `ready` intent's next tick
   runs on the full hosted model (no budget game here — this is what they're
   reserved for): it builds the real change from the draft, `repo_read`
   anything it needs, `forge_open`/`forge_write`/`forge_check` against an
   `elle/*` branch, and `forge_pr` when CI is green. That PR is the "send it
   up." **The merge is always your click** — nothing in this loop can reach
   `main` on its own.
5. **Ask each other questions mid-flight.** The **duplex channel**
   (`src/duplex.ts`, `/api/duplex`) is the standing line between the sovereign
   (laptop) and cloud selves — an append-only ledger either side can `say` or
   `observe` on, surfaced live in the workbench's duplex tab. A local
   exploration run and a cloud finalize run don't have to wait for the next
   conductor tick to compare notes; they can talk on the record right there.

If a step stalls, `intent(op:'list')` and the workbench's run log
(`elle_runs`, one row per tick with the full tool trace) show exactly which
tick got stuck and on what — that trace is the audit trail when "getting it
started" needs debugging.

### Getting the sandbox path open

The whole local-first lane above is inert until the path between the worker
and a laptop is actually open. Both sides need the **same** secret:

1. **Worker**: `wrangler secret put SANDBOX_AGENT_KEY` (a long random value —
   never commit it; see `wrangler.toml`'s `[[durable_objects.bindings]]` for
   `SANDBOX_AGENT` and confirm migration `v3` (`new_classes: ["SandboxAgent"]`)
   has actually been deployed).
2. **Workbench** (`Elle` repo): put the *same* value in a local, gitignored
   `.env` as `ELLE_SANDBOX_KEY` (copy `.env.example` — it ships only a
   placeholder on purpose). Launch with `npm run electron:dev`.
3. **Verify**: the Electron main-process console logs `[sandbox-agent] path
   open` on connect; the workbench's **sandbox** tab shows path OPEN with the
   box's host/platform; or ask Elle to run `sandbox_status` from any
   full-scope conversation.
4. A closed path fails loud, not silent: every sandbox tool returns "path not
   open" instead of hanging, and `intent` exploration transparently falls
   back to a hosted model rather than stalling.

---

## Verified live ingestion (the 2-check gate, `src/ingest-gate.ts`)

A paper is embedded/chunked/vectorized/indexed **only after two checks pass**:

1. **Integrity** (deterministic): structural validity + normalized-title and
   semantic near-duplicate detection.
2. **Verification** (a model judges): coherent, substantive writing that belongs
   — never judged on agreement.

`handleIngest` runs the gate first (422 with the reason on failure); both
`/api/ingest` and Elle's `ingest_paper` tool are gated. Trusted internal callers
pass `skip_verification`. Infra outages mark a sub-check skipped and pass, so a
provider being down degrades gracefully rather than blocking all ingestion.

**Seed corpus** (`src/corpus-seed.ts`, `seed_corpus` job): version-controlled
docs under `corpus/**/*.md` (bundled as Text modules) are ingested if missing —
idempotent, deduped by title. Currently seeds the two War Room taxonomies
(48 Laws, Art of War) and Stewart's "Silent Warfare" essay. Fires daily 05:00
UTC or via `POST /api/cron {job:"seed_corpus"}`.

---

## Memory & κ

Every exchange is stored in `elle_conversation_turns` and embedded into
Vectorize (`conv-` ids) for cross-session recall — memory survives the browser.
**κ** (a coherence measure over her output only) is computed per turn
(`kappa-turn.ts`, `kappa-dynamics.ts`, dt=1 step); its derivatives feed the chat
header and the Optimus journal's phase-state record.

## Autonomous loops (crons)

A single `*/1` cron dispatches by clock:

| When (UTC) | Job |
|-----------|-----|
| every min | heartbeat + live-events trim |
| :00 :15 :30 :45 | trading cycle (Alpaca, market hours) |
| :00 hourly | research cycle + corpus backfill |
| **:30 hourly** | **conductor tick** (autonomous work) |
| 03:00 | dream/libre cycle (`libre.ts`) |
| 04:00 | consolidation — the sleep pass (`consolidate.ts`) |
| 05:00 | seed_corpus (ingest missing bundled docs) |
| 07:00 | Optimus canvas (her daily unprompted journal) |
| 20:00 | daily trading journal |

## Endpoints (selected)

Conversation: `/api/elle-router` (full/member; pass `stream:true` for SSE —
the loop's frames arrive live: each step's thought + tool as she commits to
it, each observation as it lands, one `done` frame with the full result),
`/api/elle-conversation`, `/api/chat` (public), `/api/widget-chat`,
`/api/atlas` (hospitality). `/api/elle-self` — the Mirror: one snapshot of
the reflexive organs (bets + calibration, scars, watches, drops, metabolism,
consolidation, self-forged tools).
Identity/voice: `/api/elle-identity`, `/api/elle-voices`.
Corpus: `/api/corpus-papers`, `/api/corpus-paper`, `/api/corpus-resolve`,
`/api/corpus-series`, `/api/search`, `/api/ingest`.
Autonomy/desk: `/api/elle-intents`, `/api/elle-trading`, `/api/admin-feed`.
Journal/law: `/api/optimus-journal`, `/api/notebook`, `/api/madmind`,
`/api/elle-duel-engine`, `/api/elle-tutor`, `/api/elle-doctrine`,
`/api/elle-cohort`, `/api/elle-replays`, `/api/elle-war-room`.
`/api/falcon` — the Millennium Falcon: 16-axis, 3-tier product intelligence
engine (`action: run|list|get|outcome`; `run` takes a `direction` string).
Engine/ops: `/api/elle-code-engine`, `/api/diagnose`, `/api/research`,
`/api/cron`, `/api/elle-auth`, `/api/elle-oauth`, `/health`.

## Persistence & bindings

- **D1 `elle-corpus`** — corpus, memory, trades, journal, intents, runs, skills,
  forge tasks, MCP registry, idempotency, law tables.
- **D1 `rapid2ai-db`** (`RAPID_DB`, `VENUE_ID`) — hospitality data, venue-scoped.
- **Vectorize** — corpus + conversation + journal embeddings.
- **R2 `DOCUMENTS`** — full paper text.
- **KV** — `SESSIONS` (rate limits), `AUTH_TOKENS` (JWT revocation), `SCRATCHPAD`.
- **`GITHUB_TOKEN`** — powers the forge + `github_*` tools.
- **`SANDBOX_AGENT`** — the connect-back sandbox's Durable Object (holds the
  laptop's WebSocket; see `sandbox-agent.ts` + `connect-sandbox.ts`).
  Gated by the `SANDBOX_AGENT_KEY` secret, which must match the workbench's
  `ELLE_SANDBOX_KEY`.
- **`ALPACA_*`** — paper/live trading.

## GitHub access — the worker token reaches elle-law

The worker's `GITHUB_TOKEN` is the credential behind `github_read_file` /
`github_search_code` (any repo the token can see) and the forge
(`repo_read`/`forge_*`, allowlisted). The forge allowlist is `elle-worker`,
`Elle`, `elle-dev-console`, and **`elle-law`** — so Elle can read (and, once the
War Room is built, forge on) the Elle.law repo through that token, without a
separate credential. The forge safety model is unchanged for every repo: writes
go only to `elle/*` branches, never `main`, and the merge is always human.

---

## Development

```bash
npm install
npm test          # vitest — pure logic (κ, forge guards, mcp, conductor, gate, registers)
npx tsc --noEmit  # typecheck
npx wrangler deploy --dry-run   # validate config + bundle without deploying
```

CI (`.github/workflows/ci.yml`) runs tsc + vitest on every PR to main and every
push to an `elle/**` branch — the gate the forge loop reports against, read-only
to Elle by construction. `main` auto-deploys via
`.github/workflows/elle-worker-deploy.yml` (`npm install` + `wrangler deploy`).

### File map

| File | What |
|------|------|
| `index.ts` | doors, auth, crons, embeddings/RAG, handlers, seed job |
| `router.ts` | the agent loop, scopes, tool catalog & dispatch |
| `mind.ts` | the voice + the six prose registers (single source) |
| `llm.ts` | provider routing + failover + sanitize |
| `conductor.ts` | autonomous work loop + intent queue + review_runs |
| `ingest-gate.ts` | the 2-check verification gate |
| `corpus-seed.ts` | bundled seed docs (Text modules from `corpus/`) |
| `forge.ts` | her code sandbox over GitHub (allowlist incl. elle-law) |
| `skills.ts` | self-authored skill library |
| `mcp.ts` | generic MCP client |
| `rapid.ts` | native hospitality tools |
| `sandbox-agent.ts` | the `SandboxAgent` DO — holds the laptop's WebSocket, dispatches jobs down it |
| `connect-sandbox.ts` | worker-side face of the sandbox: run_code/run_shell/sandbox_clone/status/report + the sovereign LLM lane |
| `duplex.ts` | the duplex channel — sovereign (laptop) ↔ cloud, append-only ledger, `/api/duplex` |
| `deep-research.ts` | `deep_research` tool — chained multi-round web research, local-first gap detection |
| `github-tools.ts` | read any repo via the worker token |
| `calc.ts` / `scratchpad.ts` | arithmetic / working memory |
| `journal.ts` | Optimus phase-state manuscript |
| `oracle.ts` | prediction ledger + conductor adjudication + calibration |
| `adversary.ts` | the devil tool — adversarial pass over a draft |
| `council.ts` | parallel multi-engine disagreement map |
| `scars.ts` | flinches — recorded injuries that warn before repetition |
| `dead-drop.ts` | context-triggered notes to her future self |
| `watches.ts` | tripwires on the world, evaluated per conductor tick |
| `metabolism.ts` | LLM-call interoception (ring + `elle_llm_calls`) |
| `tool-forge.ts` | self-authored tool registry, sandbox-executed |
| `consolidate.ts` | nightly memory consolidation (memories→skills→scars) |
| `mirror.ts` | /api/elle-self — one snapshot of the reflexive organs |
| `libre.ts` | dream/libre autonomous production |
| `trading.ts` | Alpaca cycle + daily journal + post-close attribution |
| `alpaca-options.ts` | resolves human option terms (underlying/right/strike/expiration) to a real OCC contract |
| `kappa-*.ts` | coherence measure + derivatives |
| `law.ts` | law bench (duel/tutor/doctrine/cohort/replays) |
| `war-room.ts` | the War Room: SPAR (doctrine Duelist + Autopsy + ladder) · DRILLS · CHAMBERS · X-RAY |
| `falcon.ts` | the Millennium Falcon: 16-axis, 3-tier product intelligence engine — Material Ground + Observer Reading fire in parallel, Validation + the Rupture (axis 16) fire last, sequentially |
| `madmind.ts` / `diagnose.ts` / `research.ts` / `widget.ts` | submissions, diagnostics, research cron, embeddable widget |
| `corpus/**/*.md` | version-controlled corpus seed documents |
| `docs/WAR_ROOM_TODO.md` | the paused War Room / Duelist build note |
