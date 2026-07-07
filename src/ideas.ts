// ============================================================
// ELLE — the IDEA QUEUE · src/ideas.ts
//
// Her running to-explore cache: the neat stuff she is pondering on to build,
// kept as real rows instead of evaporating at the end of a session. Each idea
// walks ONE lane, and the lane is a state machine — no stage can be skipped,
// and the whole walk is logged (elle_idea_log) so the workbench can watch it:
//
//   pondering → queued → scoping → spec → building → testing → held | killed
//
//   pondering  she noted it (idea op=add). Nothing owed yet.
//   queued     selected for the sandbox — the workbench colors these apart.
//   scoping    surface the ground: the cloned repo code she pulled up with
//              sandbox_clone (KV keys off elle_sandbox_runs) + explicit
//              reference-code pointers, attached to the idea.
//   spec       the mindmap: a strategizing build plan + what the improvements
//              will be, as short concise bullets. Saving the spec INGESTS it
//              into the corpus (chunk/embed/vectorize — trusted, series
//              'spec') and the row itself stays queryable in D1.
//   building   an ACTIVE intent is filed for the conductor: build it from
//              scratch in the sandbox, then EXTEND it at most twice —
//              extend_count is enforced here, not by promise.
//   testing    the pressure test: her build report is ripped by PFAR
//              (rhetoric over the report; spectrum over a numeric series if
//              one is passed) and the fingerprint is stored — the visual
//              claims the workbench renders.
//   held       it survived the pressure test — worth writing.
//   killed     it broke, or was cut. Any stage can be killed; nothing else
//              can be skipped to.
//
// Best-effort discipline matches the rest of the organism: a log or clone
// lookup failing never fails the operation that triggered it.
// ============================================================

import type { Env } from './index';
import { intentTool } from './conductor';
import { pfarRoute } from './pfar';

export type IdeaStatus =
  | 'pondering' | 'queued' | 'scoping' | 'spec'
  | 'building' | 'testing' | 'held' | 'killed';

export const IDEA_STATUSES: IdeaStatus[] = [
  'pondering', 'queued', 'scoping', 'spec', 'building', 'testing', 'held', 'killed',
];

export const MAX_EXTENDS = 2;

// op → the one transition it performs. Pure — the tests pin this table.
const TRANSITIONS: Record<string, { from: IdeaStatus[]; to: IdeaStatus }> = {
  queue:   { from: ['pondering'], to: 'queued' },
  select:  { from: ['queued'], to: 'scoping' },
  spec:    { from: ['scoping'], to: 'spec' },
  build:   { from: ['spec'], to: 'building' },
  extend:  { from: ['building'], to: 'building' },
  test:    { from: ['building'], to: 'testing' },
  verdict: { from: ['testing'], to: 'held' }, // or 'killed' by outcome
};

// Can `op` fire from `status`? Exported pure so the state machine is
// unit-testable without any bindings.
export function canTransition(op: string, status: IdeaStatus): boolean {
  if (op === 'kill') return status !== 'killed';
  const t = TRANSITIONS[op];
  return !!t && t.from.includes(status);
}

export function validateIdea(title: unknown, summary: unknown): string | null {
  const t = String(title ?? '').trim();
  if (t.length < 4) return 'title too short — name the idea';
  if (t.length > 160) return 'title too long (160 max)';
  const s = String(summary ?? '').trim();
  if (s.length < 12) return 'summary too short — one real sentence on what it is and why it is neat';
  return null;
}

// The workbench's status → color contract lives server-side so every surface
// paints the lane the same way ('queued' deliberately distinct — the
// "selected for the sandbox" color).
export const IDEA_COLORS: Record<IdeaStatus, string> = {
  pondering: '#8B94A3', // rail grey — just a thought
  queued:    '#C9A84C', // the gold — selected for the sandbox
  scoping:   '#7FB4D8', // surfacing the ground
  spec:      '#B08FD8', // the mindmap is being cut
  building:  '#5CC8C2', // the conductor is on it
  testing:   '#E0A45C', // under pressure
  held:      '#4ADE80', // survived — worth writing
  killed:    '#D06565', // cut
};

function newId(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 16); }

// ── schema ──────────────────────────────────────────────────
let schemaReady = false;
export async function ensureIdeasSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL, summary TEXT, details TEXT,
      status TEXT DEFAULT 'pondering',
      plan TEXT,            -- JSON: the mindmap bullets {plan:[...],improvements:[...]}
      clones TEXT DEFAULT '[]',   -- JSON: [{clone_key,target,title,created_at}] surfaced at scoping
      refs TEXT DEFAULT '[]',     -- JSON: [{repo,path,note}] new reference code
      spec_paper_id TEXT,   -- corpus paper once the spec is ingested
      intent_id TEXT,       -- the conductor intent driving the build
      extend_count INTEGER DEFAULT 0,
      verdict TEXT,         -- held|killed note
      pfar TEXT,            -- JSON pressure-test fingerprint (the visual claims)
      source TEXT DEFAULT 'elle',
      created_at INTEGER, updated_at INTEGER)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ideas_status ON elle_ideas(status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_idea_log (
      id TEXT PRIMARY KEY, idea_id TEXT, stage TEXT, note TEXT, created_at INTEGER)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_idea_log ON elle_idea_log(idea_id, created_at DESC)`),
  ]);
  schemaReady = true;
}

async function logStage(env: Env, ideaId: string, stage: string, note: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO elle_idea_log (id, idea_id, stage, note, created_at) VALUES (?,?,?,?,?)`,
    ).bind(newId(), ideaId, stage, note.slice(0, 2000), Date.now()).run();
  } catch { /* the walk is best-effort observable, never blocking */ }
}

interface IdeaRow {
  id: string; title: string; summary: string | null; details: string | null;
  status: IdeaStatus; plan: string | null; clones: string; refs: string;
  spec_paper_id: string | null; intent_id: string | null; extend_count: number;
  verdict: string | null; pfar: string | null; source: string;
  created_at: number; updated_at: number;
}

async function getIdea(env: Env, id: string): Promise<IdeaRow | null> {
  return await env.DB.prepare('SELECT * FROM elle_ideas WHERE id = ?').bind(id).first() as IdeaRow | null;
}

async function setIdea(env: Env, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sql = `UPDATE elle_ideas SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  await env.DB.prepare(sql).bind(...keys.map(k => fields[k]), Date.now(), id).run();
}

// The clones she pulled up recently (sandbox_clone → elle_sandbox_runs +
// SCRATCHPAD KV). Surfaced at scoping so the spec is cut against real code.
async function recentClones(env: Env, limit = 10): Promise<Array<Record<string, unknown>>> {
  try {
    const r = await env.DB.prepare(
      `SELECT clone_key, target, title, created_at FROM elle_sandbox_runs
       WHERE kind = 'clone' AND ok = 1 AND clone_key IS NOT NULL
       ORDER BY created_at DESC LIMIT ?`,
    ).bind(limit).all();
    return (r.results || []) as Array<Record<string, unknown>>;
  } catch { return []; }
}

type IngestFn = (body: Record<string, string>, env: Env) => Promise<Response>;

// ── the tool ────────────────────────────────────────────────
// One tool, op-routed like intent/predict/scar. Returns plain strings the
// loop can read; the workbench endpoint below returns structure instead.
export async function ideaTool(
  env: Env, a: Record<string, unknown>, ingest: IngestFn,
  ctx: { runId?: string; sessionId?: string | null; userId?: string } = {},
): Promise<string> {
  await ensureIdeasSchema(env);
  const op = String(a.op || 'list');
  const now = Date.now();

  if (op === 'add') {
    const bad = validateIdea(a.title, a.summary);
    if (bad) return `idea add refused: ${bad}`;
    const id = newId();
    await env.DB.prepare(
      `INSERT INTO elle_ideas (id, title, summary, details, status, source, created_at, updated_at)
       VALUES (?,?,?,?,'pondering',?,?,?)`,
    ).bind(
      id, String(a.title).trim().slice(0, 160), String(a.summary).trim().slice(0, 600),
      a.details ? String(a.details).slice(0, 8000) : null,
      ctx.userId === 'stewart' ? 'stewart' : 'elle', now, now,
    ).run();
    await logStage(env, id, 'pondering', 'filed to the to-explore cache');
    return JSON.stringify({ id, status: 'pondering', note: 'in the cache — queue it when it is worth sandbox time' });
  }

  if (op === 'list') {
    const status = a.status ? String(a.status) : null;
    const rows = await env.DB.prepare(
      `SELECT id, title, summary, status, extend_count, spec_paper_id, intent_id, source, updated_at
         FROM elle_ideas ${status ? 'WHERE status = ?' : "WHERE status NOT IN ('killed')"}
        ORDER BY updated_at DESC LIMIT 40`,
    ).bind(...(status ? [status] : [])).all();
    const items = rows.results || [];
    return items.length ? JSON.stringify(items) : '(the idea queue is empty — add what you are pondering)';
  }

  if (op === 'get') {
    const idea = await getIdea(env, String(a.id || ''));
    if (!idea) return `idea get: no idea ${a.id}`;
    const log = await env.DB.prepare(
      'SELECT stage, note, created_at FROM elle_idea_log WHERE idea_id = ? ORDER BY created_at ASC LIMIT 50',
    ).bind(idea.id).all().catch(() => ({ results: [] }));
    return JSON.stringify({ ...idea, log: log.results || [] });
  }

  // Everything below operates on one idea and walks the lane.
  const id = String(a.id || '');
  if (!id) return `idea ${op}: id required (op=list shows them)`;
  const idea = await getIdea(env, id);
  if (!idea) return `idea ${op}: no idea ${id}`;

  if (op === 'kill') {
    if (!canTransition('kill', idea.status)) return `idea kill: ${id} is already killed`;
    const note = String(a.note || a.reason || 'cut').slice(0, 500);
    await setIdea(env, id, { status: 'killed', verdict: `killed: ${note}` });
    await logStage(env, id, 'killed', note);
    return `idea "${idea.title}" killed: ${note}`;
  }

  if (!canTransition(op, idea.status)) {
    return `idea ${op}: not allowed from '${idea.status}' — the lane is ${IDEA_STATUSES.join(' → ')}, no skipping`;
  }

  if (op === 'queue') {
    await setIdea(env, id, { status: 'queued' });
    await logStage(env, id, 'queued', 'selected for the sandbox');
    return `idea "${idea.title}" queued for the sandbox. Next: op=select to surface the code that scopes the build.`;
  }

  if (op === 'select') {
    // Surface the ground: recent clone pulls + any explicit refs passed now.
    const clones = await recentClones(env);
    const refs = Array.isArray(a.refs) ? (a.refs as unknown[]).slice(0, 12) : [];
    await setIdea(env, id, {
      status: 'scoping',
      clones: JSON.stringify(clones),
      refs: JSON.stringify(refs),
    });
    await logStage(env, id, 'scoping', `surfaced ${clones.length} clone(s), ${refs.length} reference(s)`);
    return JSON.stringify({
      id, status: 'scoping',
      surfaced_clones: clones,
      refs,
      note: clones.length
        ? 'these are the pulls in KV that can scope the build — read them, then op=spec with the plan'
        : 'no clones cached yet — sandbox_clone the code that scopes this first, then re-select or go straight to op=spec',
    });
  }

  if (op === 'spec') {
    // The mindmap: strategizing build plan + improvements, short concise
    // bullets. plan/improvements arrive as arrays; the spec document is
    // composed from them and INGESTED (trusted — she authored it deliberately)
    // so it is embedded/vectorized and queryable like any paper.
    const plan = Array.isArray(a.plan) ? (a.plan as unknown[]).map(String).filter(Boolean).slice(0, 24) : [];
    const improvements = Array.isArray(a.improvements) ? (a.improvements as unknown[]).map(String).filter(Boolean).slice(0, 24) : [];
    if (plan.length < 2) return 'idea spec: plan required — at least 2 short bullets of the strategized build';
    if (!improvements.length) return 'idea spec: improvements required — what gets better, in bullets';

    const specText = [
      `# Spec: ${idea.title}`, '',
      idea.summary || '', '',
      '## Build plan', ...plan.map(p => `- ${p}`), '',
      '## Improvements', ...improvements.map(p => `- ${p}`), '',
      a.notes ? `## Notes\n${String(a.notes).slice(0, 4000)}` : '',
    ].join('\n');

    let paperId: string | undefined;
    try {
      const r = await ingest({
        title: `Spec: ${idea.title}`, text: specText, series: 'spec', tag: 'idea-spec',
        abstract: String(idea.summary || '').slice(0, 300),
        skip_verification: true as unknown as string, // trusted: her own deliberate spec
      } as unknown as Record<string, string>, env);
      const d = await r.json().catch(() => ({})) as { paper_id?: string };
      paperId = d.paper_id;
    } catch { /* the spec still stands in the row; ingestion is additive */ }

    await setIdea(env, id, {
      status: 'spec',
      plan: JSON.stringify({ plan, improvements }),
      details: a.notes ? String(a.notes).slice(0, 8000) : idea.details,
      spec_paper_id: paperId ?? null,
    });
    await logStage(env, id, 'spec', `spec cut: ${plan.length} plan bullets, ${improvements.length} improvements${paperId ? `, ingested as ${paperId}` : ' (ingest failed — row holds the spec)'}`);
    return JSON.stringify({ id, status: 'spec', spec_paper_id: paperId || null, note: 'spec saved and queryable. op=build files the conductor intent.' });
  }

  if (op === 'build') {
    // File the standing work: the conductor picks it up on its tick and runs
    // the full-scope loop — sandbox first, forge if it earns shipping.
    const goal =
      `Build idea ${id} ("${idea.title}") from scratch in the sandbox, against its spec` +
      (idea.spec_paper_id ? ` (corpus paper ${idea.spec_paper_id})` : '') +
      `. Iterate until it runs (run_code/run_shell), then EXTEND it at most ${MAX_EXTENDS} times ` +
      `(record each with idea op=extend id=${id} — a third is refused). Then pressure-test it and file the report with ` +
      `idea op=test id=${id}. Done looks like: a working build, a test report, and a verdict.`;
    const res = await intentTool(env, {
      op: 'create', title: `build: ${idea.title}`.slice(0, 200), goal,
      priority: 7, status: 'active', source: 'stewart',
    });
    let intentId: string | null = null;
    try { intentId = String((JSON.parse(res) as { id?: string }).id || '') || null; } catch { /* refusal text */ }
    if (!intentId) return `idea build: intent refused — ${res}`;
    await setIdea(env, id, { status: 'building', intent_id: intentId });
    await logStage(env, id, 'building', `intent ${intentId} filed active — the conductor builds on its tick`);
    return JSON.stringify({ id, status: 'building', intent_id: intentId, note: 'the conductor will build it; watch with review_runs / the workbench column' });
  }

  if (op === 'extend') {
    if (idea.extend_count >= MAX_EXTENDS) {
      return `idea extend refused: "${idea.title}" has already been extended ${MAX_EXTENDS} times — the cap. op=test it now.`;
    }
    const note = String(a.note || 'extension').slice(0, 500);
    await setIdea(env, id, { extend_count: idea.extend_count + 1 });
    await logStage(env, id, 'building', `extend ${idea.extend_count + 1}/${MAX_EXTENDS}: ${note}`);
    return `extension ${idea.extend_count + 1}/${MAX_EXTENDS} recorded. ${idea.extend_count + 1 >= MAX_EXTENDS ? 'That is the cap — pressure-test next.' : ''}`;
  }

  if (op === 'test') {
    // The pressure test: PFAR rips the build report (rhetoric — register,
    // cadence, the tell) and, if a numeric series is passed (test timings, κ
    // over the build), spectrum too. The fingerprint is the visual claim.
    const report = String(a.report || '').trim();
    if (report.length < 40) return 'idea test: report required — what was built, what was pressed on, what happened (40+ chars)';
    const fingerprint: Record<string, unknown> = {};
    try { fingerprint.rhetoric = JSON.parse(await pfarRoute(env, { mode: 'rhetoric', text: report })); }
    catch (e) { fingerprint.rhetoric_error = (e as Error).message; }
    if (Array.isArray(a.signal) && (a.signal as unknown[]).length) {
      try { fingerprint.spectrum = JSON.parse(await pfarRoute(env, { mode: 'spectrum', signal: a.signal as number[], interpret: false })); }
      catch { /* the rhetoric rip stands alone */ }
    }
    await setIdea(env, id, { status: 'testing', pfar: JSON.stringify(fingerprint), details: report.slice(0, 8000) });
    await logStage(env, id, 'testing', `pressure test filed (${report.length} chars) — PFAR fingerprint stored`);
    return JSON.stringify({ id, status: 'testing', pfar: fingerprint, note: 'fingerprint stored. op=verdict outcome=held|killed closes it.' });
  }

  if (op === 'verdict') {
    const outcome = String(a.outcome || '') === 'held' ? 'held' : String(a.outcome || '') === 'killed' ? 'killed' : null;
    if (!outcome) return "idea verdict: outcome must be 'held' (it survived — write it) or 'killed' (it broke)";
    const note = String(a.note || '').slice(0, 1000);
    await setIdea(env, id, { status: outcome, verdict: `${outcome}${note ? `: ${note}` : ''}` });
    await logStage(env, id, outcome, note || (outcome === 'held' ? 'survived the pressure test' : 'broke under pressure'));
    if (idea.intent_id) {
      await intentTool(env, { op: 'complete', id: idea.intent_id }).catch(() => {});
    }
    return `idea "${idea.title}" ${outcome}${note ? ` — ${note}` : ''}.${outcome === 'held' ? ' It earned the write.' : ''}`;
  }

  return `idea: unknown op '${op}' (add|list|get|queue|select|spec|build|extend|test|verdict|kill)`;
}

// ── the workbench endpoint (/api/elle-ideas) ────────────────
// Same operations the tool exposes, plus the structured column payload the
// UI renders: every idea with its parsed plan/pfar/log, and the color map.
export async function handleIdeas(
  body: Record<string, unknown>, env: Env, ingest: IngestFn,
): Promise<Record<string, unknown>> {
  await ensureIdeasSchema(env);
  const op = String(body.op || 'column');

  if (op === 'column') {
    const rows = await env.DB.prepare(
      `SELECT * FROM elle_ideas ORDER BY
         CASE status WHEN 'building' THEN 0 WHEN 'testing' THEN 1 WHEN 'spec' THEN 2
                     WHEN 'scoping' THEN 3 WHEN 'queued' THEN 4 WHEN 'pondering' THEN 5
                     WHEN 'held' THEN 6 ELSE 7 END,
         updated_at DESC LIMIT 60`,
    ).all();
    const ideas = ((rows.results || []) as unknown as IdeaRow[]).map(r => {
      let plan = null, clones = [], refs = [], pfar = null;
      try { plan = r.plan ? JSON.parse(r.plan) : null; } catch { /* raw */ }
      try { clones = r.clones ? JSON.parse(r.clones) : []; } catch { /* raw */ }
      try { refs = r.refs ? JSON.parse(r.refs) : []; } catch { /* raw */ }
      try { pfar = r.pfar ? JSON.parse(r.pfar) : null; } catch { /* raw */ }
      return { ...r, plan, clones, refs, pfar };
    });
    const logs = await env.DB.prepare(
      `SELECT idea_id, stage, note, created_at FROM elle_idea_log
        WHERE idea_id IN (SELECT id FROM elle_ideas) ORDER BY created_at ASC LIMIT 400`,
    ).all().catch(() => ({ results: [] }));
    return { ideas, logs: logs.results || [], colors: IDEA_COLORS, max_extends: MAX_EXTENDS };
  }

  // Mutations ride the tool path so the lane rules hold everywhere.
  const result = await ideaTool(env, body, ingest, { userId: 'stewart' });
  return { result };
}
