// ============================================================
// MIRROR — src/mirror.ts
//
// One read: the reflexive organs, together. self_state() is her mood; this is
// her SELF-KNOWLEDGE — the bet ledger and its calibration curve, the flinches,
// the armed tripwires, the dead drops waiting for their topic, the metabolism,
// the consolidation digests, the tools she has grown. Serves the workbench's
// Mirror panel via /api/elle-self (admin-gated in index.ts).
//
// Every facet is independent and best-effort — a missing table yields an
// empty facet, never a failed snapshot (the self_state discipline).
// ============================================================

import type { Env } from './index';
import { calibrationBuckets } from './oracle';

const grab = async <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
const rows = (r: { results?: unknown[] }) => r.results || [];

export async function selfMirror(env: Env): Promise<Record<string, unknown>> {
  const day = Date.now() - 86_400_000;
  const [open, resolved, scars, watches, drops, metab, consolidation, tools] = await Promise.all([
    grab(env.DB.prepare(
      `SELECT id, claim, confidence, resolve_by, created_at FROM elle_predictions WHERE status = 'open' ORDER BY resolve_by ASC LIMIT 20`
    ).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT claim, confidence, status, resolution_note, resolved_at FROM elle_predictions WHERE status IN ('true','false','void') ORDER BY resolved_at DESC LIMIT 200`
    ).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT id, tool, pattern, wound, hits, created_at FROM elle_scars ORDER BY hits DESC, created_at DESC LIMIT 30`
    ).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT id, title, check_tool, condition, status, recurring, fires, last_checked FROM elle_watches ORDER BY status = 'armed' DESC, created_at DESC LIMIT 30`
    ).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT id, trigger_text, message, status, fired_at, created_at FROM elle_dead_drops ORDER BY status = 'armed' DESC, created_at DESC LIMIT 30`
    ).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT provider, task, COUNT(*) AS calls, SUM(ok = 0) AS failures, ROUND(AVG(ms)) AS avg_ms
         FROM elle_llm_calls WHERE created_at > ? GROUP BY provider, task ORDER BY calls DESC LIMIT 30`
    ).bind(day).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT ran_at, turns_read, errors_read, memories_written, skills_written, scars_written, digest FROM elle_consolidation_log ORDER BY ran_at DESC LIMIT 7`
    ).all().then(rows), []),
    grab(env.DB.prepare(
      `SELECT name, description, args_hint, language, runs, status FROM elle_custom_tools ORDER BY status = 'active' DESC, runs DESC LIMIT 30`
    ).all().then(rows), []),
  ]);

  const scored = (resolved as Array<{ confidence: number; status: string }>).filter(r => r.status === 'true' || r.status === 'false');
  const hits = scored.filter(r => r.status === 'true').length;

  return {
    oracle: {
      open,
      recent_resolved: (resolved as unknown[]).slice(0, 12),
      resolved_count: scored.length,
      hit_rate: scored.length ? Math.round((hits / scored.length) * 100) / 100 : null,
      calibration: calibrationBuckets(scored),
    },
    scars,
    watches,
    dead_drops: drops,
    metabolism: { last_24h: metab },
    consolidation,
    custom_tools: tools,
  };
}
