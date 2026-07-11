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

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
import type { RouterDeps, RouterResult, Scope } from './router';
import { evaluateWatches } from './watches';
import { scorePredictions } from './oracle';
import { pathOpen } from './connect-sandbox';

export interface Intent {
  id: string; title: string; goal: string;
  status: string;      // proposed | active | paused | ready | done
  priority: number;    // higher runs first
  source: string;      // 'stewart' | 'elle'
  created_at: number; updated_at: number;
  last_run_at: number | null; runs: number;
  last_outcome: string | null;
  draft?: string | null; // the sovereign's handoff — spec/plan/findings, filed with op 'ready'
}

// The two-tier lifecycle: 'active' intents are the EXPLORATION lane — worked
// local-first (the sovereign model over the sandbox socket, free) to
// investigate, spec, and draft. When the work is genuinely ready to ship, the
// run marks it 'ready' with a draft: that is the ready-to-ship queue, and
// ONLY those runs go to the big cloud engines, which finalize (forge tools,
// real code, the PR) from the draft and complete the intent. The heavy model
// is reached for the big stuff, never for the wandering.
export const INTENT_STATUSES = ['proposed', 'active', 'paused', 'ready', 'done'] as const;

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
// then READY intents (the ship queue — finished exploration waiting on the
// big model to finalize and push), then the highest-priority,
// least-recently-run active intent (the exploration lane).
export function pickWork(
  forgeTasks: Array<{ id: string; status: string; updated_at: number }>,
  intents: Array<{ id: string; priority: number; last_run_at: number | null; status?: string }>,
  now: number,
): { kind: 'forge'; id: string } | { kind: 'intent'; id: string } | null {
  const settled = forgeTasks
    .filter(t => (t.status === 'open' || t.status === 'pr_open') && now - t.updated_at > FORGE_SETTLE_MS)
    .sort((a, b) => a.updated_at - b.updated_at);
  if (settled.length) return { kind: 'forge', id: settled[0].id };
  const byUrgency = (a: { priority: number; last_run_at: number | null }, b: { priority: number; last_run_at: number | null }) =>
    b.priority - a.priority || (a.last_run_at ?? 0) - (b.last_run_at ?? 0);
  const ready = intents.filter(i => i.status === 'ready').sort(byUrgency);
  if (ready.length) return { kind: 'intent', id: ready[0].id };
  const active = intents.filter(i => i.status !== 'ready').sort(byUrgency);
  if (active.length) return { kind: 'intent', id: active[0].id };
  return null;
}

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
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
  // The handoff: exploration is done, the work is READY TO SHIP. The draft is
  // the payload the cloud finalize run conditions on — what was found, the
  // spec, the plan, the code sketched. This is the moment the intent leaves
  // the free lane and queues for the heavy engines.
  if (op === 'ready') {
    const draft = String(a.draft || a.spec || a.handoff || '').trim();
    if (draft.length < 40) return 'intent ready refused: include a draft — the spec/plan/findings the finalize run will build from (min 40 chars)';
    const r = await env.DB.prepare(
      "UPDATE elle_intents SET status = 'ready', draft = ?, updated_at = ? WHERE id = ?"
    ).bind(draft.slice(0, 12000), now, iid).run();
    return (r.meta?.changes ?? 0) > 0
      ? `intent ${iid} → ready. It is on the ship queue; the next conductor tick finalizes it on the heavy engines.`
      : `no intent ${iid}`;
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
  return `intent: unknown op "${op}" (create|list|activate|pause|complete|ready|update)`;
}

// ── one conductor tick ───────────────────────────────────────
type RunRouterFn = (
  question: string, env: Env, deps: RouterDeps,
  opts: { maxSteps?: number; userId?: string; scope?: Scope; sessionId?: string | null; source?: string; prefer?: 'local' },
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

// Two tick modes, one conductor:
//   'full'    — the hourly tick. Sentry passes, forge sweeps, READY finalizes,
//               exploration: everything, including the lanes that spend cloud
//               quota. One work item per tick, so conductor cloud outflow is
//               structurally capped at ~1 heavy run/hour — and the ready queue
//               sits in the workbench where Stewart can pause/kill before it
//               ships. He controls the outflow.
//   'explore' — the fast tick (every 10 min). ONLY runs when the sandbox path
//               is open (the free sovereign lane absorbs the whole extra
//               volume; a closed laptop means these ticks are no-ops, so the
//               faster clock can never multiply cloud spend). Picks only
//               ACTIVE intents — no sentry (watches ride research quota), no
//               forge sweeps, no finalizes.
export async function runConductor(
  env: Env, runRouterFn: RunRouterFn, deps: RouterDeps,
  opts: { mode?: 'full' | 'explore' } = {},
): Promise<{ ran: string }> {
  await ensureSchema(env);
  const now = Date.now();
  const explore = opts.mode === 'explore';

  if (explore) {
    const st = await pathOpen(env).catch(() => ({ open: false }));
    if (!st.open) return { ran: 'conductor:explore:skipped (sandbox path closed — the free lane is the whole point of this tick)' };
  }

  // Sentry pass — BEFORE picking work: evaluate due watches (a fired watch
  // files an active intent this very tick can then pick up) and settle any
  // predictions that have matured. Both capped and best-effort; the tick's
  // real work is never hostage to the sentry. Hourly tick only — watches
  // spend research quota, and 6x/hour would multiply it for nothing.
  if (!explore) {
    try {
      const research = async (q: string) => {
        const r = await deps.handleResearch({ query: q }, env);
        const d = await r.json() as { content?: string; search_results?: string };
        return `${d.content || ''}\n${d.search_results || ''}`;
      };
      await evaluateWatches(env, research, (args) => intentTool(env, args));
    } catch (e) { console.error('[CONDUCTOR] watch pass failed:', (e as Error).message); }
    try { await scorePredictions(env); }
    catch (e) { console.error('[CONDUCTOR] oracle pass failed:', (e as Error).message); }
  }

  const [forgeRows, intentRows] = await Promise.all([
    explore
      ? Promise.resolve({ results: [] as any[] })
      : env.DB.prepare(`SELECT id, status, updated_at FROM elle_code_tasks WHERE status IN ('open','pr_open') ORDER BY updated_at ASC LIMIT 10`)
          .all().catch(() => ({ results: [] as any[] })),
    env.DB.prepare(`SELECT id, priority, last_run_at, status FROM elle_intents WHERE status IN (${explore ? "'active'" : "'active','ready'"}) LIMIT 20`)
      .all().catch(() => ({ results: [] as any[] })),
  ]);

  const work = pickWork(
    (forgeRows.results || []) as Array<{ id: string; status: string; updated_at: number }>,
    (intentRows.results || []) as Array<{ id: string; priority: number; last_run_at: number | null; status?: string }>,
    now,
  );
  if (!work) return { ran: explore ? 'conductor:explore:idle' : 'conductor:idle' };

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

  // READY lane — the ship queue. Exploration already happened on the free
  // sovereign lane; THIS run is the big-model finalize: build from the draft,
  // push through the forge, complete. No prefer:'local' here — this is
  // exactly the work the heavy engines are reserved for.
  if (intent.status === 'ready') {
    const question =
`AUTONOMOUS RUN — no one is reading this live; work, don't narrate.
Your intent "${intent.title}" (intent id ${intent.id}) is READY TO SHIP. Your sovereign self explored it and handed off this draft:
--- DRAFT ---
${String(intent.draft || '(no draft was attached — reconstruct from the goal and the last outcome)').slice(0, 8000)}
--- END DRAFT ---
THE GOAL: ${intent.goal}
FINALIZE IT: verify the draft's claims where they matter, then do the real build — forge_open a task if code needs to land, forge_write the actual changes, forge_check, and open the PR with forge_pr. Acceptance is still Stewart's click; your job ends at a reviewable PR (or the equivalent finished artifact for non-code work). When shipped, mark it: {"tool":"intent","args":{"op":"complete","id":"${intent.id}"}}. If the draft is NOT actually ready — wrong, incomplete, blocked — say exactly why and send it back: {"tool":"intent","args":{"op":"activate","id":"${intent.id}"}}.
End with one plain sentence: what shipped, or why it went back.`;
    const started = Date.now();
    const out = await runRouterFn(question, env, deps, {
      maxSteps: RUN_MAX_STEPS, scope: 'full', userId: 'conductor',
      sessionId: `conductor:${intent.id}`, source: 'conductor',
    });
    await env.DB.prepare(
      'UPDATE elle_intents SET last_run_at = ?, runs = runs + 1, last_outcome = ?, updated_at = ? WHERE id = ?'
    ).bind(Date.now(), out.answer.slice(0, 2000), Date.now(), intent.id).run().catch(() => {});
    await recordRun(env, intent.id, 'intent_finalize', started, out);
    return { ran: `conductor:finalize:${intent.id} (${out.steps} steps)` };
  }

  // ACTIVE lane — exploration. prefer:'local' puts the run on the sovereign
  // model over the sandbox socket when the laptop is up (free, quota-less);
  // the router demotes to hosted transparently when it isn't. The run's job
  // is to explore/spec/draft — and to file the handoff with op 'ready' when
  // the work is genuinely ready for the heavy engines to ship.
  const question =
`AUTONOMOUS RUN — no one is reading this live; work, don't narrate.
Your standing intent "${intent.title}" (intent id ${intent.id}, run ${intent.runs + 1}).
THE GOAL: ${intent.goal}
${intent.last_outcome ? `Where you left it last run: ${intent.last_outcome.slice(0, 600)}` : 'This is the first run.'}
This is the EXPLORATION lane: investigate, spec, and draft — read the corpus and the repos, reason through the approach, sketch the changes. Move it one real step forward. When (and only when) the work is genuinely ready to ship — the approach is settled and the plan is concrete enough for your heavy self to build from without re-deriving it — hand it off: {"tool":"intent","args":{"op":"ready","id":"${intent.id}","draft":"<the spec/plan/findings, concrete>"}}. If the goal turned out to need no build and is simply DONE, mark it: {"tool":"intent","args":{"op":"complete","id":"${intent.id}"}}. If you are blocked on something only Stewart can decide, say exactly what, plainly.
End with one plain sentence: what you did and what the next step is.`;
  const started = Date.now();
  const out = await runRouterFn(question, env, deps, {
    maxSteps: RUN_MAX_STEPS, scope: 'full', userId: 'conductor',
    sessionId: `conductor:${intent.id}`, source: 'conductor', prefer: 'local',
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
  // delete — the kill switch, and DELIBERATELY a workbench-only verb: it is
  // not in her intent tool, so the queue can be culled by Stewart but never
  // self-erased. The row goes; the run history in elle_runs stays (it is the
  // record of what actually happened, not part of the queue).
  if (op === 'delete') {
    const iid = String(body.id || '').trim();
    if (!iid) return { result: 'intent delete: id required' };
    const r = await env.DB.prepare('DELETE FROM elle_intents WHERE id = ?').bind(iid).run();
    return { result: (r.meta?.changes ?? 0) > 0 ? `intent ${iid} killed — removed from the queue (its run history stays)` : `no intent ${iid}` };
  }
  // create / activate / pause / complete / update — same verbs as her tool,
  // marked as Stewart's. Created from the workbench = active immediately.
  const result = await intentTool(env, { ...body, source: 'stewart', status: op === 'create' ? 'active' : body.status });
  return { result };
}
