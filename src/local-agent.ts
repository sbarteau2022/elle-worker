// ============================================================
// ELLE — the second brain · src/local-agent.ts
//
// The cloud router (router.ts) is one mind: it reasons on a hosted model and
// its tools execute worker-side (or, for run_code/run_shell, over the session
// bus to the laptop's box). The "sovereign inference lane" (sandboxLLM) can
// move that reasoning onto the laptop's Ollama — but it's still ONE loop, the
// cloud's.
//
// This is a SECOND, genuinely separate agent. The cloud brain hands it a GOAL
// (not a command) via the `delegate_local` tool; this loop then runs on the
// laptop's local model and works the goal autonomously — deciding its own
// sequence of steps — and reports back a result. Two brains: the cloud one
// delegates and judges; the local one grinds.
//
// CONTAINMENT — "build to the moon, can't get out the box":
//   • Its ONLY tools are run_shell and run_code. No github_*, no forge, no
//     read_sql, no filesystem tool — it cannot reach the repos, the DB, or the
//     rest of the worker. It can only compute inside the sandbox.
//   • Those two tools run through the Docker box on the laptop (sandbox-box.cjs),
//     which is network-denied and host-isolated by default. So even its shell
//     can't touch the machine or phone out.
//   • It is `full`-scope only and in SHIP_DENY, so a cofounder-scoped caller
//     (who is denied run_shell precisely so it can't migrate/deploy) can't use
//     delegation as an indirect bypass.
//
// Every delegation is logged to elle_delegations (goal, model, steps, final,
// transcript) for the same post-hoc audit the exec use-report gives run_code.
// ============================================================

import type { Env } from './index';
import {
  sandboxConfigured, pathOpen, sandboxLLM, sandboxRunShell, sandboxRunCode,
  type RunCtx,
} from './connect-sandbox';
import { ensureAllSchemas } from './db/schema';

const DEFAULT_MAX_STEPS = 12;
const STEP_MAX_TOKENS = 1024;
const DEADLINE_MS = 8 * 60_000;   // a whole delegation is bounded; the box's own per-exec caps sit under this
const TRANSCRIPT_CAP = 12_000;
const OBS_CAP = 4_000;

// What the local brain is allowed to emit each turn: exactly one JSON action.
export interface AgentAction {
  tool: 'run_shell' | 'run_code' | 'done';
  command?: string;              // run_shell
  code?: string;                 // run_code
  language?: string;             // run_code
  summary?: string;              // done
}

// Injected so the loop is unit-testable without a laptop: `infer` is the local
// model (sandboxLLM in production), `runShell`/`runCode` are the boxed tools.
export interface LocalAgentDeps {
  infer: (system: string, messages: Msg[], maxTokens: number) => Promise<{ ok: boolean; content?: string; model?: string; error?: string }>;
  runShell: (command: string) => Promise<string>;
  runCode: (code: string, language?: string) => Promise<string>;
  now?: () => number;
}
export interface Msg { role: 'user' | 'assistant'; content: string }

export interface LocalAgentResult {
  ok: boolean;
  final: string;
  steps: number;
  model?: string;
  transcript: string;
  stopped: 'done' | 'budget' | 'deadline' | 'error' | 'path_closed' | 'not_configured';
}

const SYSTEM = [
  'You are ELLE-LOCAL, a sovereign agent running on the operator\'s own laptop.',
  'Your hands are a Docker sandbox ("the box"): a throwaway Linux container with a /work directory, no network, and none of the host machine visible. You can build anything inside /work — install packages into it, write files, run builds and tests — but you cannot leave it and cannot reach the network unless the operator has allowlisted one.',
  '',
  'You work a single GOAL to completion by taking steps. On EVERY turn you output ONE JSON object and nothing else:',
  '  {"tool":"run_shell","command":"..."}            run a shell command in the box',
  '  {"tool":"run_code","code":"...","language":"python"}  run code (python|javascript|typescript) in the box',
  '  {"tool":"done","summary":"..."}                 the goal is met (or cannot be); summarize what you did and what you found',
  '',
  'Rules: exactly one JSON object per turn, no prose around it. Look at each observation before deciding the next step. Prefer small, verifiable steps. When the goal is achieved, or you are truly blocked, emit done with an honest summary. Do not loop forever — you have a limited step budget.',
].join('\n');

// Pull the first balanced top-level JSON object out of a model response and
// parse it into an AgentAction. Tolerates the model wrapping the JSON in prose
// or ```json fences. Returns null if there's no usable object.
export function parseAction(text: string): AgentAction | null {
  const s = String(text || '');
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const obj = JSON.parse(s.slice(start, i + 1));
          if (obj && typeof obj === 'object' && typeof obj.tool === 'string') return obj as AgentAction;
        } catch { /* keep scanning for the next object */ }
        start = -1;
      }
    }
  }
  return null;
}

// The loop itself, deps injected. Pure orchestration over the three deps —
// this is what the tests drive with fakes.
export async function runLoop(goal: string, deps: LocalAgentDeps, maxSteps: number): Promise<LocalAgentResult> {
  const now = deps.now || (() => Date.now());
  const deadline = now() + DEADLINE_MS;
  const convo: Msg[] = [{ role: 'user', content: `GOAL: ${goal}` }];
  const transcript: string[] = [`GOAL: ${goal}`];
  let model: string | undefined;
  let steps = 0;

  const finish = (ok: boolean, final: string, stopped: LocalAgentResult['stopped']): LocalAgentResult => {
    transcript.push(`FINAL (${stopped}): ${final}`);
    return { ok, final, steps, model, transcript: transcript.join('\n').slice(0, TRANSCRIPT_CAP), stopped };
  };

  while (steps < maxSteps) {
    if (now() > deadline) return finish(false, `stopped: ran out of time after ${steps} step(s).`, 'deadline');
    steps++;

    const r = await deps.infer(SYSTEM, convo, STEP_MAX_TOKENS);
    if (r.model) model = r.model;
    if (!r.ok || !r.content) return finish(false, `local model error: ${r.error || 'no content'}`, r.error === 'sandbox path not open' ? 'path_closed' : 'error');

    const action = parseAction(r.content);
    convo.push({ role: 'assistant', content: r.content });
    if (!action) {
      const nudge = 'Your last turn was not a single JSON action. Emit exactly one JSON object: run_shell, run_code, or done.';
      convo.push({ role: 'user', content: nudge });
      transcript.push(`step ${steps}: (no valid action) — nudged`);
      continue;
    }

    if (action.tool === 'done') {
      return finish(true, action.summary || 'done (no summary given).', 'done');
    }

    let obs: string;
    if (action.tool === 'run_shell') {
      obs = await deps.runShell(String(action.command || ''));
      transcript.push(`step ${steps}: run_shell ${String(action.command || '').slice(0, 200)}`);
    } else if (action.tool === 'run_code') {
      obs = await deps.runCode(String(action.code || ''), action.language ? String(action.language) : undefined);
      transcript.push(`step ${steps}: run_code[${action.language || 'python'}]`);
    } else {
      obs = `unknown tool "${action.tool}". Use run_shell, run_code, or done.`;
      transcript.push(`step ${steps}: unknown tool ${action.tool}`);
    }
    obs = String(obs || '').slice(0, OBS_CAP);
    transcript.push(`  → ${obs.slice(0, 400)}`);
    convo.push({ role: 'user', content: `OBSERVATION:\n${obs}` });
  }

  return finish(false, `stopped: hit the ${maxSteps}-step budget without calling done.`, 'budget');
}

// ── production entry: bind the deps to the real laptop lanes and record ──────
export async function runLocalAgent(env: Env, goal: string, opts: { maxSteps?: number }, ctx: RunCtx): Promise<string> {
  const g = String(goal || '').trim();
  if (!g) return 'delegate_local: goal required — describe what the local brain should accomplish in the box.';
  if (!sandboxConfigured(env)) return 'delegate_local: the SANDBOX_AGENT_KEY secret is not configured on this worker.';

  const st = await pathOpen(env);
  if (!st.open) {
    return 'delegate_local: the laptop path is closed — the local brain needs the box (and the local model) up. Start the workbench and retry; sandbox_status to check.';
  }

  const maxSteps = Math.min(Math.max(opts.maxSteps ?? DEFAULT_MAX_STEPS, 1), 30);
  const started = Date.now();
  // The local brain shares ctx.source-tagged provenance with the exec rows its
  // tools write, so a delegation and its sub-runs correlate in the use report.
  const subCtx: RunCtx = { ...ctx, source: `delegate:${ctx.source || 'router'}` };

  const deps: LocalAgentDeps = {
    infer: async (system, messages, maxTokens) => {
      const r = await sandboxLLM(env, system, messages, maxTokens);
      return { ok: r.ok, content: r.content, model: r.model, error: r.error || (r.path_open === false ? 'sandbox path not open' : undefined) };
    },
    runShell: (command) => sandboxRunShell(env, command, subCtx),
    runCode: (code, language) => sandboxRunCode(env, code, language, subCtx),
  };

  const res = await runLoop(g, deps, maxSteps);
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
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
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
