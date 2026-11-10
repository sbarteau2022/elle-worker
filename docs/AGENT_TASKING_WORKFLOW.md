# Tasking agents: batching, briefs, tool allocation, workspace, StrataKV

Written 2026-09-09 from a session that ran 25 agents across two workflows plus a parallel session,
and got one large finding *because* of how the tasking was written and one near-miss *because* of
how it wasn't. Every number here was measured in this repo on this machine.

---

## 0. The correction that has to come first: StrataKV is NOT "shared", it is two scopes

"Make sure the breathing cache is shared" is right for one namespace and a **correctness bug** for
the other. `swarm-worker.cjs:144-205` draws the boundary explicitly:

| scope | namespace | shared? | persisted? |
|---|---|---|---|
| **shared prefix** | `swarm:shared:coordinator-preamble` (constant — no agentId, no seq) | **YES, across every agent and every task** | **YES by default** |
| **per-agent** | `${agentId}:${seq}` and `${agentId}:${seq}:writer` | **NEVER** | no — evicted at task end regardless of the flag |

The shared namespace holds only the system preamble and tool scaffold, which is *byte-identical for
every agent* because they all run the same 27B coordinator weights. The per-agent namespace holds
one agent's task and conversation. **Sharing that one would leak one agent's divergent state into
another's cache reads** — the file says so in as many words.

So the rule when tasking is: *nothing agent-specific or task-specific may ever be folded into the
shared prefix.* The moment a brief, a seq, or an agent id enters that preamble, the shared namespace
becomes unsafe for everyone using it.

**Why the shared scope exists** (measured on a live SOVEREIGN run: 4 agents, ~1900 tokens of shared
preamble per step, 100 steps): the coordinator slot reported `hits 0, misses 0, stores 0,
namespaces 0` for the entire run. Two compounding causes — the coordinator call was sent with *no*
namespace at all (server contract: no ns → no caching), and the only scheme that existed baked
`agentId:seq` into the ns string, so each agent/task pair got a private slot and the identical
prefix was prefilled from scratch every time: **up to 4 × 100 = 400 redundant prefills of the same
~1900 tokens instead of one.**

Current state, verified: `ELLE_SWARM_CACHE_PERSIST` unset → shared persistence **ON**.
Set it to `0` or `false` only to disable; it does not affect the per-agent scope, which is evicted
at task end either way.

---

## 1. Tool allocation — the mechanism, and the trap that costs you three tools

`providers/tool-allocation.cjs`, `allocate(brief, region, opts)`:

```js
CORE = ['run_shell', 'run_code', 'edit_file', 'done']      // always granted
WEB  = ['web_search', 'fetch_url', 'deep_research']        // granted if WEB_RE matches the BRIEF TEXT
FACULTY_DEFAULTS = { 1:['fetch_url'], 5:['web_search','fetch_url'], 8:['web_search'], 10:['web_search'] }
```

**The trap.** `WEB_RE` matches the bare word **`research`**, and also `search the web`, `look up`,
`cite`, `citation`, `sources`, `url`, `https?:`, `website`, `browse`. `FETCH_RE` additionally
matches `fetch`, `page`, `read the page`.

Grants are computed **by regex over the brief text**. So:

- A brief that says *"do not research this, just compute it"* **grants all three web tools.** The
  regex has no notion of negation.
- A brief that names a path containing `research/` — e.g. `research/seam-wire/briefs/...`, which is
  where this project keeps everything — **grants all three web tools.**
- A brief mentioning "the page" or any `https://` example **grants `fetch_url`.**

Three tools the task never needed are then in the model's context on every step. That is the
suppression tax: the agent must repeatedly decide *not* to use them.

**How to write a brief that allocates correctly:**

1. Say the operation, not the genre. "Compute", "parse", "rank", "derive" — never "research".
2. Never paste a path containing `research/` into a brief that shouldn't browse. Refer to the file
   by basename and put the directory in a tool grant or an env var instead.
3. Check the sphere. `FACULTY_DEFAULTS` grants **by region level regardless of brief text** — a
   sphere-5 task gets `web_search` + `fetch_url` whether the brief asks or not.
4. **Verify the allocation before dispatch, don't assume it:**
   ```js
   require('./providers/tool-allocation.cjs').allocate(brief, region).why
   // → ['brief asks for research', 'sphere 5 default: web_search', ...]
   ```
   `why` is the audit trail. If it lists a reason you did not intend, rewrite the brief.

---

## 2. The scratch board

Per-task workspace at
`~/Library/Application Support/elle/swarm-workspace/task-<seq>/`, created per task, reported in the
submission (`workspace: ...`), and sandboxed (`jail seatbelt, network on`).

**It is not cleaned up.** 1,299 task directories are currently on disk. The KV namespace dies with
the task; the workspace does not. Budget for that, or sweep it.

For in-session agents (the Workflow tool, not the board) the equivalent is the session scratchpad.
Give each agent a **filename unique to its slice** — a dozen agents writing `out.json` in one
directory is a silent overwrite, not an error.

---

## 3. Batching

Partition by **mutable resource, not by topic.** Topics overlap; resources are what actually
collide. This session's parallel-work split was drawn that way and held through 25 agents plus an
independent session: the one file two writers touched survived only because their writes were
ordered, which is luck, not design — so the rule is one writer per file, always.

- **One agent per natural partition** — per sphere, per dimension, per attack strategy. Not per
  item, and not one agent for everything.
- **Concurrency caps at ~16**; excess queues. 12 is a comfortable fan-out.
- **Pipeline by default, barrier only when a stage genuinely needs all prior results** (dedup
  across the whole set, early-exit on zero, cross-item comparison).
- **Model tier by task shape.** Generative and mechanical work → Sonnet. Judgment, synthesis and
  adversarial verification → the stronger tier. Measured today: 12 Sonnet agents wrote 72 briefs in
  **~2 minutes, 0 errors**; the same fan-out on Opus was stopped and relaunched for no quality loss.

---

## 4. How explicit the brief has to be — with the evidence

**Explicit enough that the agent cannot satisfy the letter and miss the point.** Two results from
today, in opposite directions.

**The near-miss.** The first brief for generating a held-out brief set said: *"median pairwise
SequenceMatcher below 0.15."* That is a lexical bar, and a capable writer beats it by varying
surface form while writing one task six times. Measured: an attack that holds the task skeleton
fixed and swaps each row's vocabulary scores **0.0839 — better than genuinely distinct work at
0.1030.** Two statistics in that family rate eleven copies of one task as *twice as diverse* as 66
real ones. The bar was Goodhartable and it was mine.

**The fix that worked.** The replacement brief said, in the imperative:

> *Do NOT optimise for surface difference. Do not reach for a thesaurus, do not rotate sentence
> shapes, do not vary formats for their own sake. Vary the TASK: what operation is demanded, what
> the input is, what a correct answer looks like, what would have to be checked.*

and added a hard structural constraint: **the generator gets no embedder and no GPU.** It cannot
observe the metric it would need to optimise. The acceptance test runs afterwards, on the side that
owns the GPU.

That is the general principle: **a metric the optimiser cannot see cannot be Goodharted.** Prefer
withholding the measurement instrument over trusting an instruction not to game it.

**Also required in every brief:**

- **A structured output schema.** Forces data, not prose, and the model retries on mismatch.
- **A refutation condition.** "State what would refute you." A claim with none is not a finding.
- **A named honour-check where the automated gate is blind.** The diversity gate abstains on any
  sphere with no data payload — in the known-good batch that is 7 of 11 spheres — so the brief
  requires one line per sphere naming *what makes the six tasks six tasks*. The gate can catch you;
  it cannot certify you.
- **The hard constraints, enumerated.** Read-only paths, no git writes, no GPU, no touching
  `~/.elle/hyper-map/*`, scratch filename unique to the agent, and never push to GitHub.

---

## 5. The pre-flight checklist

Before dispatching any agent or board task:

1. **Tools** — run `allocate(brief, region).why` and read every reason. Rewrite the brief until the
   grant is exactly what the task needs. Watch for `research`, `page`, `url`, and the sphere default.
2. **Cache** — confirm nothing task-specific has entered the shared preamble. Per-agent state stays
   in `${agentId}:${seq}`.
3. **Workspace** — unique scratch path per agent; expect the board workspace to persist.
4. **Partition** — one writer per mutable file. New files only, for anything parallel.
5. **Schema** — structured output, with a refutation field.
6. **Instrument** — if the agent's work will be scored, can it see the scorer? If yes, either
   withhold it or expect the metric to be optimised instead of the goal.

---

## 6. The coordinator: watching alignment in real time

### What the worker already emits (and what was ignoring it)

Every checkpoint, `swarm-worker.cjs` emits an `atlas` event carrying **κ, Δ, θ, W and drift**, and a
`region.leave` when a turn settles outside the sphere the task was assigned to. It also re-reads its
task **every step** and injects any newer architect directive as the next observation:

> `DIRECTIVE FROM THE ARCHITECT (F=now): … — adjust your next action to this before anything else.`

So the steering channel was already built, in both directions.

**The gap, found 2026-09-09:** the coordinator (`providers/swarm.cjs`) handled `agent.dhng`,
`agent.dissolve`, `agent.line`, `agent.metrics`, `agent.model`, `agent.task`, `done`, `lateral`,
`progress`, `stay`, `submitted` — and **neither `atlas` nor `region.leave`.** It posted directives
only for lane topology (sphere→centre, centre→sphere, kissing-neighbour handoffs), never for
alignment. Worse, `partitionBudget` was called with a literal **`kappa: 0.5` for every agent** while
live κ streamed past unread — so the budget split that is supposed to be alignment-weighted was
weighted by a constant.

Same shape as three other defects found this session: **the instrument existed and nothing read it.**

### What was added

`swarm.cjs` now keeps an `alignment` map per agent and reacts on two triggers:

| trigger | condition | directive posted |
|---|---|---|
| `atlas` | κ < **0.5** (the sign-off floor) and not final | tells the agent a `done` will be REFUSED at this κ, that strain comes from failed execs and unsupported claims, and to run the check and **show the arithmetic for every number it states** before summarising |
| `region.leave` | settled outside the assigned sphere, not held | tells it to come back, or state in one line why the task genuinely belongs in the other sphere so the coordinator can hand it across |

- **κ floor is 0.5 because that is `canSignOff`'s own gate** — below it the run is already failing, so
  steering then beats steering at re-claim.
- **`NUDGE_COOLDOWN_MS = 45000`** stops the coordinator talking over itself: a nudge lands as the
  next observation, and a second before the agent has acted on the first only burns context.
- Nudges go through `bridge_send_directive`, i.e. the **same path** a manual architect directive
  takes and the same path `newDirectives()` already consumed. Nothing new has to be trusted.
- `partitionBudget` now receives **live κ** per task, falling back to 0.5 only when no agent is on it.
- `alignmentOf()` is exported so the UI or a test can read the live picture.

Emitted as `align.nudge { agentId, taskRef, why, body }` — `why` is `kappa-below-floor` or
`left-assigned-sphere`, so nudges are auditable after the fact.

### Roles

Roles are **assigned per task, by vote, not statically**: `specialists.pickRole(roster, title, brief)`
votes coder vs reasoner over the task text, then `pickModel` and `pickWriter` resolve the executor
and the writer pass against the roster. The brief text therefore decides the role — the same text
that decides tool allocation. **One more reason the brief's verbs matter:** "compute/derive/prove"
and "edit/run/deploy" pull in different directions, and a brief that mixes them gets a coin-flip.

Roster tags currently registered: `elle-a1` … `elle-a8`, `elle-s7`, plus `qwen3.8:27b` as the
coordinator. When every agent runs a large model, give each role a **distinct tag** — see dissolve
below for why that matters.

### Dissolve — already correct, and it matters more with large models

Each agent is **one task, one process**: `swarm-worker.cjs` calls `claimNext` exactly once, runs the
task, and exits. On close the coordinator calls `dissolveIfIdle(model)`, which unloads that model
**immediately** unless another *live* agent is still using the same tag.

So agents already dissolve independently and do **not** wait for the rest of the swarm. The only
hold is model sharing, and that hold is a correctness requirement — you cannot unload a model
another agent is mid-inference on.

**Consequence for a large-model swarm:** if two roles share a tag, the first to finish cannot free
the weights. Distinct tags per concurrent role ⇒ each finishing agent frees its own VRAM at once.
Shared tags ⇒ memory is held until the last user exits.

---

## 7. Effectiveness — what this workflow actually produced

Measured on this session, so the claims are checkable rather than aspirational:

- **12 Sonnet agents, one per sphere, blind, structured schema → 72 briefs in ~2 minutes, 0 errors**,
  and the batch passed a pre-registered acceptance rule it could not observe.
- **13 agents in attack/defend/synthesize → a gate that catches 12 of 13 adversarial batches**, and
  honestly reports the one it does not.
- The **one near-miss was a vague bar** (a lexical threshold), and it was caught only because a
  parallel agent was told to state what would refute it — and did.

The pattern that worked, in one line: **partition by mutable resource, specify the operation not the
genre, hand out the smallest tool set the regex will allow, withhold the scorer from the scored, and
require a refutation condition.**
