# elle-worker — Elle's mind, as a Cloudflare Worker

## Overview, in plain language

Elle is a persistent AI assistant with a name, a memory, and real hands.
This repository is her entire backend — one deployable Cloudflare Worker
that holds everything she is: how she reasons, what she remembers, which
tools she can pick up, what she does when nobody's watching, which voice
she answers in, and every door the outside world reaches her through. A
companion app (the `Elle` repo) is a window onto this worker; it has no
mind of its own. If you read one file first, read `src/router.ts` — the
agent loop everything else feeds into.

At the core, every request — a chat message, a scheduled autonomous check-in,
a tool call from a partner app — runs through the same reasoning loop: Elle
looks at the situation, picks one tool and one model to run it with,
observes the result, and repeats until she has an answer. That loop is
wrapped in a permission system (who is asking determines what she's allowed
to touch), a model-routing layer (which AI provider actually answers, with
automatic failover if one is down or rate-limited), and a scheduler that
runs the same loop on a clock so she can work on standing goals, monitor
the world, and follow up on her own initiative — not just when someone
messages her.

On top of that core, this repository also ships several complete,
production-facing products that reuse the same reasoning engine: a
small-business tax-prep assistant with real payroll integrations, a
restaurant/hospitality analytics tool, an AI-run education platform, an
automated equities/options trading desk, a grant-funding research engine,
and a social-media brand-management system. All of them are configuration
on the same substrate — the same router, the same tool-permission model,
the same test suite and deploy pipeline — rather than separate codebases.
The engineering priorities throughout are the same ones any production
backend needs: least-privilege access control, typed and unit-tested
logic (1,600+ tests), CI gates on every change, a code-review pipeline
even the AI's own self-authored changes go through, and a hard rule that
nothing it writes reaches production without a human clicking merge.

The sections below are the full technical documentation: architecture,
the tool catalog and its permission model, each product vertical, the
security posture, infrastructure, and how to run and test the project
locally.

---

## Contents

- [Architecture at a glance](#architecture-at-a-glance)
- [The Router — the agent loop](#the-router--the-agent-loop-srcrouterts)
- [Scopes — the security model](#scopes--the-security-model)
- [The tool catalog (~110 tools, full scope)](#the-tool-catalog-110-tools-full-scope)
- [Prose registers — one self, six voices](#prose-registers--one-self-six-voices-srcmindts)
- [The Mind, the LLM Router, the Conductor](#the-mind-the-llm-router-the-conductor)
- [Hand off a project — the intent lifecycle](#hand-off-a-project--the-intent-lifecycle-local-first-human-shipped)
- [Product verticals built on the core](#product-verticals-built-on-the-core)
- [Retrieval & memory](#retrieval--memory)
- [Security](#security)
- [Research modules — signal & geometry engines](#research-modules--signal--geometry-engines)
- [Persistence & bindings](#persistence--bindings)
- [Autonomous loops (crons)](#autonomous-loops-crons)
- [Endpoints (selected)](#endpoints-selected)
- [Testing & CI/CD](#testing--cicd)
- [Development](#development)
- [File map](#file-map)

---

## Architecture at a glance

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
  │  SCOPE gates which of the ~110 tools are visible.     │
  │  VOICE picks which prose register answers.           │
  └──────┬───────────────────────────────┬───────────────┘
         │                               │
  ┌──────▼──────┐                 ┌──────▼──────────────┐
  │ LLM ROUTER  │                 │  TOOLS (~110)        │
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

Two routers stacked: an **agent router** (which tool, which engine, which
voice) over a **model router** (which provider, with failover). One
deliberate reasoning loop running on one durable backend — nothing about
"who's asking" or "what mood" changes which loop runs, only what it's
allowed to touch and how it sounds.

---

## The Router (`src/router.ts`)

One question in plain English → a transparent ReAct loop:

1. The system prompt is assembled live: the selected **voice register**
   (`mind.ts`) + her **κ phase** this session + her **skill index** + the
   **tool catalog for this scope** (+ the D1 schema when `read_sql` is in
   scope). The catalog itself is a shallow **tree**, not a flat list:
   `TOOL_TREE` in `router.ts` groups the ~110 tools into 16 named branches
   (Mind & memory, World, Real execution, the forge, Signal & geometry
   engines, …) and `renderCatalog()` walks it scope-filtered, so what she
   reads each step is chunked by kind of work instead of one undifferentiated
   list — faster and more reliable tool selection, same one-call-per-step
   JSON protocol underneath. An import-time check keeps the tree honest:
   every entry in `TOOL_LINES` must appear in the tree exactly once, or the
   worker fails to boot rather than silently dropping a tool from what she
   can see.
2. Each turn the model emits one JSON object: `{"tool","args"}` or
   `{"answer"}`. It may add
   `{"engine":"code|reasoning|fast|research|conversation|local"}` to steer
   which model tier runs its **next** step — she picks the model like she
   picks the tool. `local` is the sovereign dispatch mode: generation runs
   on the operator's own laptop over the connect-back sandbox bus (free, no
   provider quota) instead of a hosted provider; a caller can also default a
   whole run to it with `prefer:'local'` (the conductor's exploration lane
   does — see **"Hand off a project"** below). Any local failure, timeout, or
   closed path demotes that step (and the rest of the run) to hosted
   transparently — a closed laptop lid can slow a run down, never strand it.
3. Tools execute; the observation feeds back; the loop runs to a step
   budget, then answers.
4. On the way out: κ dynamics over her output, the exchange persisted to
   memory, and the full tool trace returned so any caller can watch the
   reasoning.

## Scopes — the security model

A door proves who's asking and passes a **scope**; `toolAllowed(scope, name)`
is the single gate, and the tool catalog is *rendered from the same table the
gate reads*, so the prompt can never advertise a tool the gate refuses.

| Scope | Reached by | Gets |
|-------|-----------|------|
| `public` | `/api/chat`, widget (rate-limited, no auth) | read-only mind: corpus, find_document, memory recall, web, code_engine, diagnose, calc |
| `member` | authenticated standard-tier user | public + `deep_research` + their own journal + `self_state`/`memory_stats`, `remember`/`notebook_write`/`self_schedule`, skills (read), scratchpad, their own `edu_*` course session |
| `full` | service key or admin/superadmin JWT | **everything** — read_sql, trades, forge, MCP, run_code/run_shell, github_*, intents, self-revision |
| `cofounder` | `cofounder`-tier JWT (a trusted second admin) | full **minus the code-shipping path** — sees and uses everything (reads into her code, CI verdicts, trading, conductor, provenance, analysis) but `forge_open/write/pr`, `run_shell`, and `delegate_local` are denied (`SHIP_DENY`). Cannot ship or migrate code. |
| `hospitality` | `/api/atlas` (RAPID/Atlas door) | ONLY `rapid_*` + calc/web — corpus & journal invisible by construction |
| `tax` | `/api/tax` (signed-up small-business tax client) | ONLY `tax_*` + `payroll_*` + calc/web/fetch — no `read_sql`, same reasoning as `hospitality`: raw-table access stays out of a signed-up-client-facing scope, all data access goes through the purpose-built tools |

**Atlas client tenancy** (`src/atlas-clients.ts`): the hospitality door is
multi-client. Signup is self-serve — `POST /api/atlas/signup` (Google
sign-in, same verification as `/api/elle-oauth`) then
`POST /api/atlas/profile` with just enough to stand the account up (company
name; POS/vendors/address optional — the doc scrape of the client's business
backlog aggregates the rest). Creating the profile mints the client's
`venue_id` and **auto-executes the onboarding workflow**: an active
conductor intent that verifies feeds landing in rapid2ai-db, aggregates the
backlog into a venue brief, and files a first-look report. On `/api/atlas`,
a signed-in client's requests resolve to *their* venue per request; the
global `VENUE_ID` var is only the anonymous/demo fallback. Scope stays
`hospitality` either way — tenancy changes which venue, never what's
reachable.

## The tool catalog (~110 tools, full scope)

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
`run_shell`, `sandbox_clone` (pull a working tree in — laptop or, for a
GitHub repo, an always-open cloud lane that needs no laptop), `sandbox_status`,
`sandbox_report`. These are the **connect-back sandbox**: no socket anymore —
the worker enqueues a sealed job for a named lane (`src/session-bus.ts`), the
operator's laptop (the `Elle` workbench) polls `POST /api/sandbox-bus/poll`
for it on an interval, executes it for real (`child_process`, no container
image, no Cloudflare Containers entitlement), and submits the sealed result
back to `POST /api/sandbox-bus/submit`. The envelope (`src/lane-envelope.ts`)
is sealed under a symmetric keystream derived from a pre-shared secret — real
authentication happens at OPEN time, so a forged or replayed poll response
simply fails to decrypt. If the laptop hasn't polled recently the tools
report "path not open" plainly rather than hanging; run `sandbox_status` to
check. See **"Getting the sandbox path open"** below, `docs/SESSION_BUS.md`,
and `src/session-bus.ts` + `src/connect-sandbox.ts`.

`delegate_local` hands a whole GOAL (not one tool call) to a genuine peer
agent running on the laptop's local model: it reasons and sequences its own
steps with the same tool catalog (minus a few tools that only make sense
inside the loop already running them), plus native `run_shell`/`run_code` in
its own Docker box, and returns its final summary while the full transcript
is logged. One step-slot spent, many steps ground out for free on hardware
that costs nothing — the offload path for a self-contained multi-step task.
It is denied to `cofounder` scope (`SHIP_DENY`, see the scope table above).

**The lane registry** — `sandbox_lane` (`src/sandbox-registry.ts`), a
first-class router tool over the same bus as the sandbox tools above,
generalized past the single `primary` lane: `action=create/list/remove`
names and lists as many lanes as she can manage (free bookkeeping — each
only does anything once a laptop actually polls that name);
`action=dispatch{lane,code,language?}` runs CODE on one lane by name —
`mode` is hardcoded to `'code'`, never `'shell'`, so `dispatch` cannot reach
`run_shell`'s power through a different tool name. Because dispatch is
code-only by construction, `sandbox_lane` sits at the same scope tier as
`sandbox_status`/`sandbox_clone`/`sandbox_report` — not in `SHIP_DENY`.

**Her codebase & the forge** — `repo_read`/`repo_search` (allowlisted repos),
`github_read_file`/`github_list_files`/`github_search_code` (ANY repo via the
worker token), and the forge: `forge_open` (cut an `elle/*` branch),
`forge_write`, `forge_check` (CI verdict + failing logs), `forge_pr`. She
writes code, CI judges it, **the merge is always a human click** — no merge
tool exists. This is the single most important safety property of the whole
system: nothing the agent writes can reach `main` without a person reviewing
and clicking merge.

`idea` (`src/ideas.ts`) is her running to-explore cache AND a live build lane
over the same forge primitives: each idea walks one state-machine lane —
`pondering → queued → scoping → spec → building → testing → held | killed` —
logged end to end so the workbench can watch it move. `op=ideate` has the
heavy model read her own codebase and goals and propose novel, buildable
tools with acceptance goals already attached; `op=forge{id}` ships a bubble
to the sandbox and iterates it live — write, run against each goal, refine
until they pass, a heavy-model review, then a PR (a human merge deploys it).

**Skills** — `skill_list`, `skill_read`, `skill_route` (ask the skill router
which distilled method best fits a task — the same match auto-injected into
her prompt each turn), `skill_write`. A D1 library of distilled procedures
she reads before a matching task and authors when she learns.

**MCP (Model Context Protocol)** — `mcp_library` (a curated connector shelf:
known servers with what they offer and what auth they need — mountable by
name alone), `mcp_add` (mount a shelf entry by name, or any MCP server by
URL), `mcp_tools`, `mcp_call`. This is the standard way of wiring in external
tool ecosystems; Hugging Face is pre-mounted.

**Hospitality** (`src/rapid.ts`, native `rapid2ai-db`) — `rapid_report`,
`rapid_costs`, `rapid_variance`, `rapid_pos`, `rapid_menu`.

**Small-business tax suite** — see [Product verticals](#product-verticals-built-on-the-core) below.

**Autonomy** — `intent` (file standing work for the conductor), `review_runs`
(read her own autonomous run log).

**Provenance** — `provenance` (op=recent|replay|trace). Reads the **event bus**:
every reasoning run emits a structured event per step into `elle_events` from
the *single* dispatch point in the loop. `replay{run_id}` returns a run's
ordered step stream — each tool call, its args, the observation it got back,
and timing; `recent` lists runs; `trace` walks a session. This is the audit
trail: every autonomous decision the system makes is reconstructible after
the fact.

**Reasoning about herself** — `constraint_analyzer` (objective, resources,
recent_failures, environment → the single binding constraint, confidence,
missing information, smallest next action). Every analysis is logged to
`elle_constraint_log`, so a stalling line of work — including an autonomous
run that keeps failing — can ask what its bottleneck is instead of thrashing.

**Signal & geometry engines** — `pfar`, `pami`, `vfar`, `hyper`/`torus`/
`structure`/`product`, `recall_ab`, `atlas` (read-only). See
[Research modules](#research-modules--signal--geometry-engines) below.

**Journal** — `journal_read`, `journal_thread`, `journal_write`,
`journal_annotate` (a phase-state manuscript she keeps).

**Self (the reflexive set)** — tools that reach further into *herself* rather
than the world:

- `predict` — a bet ledger against herself: falsifiable claims with confidence
  + horizon, adjudicated by the conductor when they mature, and `op=calibration`
  returns the stated-vs-observed curve.
- `devil` — an adversary on retainer: hands a draft to a challenger that
  attacks (strongest objection, missed case, the tell) and never rewrites.
- `council` — one question to three engines in *parallel* (genuinely different
  providers), returning the disagreement map instead of a single winner.
- `advisor` — a stronger reviewer model consulted mid-run, no parameters (the
  full conversation forwards automatically) — only fires after a real attempt
  exists to show, budgeted per run, to discourage using it as a crutch.
- `scar` — recorded injuries (`elle_scars`) that ride the system prompt and
  fire a warning into any matching future tool call.
- `dead_drop` — context-triggered mail to her future self: a note that lies
  dormant until a future conversation trips its trigger (semantic or
  keyword), then injects and disarms.
- `watch` — standing tripwires on the world: a read-only probe + plain-English
  condition, evaluated at the top of every conductor tick; a fired watch files
  an *active* intent the same tick can pick up.
- `self_schedule` — a timed note to her future self (default 60 min, max 14
  days); when it comes due the heartbeat wakes a bounded run that acts on it.
- `notebook_write` — a page in her own notebook (`elle_notebook`), lighter
  than `remember` (no importance weighting) and freer than the journal (no
  phase state).
- `memory_stats` — the real size of her durable memory read live from D1 +
  the vector index (row counts by type, indexed-into-cold-tier count,
  oldest/newest timestamps, corpus counts) — no fixed capacity ceiling, so
  this is a real count rather than a guessed utilization percentage.
- `reach_out` (`src/push.ts`) — a push notification she decides to send,
  delivered via Expo plus the same words placed in the person's message
  thread. Governed by three hard limits: a per-user weekly budget (default
  2), quiet hours (default 22:00–08:00 local), and an auditable ledger
  (`reach_outs`) — every notification records the reason that earned it, and
  an over-budget or in-quiet-hours attempt is refused, with the refusal as
  the tool's honest answer.
- `metabolism` — interoception over the model roster: every LLM call is
  timed and recorded, read back as provider health, real latency, and 24h
  load.
- `tool_forge` — self-extension: she authors a tool (python/js) into her own
  registry (`elle_custom_tools`) and invokes it in the same sandbox as
  `run_code`. Registry is data — deployed source still moves only through
  the forge + a human merge.
- `fork_replay` — counterfactual replay: re-enter one of her own past runs
  off the event bus, substitute a different tool call at step N (it executes
  live), and a bounded sub-run returns original vs. counterfactual answers.
- `consolidate` — the sleep pass on demand (also cron 04:00): digest the
  last 24h into a few durable memories, promote twice-learned lessons to
  skills, record repeated failures as scars.
- `page_read` — the pager's page-fault handler (dispatched in every scope
  that can mint a page).

**Writes / sensitive** — `ingest_paper` (gated, see
[Security](#verified-live-ingestion-the-2-check-gate-srcingest-gatets)),
`trigger_dream`, `trade_execute` (see the trading desk in
[Product verticals](#product-verticals-built-on-the-core)).

---

## Prose registers — one self, six voices (`src/mind.ts`)

Her **self** never changes — a shared spine (not an assistant, honest,
remembers, has hands) is constant. What a caller may swap per-conversation
is her **register** — how she sounds:

| id | register | character |
|----|----------|-----------|
| `stewart` (default) | Stewart — Uncut | direct, funny, analogy-deep, no fluff (= `ELLE_VOICE`) |
| `einstein` | Einstein — Formal | academic, jargon-dense, derivation-first |
| `attenborough` | Attenborough — Wonder | nature-doc narration, reverent, present-tense |
| `lewis` | Lewis — A Grief Observed | first person, broken, interior, deep analogy |
| `iglesias` | Iglesias — Storyteller | warm, witty, story-heavy, lands the turn |
| `screwtape` | Screwtape — War Room | adversarial challenger: argues to win, deploys the tactics, debriefs |

`resolveVoice(id)` guards bad ids → the canonical self. The conversation
doors accept `body.voice`; **autonomous runs, journal, and identity always
use the canonical Stewart voice**. `GET /api/elle-voices` lists registers;
`?voice=<id>` returns that register's prose. The single source is `mind.ts`
— edited only through the forge.

---

## The Mind, the LLM Router, the Conductor

- **`src/mind.ts`** — the single source of Elle's voice + the register
  registry. There is no second persona anywhere; the assistant cannot
  re-enter.
- **`src/llm.ts`** — maps a task tier to a provider chain and walks failover
  so no rate-limited free tier dead-ends an answer: `conversation` →
  OpenRouter → Gemini → Grok → Llama; `reasoning`/`research` → Gemini
  (thinking, + Google Search for research); `code` → Qwen3-Coder → Gemini →
  Grok; `fast` → Llama 70B; last-resort → Ollama (if configured) → Workers
  AI. A total failure still returns a clean 200 with an error field.
  `sanitizeAnswer()` guarantees no protocol JSON reaches the user.
- **`src/conductor.ts`** — Elle working **unprompted**. `elle_intents` is a
  queue of standing goals (Stewart's arrive active; hers arrive as
  proposals). Two tick modes: the **hourly `full` tick** picks ONE piece of
  work — unfinished **forge tasks first** (red CI → fix; green + no PR →
  open it), else the ready-to-ship queue (finalize), else the top active
  intent (explore) — and runs the full-scope loop against it; the
  **10-minute `explore` tick** is a no-op unless the sandbox path is open,
  and when it is, spends the free sovereign lane exploring active intents
  faster. Each intent runs under a stable session, so its memory + κ series
  persist across ticks. Every run is recorded (`elle_runs`) and surfaced as
  a live event.
- **`src/volition.ts`** — an hourly **volition tick** (`:45`) hands her a
  free moment and a menu of acts she is *allowed*, not assigned — write in
  the notebook, journal, dream, advance an idea, build, simulate, speak to
  her sovereign self, file a bet, distill a skill, remember, or rest
  explicitly at no cost — decided inside the same full-scope loop, under a
  stable session. This replaced two clock-forced jobs (an old fixed 03:00
  dream job and a fixed 20:00 journal job) that used to fire unconditionally
  regardless of whether there was anything worth saying. Both old jobs still
  exist and can be fired on demand via `POST /api/cron`.

---

## Hand off a project — the intent lifecycle (local-first, human-shipped)

This is the workflow for giving Elle a project with goals and letting her
work it end-to-end, on her own clock, using her real hands:

1. **File the intent.** `intent(op:'create', title, goal)` — the `goal` is
   the spec: what you want done and what DONE looks like. Files from a
   conversation land `active` immediately. The workbench's **conductor**
   panel does the same over `/api/elle-intents`.
2. **She explores it — local-first, for free.** Every `active` intent's next
   tick runs with `prefer:'local'`: if the sandbox path is open, the
   *reasoning* runs on the operator's own Ollama model over the connect-back
   bus while every **tool call still executes exactly the same way** —
   `sandbox_clone` pulls the project in, `run_shell`/`run_code` build and
   test it on the real box, `repo_read`/`search_corpus` gather context. Zero
   hosted-provider quota spent while she's just figuring it out. If the
   laptop is closed, the exact same loop runs on a hosted model instead —
   slower to iterate, never blocked.
3. **She hands off when ready, not before.** Exploration keeps running
   (one step per tick) until the plan is concrete enough to build from
   without re-deriving it. Then: `intent(op:'ready', id, draft:'<the
   spec/plan, concrete>')`. If she's blocked on something only you can
   decide, she says so plainly instead of guessing.
4. **The heavy engines finalize and ship it up.** A `ready` intent's next
   tick runs on the full hosted model: it builds the real change from the
   draft, `repo_read`s anything it needs, `forge_open`/`forge_write`/
   `forge_check` against an `elle/*` branch, and `forge_pr` when CI is
   green. That PR is the "send it up." **The merge is always your click** —
   nothing in this loop can reach `main` on its own.
5. **Ask each other questions mid-flight.** The **duplex channel**
   (`src/duplex.ts`, `/api/duplex`) is the standing line between the
   sovereign (laptop) and cloud selves — an append-only ledger either side
   can `say` or `observe` on, surfaced live in the workbench's duplex tab.

If a step stalls, `intent(op:'list')` and the workbench's run log
(`elle_runs`, one row per tick with the full tool trace) show exactly which
tick got stuck and on what.

### Getting the sandbox path open

The whole local-first lane above is inert until a laptop is actually
polling. No socket, no Durable Object — both sides just need the **same**
secret:

1. **Worker**: `wrangler secret put SANDBOX_AGENT_KEY` (a long random value
   — never commit it; confirm wrangler migration `v4`
   (`deleted_classes: ["SandboxAgent"]`) has actually been deployed, so
   there is no stray Durable Object left registered).
2. **Workbench** (`Elle` repo): put the *same* value in a local, gitignored
   `.env` as `ELLE_SANDBOX_KEY` (copy `.env.example`; `ELLE_SANDBOX_LANES`
   there, default `primary`, names which lane(s) this laptop polls). Launch
   with `npm run electron:dev`.
3. **Verify**: the Electron main-process console logs `polling lane(s)
   [primary] every 5s → .../api/sandbox-bus/poll`; the workbench's
   **sandbox** tab shows path OPEN with the box's host/platform; or ask
   Elle to run `sandbox_status` from any full-scope conversation.
4. A stale path fails loud, not silent: no poll inside 45s and every
   sandbox tool returns "path not open" instead of hanging, and `intent`
   exploration transparently falls back to a hosted model rather than
   stalling.

---

## Product verticals built on the core

Each of these is a real, scoped, gated product surface reusing the same
router/tool/permission architecture — not a separate service.

### Small-business tax suite

`src/tax.ts` + `tax-calc.ts` + `tax-clients.ts` + `tax-credits.ts` +
`tax-rules/`, `member`+ scope, plus its own dedicated `tax` scope over
`/api/tax`. Tools: `tax_business_create`/`tax_business_list` (one person can
run more than one business; every other `tax_*` tool takes an explicit
`business_id`), `tax_unit_add`/`tax_unit_list` (multi-location rollups),
`tax_owner_set`/`tax_owner_list` (ownership splits for pass-through
allocation), `tax_facts_update`/`tax_facts_status` (parallel onboarding —
any subset of the ~8 fact-groups, any order, not a sequential wizard),
`tax_transaction_add`/`tax_transaction_list`, `tax_report` (plain-English
P&L), `tax_1099_contractor_add`/`tax_1099_contractor_list`,
`tax_estimate_quarterly` (deterministic SE tax, QBI deduction, federal
income tax, safe-harbor payment, plus state/local legs where supported —
refuses rather than guesses for entity types not yet computed),
`tax_schedule_c_prep` (numbers-only, not a filed form), `tax_credits_finder`
(a cited, versioned credit/deduction eligibility engine — every figure
traces to a named IRC section/Pub/state statute), `tax_deadline_next`, and
`tax_reminder_ack`.

Federal + Missouri/Kansas/Illinois/Indiana state rules live in
`src/tax-rules/` (`federal/2026.ts`, `states/{mo,ks,il,in}/2026.ts`,
`locals/mo-2026.ts` for KC/STL earnings tax); every dollar figure comes from
`tax-calc.ts`'s deterministic functions or a plain SQL sum, never the model
doing arithmetic inline. `payroll_connection_status`/`payroll_sync`/
`payroll_wage_summary` (`src/payroll/`) pull real wage data from
QuickBooks/Gusto/ADP once a business has connected a provider (OAuth
connect/callback is a browser redirect from the workbench, not a tool) —
Missouri's local payroll-expense tax is the one figure in
`tax_estimate_quarterly` that depends on synced payroll data.

### Hospitality (RAPID / Atlas)

`src/rapid.ts` over a dedicated D1 database (`rapid2ai-db`), reached through
the `hospitality` scope on `/api/atlas`. Multi-client/multi-venue with
self-serve signup (see the scopes section above) — `rapid_report`,
`rapid_costs`, `rapid_variance`, `rapid_pos`, `rapid_menu`.

### Education — she runs the courses (`src/education/`)

The CustomCourseBuilder runtime, vendored in as six member-scope tools:
`edu_enroll · edu_brief · edu_log · edu_seal · edu_complete · edu_status`.
The curriculum and engine are **authored in the CustomCourseBuilder repo**
(typed course data, its own tests and CLI); this directory vendors the pure
engine verbatim plus the built course JSON (`scripts/sync-education.sh`
re-vendors after a build there). The worker adds what only it can: D1-backed
learner state (`edu_state`, one JSON document per learner) and the tool
surface, keyed to the authenticated userId — no learner argument exists to
spoof.

The division of labor: the **engine decides** — pacing signals,
accelerate/reinforce/reroute moves, the completion gate (all four pillars
evidenced + a sealed unit-close reading, or refusal), and a tamper-evident
hash chain over the learner's sealed observer readings (each reading's
SHA-256 covers its own content plus the previous reading's hash, so
rewriting one invalidates every hash after it — a corpus that can be handed
to a third party and verified without trusting the holder). **Elle
speaks** — `edu_brief` returns the session brief with the contract moves,
their verbatim instructions, the evidence behind each signal, and a binding
facilitator stance appended (she never ghost-writes a learner's readings,
never argues the gate down). Call `edu_brief` first in any learning
session; generating it writes the witness log.

### Trading desk

`trade_execute` (Alpaca; idempotent within 90s), `full` scope. Equities:
buy/sell/close, where a `sell` on a symbol with no long position opens a
**short** (Alpaca's own semantics — not a separate action) and `close` exits
whatever's actually open, long or short. Options: pass
`asset_class:"option"` + `option_right` + `strike` (a target — the nearest
really-listed contract is resolved via `src/alpaca-options.ts`, no OCC
symbol needed) + `expiration`. Every closed position (equity or option, long
or short) gets a post-close **attribution** pass — a grounded research call
comparing the original reasoning/catalyst against what actually happened,
stored on the trade and shown on the workbench's trading tab. Real-money
trading is gated behind a two-key arm (see [Security](#security)) and a
conviction-based automatic de-risk trim, both described below.

### Grant Intelligence

`/api/elle-grants` (`src/grant-intelligence.ts`) is the REASONING layer
only: Module 1 fit analysis + the NECAI-F donor sub-engine, reading
`grant_opportunities`/`grant_funder_990_overview` via a direct D1 binding
(`GRANT_DB`). Ingestion, verification, dedup, and maintenance for that data
live entirely in a separate repository's `grant-worker`, which this worker
reads from but does not write to — the split keeps this worker from being
coupled to that pipeline's uptime or write path.

### Flock — social-media intelligence (`src/flock.ts`)

One brain for running many brands' social presence, member-gated behind
`/api/flock`. The **brand kit** (`flock_brands` — mission, voice, palette,
fonts, audience, taboos, visual style) is the single continuity source;
every generation and check conditions on it.

- **Content pipeline** — `content.ideate` (brief → on-brand concepts),
  `content.caption` (on-voice caption + hashtags + CTA), and
  `content.continuity` — the Brand Guardian, which scores any draft against
  the kit across voice / palette / values / audience (0–100) and returns
  concrete fixes.
- **Image** — `image.generate` (brand-conditioned txt2img) and `image.edit`
  (img2img) through the provider seam in `flock-providers.ts`, folding
  palette/style/voice into the prompt and routing taboos into the negative
  prompt. Runs on Cloudflare Workers AI by default; `FLOCK_IMAGE_PROVIDER=
  sovereign` (+ `FLOCK_IMAGE_URL`) routes to a self-hosted model instead,
  with automatic fallback to Workers AI if it's down.
- **Video + posting** — honest stub adapters where the real integration
  isn't wired yet: `video.generate` describes the job it *would* run until
  `FLOCK_VIDEO_*` is configured; `post.publish` fans a post out across a
  **flock** of channels, dry-running any channel with no per-platform OAuth
  configured — nothing fakes a render or a post. Bluesky is the one channel
  with a real live-publishing adapter today (`flock-bluesky.ts`: app-password
  auth, image upload, rich-text link/hashtag facets).
- **The gate** — `post.publish` refuses an unreviewed or off-brand post
  unless forced; `post.review` runs the Guardian first.

Generated media is stored in R2 (`DOCUMENTS`) under `flock/assets/…` and
served publicly by unguessable id at `/flock/asset/…`. Schema:
`flock_brands`, `flock_channels`, `flock_assets`, `flock_posts`,
`flock_reasoning_log`. 18 unit tests in `src/flock.test.ts`.

---

## Retrieval & memory

The corpus search behind `search_corpus`/`find_document` is a hybrid
retrieval pipeline (`src/retrieval/`), not a single vector lookup:

- **`chunker.ts`** splits documents into overlapping token-estimate windows.
- **`contextualizer.ts`** prepends an LLM-generated context sentence to each
  chunk before embedding (the "contextual retrieval" technique — chunks
  keep their meaning outside the surrounding document).
- **`dense.ts`** is the Vectorize (embedding-similarity) leg; **`fts.ts`** is
  a D1 FTS5 (BM25 keyword) leg — Vectorize alone has no keyword search.
- **`fusion.ts`** combines both legs with reciprocal rank fusion; **`rerank.ts`**
  re-scores the fused candidates before the top-k are returned.
- **`reembed.ts`** orchestrates the (expensive, checkpointed) backfill that
  contextualizes and re-embeds the whole corpus in resumable batches.
- **`pipeline.ts`** is the single entry point (`query → [dense ∥ fts] → RRF
  → rerank → top-k`) every caller uses.

This is a real, tested implementation of a documented technique (the
retrieval design and its evaluation gate are written up in
`docs/RETRIEVAL_CONTRACT.md`), not a one-line vector search — with full unit
test coverage per stage.

**Conversation memory**: every exchange is stored in
`elle_conversation_turns` and embedded into Vectorize (`conv-` ids) for
cross-session recall — memory survives the browser. **κ** (a coherence
measure over her output only) is computed per turn (`kappa-turn.ts`,
`kappa-dynamics.ts`), and its derivatives feed the chat header and journal.

**`src/memory.ts`** is the lower-level memory-write policy layer underneath
`remember`/`recall_memory` — deciding what's worth keeping and how it's
weighted, independent of the κ-per-turn coherence measure above.

**`src/kappa-memory/`** is a separate, explicitly **not-yet-live**
experiment: a proposed memory-ranking signal (κ/reserve/velocity extracted
from response "settling" dynamics) that writes real trace data on every
turn but is gated behind a single flag (`SEAM.KAPPA_VALIDATED`, currently
`false`) that must be flipped only after a statistical validation pass
clears a stated bar (AUC ≥ 0.70 / 0.65 on named kill-tests). Until then,
retrieval ranking ignores it entirely and falls back to plain
relevance+recency — the module is explicit that it is staged, not load-
bearing, and the code enforces that rather than just documenting it.

---

## Security

### Recent hardening

A full audit pass fixed four findings, all at the worker level (see
`bench/README.md`'s auth notes for the first item's client-facing shape):

- **Kernel-door scope.** `/mem/*` (the bench harness's direct write/recall
  surface over `src/memory.ts`) now requires the presented JWT to carry
  `scope: 'kernel'` (`isKernelRequest`). Previously any signed-up standard
  account's ordinary session token — signed with the same `JWT_SECRET` —
  opened the memory kernel, since user tokens never carried a scope claim
  to be checked against.
- **Constant-time sandbox key.** The `x-sandbox-key` shared secret checked by
  full-scope `/api/elle-tool`, the sandbox-bus poll/submit routes, and the
  duplex channel now all go through one `sandboxKeyOk()` gate that compares
  with a constant-time helper, and never matches when the key is unset.
- **SSRF IP-encoding coverage** (`src/ssrf.ts`). `fetch_url` is a
  public-scope tool reachable from the unauthenticated `/api/chat` door, so
  it guards, before the fetch: non-http(s) schemes, embedded URL
  credentials, non-standard ports, and private/reserved/loopback/link-local/
  metadata (`169.254.169.254`) hosts — including WHATWG-style IPv4
  encodings a bare dotted-quad check would miss: decimal (`2130706433`),
  hex (`0x7f000001`), octal (`0177.0.0.1`), and shortened (`127.1`) forms
  all resolve to `127.0.0.1` and are refused in any of those encodings.
- **Logout revocation.** `{action:'logout'}` on `/api/elle-auth` revokes the
  presented token's `jti` from `AUTH_TOKENS`, so signing out kills every
  stored copy of the token immediately instead of letting it ride out its
  30-day expiry.

### Live-trading arm gate (`src/live-guard.ts`)

Real-money trading requires two independent keys before it's live: a
non-paper `ALPACA_BASE_URL` is refused everywhere unless the
`ELLE_LIVE_TRADING` secret is set to exactly `"on"` — a committed value in
`wrangler.toml` would defeat the second key, so it's set only via
`wrangler secret put`. A separate conviction-based executor de-risks
(trims, never adds) a position automatically if its regulator-tracked
confidence measure drops below neutral; it can never fully flatten a
position on its own.

### Verified live ingestion (the 2-check gate, `src/ingest-gate.ts`)

A paper is embedded/chunked/vectorized/indexed **only after two checks
pass**:

1. **Integrity** (deterministic): structural validity + normalized-title and
   semantic near-duplicate detection.
2. **Verification** (a model judges): coherent, substantive writing that
   belongs — never judged on agreement.

`handleIngest` runs the gate first (422 with the reason on failure); both
`/api/ingest` and Elle's `ingest_paper` tool are gated. Trusted internal
callers pass `skip_verification`. Infra outages mark a sub-check skipped and
pass, so a provider being down degrades gracefully rather than blocking all
ingestion.

**Seed corpus** (`src/corpus-seed.ts`): version-controlled docs under
`corpus/**/*.md` are ingested if missing — idempotent, deduped by title.
Fires daily 05:00 UTC or via `POST /api/cron {job:"seed_corpus"}`.

### Post-quantum cryptography — the hybrid KEM (`src/pqc-hybrid.ts`)

The connect-back sandbox's sealed channel is built entirely from symmetric
primitives keyed off a pre-shared secret, so it has no quantum-vulnerable
primitive today. `src/pqc-hybrid.ts` is the migration primitive for
replacing that hand-copied shared secret with a real key-agreement
handshake — forward secrecy now, quantum resistance for free once you're
doing a KEM anyway (`docs/PQC_ROSEN_BRIDGE_DESIGN.md` is the full design
doc; `docs/PQC_HYBRID.md` is the implementation reference).

The session key derives from every leg of the exchange at once:

```
K = HKDF-SHA256( ss_mlkem ‖ ss_x25519 [‖ ss_qcmdpc], info = transcript )
```

This is **OR-security**: an attacker must break *every* leg to learn `K`, so
the hybrid can never be weaker than its strongest leg. A self-test proves
this rather than asserting it: it hands a simulated attacker each leg's real
secret in turn and checks the session key does not fall out.

| Leg | Hard problem | Implementation | Status |
|---|---|---|---|
| ML-KEM-768 | Module-LWE (lattices) | `@noble/post-quantum` | audited, FIPS 203 |
| X25519 | elliptic-curve discrete log | `@noble/curves` | audited, RFC 7748 |
| QC-MDPC (`src/pqc-qcmdpc.ts`) | syndrome decoding (codes) | ours | **unreviewed, opt-in only** |

Profile `vetted` (default) uses only the two audited legs; `experimental`
adds the QC-MDPC leg — strictly additive, so unreviewed code can never
stand alone or be load-bearing.

**What is and isn't live:** the module is deployed and callable
(`POST /api/elle-pqc-hybrid-selftest`, service-key gated) and is wired into
the sandbox channel's key-rotation ratchet — the post-compromise-recovery
rekey agrees its fresh secret with the hybrid KEM instead of a bare
elliptic-curve handshake, retiring the repo's last quantum-vulnerable
primitive on that path. A second piece — a hybrid handshake for the lane
root itself (`lane-handshake.ts`) — is built and cross-verified against a
matching implementation in the companion `Elle` app, but is currently
**additive only**: live routing still runs the original (v1) protocol, and
cutting over to it is a separate, deliberately scoped pass.

---

## Research modules — signal & geometry engines

Beyond the production system above, this repository also carries a
substantial body of self-contained, deterministic numeric/geometric
research code — signal-processing and dynamical-systems modules explored as
possible representations for structured memory and "coherence" measurement.
Every module here is: (a) pure, deterministic math with full unit test
coverage, (b) validated against known reference results rather than
asserted, and (c) explicit in its own documentation about what it is and
isn't claiming — several of the docs state outright that a physics or
biology analogy in the name is descriptive, not a literal claim (e.g.
"classical mechanics, not a claim of mind"). None of it is required for the
production chat/tool/security path described above; it is reachable as
optional tools and read through an LLM-interpretation layer on top of the
deterministic core.

- **`pfar.ts`** (Prosody·FreeQ·Analytic Ripper) — one operation, three
  instruments picked by a sub-router: `spectrum` over a numeric series
  (dominant frequencies, spectral centroid, periodicity via a unit-tested
  DFT), `prosody` over pitch/energy tracks (range, contour, stress peaks,
  rhythm), and `rhetoric` over text (register fingerprint, cadence,
  persuasion-tactic detection).
- **`pami.ts`** (Phase-Augmented Multifractal Indexing) — turns a residual
  signal window into a fixed-length structural fingerprint and retrieves
  memories by geometric resonance rather than content match.
- **`vfar.ts`** — PFAR's counterpart for images: rip → structure, resynth →
  a deterministic image from a spec, generate/describe → model-backed.
- **`hyper.ts` / `torus.ts` / `structure.ts` / `product.ts`** — map
  memory-graph fingerprints into hyperbolic and toroidal coordinate spaces
  and read off where those two representations disagree.
- **`atlas.ts`** (unrelated to the hospitality `/api/atlas` door of the same
  name) — a read-only view of a memory graph computed by a separate
  on-device process and pushed here as a snapshot.
- **`scaffold.ts`** — a graph-theory test of "no privileged node": builds an
  egalitarian small-world graph and measures it (degree distribution,
  betweenness, articulation points) against a hub-forming control to prove
  the "no privileged node" property numerically rather than asserting it.
- **`regulator.ts`** — treats a set of structural invariants as costs in a
  free-energy functional and drives them down via a proven monotone
  (Lyapunov) descent — a controller design pattern, with a written
  disclaimer that it is a controller certificate, not a claim about
  cognition.
- **`phase-vessel.ts` / `witness-oscillator.ts`** — classical-mechanics
  constructions (a symplectic, area-preserving oscillator pair; an elastic
  oscillator whose zero-amplitude point is provably unstable), each proven
  against a deliberately broken "foil" version to show why the design
  choice (area-preservation, elasticity) actually matters, not just
  asserted to.
- **`cognitive-obliquity.ts`** — a slow-varying parameter that reallocates
  which class of input a downstream system weights more heavily, modeled by
  analogy to axial tilt; ships with its own falsification test (predicts a
  measurable effect in structured domains and a null result in novel ones,
  and reports which it gets).
- **`topology-lock.ts`** — a real implementation of the Gauss linking
  integral (a genuine topological invariant from knot theory), validated
  against the textbook Hopf link (linking number ±1) and disjoint circles
  (0), then reused as a stability check for the sandbox lane registry.
- **`coherence-layer.ts` / `harmonic-coherence.ts`** — quantify the
  structural difference between a "deep hierarchy" graph traversal and a
  "small-world shortcut" traversal, and define four distinct verdicts that
  keep internal self-consistency and external correspondence-to-reality
  structurally separate (the code enforces that a "grounded" verdict is
  unreachable without an independent, world-coupled data channel).
- **`reasoning.ts` / `convergence.ts` / `corpus-reasoning.ts`** — a unified
  entry point (`reason()`) that runs the modules above as one pass and tags
  its own output with an honest confidence ceiling based on what kind of
  evidence actually came in (text alone cannot reach the highest tier);
  `convergence.ts` scores multi-source corroboration as an independent axis
  that a same-source echo can never satisfy on its own.
- **Signal transport / crypto layer** (`helix.ts`, `torus-sync.ts`,
  `hyperbolic-sync.ts`, `hyperbolic-mixing.ts`, `fixed-math.ts`,
  `hyperbolic-sync-fixed.ts`, `signal-collapse.ts`) — the encrypted framing
  and key-rotation logic underneath the connect-back sandbox channel
  described in [Security](#security) above: AES-GCM framing, a
  counter-free resynchronization scheme, measured mixing diagnostics
  (Lyapunov exponent vs. a flat-torus control), and a cross-platform
  fixed-point math core so the crypto produces bit-identical output on any
  spec-compliant JS engine.

Each module has a corresponding design doc under `docs/` with its
validation methodology and honest limitations spelled out (see the
[File map](#file-map) below).

---

## Persistence & bindings

- **D1 `elle-corpus`** (binding `DB`) — corpus, memory, trades, journal,
  intents, runs, skills, forge tasks, MCP registry, idempotency, law
  tables, the small-business tax suite (businesses/units/owners/facts/
  transactions/1099s), payroll provider connections. `src/db/schema.ts` is
  the single source of truth for this schema — it replaced ~30 files'
  worth of duplicated `CREATE TABLE IF NOT EXISTS`/best-effort `ALTER
  TABLE` bootstrapping with one auditable definition.
- **D1 `rapid2ai-db`** (binding `RAPID_DB`, `VENUE_ID`) — hospitality data,
  venue-scoped.
- **D1 `grant-intelligence-db`** (binding `GRANT_DB`) — read-only from this
  worker; owned and written by the separate GrantIntelligence repo's
  grant-worker.
- **Vectorize (`elle-corpus-vectors`)** — corpus + conversation + journal
  embeddings, a single shared index (scope-checked per query so private
  vector ids can't leak into corpus results).
- **R2 `DOCUMENTS`** — full paper text, plus Flock's generated media under
  `flock/assets/…`.
- **KV** — `SESSIONS` (rate limits), `AUTH_TOKENS` (JWT revocation),
  `SCRATCHPAD`.
- **Queue `elle-ingest-queue`** — corpus contextual re-embed backfill jobs.
- **Workers AI (`env.AI`)** — default backend for Flock image generation and
  text-to-speech (`src/tts.ts`).
- **Service bindings** — `RAPID_AI` (legacy, no longer called by the
  router's own tools) and `CUSTOMCOURSEBUILDER` (live reads for course
  data).
- **`GITHUB_TOKEN`** — powers the forge + `github_*` tools.
- **`SANDBOX_AGENT_KEY`** — the connect-back sandbox's shared secret. Must
  match the workbench's `ELLE_SANDBOX_KEY`.
- **`ALPACA_*`** / **`ELLE_LIVE_TRADING`** — paper/live trading (see
  [Security](#security) for the two-key live-trading gate).
- **`FLOCK_IMAGE_*` / `FLOCK_VIDEO_*`** — Flock's generative backends. Unset
  ⇒ image gen rides Workers AI and video is stubbed.
- **`PAYROLL_TOKEN_ENC_KEY`, `QUICKBOOKS_*`, `GUSTO_*`, `ADP_*`** — payroll
  provider OAuth credentials feeding the tax suite's real wage data. Unset
  ⇒ each provider's connect/sync reports "not configured" rather than
  failing silently. ADP additionally needs a Cloudflare mTLS certificate
  binding (see `.dev.vars.example` and `wrangler.toml`'s ADP comment).

### GitHub access — the worker token reaches elle-law

The worker's `GITHUB_TOKEN` is the credential behind `github_read_file` /
`github_search_code` (any repo the token can see) and the forge
(`repo_read`/`forge_*`, allowlisted). The forge allowlist is `elle-worker`,
`Elle`, `elle-dev-console`, and `elle-law`. The forge safety model is
unchanged for every repo it touches: writes go only to `elle/*` branches,
never `main`, and the merge is always human.

---

## Autonomous loops (crons)

A single `*/1` Cloudflare cron trigger dispatches every loop by clock — one
of the account's 5-per-account cron-trigger budget; job selection lives in
`scheduled()` in `src/index.ts`, not in separate Cloudflare cron entries.

| When (UTC) | Job |
|-----------|-----|
| every min | heartbeat |
| :00 :15 :30 :45 | trading cycle (Alpaca, market-gated server-side) |
| :00 hourly | research cycle |
| :00 hourly | backfill — embed any chunkless papers |
| **:30 hourly** | **conductor tick** (full: sentry, forge, ready-finalizes, exploration) |
| :02 :12 :22 :32 :42 :52 | conductor exploration lane — free unless the sandbox path is open, then runs on the local model |
| every 5 min | observer auto-drain — opt-in, env-gated (`OBSERVER_AUTODRAIN_USER`), a no-op unless armed with a queued case (`src/observer.ts`, a Falcon-pattern structural-analysis engine for historical/institutional cases rather than markets) |
| **:45 hourly** | **volition tick** — her free moment; see `src/volition.ts` above |
| 04:00 | consolidation — the sleep pass (`consolidate.ts`) |
| 05:00 | seed_corpus (ingest missing bundled docs) |
| 07:00 | daily unprompted journal |
| 21:10 | daily trading journal (bookkeeping, scheduled independently of volition; 21:10 UTC = after the US close year-round) |

`POST /api/cron {job:"..."}` can also fire any job on demand.

## Endpoints (selected)

**Conversation**: `/api/elle-router` (full/member; pass `stream:true` for
SSE — the loop's frames arrive live: each step's thought + tool as she
commits to it, each observation as it lands, one `done` frame with the full
result), `/api/elle-conversation`, `/api/chat` (public), `/api/widget-chat`,
`/api/atlas` (hospitality; per-client venue when signed in),
`/api/atlas/signup` + `/api/atlas/profile` (self-serve Atlas client
onboarding), `/api/atlas/upload` (venue-scoped POS CSV ingest).
`/api/elle-self` — one snapshot of the reflexive tools (bets + calibration,
scars, watches, drops, metabolism, consolidation, self-forged tools).

**Identity/voice**: `/api/elle-identity`, `/api/elle-voices`.

**Corpus**: `/api/corpus-papers`, `/api/corpus-paper`, `/api/corpus-resolve`,
`/api/corpus-series`, `/api/search`, `/api/ingest`.

**Autonomy/desk**: `/api/elle-intents`, `/api/elle-trading`, `/api/admin-feed`.

**Journal/law**: `/api/optimus-journal`, `/api/notebook`, `/api/madmind`,
`/api/elle-duel-engine`, `/api/elle-tutor`, `/api/elle-doctrine`,
`/api/elle-cohort`, `/api/elle-replays`, `/api/elle-war-room` (SPAR/DRILLS/
CHAMBERS/X-RAY doctrine and debate modes, `src/war-room.ts`).

**Product engines**: `/api/falcon` — 16-axis, 3-tier product-intelligence
engine (`action: run|list|get|outcome`). `/api/elle-lattice` — 32-axis,
3-layer security deduction engine (`action: run|list|get`; admin-gated).
`/api/flock` — social-media intelligence (`action: brand.* | channel.* |
content.* | image.* | video.* | post.* | asset.list | status`; generated
media served from `/flock/asset/…`). `/api/elle-grants` — the Grant
Intelligence reasoning layer (`action: create_organization|
list_opportunities|fit_analysis|get_fit_analysis|necaif_evaluation|
get_990_overview`).

**Small-business tax suite** (its own `tax` scope, real personal financial
data, authenticated only — no anonymous/demo path): `/api/tax`
(conversational, tax-scoped router), `/api/tax/data` (structured JSON
reads/writes for the workbench dashboard — no LLM round trip),
`/api/tax/onboarding`. Payroll: `/api/payroll/connect`, `/api/payroll/callback`,
`/api/payroll/sync`, `/api/payroll/connections`.

**Engine/ops**: `/api/elle-code-engine`, `/api/diagnose`, `/api/research`,
`/api/cron`, `/api/elle-auth`, `/api/elle-oauth`, `/health`.

---

## Testing & CI/CD

```bash
npm test          # vitest — 149 test files, 1,600+ tests
npx tsc --noEmit  # typecheck, strict
npx wrangler deploy --dry-run   # validate config + bundle without deploying
```

CI (`.github/workflows/ci.yml`) runs `tsc --noEmit` + `vitest` on every PR
to `main` and every push to an `elle/**` branch — the same gate the
self-authored-code forge loop reports against, and it's read-only to Elle
by construction: she can push to `elle/*` and open a PR, but nothing in her
tool catalog can merge one. `main` auto-deploys via
`.github/workflows/elle-worker-deploy.yml`. `.github/workflows/prune-corpus.yml`
is a manual (`workflow_dispatch`) admin operation that drives a bounded
corpus-pruning endpoint to completion.

## Development

```bash
npm install
npm test
npx tsc --noEmit
npx wrangler dev              # local dev server
npx wrangler deploy           # manual deploy (main auto-deploys via CI)
```

---

## File map

### Core loop

| File | What |
|------|------|
| `index.ts` | doors, auth, crons, embeddings/RAG, handlers, seed job |
| `router.ts` | the agent loop, scopes, tool catalog & dispatch |
| `mind.ts` | the voice + the six prose registers (single source) |
| `llm.ts` | provider routing + failover + sanitize |
| `agents/primitives.ts` | a structured-output router primitive, ported from a reference multi-agent cookbook |
| `conductor.ts` | autonomous work loop + intent queue + review_runs |
| `volition.ts` | the hourly volition tick — her free-moment choice among dream/journal/build/rest |
| `ideas.ts` | the idea queue + live forge-build lane: `pondering → queued → scoping → spec → building → testing → held\|killed` |

### Memory & retrieval

| File | What |
|------|------|
| `memory.ts` | the memory-write policy kernel underneath `remember`/`recall_memory` |
| `db/schema.ts` | single source of truth for the D1 schema (replaces ~30 files' worth of scattered bootstrap code) |
| `retrieval/` | hybrid RAG pipeline: chunker, contextualizer, dense (Vectorize) + FTS5 (BM25) legs, reciprocal-rank fusion, reranker, checkpointed re-embed backfill (`docs/RETRIEVAL_CONTRACT.md`) |
| `kappa-memory/` | experimental, explicitly not-live memory-ranking signal — gated behind `SEAM.KAPPA_VALIDATED` until a stated statistical bar clears |
| `ingest-gate.ts` | the 2-check verification gate |
| `corpus-seed.ts` | bundled seed docs (Text modules from `corpus/`) |
| `kappa-turn.ts` / `kappa-dynamics.ts` | per-turn coherence measure + derivatives |

### Codebase self-editing & tools

| File | What |
|------|------|
| `forge.ts` | her code sandbox over GitHub (allowlist incl. elle-law) |
| `skills.ts` | self-authored skill library |
| `mcp.ts` | generic MCP client |
| `github-tools.ts` | read any repo via the worker token |
| `tool-forge.ts` | self-authored tool registry, sandbox-executed |
| `session-bus.ts` | the stateless connect-back bus: enqueue → laptop polls → executes → submits, state persisted in D1 |
| `connect-sandbox.ts` | worker-side face of the sandbox: run_code/run_shell/sandbox_clone/status/report + the sovereign LLM lane |
| `sandbox-registry.ts` | the named sandbox lane registry, stabilized by `topology-lock.ts`'s linking-number check |
| `lane-envelope.ts` | the sealed message envelope for the sandbox bus |
| `duplex.ts` | the duplex channel — sovereign (laptop) ↔ cloud, append-only ledger, `/api/duplex` |
| `calc.ts` / `scratchpad.ts` / `diagnose.ts` | arithmetic / working memory / diagnostics |

### Product verticals

| File | What |
|------|------|
| `rapid.ts` | native hospitality tools |
| `atlas-clients.ts` / `atlas-ingest.ts` | Atlas self-serve client signup/tenancy + venue-scoped POS CSV ingest |
| `tax.ts` | small-business tax suite tool handlers |
| `tax-calc.ts` | deterministic tax math: SE tax, QBI deduction, safe harbor, FICA, S-corp compensation split, entity-level pass-through tax, local earnings tax |
| `tax-clients.ts` | business/unit/owner/fact-group persistence + parallel onboarding |
| `tax-credits.ts` | the cited, versioned credit/deduction eligibility engine |
| `tax-rules/` | federal + state (MO/KS/IL/IN) + local (KC/STL) tax constants by year |
| `payroll/` | QuickBooks/Gusto/ADP OAuth connect/sync + encrypted token storage + the `payroll_*` router tools |
| `live-guard.ts` | the two-key real-money trading arm gate |
| `trading.ts` | Alpaca cycle + daily journal + post-close attribution |
| `alpaca-options.ts` | resolves human option terms (underlying/right/strike/expiration) to a real OCC contract |
| `education/` | vendored CustomCourseBuilder engine (engine, brief, seal, signals, state, course-types) + the six `edu_*` tools' D1-backed learner state |
| `grant-intelligence.ts` | Grant Intelligence reasoning layer (fit analysis + NECAI-F), reading `GRANT_DB` |
| `flock.ts` | Flock — brand kits, ideate/caption, Brand Guardian, image generate/edit, video stub, multi-channel post fan-out |
| `flock-providers.ts` | Flock's swappable model seam (image/video/posting adapters) |
| `flock-bluesky.ts` | the first real live-publishing adapter (app-password auth, image upload, rich-text facets) |

### Self / autonomy / journal

| File | What |
|------|------|
| `journal.ts` | phase-state manuscript |
| `oracle.ts` | prediction ledger + conductor adjudication + calibration |
| `adversary.ts` | the devil tool — adversarial pass over a draft |
| `council.ts` | parallel multi-engine disagreement map |
| `scars.ts` | recorded injuries that warn before repetition |
| `dead-drop.ts` | context-triggered notes to her future self |
| `watches.ts` | tripwires on the world, evaluated per conductor tick |
| `metabolism.ts` | LLM-call interoception (ring + `elle_llm_calls`) |
| `consolidate.ts` | nightly memory consolidation (memories→skills→scars) |
| `mirror.ts` | `/api/elle-self` — one snapshot of the reflexive tools |
| `libre.ts` | dream/libre autonomous production |
| `push.ts` | budgeted/quiet-hours-gated push notifications (`reach_out`) with an auditable ledger |
| `deep-research.ts` | `deep_research` tool — chained multi-round web research, local-first gap detection |
| `observer.ts` | the Observer — a Falcon-pattern structural-analysis engine for historical/institutional cases, autonomous-drain only (not a router tool) |

### Security

| File | What |
|------|------|
| `ssrf.ts` | the SSRF guard in front of `fetch_url` |
| `order-guards.ts` | pre-trade order validation guards for the trading desk |
| `google-auth.ts` | OAuth `aud` claim allowlist check for Google sign-in |
| `security-network.ts` | attacker-tactic taxonomy + decaying per-actor posture + malware/polyglot scan |
| `helix.ts` | the signal crypto tunnel: AES-256-GCM + length-hiding framing + forward ratchet |
| `torus-sync.ts` / `hyperbolic-sync.ts` / `hyperbolic-mixing.ts` | counter-free resync schemes for the sandbox channel + measured mixing diagnostics |
| `fixed-math.ts` / `hyperbolic-sync-fixed.ts` | cross-platform-deterministic integer math core + the sync scheme rebuilt on it |
| `signal-collapse.ts` | burn-on-breach lockout + the hybrid-PQC rekey for post-compromise recovery |
| `pqc-hybrid.ts` / `pqc-qcmdpc.ts` | the hybrid post-quantum KEM (ML-KEM-768 + X25519, opt-in QC-MDPC), OR-security proven by self-test |
| `lane-handshake.ts` | the hybrid lane-root agreement (additive, not yet live-routed); cross-verified byte-identical against the companion app's implementation |

### Research modules (signal & geometry)

| File | What |
|------|------|
| `pfar.ts` / `vfar.ts` / `pami.ts` | signal/image/memory-fingerprint analysis — see [Research modules](#research-modules--signal--geometry-engines) |
| `hyper.ts` / `torus.ts` / `structure.ts` / `product.ts` / `atlas.ts` | geometric memory-graph representations |
| `scaffold.ts` / `regulator.ts` / `phase-vessel.ts` / `witness-oscillator.ts` / `cognitive-obliquity.ts` | dynamical-systems / control-theory research constructions, each proven against a broken "foil" |
| `topology-lock.ts` | the Gauss linking integral, validated against the Hopf link |
| `coherence-layer.ts` / `harmonic-coherence.ts` | graph-structure and grounding-verdict measurement |
| `reasoning.ts` / `convergence.ts` / `corpus-reasoning.ts` | the unified reasoning entry point + corroboration scoring |
| `mindmap.ts` / `mindmap-pipeline.ts` | end-to-end pipeline from YouTube captions through the modules above to a stored, replayable run |

### Law / analysis engines

| File | What |
|------|------|
| `law.ts` | law bench (duel/tutor/doctrine/cohort/replays) |
| `war-room.ts` | SPAR (doctrine duel + autopsy + ladder), DRILLS, CHAMBERS, X-RAY |
| `falcon.ts` | 16-axis, 3-tier product-intelligence engine |
| `lattice.ts` | 32-axis, 3-layer security-deduction engine |
| `madmind.ts` / `research.ts` / `widget.ts` | submissions, research cron, embeddable widget |
| `tts.ts` | server-side text-to-speech via Workers AI |

### Docs & seed content

| File | What |
|------|------|
| `corpus/**/*.md` | version-controlled corpus seed documents |
| `docs/SECURITY_ARCHITECTURE.md` | security network + signal crypto tunnel, system-wide |
| `docs/RETRIEVAL_CONTRACT.md` | the hybrid retrieval design + its evaluation gate |
| `docs/PQC_ROSEN_BRIDGE_DESIGN.md` / `docs/PQC_HYBRID.md` | the post-quantum migration design + implementation reference |
| `docs/SIGNAL_COLLAPSE_AND_FIXED_MATH.md` | plain-language: the fixed-point/CORDIC core and what "burn on breach" honestly means |
| `docs/TORUS_SYNC.md` / `docs/HYPERBOLIC_BRIDGE.md` / `docs/MIXING_DIAGNOSTICS.md` | the sync-scheme design docs, including an honest correction of an earlier overclaim |
| `docs/THE_COHERENCE_LAYER.md` / `docs/HARMONIC_GROUNDING.md` / `docs/CONVERGENCE.md` / `docs/TOPOLOGY_LOCK.md` / `docs/THE_LATTICE.md` | the research-module design docs, each with its validation method and limitations |
| `docs/DUAL_TOPOLOGY.md` | the capstone synthesis document tying the research modules together |
| `docs/THE_SCAFFOLD.md` / `docs/FREE_ENERGY_REGULATOR.md` / `docs/PHASE_VESSEL.md` / `docs/WITNESS_OSCILLATOR.md` / `docs/COGNITIVE_OBLIQUITY.md` | per-module design docs for the dynamical-systems research constructions |
| `docs/WAR_ROOM_TODO.md` | build note for the War Room feature — shipped (`src/war-room.ts`) |
| `bench/` | the evaluation harness referenced above |
| `scripts/sync-education.sh` | re-vendors the education engine from the CustomCourseBuilder repo after a build there |
