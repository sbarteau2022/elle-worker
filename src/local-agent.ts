// ============================================================
// ELLE — the second brain · src/local-agent.ts
//
// The cloud router (router.ts) is one mind: it reasons on a hosted model and
// its tools execute worker-side (or, for run_code/run_shell, over the session
// bus to the laptop's box). The "sovereign inference lane" (sandboxLLM) can
// move that reasoning onto the laptop's Ollama — but it's still ONE loop, the
// cloud's.
//
// This is a SECOND, genuinely separate agent — and a PEER, not a boxed
// sub-agent. The cloud brain hands it a GOAL (not a command) via the
// `delegate_local` tool; the ORCHESTRATION of that goal — deciding the next
// step from the last observation, over and over until done — now runs
// entirely in Electron (see Elle/electron/native/providers/local-react-agent.cjs),
// on the laptop's own model. This module's job shrinks to match: dispatch the
// goal as ONE job over the session bus, wait for the laptop to work it to
// completion on its own, and record what came back.
//
// TOOL CATALOG: the local loop gets the SAME catalog the cloud router does
// (renderLocalLoopCatalog() in router.ts — full scope minus the handful of
// tools that only make sense from inside the loop that's already running
// them: run_shell/run_code stay NATIVE to the laptop's own Docker box, no
// HTTP round trip; delegate_local itself would be self-recursion;
// sandbox_clone/sandbox_lane's laptop-bound lanes would try to bus-round-trip
// back to the very agent that's busy running this goal). Every other tool —
// corpus, read_sql, github_*, forge_*, journal, everything — is reachable
// over HTTP, via /api/elle-tool, authenticated the same way the session bus
// itself is (the SANDBOX_AGENT_KEY shared secret). That endpoint runs the
// EXACT SAME runTool() dispatch the cloud router's own loop uses, full scope
// — "a genuine peer to the cloud router" is the design, not a slogan.
//
// CONTAINMENT — what still holds:
//   • The channel is gated by the SAME shared secret that gates the sandbox
//     bus and /api/duplex: only the operator's own laptop holds it.
//   • It is `full`-scope only and in SHIP_DENY, so a cofounder-scoped caller
//     (denied run_shell precisely so it can't migrate/deploy) can't use
//     delegation as an indirect bypass.
//   • The whole goal is bounded by DEADLINE_MS — a run that never calls done
//     still comes back, doesn't hang forever.
//
// Every delegation is logged to elle_delegations (goal, model, steps, final,
// transcript) for the same post-hoc audit the exec use-report gives run_code.
// ============================================================

import type { Env } from './index';
import {
  sandboxConfigured, pathOpen, dispatchToLane,
  type RunCtx,
} from './connect-sandbox';
import { ensureAllSchemas } from './db/schema';
import { ELLE_VOICE } from './mind';

const DEFAULT_MAX_STEPS = 12;
// A peer with the full catalog can legitimately need more turns than the old
// shell/code-only loop did (read a few files, run tests, open a PR) — widened
// from the old 30-step ceiling, still bounded so a runaway goal can't spin
// forever.
const MAX_MAX_STEPS = 40;
// dispatchToLane clamps its own timeout to [1s, 600s] — use the whole window
// the bus allows rather than the old 8-minute sub-slice, since there's no
// longer a Worker-side step loop layering its own deadline on top.
const DEADLINE_MS = 10 * 60_000;
const TRANSCRIPT_CAP = 12_000;

const STOP_REASONS = new Set(['done', 'budget', 'deadline', 'error', 'path_closed', 'not_configured', 'timeout']);

export interface LocalAgentResult {
  ok: boolean;
  final: string;
  steps: number;
  model?: string;
  transcript: string;
  stopped: 'done' | 'budget' | 'deadline' | 'error' | 'path_closed' | 'not_configured' | 'timeout';
}

// The dispatch seam. Production sends the WHOLE goal to the laptop as one
// sealed job over the session bus and awaits its result — the laptop runs
// its own ReAct loop start to finish, reaching back to the Worker only for
// individual tool calls (over /api/elle-tool, not this bus). Tests inject a
// fake dispatch so the orchestration here stays testable without a laptop.
export interface LocalAgentDeps {
  dispatch: (goal: string, maxSteps: number, catalog: string, timeoutMs: number) => Promise<unknown>;
}

// Pure: turn whatever the laptop's react_goal job handler (or the bus itself,
// on a timeout) handed back into a well-formed LocalAgentResult. Tolerant of
// a handler that doesn't set every field — a summary and an ok flag are the
// only things this actually requires to produce something honest.
export function normalizeDispatchResult(raw: unknown): LocalAgentResult {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null;
  if (!r) return { ok: false, final: 'local brain returned no result.', steps: 0, transcript: '', stopped: 'error' };
  const ok = !!r.ok;
  const stopped = typeof r.stopped === 'string' && STOP_REASONS.has(r.stopped) ? r.stopped as LocalAgentResult['stopped'] : (ok ? 'done' : 'error');
  return {
    ok,
    final: String(r.final || r.error || (ok ? 'done (no summary given).' : 'local brain stopped with no summary.')),
    steps: Number(r.steps) || 0,
    model: r.model ? String(r.model) : undefined,
    transcript: String(r.transcript || '').slice(0, TRANSCRIPT_CAP),
    stopped,
  };
}

// The orchestration core, deps injected — this is what the tests drive.
export async function runAgentCore(goal: string, maxSteps: number, catalog: string, deps: LocalAgentDeps): Promise<LocalAgentResult> {
  const raw = await deps.dispatch(goal, maxSteps, catalog, DEADLINE_MS);
  return normalizeDispatchResult(raw);
}

function newId(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }

// ── production entry: dispatch to Electron, record the outcome ──────────────
export async function runLocalAgent(env: Env, goal: string, opts: { maxSteps?: number }, ctx: RunCtx, catalog: string): Promise<string> {
  const g = String(goal || '').trim();
  if (!g) return 'delegate_local: goal required — describe what the local brain should accomplish.';
  if (!sandboxConfigured(env)) return 'delegate_local: the SANDBOX_AGENT_KEY secret is not configured on this worker.';

  const st = await pathOpen(env);
  if (!st.open) {
    return 'delegate_local: the laptop path is closed — the local brain needs the workbench (and the local model) up. Start it and retry; sandbox_status to check.';
  }

  const maxSteps = Math.min(Math.max(opts.maxSteps ?? DEFAULT_MAX_STEPS, 1), MAX_MAX_STEPS);
  const started = Date.now();
  // The local brain shares ctx.source-tagged provenance with the tool calls
  // its own loop makes back over /api/elle-tool, so a delegation and every
  // tool call inside it correlate in the event bus / use reports by run_id.
  const subCtx: RunCtx = { ...ctx, source: `delegate:${ctx.source || 'router'}` };

  const deps: LocalAgentDeps = {
    // persona: the canonical self (mind.ts's ELLE_VOICE) — without this the
    // Electron loop (local-react-agent.cjs) only had its own bare mechanical
    // "ELLE-LOCAL, the sovereign second brain" protocol text, no voice at all.
    // Delegated goals run headless/autonomous, so they always get the default
    // register, same as the journal and libre runs.
    dispatch: (goal, maxSteps, catalog, timeoutMs) => dispatchToLane(env, 'primary', 'react_goal', {
      id: newId(), goal, max_steps: maxSteps, catalog, timeout_ms: timeoutMs, persona: ELLE_VOICE,
      run_id: subCtx.runId, session_id: subCtx.sessionId, source: subCtx.source, user_id: subCtx.userId,
    }),
  };

  const res = await runAgentCore(g, maxSteps, catalog, deps);
  await recordDelegation(env, ctx, {
    goal: g, model: res.model, steps: res.steps, ok: res.ok,
    final: res.final, transcript: res.transcript, duration_ms: Date.now() - started,
  });

  const head = res.ok
    ? `local brain finished the goal in ${res.steps} step(s)${res.model ? ` on ${res.model}` : ''}.`
    : `local brain stopped (${res.stopped}) after ${res.steps} step(s)${res.model ? ` on ${res.model}` : ''}.`;
  return `${head}\n\n${res.final}`;
}

// ── the use report for delegations ──────────────────────────
interface DelegationRow {
  goal: string; model?: string; steps: number; ok: boolean;
  final: string; transcript: string; duration_ms: number;
}
async function recordDelegation(env: Env, ctx: RunCtx, row: DelegationRow): Promise<void> {
  try {
    await ensureAllSchemas(env.DB);
    const id = newId();
    await env.DB.prepare(`INSERT INTO elle_delegations
      (id,run_id,session_id,user_id,source,goal,model,steps,ok,final,transcript,duration_ms,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id, ctx.runId ?? null, ctx.sessionId ?? null, ctx.userId ?? null, ctx.source ?? null,
      row.goal.slice(0, 2000), row.model ?? null, row.steps, row.ok ? 1 : 0,
      row.final.slice(0, 8000), row.transcript.slice(0, TRANSCRIPT_CAP), row.duration_ms, Date.now(),
    ).run();
  } catch {
    /* the use report is best-effort — it never blocks or fails a delegation */
  }
}

export async function delegationsRecent(env: Env, limit = 40): Promise<unknown[]> {
  try {
    await ensureAllSchemas(env.DB);
    const r = await env.DB.prepare(
      `SELECT id,run_id,session_id,user_id,source,goal,model,steps,ok,final,duration_ms,created_at
       FROM elle_delegations ORDER BY created_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 200)).all();
    return r.results || [];
  } catch {
    return [];
  }
}
