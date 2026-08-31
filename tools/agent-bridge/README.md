# Agent Bridge — chief architect ⇄ worker coordination bus

A tiny [MCP](https://modelcontextprotocol.io) server that lets **two agents in
two different apps** collaborate on one shared task board:

| Role | Runs in | Does |
| --- | --- | --- |
| **Chief architect** (meta observer) | Google **Antigravity** (Gemini — or whomever you sub in) | Posts briefs, watches progress, reviews & approves results |
| **Worker** | **Claude Desktop** hosting your local **Qwen** | Claims tasks, reports progress, submits results, flags blockers |

The two apps can't see each other. This bridge is the surface they share:
Gemini hands work **down**, watches it happen, and reviews what comes **back** —
while Qwen does the actual execution. Because every tool takes an explicit
`role`, the architect is swappable; point a different model at the same server
and nothing else changes.

```
   ┌──────────────────────────┐          ┌──────────────────────────┐
   │  Google Antigravity      │          │  Claude Desktop          │
   │  Gemini = ARCHITECT      │          │  local Qwen = WORKER     │
   └───────────┬──────────────┘          └───────────┬──────────────┘
               │ MCP (serverUrl)                      │ MCP (mcp-remote shim)
               └──────────────┬───────────────────────┘
                              ▼
                 ┌─────────────────────────────┐
                 │  agent-bridge  (this)       │
                 │  POST http://127.0.0.1:8787 │
                 │  shared task board + inbox  │
                 │  durable JSON: data/board.json
                 └─────────────────────────────┘
```

## Why an HTTP bridge (not stdio)

An stdio MCP server is spawned *per client*, so Antigravity and Claude Desktop
would each get a **private** subprocess and never share state. This server runs
as **one** long-lived process over stateless Streamable HTTP on localhost, so
both apps read and write the **same** board.

## Run it

```bash
cd tools/agent-bridge
npm install
npm run build
npm start          # → http://127.0.0.1:8787/mcp
```

Config via env vars (all optional):

| Var | Default | Meaning |
| --- | --- | --- |
| `BRIDGE_PORT` | `8787` | Listen port |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address (keep on localhost) |
| `BRIDGE_DB` | `./data/board.json` | Where the board is persisted |
| `BRIDGE_TOKEN` | *(unset)* | If set, every request must send `Authorization: Bearer <token>` |

Health check: `curl http://127.0.0.1:8787/health`.

## Wire up the two apps

Snippets live in [`config/`](./config). Merge each into the app's own MCP config
— don't overwrite existing servers.

- **Antigravity (architect):** [`config/antigravity.mcp_config.json`](./config/antigravity.mcp_config.json)
  → `~/.gemini/config/mcp_config.json` (global) or `<workspace>/.agents/mcp_config.json`.
  Antigravity requires `serverUrl` for remote HTTP MCP. Save and it hot-reloads.
- **Claude Desktop (worker):** [`config/claude_desktop_config.json`](./config/claude_desktop_config.json)
  → `claude_desktop_config.json`. It speaks stdio, so the snippet uses the
  `mcp-remote` shim to reach the HTTP endpoint. Fully quit and reopen Claude
  Desktop after editing.

If you set `BRIDGE_TOKEN`, add the header on both sides:
Antigravity — `"headers": { "Authorization": "Bearer <token>" }`;
Claude Desktop — append `--header "Authorization: Bearer <token>"` to the
`mcp-remote` args.

## The workflow

**Architect (Gemini in Antigravity):**
1. `bridge_create_task` — hand down a brief (title + full spec + priority).
2. `bridge_inbox` with `role: "architect"` — watch for progress / submissions
   (pass the last `cursor` back as `since` to see only what's new).
3. `bridge_review` — `approve` (done) or `request_changes` (back to the worker).

**Worker (Qwen in Claude Desktop):**
1. `bridge_claim_next` with `role: "worker"` — take the next brief (returns the
   full spec + history).
2. `bridge_post_progress` — narrate as you go so the architect can observe.
3. `bridge_submit_result` — hand the finished work back for review, or
   `bridge_report_blocker` if stuck.

Either side: `bridge_list_tasks`, `bridge_get_task`, `bridge_status` to observe.

## Run it ON the laptop, not in a cloud session

Same constraint as `tools/qwen-mcp` in the sibling **Elle** repo (see this
repo's `CLAUDE.md`, "Delegating to the local model"): Claude Desktop and
Antigravity are both apps running on your machine, and they reach this
bridge over `127.0.0.1`. A cloud coding session's `127.0.0.1` is *that
container's* loopback, not your laptop's — so this process has to be started
by you, locally, for either app to ever see it.

### Tools

| Tool | Role | Purpose |
| --- | --- | --- |
| `bridge_create_task` | architect | Post a brief |
| `bridge_review` | architect | Approve / request changes |
| `bridge_send_directive` | either | Message on a task, no status change |
| `bridge_cancel_task` | architect | Withdraw a task |
| `bridge_claim_next` | worker | Take the next brief |
| `bridge_post_progress` | worker | Report an update |
| `bridge_submit_result` | worker | Submit finished work |
| `bridge_report_blocker` | worker | Flag a blocker |
| `bridge_list_tasks` | any | See the board |
| `bridge_get_task` | any | One task in full, with timeline |
| `bridge_inbox` | any | Poll events newer than a cursor |
| `bridge_status` | any | Health + counts |

## Seed the roles

Give each agent a one-line system instruction so it stays in character:

- **Architect:** *"You are the chief architect. Decompose the goal into briefs
  and post each with `bridge_create_task`. Do not write the implementation
  yourself — the worker does. Poll `bridge_inbox` (role: architect) and review
  every submission with `bridge_review`."*
- **Worker:** *"You are the worker. Call `bridge_claim_next` (role: worker),
  execute the brief exactly, post progress, then `bridge_submit_result`. If the
  brief is unclear or you're blocked, `bridge_report_blocker` instead of
  guessing."*

## Test

```bash
npm test          # vitest — store lifecycle, priority ordering, inbox, durability
```
