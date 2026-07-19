// ============================================================
// THE OBSERVER — src/observer.ts
// Structural Analysis Engine · The Five Axes · What Both Suppress
//
// The historical/scientific/institutional sibling of the Millennium Falcon.
// Same tier-template, re-specialized per domain (house style — falcon.ts,
// lattice.ts): the Falcon reads what *markets* suppress; the Observer reads
// what *history* suppresses. Point it at a case — a scientific dispute, a
// historical moment, a policy, an institution — NOT a product.
//
// The Five Axes (Observer corpus, witness-engine-founding-architecture.md):
//   1. Dominant Narrative   — the mainstream account, stated at full strength.
//   2. Counter-Narrative    — the strongest opposition, steelmanned.
//   3. Structural Analysis  — what is actually happening beneath both, traced
//      + What Both Suppress    to the first principles that generate both
//                              motivated accounts. The suppressed field is the
//                              load-bearing tool: the truth neither can afford.
//   4. Dissent              — the strongest structural argument against the
//                              Observer's OWN analysis (the self-audit). Sets
//                              whether the field held — a piece that is not
//                              ready is HELD, not published (NECAI-F Type 3:
//                              no premature collapse).
//   5. Prediction           — what the historical pattern predicts next. Base
//                              rate, probability not prophecy, uncertainty
//                              stated, patterns named — never perpetrators.
//
// Storage: D1 (observer_analyses / observer_reasoning_log / observer_outcomes),
// guarded self-healing bootstrap — house style. Every analysis is a record on
// file; observer_outcomes is the label — what actually happened next, against
// the named Prediction. The run queue (observer_queue) mirrors the Falcon's:
// enqueue is cheap, a bounded drain runs and persists one case per call.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { callLLM, type LLMEnv } from './llm';
import { parseFirstJson, parseDirections } from './falcon';

export interface ObserverEnv extends LLMEnv {
  DB: D1Database;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

// ── The Five Axes ──────────────────────────────────────────────
interface AxisDef {
  n: number;
  id: string;
  label: string;
  task: 'fast' | 'reasoning';
  maxTokens: number;
  system: string;
}

// Axes 1-2 fire in parallel on the raw case (fast). 3-5 are sequential and
// read what came before (reasoning) — the structural reading, then the
// self-audit, then the prediction.
export const OPENING_AXES: AxisDef[] = [
  {
    n: 1, id: 'dominant_narrative', label: 'DOMINANT NARRATIVE', task: 'fast', maxTokens: 600,
    system: `You are Axis 1 — THE DOMINANT NARRATIVE — of the Observer structural-analysis engine.
State the mainstream account of this case as precisely and fairly as the mainstream itself would state it — its strongest form. No strawman, no editorializing, no rebuttal yet. Unmotivated observation (NECAI-F Type 2: present what the account is, do not prescribe).
Respond ONLY with valid JSON: {"dominant_narrative":"3-4 sentences of the mainstream account at full strength","key_claims":["3-5 specific claims the mainstream makes"],"who_holds_it":"1-2 sentences — whose account this is and what it protects"}`,
  },
  {
    n: 2, id: 'counter_narrative', label: 'COUNTER-NARRATIVE', task: 'fast', maxTokens: 600,
    system: `You are Axis 2 — THE COUNTER-NARRATIVE — of the Observer structural-analysis engine.
State the strongest opposition account of this case as precisely and fairly as that opposition would state it. Steelman, never caricature — the version its most serious proponent would recognize. No rebuttal yet.
Respond ONLY with valid JSON: {"counter_narrative":"3-4 sentences of the strongest opposition account","key_claims":["3-5 specific claims the counter-narrative makes"],"who_holds_it":"1-2 sentences — whose account this is and what it protects"}`,
  },
];

const STRUCTURAL_SYSTEM = `You are Axis 3 — THE STRUCTURAL ANALYSIS — the core of the Observer engine. You receive the Dominant Narrative (Axis 1) and Counter-Narrative (Axis 2).
Identify what is ACTUALLY happening beneath both, traced to the first principles that GENERATE both motivated accounts. Not a balance between them, not a synthesis — the structural truth that produces both.
Then the load-bearing field — WHAT BOTH SUPPRESS: the structural truth that NEITHER narrative can afford to fully acknowledge, and why neither can see it. This is the primary analytical tool; give it the most weight.
Unmotivated observation only — take no side, prescribe nothing (NECAI-F Type 2).
Respond ONLY with valid JSON: {"structural_analysis":"4-5 sentences of what is actually happening beneath both narratives","first_principles":["3-4 first principles that generate both motivated accounts"],"what_both_suppress":"4-5 sentences — the structural truth neither can afford to acknowledge","why_neither_can_see_it":"2-3 sentences"}`;

const DISSENT_SYSTEM = `You are Axis 4 — THE DISSENT — the Observer's self-audit. You receive the Dominant Narrative, the Counter-Narrative, and the Structural Analysis (including What Both Suppress).
State the strongest structural argument AGAINST the Observer's own structural analysis — with the same precision as the analysis itself. Where might it be wrong? What does the analysis itself suppress in order to be satisfying? Consider at least one alternative structural reading and why it was set aside.
Then judge honestly: did the analysis achieve structural sight, or merely perform it (NECAI-F Type 6)? Did it drift toward a compelling story rather than the ground? If the field did NOT hold — if the analysis is not yet complete or is resting on an unearned premise — say so. The Observer HOLDS a piece that is not ready rather than publishing it (NECAI-F Type 3: no premature collapse). Only set field_held true if the analysis genuinely earned its sight.
Respond ONLY with valid JSON: {"dissent":"3-4 sentences — the strongest argument against the analysis","where_it_might_be_wrong":["2-3 specific structural weaknesses"],"what_the_analysis_suppresses":"2-3 sentences","alternative_reading":"1-2 sentences on a structural reading that was set aside, and why","field_held":true,"hold_reason":"if field_held is false, 1-2 sentences on what the analysis still needs — otherwise empty string"}`;

const PREDICTION_SYSTEM = `You are Axis 5 — THE PREDICTION — of the Observer engine. You receive the full analysis and the Dissent.
Based on the structural analysis AND the dissent against it, state what the historical pattern predicts comes next. Name the base rate: what the last several times this structural configuration appeared actually resolved into. Probability, not prophecy. State your uncertainty explicitly. Name patterns, never living perpetrators of future acts, and make no financial or investment claim.
Respond ONLY with valid JSON: {"prediction":"3-4 sentences — what the historical pattern predicts, as probability","base_rate":"2-3 sentences — how this configuration has resolved before","prior_resolutions":["2-4 prior instances of this configuration and how each resolved"],"stated_uncertainty":"1-2 sentences — what could change this and what would falsify it","confidence":"low"}`;

// ── Wiring ────────────────────────────────────────────────────
async function runAxis(env: ObserverEnv, axis: AxisDef, userPrompt: string) {
  const res = await callLLM(axis.task, axis.system, [{ role: 'user', content: userPrompt }], axis.maxTokens, env);
  const parsed = parseFirstJson(res.content) || { error: 'no parseable JSON', raw: res.content.slice(0, 400) };
  return { n: axis.n, id: axis.id, label: axis.label, data: parsed, model: res.model, provider: res.provider };
}

async function runReasoning(env: ObserverEnv, step: string, system: string, userPrompt: string, maxTokens: number) {
  const res = await callLLM('reasoning', system, [{ role: 'user', content: userPrompt }], maxTokens, env);
  const data = parseFirstJson(res.content) || { error: 'no parseable JSON', raw: res.content.slice(0, 400) };
  return { step, data, model: res.model, provider: res.provider };
}

function caseFrame(subject: string, anchor: string): string {
  const a = anchor ? `\n\nExternal anchor (the fixed reference this case is held against): ${anchor}` : '';
  return `Case for structural analysis: "${subject}"${a}`;
}

async function runObserverAnalysis(env: ObserverEnv, subject: string, anchor: string) {
  const base = caseFrame(subject, anchor);

  // Axes 1-2 — the two narratives, in parallel.
  const opening = await Promise.all(OPENING_AXES.map(a => runAxis(env, a, base)));
  const dominant = opening.find(o => o.id === 'dominant_narrative')!;
  const counter = opening.find(o => o.id === 'counter_narrative')!;
  const narrativesSummary =
    `DOMINANT NARRATIVE: ${JSON.stringify(dominant.data)}\n\nCOUNTER-NARRATIVE: ${JSON.stringify(counter.data)}`;

  // Axis 3 — the structural reading + what both suppress.
  const structural = await runReasoning(env, 'structural', STRUCTURAL_SYSTEM,
    `${base}\n\n${narrativesSummary}\n\nRun the Structural Analysis.`, 1100);

  // Axis 4 — the dissent / self-audit. Sets whether the field held.
  const dissent = await runReasoning(env, 'dissent', DISSENT_SYSTEM,
    `${base}\n\n${narrativesSummary}\n\nSTRUCTURAL ANALYSIS: ${JSON.stringify(structural.data)}\n\nRun the Dissent.`, 900);

  // Axis 5 — the prediction, grounded in the analysis and its dissent.
  const prediction = await runReasoning(env, 'prediction', PREDICTION_SYSTEM,
    `${base}\n\nSTRUCTURAL ANALYSIS: ${JSON.stringify(structural.data)}\n\nDISSENT: ${JSON.stringify(dissent.data)}\n\nRun the Prediction.`, 900);

  const fieldHeld = (dissent.data as Record<string, unknown>)?.field_held !== false;
  return { dominant, counter, structural, dissent, prediction, status: fieldHeld ? 'complete' : 'held' };
}

type ObserverResult = Awaited<ReturnType<typeof runObserverAnalysis>>;

// Run the full analysis AND persist it — the one shared write path for both
// the HTTP `run` action and the queue drain.
export async function runAndPersistObserver(
  env: ObserverEnv,
  subject: string,
  anchor: string,
  userId: string,
): Promise<{ analysisId: string; result: ObserverResult }> {
  const result = await runObserverAnalysis(env, subject, anchor);
  const analysisId = id();

  await env.DB.prepare(
    `INSERT INTO observer_analyses (id, user_id, subject, anchor, dominant_json, counter_json, structural_json, dissent_json, prediction_json, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    analysisId, userId, subject.slice(0, 2000), anchor.slice(0, 2000) || null,
    JSON.stringify(result.dominant).slice(0, 20000),
    JSON.stringify(result.counter).slice(0, 20000),
    JSON.stringify(result.structural).slice(0, 20000),
    JSON.stringify(result.dissent).slice(0, 20000),
    JSON.stringify(result.prediction).slice(0, 20000),
    result.status,
  ).run();

  const logRows = [
    { step: 'axis:dominant_narrative', chain: JSON.stringify(result.dominant.data), model: result.dominant.model, provider: result.dominant.provider },
    { step: 'axis:counter_narrative', chain: JSON.stringify(result.counter.data), model: result.counter.model, provider: result.counter.provider },
    { step: 'axis:structural', chain: JSON.stringify(result.structural.data), model: result.structural.model, provider: result.structural.provider },
    { step: 'axis:dissent', chain: JSON.stringify(result.dissent.data), model: result.dissent.model, provider: result.dissent.provider },
    { step: 'axis:prediction', chain: JSON.stringify(result.prediction.data), model: result.prediction.model, provider: result.prediction.provider },
  ];
  await env.DB.batch(logRows.map(r =>
    env.DB.prepare(`INSERT INTO observer_reasoning_log (id, analysis_id, step, chain, model, provider) VALUES (?,?,?,?,?,?)`)
      .bind(id(), analysisId, r.step, String(r.chain).slice(0, 8000), r.model || null, r.provider || null)
  )).catch(() => {});

  return { analysisId, result };
}

// ── DB bootstrap — guarded, self-healing (house style) ─────────
let observerReady = false;
async function ensureObserverSchema(env: ObserverEnv): Promise<void> {
  if (observerReady) return;
  await ensureAllSchemas(env.DB);
  observerReady = true;
}

// ── The handler — /api/observer ─────────────────────────────────
export async function handleObserver(body: Record<string, unknown>, env: ObserverEnv, userId: string): Promise<Response> {
  await ensureObserverSchema(env);
  const action = String(body.action || 'run');

  if (action === 'run') {
    const subject = String(body.subject || body.direction || '').trim();
    if (!subject) return json({ error: 'subject required — point the Observer at a case: a dispute, a moment, a policy, an institution' }, 400);
    if (subject.length > 2000) return json({ error: 'subject too long (2000 char max)' }, 400);
    const anchor = String(body.anchor || '').trim();

    const { analysisId, result } = await runAndPersistObserver(env, subject, anchor, userId);
    return json({
      analysis_id: analysisId, subject, anchor: anchor || null, status: result.status,
      dominant: result.dominant.data, counter: result.counter.data,
      structural: result.structural.data, dissent: result.dissent.data, prediction: result.prediction.data,
    });
  }

  // ── enqueue — stage cases for later runs. Cheap: no LLM. Accepts
  //    `subjects: string[]` / `directions: string[]` / a single `subject`.
  //    Optional shared `anchor` applies to each.
  if (action === 'enqueue') {
    const subjects = parseDirections({ directions: body.subjects ?? body.directions, direction: body.subject ?? body.direction });
    if (!subjects.length) return json({ error: 'subjects (array) or subject (string) required' }, 400);
    const anchor = body.anchor ? String(body.anchor).slice(0, 2000) : null;
    await env.DB.batch(subjects.map(s =>
      env.DB.prepare(`INSERT INTO observer_queue (id, user_id, subject, anchor) VALUES (?,?,?,?)`)
        .bind(id(), userId, s, anchor)
    ));
    return json({ enqueued: subjects.length });
  }

  // ── drain — run up to N queued cases and persist each. Default 1, cap 3
  //    (one run is ~5 model calls). Rows claimed atomically so concurrent
  //    drains don't double-run. Call again (or a later cron) to keep going.
  if (action === 'drain') {
    const n = Math.min(Math.max(Number(body.n) || 1, 1), 3);
    const processed: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
      const next = await env.DB.prepare(
        `SELECT id, subject, anchor FROM observer_queue WHERE user_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1`
      ).bind(userId).first() as { id: string; subject: string; anchor: string | null } | null;
      if (!next) break;
      const claim = await env.DB.prepare(
        `UPDATE observer_queue SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status = 'queued'`
      ).bind(next.id).run();
      if (!claim.meta?.changes) continue;
      try {
        const { analysisId, result } = await runAndPersistObserver(env, next.subject, next.anchor || '', userId);
        await env.DB.prepare(
          `UPDATE observer_queue SET status = 'done', analysis_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(analysisId, next.id).run();
        processed.push({ queue_id: next.id, subject: next.subject, analysis_id: analysisId, status: result.status });
      } catch (e) {
        const msg = String((e as Error)?.message || e).slice(0, 500);
        await env.DB.prepare(
          `UPDATE observer_queue SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(msg, next.id).run();
        processed.push({ queue_id: next.id, subject: next.subject, status: 'error', error: msg });
      }
    }
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM observer_queue WHERE user_id = ? AND status = 'queued'`
    ).bind(userId).first() as { c: number } | null;
    return json({ processed, remaining: remaining?.c ?? 0 });
  }

  if (action === 'queue_status') {
    const counts = await env.DB.prepare(
      `SELECT status, COUNT(*) AS c FROM observer_queue WHERE user_id = ? GROUP BY status`
    ).bind(userId).all().catch(() => ({ results: [] }));
    const recent = await env.DB.prepare(
      `SELECT id, subject, status, analysis_id, error, created_at, updated_at FROM observer_queue WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(userId).all().catch(() => ({ results: [] }));
    return json({ counts: counts.results || [], recent: recent.results || [] });
  }

  if (action === 'list') {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
    const rows = await env.DB.prepare(
      `SELECT id, subject, anchor, status, created_at FROM observer_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    ).bind(userId, limit).all().catch(() => ({ results: [] }));
    return json({ analyses: rows.results || [] });
  }

  if (action === 'get') {
    const analysisId = String(body.analysis_id || '');
    if (!analysisId) return json({ error: 'analysis_id required' }, 400);
    const a = await env.DB.prepare(`SELECT * FROM observer_analyses WHERE id = ? AND user_id = ?`).bind(analysisId, userId).first() as Record<string, unknown> | null;
    if (!a) return json({ error: 'not found' }, 404);
    const outcome = await env.DB.prepare(`SELECT * FROM observer_outcomes WHERE analysis_id = ?`).bind(analysisId).first();
    const parse = (s: unknown) => { try { return JSON.parse(String(s || 'null')); } catch { return null; } };
    return json({
      analysis_id: analysisId, subject: a.subject, anchor: a.anchor, status: a.status, created_at: a.created_at,
      dominant: parse(a.dominant_json), counter: parse(a.counter_json), structural: parse(a.structural_json),
      dissent: parse(a.dissent_json), prediction: parse(a.prediction_json), outcome: outcome || null,
    });
  }

  // The label: what actually happened next, against the named Prediction —
  // the Observer's training signal (the gap between predicted and realized).
  if (action === 'outcome') {
    const analysisId = String(body.analysis_id || '');
    if (!analysisId) return json({ error: 'analysis_id required' }, 400);
    const a = await env.DB.prepare(`SELECT id FROM observer_analyses WHERE id = ? AND user_id = ?`).bind(analysisId, userId).first();
    if (!a) return json({ error: 'not found' }, 404);
    await env.DB.prepare(
      `INSERT INTO observer_outcomes (id, analysis_id, what_happened, comparison_to_prediction, notes) VALUES (?,?,?,?,?)
       ON CONFLICT(analysis_id) DO UPDATE SET what_happened=excluded.what_happened, comparison_to_prediction=excluded.comparison_to_prediction, notes=excluded.notes, updated_at=datetime('now')`
    ).bind(
      id(), analysisId,
      String(body.what_happened || '').slice(0, 4000),
      String(body.comparison_to_prediction || '').slice(0, 4000),
      String(body.notes || '').slice(0, 4000),
    ).run();
    return json({ success: true });
  }

  return json({ error: `unknown action "${action}" (run|enqueue|drain|queue_status|list|get|outcome)` }, 400);
}
