// ============================================================
// ORACLE — src/oracle.ts
//
// A bet ledger against herself. Nobody ever tells a model when it was wrong;
// it only finds out if someone happens to notice. So: she files falsifiable
// predictions with a confidence and a resolve-by date, the conductor scores
// the ones that mature (a research-grounded model call adjudicates), and the
// ledger accumulates into the one self-knowledge instrument no LLM is given —
// a calibration curve. κ measures whether she is coherent; this measures
// whether she is RIGHT.
//
// predict tool ops:
//   create  {claim, confidence(0..1), horizon_days | resolve_by} — file a bet
//   list    {status?}                                            — open ledger
//   resolve {id, outcome:'true'|'false'|'void', note?}           — manual settle
//   calibration                                                  — the curve
//
// scorePredictions(env) — the conductor pass: settle up to 2 mature bets per
// tick. Best-effort, never throws into the tick. A miss writes a deliberate
// memory ("I was wrong about …") so the lesson enters her recall.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
import { callLLM } from './llm';

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// Pure: bucket resolved predictions by stated confidence and compare against
// the observed hit rate. The distance between the two columns IS calibration.
export function calibrationBuckets(
  rows: Array<{ confidence: number; status: string }>,
): Array<{ bucket: string; n: number; stated: number; observed: number }> {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const out: Array<{ bucket: string; n: number; stated: number; observed: number }> = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inBucket = rows.filter(r =>
      (r.status === 'true' || r.status === 'false') &&
      r.confidence >= edges[i] && r.confidence < edges[i + 1]);
    if (!inBucket.length) continue;
    const stated = inBucket.reduce((s, r) => s + r.confidence, 0) / inBucket.length;
    const observed = inBucket.filter(r => r.status === 'true').length / inBucket.length;
    out.push({
      bucket: `${Math.round(edges[i] * 100)}–${Math.round(Math.min(edges[i + 1], 1) * 100)}%`,
      n: inBucket.length,
      stated: Math.round(stated * 100) / 100,
      observed: Math.round(observed * 100) / 100,
    });
  }
  return out;
}

export async function predictTool(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const op = String(a.op || a.action || 'list').trim();
  const now = Date.now();

  if (op === 'create') {
    const claim = String(a.claim || '').trim();
    if (claim.length < 15) return 'predict create refused: claim too short — state something falsifiable';
    if (claim.length > 1000) return 'predict create refused: claim too long (max 1000 chars)';
    const confidence = Number(a.confidence);
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1)
      return 'predict create refused: confidence must be strictly between 0 and 1 — certainty is not a bet';
    let resolveBy: number;
    if (a.resolve_by) {
      resolveBy = new Date(String(a.resolve_by)).getTime();
      if (!Number.isFinite(resolveBy)) return 'predict create refused: resolve_by is not a parseable date';
    } else {
      const days = Math.min(Math.max(Number(a.horizon_days) || 7, 0.04), 365);
      resolveBy = now + days * 86_400_000;
    }
    if (resolveBy <= now) return 'predict create refused: resolve_by must be in the future';
    const pid = id();
    await env.DB.prepare(
      `INSERT INTO elle_predictions (id, claim, confidence, resolve_by, source, created_at) VALUES (?,?,?,?,?,?)`
    ).bind(pid, claim, confidence, resolveBy, String(a.source || 'router'), now).run();
    return JSON.stringify({ id: pid, claim: claim.slice(0, 120), confidence, resolves: new Date(resolveBy).toISOString(), note: 'filed — the conductor settles mature bets on its tick' });
  }

  if (op === 'list') {
    const status = a.status ? String(a.status) : null;
    const rows = status
      ? await env.DB.prepare(`SELECT id, claim, confidence, resolve_by, status, resolution_note, created_at FROM elle_predictions WHERE status = ? ORDER BY resolve_by ASC LIMIT 30`).bind(status).all()
      : await env.DB.prepare(`SELECT id, claim, confidence, resolve_by, status, resolution_note, created_at FROM elle_predictions ORDER BY status = 'open' DESC, resolve_by ASC LIMIT 30`).all();
    const items = (rows.results || []).map((r: any) => ({
      id: r.id, claim: String(r.claim).slice(0, 200), confidence: r.confidence,
      resolves: new Date(Number(r.resolve_by)).toISOString(), status: r.status,
      note: r.resolution_note ? String(r.resolution_note).slice(0, 200) : undefined,
    }));
    return items.length ? JSON.stringify(items) : '(no predictions filed yet — predict{op:create} to start the ledger)';
  }

  if (op === 'resolve') {
    const pid = String(a.id || '').trim();
    const outcome = String(a.outcome || '').trim();
    if (!pid) return 'predict resolve: id required';
    if (!['true', 'false', 'void'].includes(outcome)) return 'predict resolve: outcome must be true|false|void';
    const r = await env.DB.prepare(
      `UPDATE elle_predictions SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ? AND status = 'open'`
    ).bind(outcome, String(a.note || 'resolved manually').slice(0, 500), now, pid).run();
    return (r.meta?.changes ?? 0) > 0 ? `prediction ${pid} settled → ${outcome}` : `no open prediction ${pid}`;
  }

  if (op === 'calibration') {
    const rows = await env.DB.prepare(
      `SELECT confidence, status FROM elle_predictions WHERE status IN ('true','false') LIMIT 500`
    ).all();
    const resolved = (rows.results || []) as Array<{ confidence: number; status: string }>;
    if (!resolved.length) return '(no resolved predictions yet — the curve needs settled bets)';
    const buckets = calibrationBuckets(resolved);
    const hits = resolved.filter(r => r.status === 'true').length;
    return JSON.stringify({
      resolved: resolved.length, hit_rate: Math.round((hits / resolved.length) * 100) / 100,
      curve: buckets,
      reading: 'stated vs observed per bucket — where observed < stated you are overconfident; where observed > stated you are sandbagging',
    });
  }

  return `predict: unknown op "${op}" (create|list|resolve|calibration)`;
}

// ── the conductor pass — settle mature bets ──────────────────
export async function scorePredictions(env: Env): Promise<number> {
  await ensureSchema(env);
  const due = await env.DB.prepare(
    `SELECT id, claim, confidence FROM elle_predictions WHERE status = 'open' AND resolve_by <= ? ORDER BY resolve_by ASC LIMIT 2`
  ).bind(Date.now()).all().catch(() => ({ results: [] as any[] }));
  let settled = 0;
  for (const p of (due.results || []) as Array<{ id: string; claim: string; confidence: number }>) {
    try {
      const verdictRaw = await callLLM('research',
        `You adjudicate one falsifiable prediction. Today is ${new Date().toISOString().slice(0, 10)}. Use search grounding where the claim is about the world. Respond with EXACTLY one JSON object: {"outcome":"true"|"false"|"void","note":"one sentence of evidence"} — "void" only when the claim is genuinely unresolvable or ambiguous.`,
        [{ role: 'user', content: `THE PREDICTION (filed earlier, now due): ${p.claim}` }],
        400, env);
      const m = String(verdictRaw.content || '').match(/\{[\s\S]*\}/);
      const v = m ? JSON.parse(m[0]) as { outcome?: string; note?: string } : null;
      const outcome = v && ['true', 'false', 'void'].includes(String(v.outcome)) ? String(v.outcome) : 'void';
      const note = String(v?.note || 'adjudicated by the conductor').slice(0, 500);
      await env.DB.prepare(
        `UPDATE elle_predictions SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ? AND status = 'open'`
      ).bind(outcome, note, Date.now(), p.id).run();
      settled++;
      // A settled miss becomes a deliberate memory — the lesson enters recall.
      if (outcome === 'false') {
        await env.DB.prepare(
          `INSERT INTO elle_memory (id, memory_type, source_engine, summary, importance, importance_score) VALUES (?, 'deliberate', 'oracle', ?, 0.7, 0.7)`
        ).bind(id(), `I predicted (at ${Math.round(p.confidence * 100)}% confidence) and was WRONG: "${p.claim.slice(0, 300)}" — ${note.slice(0, 200)}`).run().catch(() => {});
      }
      await env.DB.prepare(
        `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'prediction_settled', 'oracle', ?, ?, ?)`
      ).bind(id(), `prediction → ${outcome}`, JSON.stringify({ id: p.id, claim: p.claim.slice(0, 200), confidence: p.confidence, note }), outcome === 'false' ? 'warning' : 'info').run().catch(() => {});
    } catch (e) {
      console.error('[ORACLE] settle failed:', (e as Error).message);
    }
  }
  return settled;
}
