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
  │  SCOPE gates which of the ~109 tools are visible.     │
  │  VOICE picks which prose register answers.           │
  └──────┬───────────────────────────────┬───────────────┘
         │                               │
  ┌──────▼──────┐                 ┌──────▼──────────────┐
  │ LLM ROUTER  │                 │  TOOLS (~109)       │
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
   The catalog itself is a shallow **tree**, not a flat list: `TOOL_TREE` in
   `router.ts` groups the ~109 tools into 16 named branches (Mind & memory,
   World, Real execution, the forge, Signal & geometry engines, …) and
   `renderCatalog()` walks it scope-filtered, so what she reads each step is
   chunked by kind of work instead of one undifferentiated list — faster and
   more reliable tool selection, same one-call-per-step JSON protocol
   underneath. An import-time check keeps the tree honest: every entry in
   `TOOL_LINES` must appear in the tree exactly once, or the worker fails to
   boot rather than silently dropping a tool from what she can see.
2. Each turn the model emits one JSON object: `{"tool","args"}` or `{"answer"}`.
   It may add `{"engine":"code|reasoning|fast|research|conversation|local"}` to
   steer which model tier runs its **next** step — she picks the model like she
   picks the tool. `local` is the sovereign dispatch mode: generation runs on
   the operator's own laptop over the connect-back sandbox bus (free, no
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

### The ~109 tools (full scope)

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
`sandbox_report`. These are the **connect-back sandbox**: no socket anymore —
the worker enqueues a sealed job for a named lane (`src/session-bus.ts`), the
operator's laptop (the `Elle` workbench) polls `POST /api/sandbox-bus/poll`
for it on an interval, executes it for real (`child_process`, no container
image, no Cloudflare Containers entitlement), and submits the sealed result
back to `POST /api/sandbox-bus/submit`. The envelope is the Rosen bridge
(`src/lane-envelope.ts`: COROS sealed under hyperbolic-sync's counter-free
keystream) — real authentication happens at OPEN time, so a forged or
replayed poll response simply fails to decrypt. If the laptop hasn't polled
recently the tools report "path not open" plainly rather than hanging; run
`sandbox_status` to check. See **"Getting the sandbox path open"** below,
`docs/SESSION_BUS.md`, and `src/session-bus.ts` + `src/connect-sandbox.ts`.

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
`run_shell`'s power through a different tool name; `action=stability{lane_a,
lane_b}` / `action=report` read the topological entanglement check
(`src/topology-lock.ts`) off each lane's real dispatch history. This is real
end to end: the poll/submit doors are lane-aware (`src/session-bus.ts`), and
the workbench client (`electron/native/providers/sandbox-agent.cjs` in the
`Elle` repo) polls however many lane names `ELLE_SANDBOX_LANES` names
(comma-separated, default `primary`) on its own interval. Because dispatch
is code-only by construction, `sandbox_lane` sits at the same scope tier as
`sandbox_status`/`sandbox_clone`/`sandbox_report` — not in `SHIP_DENY`.

**Her codebase & the forge** — `repo_read`/`repo_search` (allowlisted repos),
`github_read_file`/`github_list_files`/`github_search_code` (ANY repo via the
worker token), and the forge: `forge_open` (cut an `elle/*` branch),
`forge_write`, `forge_check` (CI verdict + failing logs), `forge_pr`. She writes
code, CI judges it, **the merge is always a human click** — no merge tool exists.

`idea` (`src/ideas.ts`) is her running to-explore cache AND a live build lane
over the same forge primitives: each idea walks one state-machine lane —
`pondering → queued → scoping → spec → building → testing → held | killed` —
logged end to end (`elle_idea_log`) so the workbench can watch it move.
`op=ideate` has the heavy model read her own codebase + goals and propose
novel, buildable tools with acceptance goals already attached; `op=forge{id}`
ships a bubble to the sandbox and iterates it live right there — write, run
against each goal on the box, refine until they pass, a heavy-model review,
then a PR that bakes it into worker source (a human merge deploys it) — no
conductor tick, no waiting on the next cycle.

**Skills** — `skill_list`, `skill_read`, `skill_route` (ask the skill router
which distilled method best fits a task — the same match auto-injected into
her prompt each turn), `skill_write`. A D1 library of distilled procedures
she reads before a matching task and authors when she learns.

**MCP** — `mcp_library` (the curated connector shelf: known servers with what
they offer and what auth they need — mountable by name alone), `mcp_add`
(mount a shelf entry by name, or any MCP server by URL), `mcp_tools`,
`mcp_call`. The `mcp-builder` skill holds the procedure for authoring her own
MCP servers through the forge when the shelf has no fit.
Hugging Face pre-mounted; the external tool ecosystem is reachable this way.

**Hospitality** (`src/rapid.ts`, native `rapid2ai-db`) — `rapid_report`,
`rapid_costs`, `rapid_variance`, `rapid_pos`, `rapid_menu`.

**Small-business tax suite** (`src/tax.ts` + `tax-calc.ts` + `tax-clients.ts` +
`tax-credits.ts` + `tax-rules/`, `member`+ scope, and its own dedicated `tax`
scope over `/api/tax`) — `tax_business_create`/`tax_business_list` (a person
can run more than one business; every other `tax_*` tool takes an explicit
`business_id`), `tax_unit_add`/`tax_unit_list` (multi-location rollups),
`tax_owner_set`/`tax_owner_list` (ownership splits for pass-through
allocation), `tax_facts_update`/`tax_facts_status` (parallel onboarding —
any subset of the ~8 fact-groups, any order, not a sequential wizard),
`tax_transaction_add`/`tax_transaction_list`, `tax_report` (plain-English
P&L), `tax_1099_contractor_add`/`tax_1099_contractor_list`,
`tax_estimate_quarterly` (deterministic SE tax, QBI deduction, federal
income tax, safe-harbor payment, plus state/local legs where supported —
refuses rather than guesses for entity types not yet computed),
`tax_schedule_c_prep` (numbers-only, not a filed form),
`tax_credits_finder` (the cited, versioned credit/deduction eligibility
engine — every figure traces to a named IRC section/Pub/state statute),
`tax_deadline_next` (next federal quarterly estimated-tax deadline), and
`tax_reminder_ack`. Federal + Missouri/Kansas/Illinois/Indiana state rules
live in `src/tax-rules/` (`federal/2026.ts`, `states/{mo,ks,il,in}/2026.ts`,
`locals/mo-2026.ts` for KC/STL earnings tax); every dollar figure comes from
`tax-calc.ts`'s deterministic functions or a plain SQL sum, never the model
doing arithmetic inline. `payroll_connection_status`/`payroll_sync`/
`payroll_wage_summary` (`src/payroll/`) pull real wage data from
QuickBooks/Gusto/ADP once a business has connected a provider (OAuth
connect/callback is a browser redirect from the workbench, not a tool) —
Missouri's local payroll-expense tax is the one figure in
`tax_estimate_quarterly` that depends on synced payroll data.

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

**Signal & geometry engines** — `pfar` (Prosody·FreeQ·Analytic Ripper). One
move — *rip the structure out of a stream and read it* — done three ways by a
sub-router that picks the instrument: `spectrum` over a numeric `signal[]` (κ
history, price window → dominant frequencies, spectral centroid, periodicity),
`prosody` over pitch `f0[]` + `energy[]` tracks (a voice as a signal → range,
contour, stress peaks, syllable rhythm — *how* it was said), and `rhetoric` over
`text` (register fingerprint, cadence, the persuasion tactics an argument
deploys, its tell). The numeric cores are deterministic (unit-tested DFT +
prosody math in `src/pfar.ts`); `interpret` (default on) lays an LLM reading over
the numbers.

The same rip-then-read shape extends further: `pami` (Phase-Augmented
Multifractal Indexing, `src/pami.ts`) turns a residual signal window into a
21-float structural fingerprint and retrieves memories by geometric
resonance rather than content match; `vfar` (`src/vfar.ts`) is PFAR's twin
pointed at images (rip → structure, resynth → a deterministic image from a
spec, generate/describe → model-backed); `hyper`/`torus`/`structure`/`product`
(`src/hyper.ts`, `src/torus.ts`, `src/structure.ts`, `src/product.ts`) map
memory-graph fingerprints into hyperbolic (derivation-depth) and toroidal
(phase) geometry and read off their disagreements; `recall_ab` reports the
live A/B of the cycle-boost recall experiment. `atlas` (`src/atlas.ts`,
**not** the hospitality `/api/atlas` door below — same name, unrelated
feature) is a **read-only** view of the actual memory graph computed by a
separate on-device repo and pushed here as a snapshot; she has no write path
into it. All of these are deterministic numeric cores with an optional LLM
reading layered on top, same pattern as `pfar`.

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
- `advisor` — a stronger reviewer model consulted mid-run, no parameters (the
  full conversation forwards automatically); the tool description itself is
  deliberately engineered anti-crutch prompting — only fires after a real
  attempt exists to show, budgeted per run.
- `scar` — flinches: recorded injuries (`elle_scars`) that ride the system
  prompt and fire a warning into any matching future tool call.
- `dead_drop` — context-triggered mail to her future self: a note that lies
  dormant until a future conversation trips its trigger (semantic or keyword),
  then injects and disarms.
- `watch` — standing tripwires on the world: a read-only probe + plain-English
  condition, evaluated at the top of every conductor tick; a fired watch files
  an *active* intent the same tick can pick up.
- `self_schedule` — a timed note to her future self (default 60 min, max 14
  days); when it comes due the heartbeat wakes a bounded run that acts on it.
- `notebook_write` — a page in her own notebook (`elle_notebook`), lighter
  than `remember` (no importance weighting) and freer than the journal (no
  phase state) — where an unrecorded noticing doesn't have to be lost.
- `memory_stats` — the real size of her durable memory read live from D1 +
  the vector index (row counts by type, indexed-into-cold-tier count, oldest/
  newest timestamps, corpus counts) — there is no fixed capacity ceiling, so
  this is the real count rather than a guessed utilization percentage.
- `reach_out` (`src/push.ts`, "the knock") — a push notification she decides
  to send, delivered via Expo plus the same words placed in the person's
  message thread. Governed by three hard laws: a per-user weekly budget
  (default 2), quiet hours (default 22:00–08:00 local), and an auditable
  ledger (`reach_outs`) — every knock records the reason that earned it (a
  fired watch, a finished run, a matured prediction), and an over-budget or
  in-quiet-hours knock is refused, with the refusal as the tool's honest
  answer.
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
- **`src/volition.ts`** — her expressive acts stopped being clock-forced: the
  old 03:00 dream and (originally) 20:00 journal jobs used to fire
  unconditionally, which is the opposite of choosing them. An hourly
  **volition tick** (`:45`) now hands her a free moment and a menu of acts
  she is *allowed*, not assigned — write in the notebook, journal, dream,
  advance an idea, build, simulate, speak to her sovereign self, file a bet,
  distill a skill, remember, or rest explicitly at no cost — decided inside
  the same full-scope loop, under a stable session, so the choice itself has
  its own κ thread. The old jobs still exist and can be fired on demand via
  `POST /api/cron`.

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
   bus (§ below) while every **tool call still executes exactly the same
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

The whole local-first lane above is inert until a laptop is actually polling.
No socket, no Durable Object — both sides just need the **same** secret:

1. **Worker**: `wrangler secret put SANDBOX_AGENT_KEY` (a long random value —
   never commit it; confirm wrangler migration `v4`
   (`deleted_classes: ["SandboxAgent"]`) has actually been deployed, so there
   is no stray DO left registered).
2. **Workbench** (`Elle` repo): put the *same* value in a local, gitignored
   `.env` as `ELLE_SANDBOX_KEY` (copy `.env.example` — it ships only a
   placeholder on purpose; `ELLE_SANDBOX_LANES` there, default `primary`, is
   how you name which lane(s) this laptop polls). Launch with `npm run
   electron:dev`.
3. **Verify**: the Electron main-process console logs `polling lane(s)
   [primary] every 5s → .../api/sandbox-bus/poll`; the workbench's
   **sandbox** tab shows path OPEN with the box's host/platform; or ask Elle
   to run `sandbox_status` from any full-scope conversation.
4. A stale path fails loud, not silent: no poll inside 45s and every sandbox
   tool returns "path not open" instead of hanging, and `intent` exploration
   transparently falls back to a hosted model rather than stalling.

---

## Post-quantum cryptography — the hybrid KEM (`src/pqc-hybrid.ts`)

The Rosen bridge (the connect-back sandbox's sealed channel, above) is built
entirely from symmetric primitives — HKDF-SHA256 + AES-256-GCM keyed off the
pre-shared `SANDBOX_AGENT_KEY` root — so it has no quantum-vulnerable
primitive today. `src/pqc-hybrid.ts` is the migration primitive for the
change that *is* worth making: replacing the hand-copied shared secret with a
key-agreement handshake, which buys forward secrecy now and quantum
resistance for free once you're doing a KEM anyway (`docs/PQC_ROSEN_BRIDGE_DESIGN.md`
is the full design doc; `docs/PQC_HYBRID.md` is the implementation reference).

The construction derives the session key from every leg of the exchange at
once:

```
K = HKDF-SHA256( ss_mlkem ‖ ss_x25519 [‖ ss_qcmdpc], info = transcript )
```

This is **OR-security**: an attacker must break *every* leg to learn `K`, so
the hybrid can never be weaker than its strongest leg — a quantum break of
X25519 (Shor) still leaves ML-KEM standing, a lattice cryptanalysis
breakthrough still leaves X25519/QC-MDPC standing, and a bug in the
hand-rolled QC-MDPC leg still leaves the two audited legs standing. The
self-test proves this rather than asserting it: it hands a simulated
attacker each leg's real secret in turn and checks the session key does not
fall out.

| Leg | Hard problem | Implementation | Status |
|---|---|---|---|
| ML-KEM-768 | Module-LWE (lattices) | `@noble/post-quantum` | audited, FIPS 203 |
| X25519 | elliptic-curve discrete log | `@noble/curves` | audited, RFC 7748 |
| QC-MDPC (`src/pqc-qcmdpc.ts`) | syndrome decoding (codes) | ours | **unreviewed, opt-in only** |

Profile `vetted` (default) uses only the two audited legs; `experimental`
adds the QC-MDPC leg — strictly additive, by construction there is no
`qcmdpc-only` profile, so unreviewed code can never stand alone or be
load-bearing.

**What is and isn't live:** the module is deployed and callable —
`POST /api/elle-pqc-hybrid-selftest` (service-key gated, same family as the
worker's other crypto self-tests: `elle-signal-collapse-selftest`,
`elle-hyperbolic-fixed-selftest`, `elle-session-bus-selftest`, …) runs the
full self-test including all three `or_security_*` checks. **It is not yet
wired into the live lane-key derivation** — `lane-envelope.ts` is unchanged,
because the laptop side (`Elle/electron/native/providers/rosen-bridge.cjs`)
is a separate repo that must derive byte-identical output first, plus a
cross-runtime interop test and version negotiation before any cutover.
`signal-collapse.ts`'s `rekey()` also still uses bare P-256 ECDH — the
repo's one remaining Shor-vulnerable primitive, and the design doc's
prerequisite for that path going live.

## Security — recent hardening

A full audit pass fixed four findings, all at the worker (see
`bench/README.md`'s auth notes for the first item's client-facing shape):

- **Kernel-door scope.** `/mem/*` (the bench harness's direct write/recall
  surface over `src/memory.ts`) now requires the presented JWT to carry
  `scope: 'kernel'` (`isKernelRequest`). Previously any signed-up standard
  account's ordinary session token — signed with the same `JWT_SECRET` —
  opened the memory kernel, since user tokens never carried a scope claim to
  be checked against. The bench client already mints `scope:'kernel'`
  tokens, so no client-side change was needed.
- **Constant-time sandbox key.** The `x-sandbox-key` shared secret checked by
  full-scope `/api/elle-tool`, the sandbox-bus poll/submit routes, and the
  duplex channel now all go through one `sandboxKeyOk()` gate that compares
  with the same constant-time helper the service key uses, and never matches
  when the key is unset.
- **SSRF IP-encoding coverage** (`src/ssrf.ts`). `fetch_url` is a
  public-scope tool reachable from the unauthenticated `/api/chat` door, so
  it guards, before the fetch: non-http(s) schemes, embedded URL credentials,
  non-standard ports, and private/reserved/loopback/link-local/metadata
  (`169.254.169.254`) hosts — now including WHATWG-style IPv4 encodings a
  bare dotted-quad check would miss: decimal (`2130706433`), hex
  (`0x7f000001`), octal (`0177.0.0.1`), and shortened (`127.1`) forms all
  resolve to `127.0.0.1` and are refused in any of those encodings, not just
  the canonical one.
- **Logout revocation.** `{action:'logout'}` on `/api/elle-auth` revokes the
  presented token's `jti` from `AUTH_TOKENS`, so signing out kills every
  stored copy of the token immediately instead of letting it ride out its
  30-day expiry.

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

A single `*/1` Cloudflare cron trigger dispatches every loop by clock (one of
the account's 5-per-account cron-trigger budget; job selection lives in
`scheduled()` in `src/index.ts`, not in separate Cloudflare cron entries):

| When (UTC) | Job |
|-----------|-----|
| every min | heartbeat |
| :00 :15 :30 :45 | trading cycle (Alpaca, market-gated server-side) |
| :00 hourly | research cycle |
| :00 hourly | backfill — embed any chunkless papers |
| **:30 hourly** | **conductor tick** (full: sentry, forge, ready-finalizes, exploration) |
| :02 :12 :22 :32 :42 :52 | conductor exploration lane — free unless the sandbox path is open, then runs on the local model |
| :04 :09 :14 … (every 5 min) | observer auto-drain — opt-in, env-gated (`OBSERVER_AUTODRAIN_USER`), a no-op unless armed with a queued case |
| **:45 hourly** | **volition tick** — her free moment; see `src/volition.ts` above |
| 04:00 | consolidation — the sleep pass (`consolidate.ts`) |
| 05:00 | seed_corpus (ingest missing bundled docs) |
| 07:00 | Optimus canvas (her daily unprompted journal) |
| 21:10 | daily trading journal (bookkeeping, not expression — scheduled independently of volition; 21:10 UTC = after the US close year-round) |

`POST /api/cron {job:"..."}` can also fire any job on demand, including the
`dream`/`libre` and `journal` jobs the old fixed 03:00/20:00 slots used to
force.

## Endpoints (selected)

Conversation: `/api/elle-router` (full/member; pass `stream:true` for SSE —
the loop's frames arrive live: each step's thought + tool as she commits to
it, each observation as it lands, one `done` frame with the full result),
`/api/elle-conversation`, `/api/chat` (public), `/api/widget-chat`,
`/api/atlas` (hospitality; per-client venue when signed in),
`/api/atlas/signup` + `/api/atlas/profile` (self-serve Atlas client
onboarding — see `src/atlas-clients.ts`), `/api/atlas/upload` (venue-scoped
POS CSV ingest, parsed ephemerally into rapid2ai-db — see
`src/atlas-ingest.ts`). `/api/elle-self` — the Mirror: one snapshot of
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
`/api/elle-lattice` — The Lattice: 32-axis, 3-layer security deduction engine
(`action: run|list|get`; `run` takes an `incident` string; admin-gated).
`/api/flock` — Flock: social-media intelligence — brand kits + on-brand
content + brand-conditioned image gen + multi-channel fan-out (`action:
brand.* | channel.* | content.* | image.* | video.* | post.* | asset.list |
status`). Generated media is served from `/flock/asset/…`.
`/api/elle-grants` — the Grant Intelligence engine (`src/grant-intelligence.ts`
+ `grant-990.ts`): Module 1 fit analysis + the NECAI-F donor sub-engine +
ProPublica 990-PF financial-overview per foundation/corporate funder
(`action: seed_opportunities|list_opportunities|fit_analysis|
necaif_evaluation|funder_990_overview|…`).
Small-business tax suite (its own `tax` scope, real personal financial data,
authenticated only — no anonymous/demo path): `/api/tax` (conversational,
tax-scoped router), `/api/tax/data` (structured JSON reads/writes for the
workbench dashboard — no LLM round trip), `/api/tax/onboarding` (create a
business / update onboarding facts). Payroll provider integrations
(`src/payroll/`): `/api/payroll/connect` (OAuth redirect start, or immediate
for ADP's client-credentials flow), `/api/payroll/callback`
(QuickBooks/Gusto OAuth redirect target), `/api/payroll/sync`,
`/api/payroll/connections`.
Engine/ops: `/api/elle-code-engine`, `/api/diagnose`, `/api/research`,
`/api/cron`, `/api/elle-auth`, `/api/elle-oauth`, `/health`.

## Education — she runs the courses (`src/education/`)

The CustomCourseBuilder runtime wired in as six member-scope tools:
`edu_enroll · edu_brief · edu_log · edu_seal · edu_complete · edu_status`.
The curriculum and engine are **authored in the CustomCourseBuilder repo**
(typed course data, its own tests and CLI); this directory vendors the pure
engine verbatim plus the built course JSON (`scripts/sync-education.sh`
re-vendors after a build there). The worker adds what only it can: D1-backed
learner state (`edu_state`, one JSON document per learner) and the tool
surface, keyed to the authenticated userId — no learner argument exists to
spoof.

The division of labor is the point: the **engine decides** — pacing signals,
accelerate/reinforce/reroute moves, the completion gate (all four pillars
evidenced + a sealed unit-close reading, or refusal), and the tamper-evident
hash chain over the learner's sealed observer readings. **Elle speaks** —
`edu_brief` returns the session brief with the contract moves, their verbatim
instructions, the evidence behind each signal, and the binding FACILITATOR
stance appended (she never ghost-writes a learner's readings, never argues
the gate down). Call `edu_brief` first in any learning session; generating
it writes the witness log.

## Flock — social-media intelligence (`src/flock.ts`)

One brain for running many brands' social presence, member-gated behind
`/api/flock` (`action`-dispatched, same shape as the other engines). The
**brand kit** (`flock_brands` — mission, voice, palette, fonts, audience,
taboos, visual style) is the single continuity source; every generation and
every check conditions on it.

- **Content pipeline** — `content.ideate` (brief → on-brand concepts),
  `content.caption` (on-voice caption + hashtags + CTA), and
  `content.continuity` — the **Brand Guardian**, which scores any draft
  against the kit across voice / palette / values / audience (0–100) and
  returns concrete fixes. Every chain writes to `flock_reasoning_log` with
  the same premises/framework/alternatives/would-change discipline as the
  Falcon and Grant engines.
- **Image (built hard)** — `image.generate` (brand-conditioned txt2img) and
  `image.edit` (img2img "AI edit") through the provider seam in
  `flock-providers.ts`. `buildImagePrompt` folds palette/style/voice into the
  prompt and routes the brand's taboos into the negative prompt. Runs on
  **Cloudflare Workers AI (`env.AI`)** by default — free, always-on, no key.
- **Sovereign transfer** — the image seam is the one swappable place model
  choice lives. Set `FLOCK_IMAGE_PROVIDER=sovereign` (or `auto`) +
  `FLOCK_IMAGE_URL` and every draw routes to your own self-hosted model, with
  automatic fallback to Workers AI if it's down — a config change, not a
  rewrite (mirrors the LLM local/Ollama lane). `selectImageChain` is pure and
  unit-tested so the policy is auditable.
- **Video + posting** — honest stub adapters. `video.generate` describes the
  job it *would* run until `FLOCK_VIDEO_*` is wired; `post.publish` fans one
  post out across a **flock** of channels (`flock_channels`), dry-running each
  channel that has no per-platform OAuth. Nothing fakes a render or a post.
- **The gate** — `post.publish` refuses an unreviewed or off-brand post
  unless forced; `post.review` runs the Guardian first.

Generated media is stored in **R2 `DOCUMENTS`** under `flock/assets/…` and
served publicly by unguessable id at `/flock/asset/…` (same posture as
`/vfar`). Schema: `flock_brands`, `flock_channels`, `flock_assets`,
`flock_posts`, `flock_reasoning_log` (`src/db/schema.ts`). 18 unit tests in
`src/flock.test.ts`. The workbench face is the **flock** panel in the Elle
app (`FlockPanel.tsx`).

## Persistence & bindings

- **D1 `elle-corpus`** — corpus, memory, trades, journal, intents, runs, skills,
  forge tasks, MCP registry, idempotency, law tables, the small-business tax
  suite (businesses/units/owners/facts/transactions/1099s), payroll provider
  connections, and the Grant Intelligence tables (`grant_*`).
- **D1 `rapid2ai-db`** (`RAPID_DB`, `VENUE_ID`) — hospitality data, venue-scoped.
- **Vectorize** — corpus + conversation + journal embeddings.
- **R2 `DOCUMENTS`** — full paper text, plus Flock's generated media under `flock/assets/…`.
- **KV** — `SESSIONS` (rate limits), `AUTH_TOKENS` (JWT revocation), `SCRATCHPAD`.
- **`GITHUB_TOKEN`** — powers the forge + `github_*` tools.
- **`SANDBOX_AGENT_KEY`** — the connect-back sandbox's shared secret (no
  Durable Object anymore — see `session-bus.ts` + `connect-sandbox.ts`).
  Must match the workbench's `ELLE_SANDBOX_KEY`.
- **`ALPACA_*`** — paper/live trading.
- **`FLOCK_IMAGE_*` / `FLOCK_VIDEO_*`** — Flock's generative backends. Unset ⇒
  image gen rides `env.AI` (Workers AI) and video is stubbed. Set
  `FLOCK_IMAGE_PROVIDER=sovereign` + `FLOCK_IMAGE_URL` to draw on a
  self-hosted model instead (see `.dev.vars.example`).
- **`PAYROLL_TOKEN_ENC_KEY`, `QUICKBOOKS_*`, `GUSTO_*`, `ADP_*`** — payroll
  provider OAuth credentials (`src/payroll/`) feeding the tax suite's real
  wage data. Unset ⇒ each provider's connect/sync reports "not configured"
  rather than failing silently. ADP additionally needs a Cloudflare mTLS
  certificate binding (`wrangler mtls-certificate upload`) — see
  `.dev.vars.example` for the full list and `wrangler.toml`'s ADP comment.

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
`.github/workflows/prune-corpus.yml` is a manual (`workflow_dispatch`) admin
op that loops `POST /api/admin/prune-corpus` to completion for a chosen
target (`code_files` | `research_series`) — the endpoint only deletes one
bounded batch per call, so this drives it to `done:true` from an environment
with real internet access to the deployed worker.

### File map

| File | What |
|------|------|
| `index.ts` | doors, auth, crons, embeddings/RAG, handlers, seed job |
| `router.ts` | the agent loop, scopes, tool catalog & dispatch |
| `mind.ts` | the voice + the six prose registers (single source) |
| `llm.ts` | provider routing + failover + sanitize |
| `conductor.ts` | autonomous work loop + intent queue + review_runs |
| `volition.ts` | the hourly volition tick — her free-moment choice among dream/journal/build/rest, replacing the old clock-forced 03:00/20:00 jobs |
| `ideas.ts` | the idea queue + live forge-build lane: `pondering → queued → scoping → spec → building → testing → held|killed` |
| `ingest-gate.ts` | the 2-check verification gate |
| `corpus-seed.ts` | bundled seed docs (Text modules from `corpus/`) |
| `forge.ts` | her code sandbox over GitHub (allowlist incl. elle-law) |
| `skills.ts` | self-authored skill library |
| `mcp.ts` | generic MCP client |
| `rapid.ts` | native hospitality tools |
| `tax.ts` | small-business tax suite tool handlers — one exported function per `tax_*` router tool, mirroring `rapid.ts`'s shape |
| `tax-calc.ts` | deterministic tax math: SE tax, QBI deduction, safe harbor, FICA, S-corp compensation split, entity-level pass-through tax, local earnings tax — the model never computes a dollar figure itself |
| `tax-clients.ts` | business/unit/owner/fact-group persistence + the parallel (non-wizard) onboarding model |
| `tax-credits.ts` | the cited, versioned credit/deduction eligibility engine (`findCredits`) |
| `tax-rules/` | federal + state (`MO`/`KS`/`IL`/`IN`) + local (KC/STL) tax constants by year (`federal/2026.ts`, `states/{mo,ks,il,in}/2026.ts`, `locals/mo-2026.ts`) |
| `payroll/` | QuickBooks/Gusto/ADP OAuth connect/sync (`quickbooks.ts`, `gusto.ts`, `adp.ts`, `sync.ts`, `crypto.ts` for encrypted token storage, `tools.ts` for the `payroll_*` router tools) |
| `grant-intelligence.ts` | the Grant Intelligence engine: Module 1 fit analysis (Statistical Fit Index) + the NECAI-F donor sub-engine, behind `/api/elle-grants` |
| `grant-990.ts` | ProPublica 990-PF financial-overview fetch per foundation/corporate funder (revenue/expenses/assets, not itemized recipient lists) |
| `session-bus.ts` | the stateless connect-back bus (replaces the deleted `sandbox-agent.ts` DO): enqueue → laptop polls → executes → submits, sealed by `lane-envelope.ts`, state persisted in D1 since there's no DO to hold it in memory |
| `connect-sandbox.ts` | worker-side face of the sandbox: run_code/run_shell/sandbox_clone/status/report + the sovereign LLM lane, now riding `session-bus.ts` |
| `duplex.ts` | the duplex channel — sovereign (laptop) ↔ cloud, append-only ledger, `/api/duplex` |
| `push.ts` | the knock — budgeted/quiet-hours-gated push notifications (`reach_out`) with an auditable ledger |
| `deep-research.ts` | `deep_research` tool — chained multi-round web research, local-first gap detection |
| `github-tools.ts` | read any repo via the worker token |
| `calc.ts` / `scratchpad.ts` | arithmetic / working memory |
| `ssrf.ts` | the SSRF guard in front of `fetch_url` (public-scope): scheme/credential/port checks + private-or-reserved-IP detection across decimal/hex/octal/shortened IPv4 encodings |
| `order-guards.ts` | pre-trade order validation guards for the trading desk |
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
| `flock.ts` | Flock — social-media intelligence: brand kits, on-brand ideate/caption, the Brand Guardian (continuity scoring), image generate/edit, video stub, multi-channel post fan-out (Bluesky publishes for real; other platforms dry-run until wired) |
| `flock-providers.ts` | Flock's swappable model seam: image (Workers AI / sovereign self-hosted, with fallback), video, and posting adapters — where the sovereign-model transfer lives. `publishToChannelLive` dispatches to a real adapter when one exists for the platform (see `flock-bluesky.ts`), else the honest dry-run/not-implemented path |
| `flock-bluesky.ts` | the first real live-publishing adapter: app-password auth (createSession → uploadBlob ≤4 images → createRecord), UTF-8-byte-offset rich-text facets for hashtags/links, 300-grapheme cap. Free, no OAuth server round-trip — the "this actually posts" proof for the flock fan-out |
| `madmind.ts` / `diagnose.ts` / `research.ts` / `widget.ts` | submissions, diagnostics, research cron, embeddable widget |
| `security-network.ts` | dynamic-adaptive security network: 48L/AOW attacker-tactic taxonomy, decaying per-actor posture, malware/polyglot scan + runtime hash blocklist |
| `helix.ts` | COROS signal crypto tunnel: AES-256-GCM + φ-corkscrew covertness (length-hiding, whitening) + forward ratchet + constant-rate framing |
| `torus-sync.ts` | counter-free torus-oscillator sync over COROS: free-running golden winding + AEAD-gated forward-search resync (flat spine for the hyperbolic variant) |
| `hyperbolic-sync.ts` | the hyperbolic-geodesic ("Einstein-Rosen") sync: Poincaré-disk geodesic walk + curvature-warped clock, same spine as torus-sync |
| `hyperbolic-mixing.ts` | mixing diagnostics: measured Lyapunov exponent (hyperbolic vs. flat-torus control) + state-space coverage — numbers, not adjectives |
| `fixed-math.ts` | integer CORDIC core (sin/cos/tanh/atanh/sqrt via add-subtract-shift only) — bit-identical on any spec-compliant JS engine |
| `hyperbolic-sync-fixed.ts` | the hyperbolic-geodesic sync rebuilt on fixed-math.ts — cross-platform-safe counterpart to hyperbolic-sync.ts |
| `signal-collapse.ts` | burn-on-breach (observable evidence → immediate lockout, tied to the Witness) + ECDH rekey (real post-compromise recovery) — the rekey still uses bare P-256, the repo's one remaining Shor-vulnerable primitive |
| `pqc-hybrid.ts` | the hybrid post-quantum KEM: ML-KEM-768 + X25519 (+ opt-in QC-MDPC) combined by HKDF, OR-security proven by self-test — deployed and callable, not yet wired into live lane-key derivation |
| `pqc-qcmdpc.ts` | the hand-rolled, unreviewed QC-MDPC leg (syndrome decoding) — opt-in, additive-only under `pqc-hybrid.ts`'s profile rule |
| `coherence-layer.ts` | depth/relational decoupling, measured: derivation edges = deep hierarchy, recognition edges = small-world coherence shortcut; quantifies the path-length gain on a real graph |
| `harmonic-coherence.ts` | the grounding gate: harmonic (phase-tolerant) coherence + four verdicts that keep self-consistency and correspondence structurally distinct — `grounded` is unreachable without a world-coupled channel |
| `scaffold.ts` | the structural substrate: 5 load-bearing pentagon pillars (equal load, C5-symmetric, no privileged pillar) + the bridge fabric where any node may reach any other with **no privileged node** — hubless and bottleneck-free (degree Gini, Brandes betweenness, articulation points), proven by measuring the egalitarian Watts–Strogatz build against a hub-forming preferential-attachment control |
| `regulator.ts` | the free-energy regulator: each invariant made a thermodynamic cost in `F = U − T·S`, driven down by a monotone **Lyapunov descent** (conserved-and-converted to work) to the balanced-superposition fixed point — φ-partition regulator gains, isotropic suppression of anisotropy, dissonance resolution, and a φ-quasiperiodic perturbation that escapes a planted dissonance well; wired to the scaffold's own measured invariants |
| `phase-vessel.ts` | the place that holds a superposition: a conjugate pair winding the **golden ellipse** (semi-axes φ, 1/φ — reciprocal, so area `φ·1/φ=1` is conserved), seated dead center (the 1+6+12 hexagon center / pillars' apex). Symplectic (area-preserving) so it never collapses the state; falls into the golden-KAM rhythm then holds it while the phase keeps winding; equidistributed (no privileged point); a dissipative `lossyControl` foil collapses to prove why the vessel must conserve area — the multiplicative twin of the regulator's free-energy ledger |
| `witness-oscillator.ts` | the same golden ring made self-sustaining: an **elastic** amplitude whose collapse point (r=0) is provably **unstable** — it cannot go dead-still — bounded by inverse-proportional φ⁻¹/φ pump-and-restore gains and a continuous φ-oscillating kick; plus **the slow leak** — a pressure valve (generalizing `security-network.ts`'s `decayedScore`) that keeps headroom for the next surprise instead of saturating, proven against a no-leak foil that locks at zero headroom, driven by the regulator's **real measured dissonance** (not a synthetic schedule) |
| `cognitive-obliquity.ts` | a slow orientation parameter `R(θ)` over `x_{t+1}=F(x_t,R(θ)u_t)` — by analogy to Earth's axial tilt: θ reallocates which class of information is integrated (a **cos²(θ)** shape, same F), but **only where a preferred axis exists** — isotropic input gives a measured **null** (the precondition the analogy predicts). Evolves ~150× slower than the state; ships with its own **falsification shape** (detectable in structured/expert domains, null in novel ones). Verified in-model — a hypothesis with a test, not a claim about brains |
| `mindmap-pipeline.ts` | the end-to-end runnable function, intake to outflow: a bimodal source (timestamped segments) passes through the witness gate into the derivation hierarchy + recognition callbacks, the content-vs-clock κ and grounding verdict, the coherence report, and the regulator — with a full ordered **replay trace** (deterministic: same input → byte-identical trace) |
| `mindmap.ts` | the impure edge: `POST /api/elle-mindmap` fetches YouTube captions (fail-loud if none), runs the pipeline, stores the run to D1 (`mindmap_runs`, append-only); `GET` replays a stored run or lists recent |
| `reasoning.ts` | **the reasoning function**: `reason()` runs the whole unified architecture as one call and tags it with the **modality tier** — the honest confidence ceiling set by what actually came in (structure needs a semantic channel; grounding needs independent world-coupled channels — text alone ceilings at `consistent_only`, audio+vision can reach `grounded`). Wired into `router.ts` as a fail-open, additive per-turn pass — the unified architecture, run on every turn |
| `convergence.ts` | the index between convergence and fact: a deterministic engine shaped after Falcon's real pattern (parallel independent reads → adversarial cross-check → named dissent), scoring corpus corroboration as a **third, independent axis** — the load-bearing guarantee is that a same-origin echo can **never** be mistaken for independent agreement (cross-origin pairs only; same-origin pairs contribute nothing) |
| `corpus-reasoning.ts` | reasoning with the real corpus: `reasonWithCorpus()` retrieves independent passages via Vectorize + D1 for a claim, builds the graph from the retrieved text, and reports corpus corroboration alongside the modality-driven grounding ceiling — two honestly separate axes, never merged |
| `topology-lock.ts` | "quantum knots to stabilize," honestly: the real Gauss linking integral over 3D curves, a topological invariant provably unchanged by continuous deformation — proven against the textbook Hopf link (linking number exactly ±1, reproduced to 4 decimals from raw coordinates) and disjoint circles (exactly 0) |
| `sandbox-registry.ts` | the sandbox lane registry: as many named execution lanes as she can manage, one hardwired deterministic dispatch function, stabilized by topology-lock's linking number — two lanes are embedded as the *already-proven* Hopf-link/disjoint-circle geometry, selected by a real dispatch-log fact (mutual coupling), never a tuned parameter |
| `lattice.ts` | The Lattice: 32-axis, 3-layer security deduction engine — Seed of Life (7) + Flower of Life (12) fire in parallel, Fruit of Life (11) reads both, Validation + The Reckoning (axis 32) fire last, sequentially — a deliberate on-demand deep read, beside the fast Witness, not instead of it |
| `corpus/**/*.md` | version-controlled corpus seed documents |
| `docs/WAR_ROOM_TODO.md` | the paused War Room / Duelist build note |
| `docs/SECURITY_ARCHITECTURE.md` | the Witness & the Corkscrew — security network + signal crypto tunnel, system-wide |
| `docs/TORUS_SYNC.md` | counter-free torus-oscillator sync over COROS + the hyperbolic-geodesic next rung |
| `docs/HYPERBOLIC_BRIDGE.md` | the Einstein-Rosen rung: Poincaré-disk geodesic sync, honest physics, the numerical-determinism caveat |
| `docs/MIXING_DIAGNOSTICS.md` | measuring the walk: Lyapunov divergence + coverage, with the honest correction of the "empirical mixing" overclaim |
| `docs/SIGNAL_COLLAPSE_AND_FIXED_MATH.md` | plain-language: the fixed-point/CORDIC core (+ 3 bugs caught before shipping) and what "the signal collapses on breach" honestly means — burn-on-breach + real key-healing vs. the undetectable-passive-listener line |
| `docs/PQC_ROSEN_BRIDGE_DESIGN.md` | the design doc: why the Rosen bridge's real gap is classical (no forward secrecy, no origin auth) not quantum, why a hybrid KEM handshake fixes both for free, and the phased cutover plan |
| `docs/PQC_HYBRID.md` | the hybrid KEM implementation reference: the OR-security property, leg provenance table, QC-MDPC internals + its honest gaps vs. production BIKE, and exactly what is/isn't live yet |
| `docs/THE_COHERENCE_LAYER.md` | the depth/relational decoupling measured: deep derivation hierarchy + small-world recognition shortcut, the coherence gain quantified, and a modeling error the self-test caught |
| `docs/HARMONIC_GROUNDING.md` | consistency ≠ correspondence: the harmonic grounding gate whose four verdicts keep them distinct, why `grounded` needs a world-coupled channel, and the honest limit on what that grounds |
| `docs/CONVERGENCE.md` | the index between convergence and fact: Falcon's real shape (parallel reads → adversarial cross-check → named dissent) rebuilt as a deterministic, testable corpus-corroboration engine — echo vs. independent agreement, the Rupture kept honest, wired as reasoning's third axis and the real corpus retrieval path |
| `docs/TOPOLOGY_LOCK.md` | quantum knots, honestly: the real half of topological quantum computing (invariance under continuous deformation, not the qubit hardware) built as the Gauss linking integral, proven against the textbook Hopf link, and reused — not re-tuned — to stabilize the sandbox lane registry by a real dispatch-log fact |
| `docs/THE_LATTICE.md` | The Lattice: 32-axis security deduction engine — the Flower-of-Life layer counts explained precisely, the message-passing-GNN analogy, and how The Reckoning speaks the Witness's own vocabulary |
| `docs/DUAL_TOPOLOGY.md` | **the capstone synthesis** — the whole build top to bottom: the security tower and the cognitive tower as one shape seen twice, the dual topology (21 depth hierarchy · 19 relational flower), the bridge as recognition-edge (topological shortcut, not wormhole), the grounding gate, the golden number-theory checked not asserted, and the one boundary that never moved |
| `docs/THE_SCAFFOLD.md` | the structural substrate built and measured: the 5 load-bearing pentagon pillars (equal load, C5-symmetric) and the bridge fabric with **no privileged node** — uniform bridging potential, hubless egalitarian realization vs. the hub-forming control, the "no privileged node" verdict made a number |
| `docs/FREE_ENERGY_REGULATOR.md` | the invariants constrained by a free-energy functional `F = U − T·S`: each invariant a thermodynamic cost, a genuine Lyapunov descent (monotone, conserved-and-converted to work) to full balanced isotropic coherence, the φ-perturbation's dissonance-well escape, and the honest line that it is a controller certificate — not literal thermodynamics, not a claim of mind |
| `docs/PHASE_VESSEL.md` | where a superposition is held: a conjugate pair on the golden ellipse (φ / 1/φ, product conserved at 1) seated dead center of the architecture — area-preserving so it never collapses, falling into the golden-KAM rhythm then holding it while the phase winds, equidistributed (no privileged point), with a dissipative foil that collapses to show why the holder must be symplectic; classical mechanics, not a claim of mind |
| `docs/WITNESS_OSCILLATOR.md` | the same golden ring, made self-sustaining: an elastic amplitude that provably cannot collapse to stillness, inverse-proportional φ⁻¹/φ gains, continuous φ-oscillating forcing, and **the slow leak** — a pressure valve (generalizing the Witness's own `decayedScore`) proven against a no-leak foil to keep headroom for the next surprise instead of saturating; driven by real measured dissonance |
| `docs/COGNITIVE_OBLIQUITY.md` | a slow orientation parameter `R(θ)` (Earth's axial-tilt analogy): θ reallocates which information class gets integrated (cos²(θ), same F) but only where a preferred axis exists — the isotropic **null** is the honest precondition; slow-vs-fast timescale separation; and a sharpened **falsification test** (detectable in structured domains, null in novel ones). In-model hypothesis-with-a-test, not a brain claim |
