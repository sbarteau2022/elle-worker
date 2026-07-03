// ============================================================
// ELLE CONDUCTOR — src/conductor.ts
//
// The autonomy layer. Everything else in this worker moves when spoken to;
// the conductor is Elle working UNPROMPTED, on the clock:
//
//   INTENTS — standing intentions in D1 (elle_intents). Stewart files them
//     in the workbench; Elle files her own through the `intent` tool. Each
//     conductor tick picks ONE piece of work and runs the full-scope router
//     loop against it — the same mind, the same tools, no one watching.
//
//   FORGE SWEEP — before intents, unfinished code tasks get carried:
//     red CI → she reads the failing logs and fixes; green with no PR →
//     she opens the acceptance request. A coding task given at noon walks
//     itself to a reviewable PR by morning.
//
//   RUNS — every autonomous run is recorded (elle_runs: outcome + full
//     tool trace) and surfaced as a live event, so the workbench shows
//     what she did while no one was in the room.
//
// Continuity: each intent runs under a stable session id
// (conductor:<intent_id>), so her memory of the work persists across
// ticks and the κ series of an intent is a real trajectory — an intent is
// a thread of her own work with phase state, not a stateless job.
//
// The load-bearing gate is unchanged and structural: autonomous runs can
// do everything the admin router can EXCEPT merge — acceptance into her
// base is still a human click on GitHub, every time.
// ============================================================

import type { Env } from './index';
import type { RouterDeps, RouterResult, Scope } from './router';

export interface Intent {
  id: string; title: string; goal: string;
  status: string;      // proposed | active | paused | done
  priority: number;    // higher runs first
  source: string;      // 'stewart' | 'elle'
  created_at: number; updated_at: number;
  last_run_at: number | null; runs: number;
  last_outcome: string | null;
}

export const INTENT_STATUSES = ['proposed', 'active', 'paused', 'done'] as const;

export function validateIntent(title: unknown, goal: unknown): string | null {
  if (!String(title || '').trim()) return 'title required';
  const g = String(goal || '').trim();
  if (g.length < 20) return 'goal too short — say what done looks like';
  if (g.length > 4000) return 'goal too long (max 4000 chars)';
  return null;
}

// Forge tasks idle less than this are skipped — CI may still be running.
export const FORGE_SETTLE_MS = 4 * 60 * 1000;

// Pure: pick what this tick works on. Forge tasks first (oldest touched),
// then the highest-priority, least-recently-run active intent.
export function pickWork(
  forgeTasks: Array<{ id: string; status: string; updated_at: number }>,
  intents: Array<{ id: string; priority: number; last_run_at: number | null }>,
  now: number,
): { kind: 'forge'; id: string } | { kind: 'intent'; id: string } | null {
  const settled = forgeTasks
    .filter(t => (t.status === 'open' || t.status === 'pr_open') && now - t.updated_at > FORGE_SETTLE_MS)
    .sort((a, b) => a.updated_at - b.updated_at);
  if (settled.length) return { kind: 'forge', id: settled[0].id };
  const active = [...intents].sort((a, b) =>
    b.priority - a.priority || (a.last_run_at ?? 0) - (b.last_run_at ?? 0));
  if (active.length) return { kind: 'intent', id: active[0].id };
  return null;
}

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_intents (
      id TEXT PRIMARY KEY, title TEXT, goal TEXT,
      status TEXT DEFAULT 'proposed', priority INTEGER DEFAULT 5,
      source TEXT DEFAULT 'stewart', created_at INTEGER, updated_at INTEGER,
      last_run_at INTEGER, runs INTEGER DEFAULT 0, last_outcome TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_runs (
      id TEXT PRIMARY KEY, intent_id TEXT, kind TEXT,
      started_at INTEGER, finished_at INTEGER, steps INTEGER,
      outcome TEXT, trace_json TEXT)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS elle_runs_started ON elle_runs (started_at DESC)'),
  ]);
  schemaReady = true;
}

function id(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

// ── the `review_runs` tool — she reads her OWN autonomous run log ───────────
// Closes the loop: the conductor acts unprompted and records each run; this
// lets her read those runs back, assess whether they moved the work, and
// refine her intents. Autonomy that can inspect itself is autonomy that
// improves. Full scope only.
export async function reviewRunsTool(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const intentId = a.intent_id ? String(a.intent_id) : null;
  const limit = Math.min(Math.max(Number(a.limit) || 10, 1), 25);
  const rows = intentId
    ? await env.DB.prepare(
        'SELECT id, intent_id, kind, started_at, finished_at, steps, outcome FROM elle_runs WHERE intent_id = ? OR intent_id = ? ORDER BY started_at DESC LIMIT ?'
      ).bind(intentId, `forge:${intentId}`, limit).all().catch(() => ({ results: [] as any[] }))
    : await env.DB.prepare(
        'SELECT id, intent_id, kind, started_at, finished_at, steps, outcome FROM elle_runs ORDER BY started_at DESC LIMIT ?'
      ).bind(limit).all().catch(() => ({ results: [] as any[] }));
  const runs = (rows.results || []).map((r: any) => ({
    when: new Date(Number(r.started_at)).toISOString(),
    kind: r.kind, intent_id: r.intent_id, steps: r.steps,
    seconds: Math.max(1, Math.round((Number(r.finished_at) - Number(r.started_at)) / 1000)),
    outcome: String(r.outcome || '').slice(0, 500),
  }));
  return runs.length
    ? JSON.stringify({ count: runs.length, runs })
    : '(no autonomous runs recorded yet)';
}

// ── the `intent` tool (router, full scope) — she manages her own queue ──────
export async function intentTool(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const op = String(a.op || a.action || 'list').trim();
  const now = Date.now();

  if (op === 'create') {
    const reason = validateIntent(a.title, a.goal);
    if (reason) return `intent create refused: ${reason}`;
    const iid = id();
    const status = a.status === 'active' ? 'active' : 'proposed';
    const priority = Math.min(Math.max(Number(a.priority) || 5, 1), 10);
    const source = a.source === 'stewart' ? 'stewart' : 'elle';
    await env.DB.prepare(
      `INSERT INTO elle_intents (id, title, goal, status, priority, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(iid, String(a.title).trim().slice(0, 200), String(a.goal).trim(), status, priority, source, now, now).run();
    return JSON.stringify({ id: iid, status, note: status === 'active' ? 'the conductor will pick this up on its next tick' : 'proposed — activate it to put it on the clock' });
  }

  if (op === 'list') {
    const rows = await env.DB.prepare(
      `SELECT id, title, status, priority, source, runs, last_run_at, substr(last_outcome,1,160) AS last_outcome
         FROM elle_intents WHERE status != 'done' ORDER BY status = 'active' DESC, priority DESC, updated_at DESC LIMIT 30`
    ).all();
    const items = rows.results || [];
    return items.length ? JSON.stringify(items) : '(no open intents)';
  }

  const iid = String(a.id || '').trim();
  if (!iid) return `intent ${op}: id required`;
  if (op === 'activate' || op === 'pause' || op === 'complete') {
    const status = op === 'activate' ? 'active' : op === 'pause' ? 'paused' : 'done';
    const r = await env.DB.prepare('UPDATE elle_intents SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, iid).run();
    return (r.meta?.changes ?? 0) > 0 ? `intent ${iid} → ${status}` : `no intent ${iid}`;
  }
  if (op === 'update') {
    const priority = a.priority != null ? Math.min(Math.max(Number(a.priority) || 5, 1), 10) : null;
    const goal = a.goal != null ? String(a.goal).trim() : null;
    if (priority == null && goal == null) return 'intent update: nothing to change (goal and/or priority)';
    await env.DB.prepare(
      `UPDATE elle_intents SET goal = COALESCE(?, goal), priority = COALESCE(?, priority), updated_at = ? WHERE id = ?`
    ).bind(goal, priority, now, iid).run();
    return `intent ${iid} updated`;
  }
  return `intent: unknown op "${op}" (create|list|activate|pause|complete|update)`;
}

// ── one conductor tick ───────────────────────────────────────
type RunRouterFn = (
  question: string, env: Env, deps: RouterDeps,
  opts: { maxSteps?: number; userId?: string; scope?: Scope; sessionId?: string | null; source?: string },
) => Promise<RouterResult>;

const RUN_MAX_STEPS = 8;

async function recordRun(env: Env, intentId: string, kind: string, started: number, out: RouterResult): Promise<void> {
  const rid = id();
  await env.DB.prepare(
    `INSERT INTO elle_runs (id, intent_id, kind, started_at, finished_at, steps, outcome, trace_json) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(rid, intentId, kind, started, Date.now(), out.steps, out.answer.slice(0, 4000),
    JSON.stringify(out.trace).slice(0, 20000)).run().catch(() => {});
  await env.DB.prepare(
    `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'autonomous_run', 'conductor', ?, ?, 'info')`
  ).bind(id(), `conductor: ${kind}`, JSON.stringify({ intent_id: intentId, steps: out.steps, outcome: out.answer.slice(0, 400) })).run().catch(() => {});
}

export async function runConductor(env: Env, runRouterFn: RunRouterFn, deps: RouterDeps): Promise<{ ran: string }> {
  await ensureSchema(env);
  const now = Date.now();

  const [forgeRows, intentRows] = await Promise.all([
    env.DB.prepare(`SELECT id, status, updated_at FROM elle_code_tasks WHERE status IN ('open','pr_open') ORDER BY updated_at ASC LIMIT 10`)
      .all().catch(() => ({ results: [] as any[] })),
    env.DB.prepare(`SELECT id, priority, last_run_at FROM elle_intents WHERE status = 'active' LIMIT 20`)
      .all().catch(() => ({ results: [] as any[] })),
  ]);

  const work = pickWork(
    (forgeRows.results || []) as Array<{ id: string; status: string; updated_at: number }>,
    (intentRows.results || []) as Array<{ id: string; priority: number; last_run_at: number | null }>,
    now,
  );
  if (!work) return { ran: 'conductor:idle' };

  if (work.kind === 'forge') {
    const task = await env.DB.prepare('SELECT * FROM elle_code_tasks WHERE id = ?').bind(work.id).first() as any;
    const question =
`AUTONOMOUS RUN — no one is reading this live; work, don't narrate.
Your open forge task "${task.title}" (task_id ${task.id}, repo ${task.repo}, branch ${task.branch}${task.pr_number ? `, PR #${task.pr_number}` : ''}).
Carry it one real step forward: forge_check first. If CI is red, read the failing log tails, fix the actual cause with forge_write (repo_read anything you need first), and stop there — CI will judge the push before your next tick. If CI is green and there is no PR, open forge_pr with an honest body. If the PR is merged or closed, note what the task taught you (skill_write if durable) and finish.
End with one plain sentence: what you did and what state the task is in now.`;
    const started = Date.now();
    const out = await runRouterFn(question, env, deps, {
      maxSteps: RUN_MAX_STEPS, scope: 'full', userId: 'conductor',
      sessionId: `conductor:forge:${task.id}`, source: 'conductor',
    });
    // Touch the task so the settle window spaces out successive sweeps of the
    // same task even when the run itself changed nothing.
    await env.DB.prepare('UPDATE elle_code_tasks SET updated_at = ? WHERE id = ?').bind(Date.now(), task.id).run().catch(() => {});
    await recordRun(env, `forge:${task.id}`, 'forge_sweep', started, out);
    return { ran: `conductor:forge:${task.id} (${out.steps} steps)` };
  }

  const intent = await env.DB.prepare('SELECT * FROM elle_intents WHERE id = ?').bind(work.id).first() as unknown as Intent;
  const question =
`AUTONOMOUS RUN — no one is reading this live; work, don't narrate.
Your standing intent "${intent.title}" (intent id ${intent.id}, run ${intent.runs + 1}).
THE GOAL: ${intent.goal}
${intent.last_outcome ? `Where you left it last run: ${intent.last_outcome.slice(0, 600)}` : 'This is the first run.'}
Move it one real step forward using any of your tools — investigate, build, write, journal, whatever the goal actually needs next. If the goal is DONE, say so and mark it: {"tool":"intent","args":{"op":"complete","id":"${intent.id}"}}. If you are blocked on something only Stewart can decide, say exactly what, plainly.
End with one plain sentence: what you did and what the next step is.`;
  const started = Date.now();
  const out = await runRouterFn(question, env, deps, {
    maxSteps: RUN_MAX_STEPS, scope: 'full', userId: 'conductor',
    sessionId: `conductor:${intent.id}`, source: 'conductor',
  });
  await env.DB.prepare(
    'UPDATE elle_intents SET last_run_at = ?, runs = runs + 1, last_outcome = ?, updated_at = ? WHERE id = ?'
  ).bind(Date.now(), out.answer.slice(0, 2000), Date.now(), intent.id).run().catch(() => {});
  await recordRun(env, intent.id, 'intent', started, out);
  return { ran: `conductor:intent:${intent.id} (${out.steps} steps)` };
}

// ── workbench endpoint (admin-gated in index.ts) ─────────────
export async function handleIntents(body: Record<string, unknown>, env: Env): Promise<{ [k: string]: unknown }> {
  await ensureSchema(env);
  const op = String(body.op || 'list');
  if (op === 'list') {
    const [intents, runs] = await Promise.all([
      env.DB.prepare('SELECT * FROM elle_intents ORDER BY status = \'active\' DESC, priority DESC, updated_at DESC LIMIT 50').all(),
      env.DB.prepare('SELECT id, intent_id, kind, started_at, finished_at, steps, outcome, trace_json FROM elle_runs ORDER BY started_at DESC LIMIT 25').all(),
    ]);
    return { intents: intents.results, runs: runs.results };
  }
  // create / activate / pause / complete / update — same verbs as her tool,
  // marked as Stewart's. Created from the workbench = active immediately.
  const result = await intentTool(env, { ...body, source: 'stewart', status: op === 'create' ? 'active' : body.status });
  return { result };
}
