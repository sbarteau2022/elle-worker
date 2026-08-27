# CLAUDE.md — working agreement for this repo

Operator: Stewart Barteau. Read before doing multi-step work here.

## Pull-request discipline

- **Max 2 pull requests per session.** Batch related work into a single PR
  instead of opening one per sub-task. If a session produces more than two
  distinct deliverables, group them into ≤2 PRs — or ask before exceeding two.
  A stream of small PRs for one line of work is the anti-pattern this rule
  exists to stop.

_Set 2026-07-20 after a session opened four PRs for what should have been one
or two._

## Configuration: where values actually go

Three different places, and putting a value in the wrong one silently does
nothing. Know which kind a value is before telling the operator to set it.

| Kind | Where it goes | How to set it |
|---|---|---|
| **Cloudflare Worker secret** | Cloudflare only | dashboard (Workers → elle-worker → Settings → Variables → Encrypt), or `wrangler secret put NAME` |
| **Config var** (`[vars]`) | `wrangler.toml`, committed | edit the file — **not** the dashboard |
| **GitHub Actions secret** | repo Settings → Secrets → Actions | only if a `.github/workflows/*.yml` file literally reads `secrets.NAME` |

`wrangler deploy` treats `wrangler.toml` as authoritative for `[vars]`: a plain
var set in the dashboard is **wiped by the next deploy**. Secrets are never
touched by deploy. A GitHub Actions secret does **not** reach Cloudflare unless
a workflow step explicitly forwards it — no step in this repo does.

**GitHub Actions secrets here are exactly two**, and that is the whole list:
`CLOUDFLARE_API_TOKEN` (`elle-worker-deploy.yml`) and `ELLE_SERVICE_KEY`
(`prune-corpus.yml`). Everything else in `docs/SERVICE_KEYS.md` is a Cloudflare
secret. `ELLE_SERVICE_KEY` legitimately lives in both: Cloudflare's copy
verifies inbound calls, GitHub's copy authenticates CI calling in.

`docs/SERVICE_KEYS.md` is the canonical fleet-wide reference. Read it before
re-deriving a key list by grep — and update it when a repo's key surface
changes, or the next session re-derives from a stale table.

## Reading the code before making claims about it

Two mistakes have cost real operator time. Don't repeat them:

1. **`grep "env\.X"` misses destructured env.** `llm.ts` takes its env as a
   parameter (`(e: LLMEnv) => normalizeModel(e.LLM_MODEL_PRIMARY, ...)`), so an
   `env.` grep silently drops the entire `LLM_MODEL_*` family. Grep the
   `Env`/`*Env` interface declarations too. Also note `src/session-bus.ts` and
   `src/hyper.ts` match as binary — plain `grep` skips them without saying so;
   use `grep -a`.
2. **"Not declared in `wrangler.toml`" ≠ "hardcoded" or "dead."** The pattern
   throughout this worker is `env.SOMETHING || 'default'` — e.g. `flock.ts`'s
   `env.FLOCK_IMAGE_PROVIDER || 'workers-ai'`. The var is read; unset degrades
   to a documented default; setting it turns the feature on. Roughly 27 config
   vars are read this way without appearing in `[vars]`, and every one of them
   is live. Reporting them as "not in play" is false and alarming — check for
   the fallback before characterizing anything as missing.

## Fail-closed is the house style

Unset integrations report "not configured" and stay disabled rather than
erroring: payroll without `PAYROLL_TOKEN_ENC_KEY`, the sandbox without
`SANDBOX_AGENT_KEY` (503), CRM intake without `INGEST_API_TOKEN`, live trading
without `ELLE_LIVE_TRADING=on`. That is the intended default, not a bug. Say so
plainly instead of filing it as breakage.
