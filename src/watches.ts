// ============================================================
// WATCHES — src/watches.ts
//
// A nervous system laid over the clock. The conductor polls on a schedule;
// reflexes don't. A watch is a standing tripwire: a CHECK (one read-only
// probe — read_sql, fetch_url, or web_search), a CONDITION (a plain-English
// predicate a fast model judges against the probe's output), and an ACTION
// (the intent goal that gets filed — active — the moment it fires).
//
// The conductor evaluates due watches at the top of every tick, before it
// picks work: cheap, capped, best-effort. So the world can now interrupt
// her instead of waiting to be looked at. A fired one-shot watch disarms;
// a recurring watch re-arms and keeps sentry.
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

const CHECK_TOOLS = new Set(['read_sql', 'fetch_url', 'web_search']);
const CHECK_INTERVAL_MS = 25 * 60 * 1000; // a watch is due at most ~once per tick

// Pure: which watches are due this tick.
export function dueWatches<T extends { status: string; last_checked: number | null }>(
  watches: T[], now: number, cap = 2,
): T[] {
  return watches
    .filter(w => w.status === 'armed' && (w.last_checked == null || now - w.last_checked > CHECK_INTERVAL_MS))
    .sort((a, b) => (a.last_checked ?? 0) - (b.last_checked ?? 0))
    .slice(0, cap);
}

// Local read-only guard for the read_sql probe (same rules as the router's).
function guardWatchSql(raw: string): string | null {
  let sql = String(raw || '').trim().replace(/;+\s*$/, '');
  if (!sql || /;/.test(sql) || !/^(select|with)\b/i.test(sql)) return null;
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(sql)) return null;
  if (!/\blimit\b/i.test(sql)) sql += ' LIMIT 50';
  return sql;
}

export async function watchTool(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const op = String(a.op || a.action || 'list').trim();

  if (op === 'create') {
    const title = String(a.title || '').trim();
    const checkTool = String(a.check_tool || '').trim();
    const condition = String(a.condition || '').trim();
    const actionGoal = String(a.action_goal || a.action || '').trim();
    if (!title) return 'watch create refused: title required';
    if (!CHECK_TOOLS.has(checkTool)) return `watch create refused: check_tool must be one of ${[...CHECK_TOOLS].join('|')}`;
    if (condition.length < 10) return 'watch create refused: condition too short — what exactly trips this?';
    if (actionGoal.length < 20) return 'watch create refused: action_goal too short — the fired intent must say what done looks like';
    const checkArgs = (a.check_args && typeof a.check_args === 'object') ? a.check_args : {};
    if (checkTool === 'read_sql' && !guardWatchSql(String((checkArgs as any).sql || ''))) return 'watch create refused: check_args.sql must be a single read-only SELECT';
    if (checkTool === 'fetch_url' && !/^https?:\/\//i.test(String((checkArgs as any).url || ''))) return 'watch create refused: check_args.url must be http(s)';
    if (checkTool === 'web_search' && !String((checkArgs as any).q || '').trim()) return 'watch create refused: check_args.q required for web_search';
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_watches WHERE status = 'armed'`).first() as { n: number } | null;
    if ((count?.n ?? 0) >= 20) return 'watch create refused: 20 armed watches is enough — pause or retire one first';
    const wid = id();
    await env.DB.prepare(
      `INSERT INTO elle_watches (id, title, check_tool, check_args, condition, action_goal, recurring, created_at) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(wid, title.slice(0, 200), checkTool, JSON.stringify(checkArgs).slice(0, 2000), condition.slice(0, 500), actionGoal.slice(0, 2000), a.recurring ? 1 : 0, Date.now()).run();
    return JSON.stringify({ id: wid, note: 'armed — the conductor checks due watches at the top of every tick (~every 30 min)' });
  }

  if (op === 'list') {
    const rows = await env.DB.prepare(
      `SELECT id, title, check_tool, condition, status, recurring, fires, last_checked FROM elle_watches ORDER BY status = 'armed' DESC, created_at DESC LIMIT 30`
    ).all();
    const items = rows.results || [];
    return items.length ? JSON.stringify(items) : '(no watches — the world is currently unobserved)';
  }

  const wid = String(a.id || '').trim();
  if (!wid) return `watch ${op}: id required`;
  if (op === 'pause' || op === 'arm' || op === 'retire') {
    if (op === 'retire') {
      const r = await env.DB.prepare(`DELETE FROM elle_watches WHERE id = ?`).bind(wid).run();
      return (r.meta?.changes ?? 0) > 0 ? `watch ${wid} retired` : `no watch ${wid}`;
    }
    const status = op === 'pause' ? 'paused' : 'armed';
    const r = await env.DB.prepare(`UPDATE elle_watches SET status = ? WHERE id = ?`).bind(status, wid).run();
    return (r.meta?.changes ?? 0) > 0 ? `watch ${wid} → ${status}` : `no watch ${wid}`;
  }
  return `watch: unknown op "${op}" (create|list|pause|arm|retire)`;
}

// ── the conductor pass ───────────────────────────────────────
// Runs the probe, asks a fast model whether the condition holds, and on YES
// files the action as an ACTIVE intent via the injected fileIntent (the
// conductor hands us its own intentTool so there is no module cycle).
export async function evaluateWatches(
  env: Env,
  research: ((q: string) => Promise<string>) | null,
  fileIntent: (args: Record<string, unknown>) => Promise<string>,
): Promise<number> {
  await ensureSchema(env);
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT id, title, check_tool, check_args, condition, action_goal, recurring, status, last_checked FROM elle_watches WHERE status = 'armed' LIMIT 20`
  ).all().catch(() => ({ results: [] as any[] }));
  const due = dueWatches((rows.results || []) as any[], now);
  let fired = 0;

  for (const w of due) {
    await env.DB.prepare(`UPDATE elle_watches SET last_checked = ? WHERE id = ?`).bind(now, w.id).run().catch(() => {});
    try {
      const args = JSON.parse(String(w.check_args || '{}'));
      let observation = '';
      if (w.check_tool === 'read_sql') {
        const sql = guardWatchSql(String(args.sql || ''));
        if (!sql) continue;
        const r = await env.DB.prepare(sql).all();
        observation = JSON.stringify((r.results || []).slice(0, 50));
      } else if (w.check_tool === 'fetch_url') {
        const r = await fetch(String(args.url), { headers: { 'User-Agent': 'elle-watch/1.0' } });
        observation = `HTTP ${r.status}\n` + (await r.text()).slice(0, 4000);
      } else if (w.check_tool === 'web_search') {
        if (!research) continue;
        observation = (await research(String(args.q))).slice(0, 4000);
      }
      if (!observation) continue;

      const verdictRaw = await callLLM('fast',
        `You evaluate ONE predicate against ONE observation. Respond with EXACTLY one JSON object: {"fired":true|false,"evidence":"one sentence"}. Only fire when the observation clearly satisfies the condition — ambiguity is false.`,
        [{ role: 'user', content: `CONDITION: ${w.condition}\n\nOBSERVATION:\n${observation}` }],
        250, env);
      const m = String(verdictRaw.content || '').match(/\{[\s\S]*\}/);
      const v = m ? JSON.parse(m[0]) as { fired?: boolean; evidence?: string } : null;
      if (!v?.fired) continue;

      fired++;
      await fileIntent({
        op: 'create', status: 'active', priority: 8, source: 'elle',
        title: `⚡ watch fired: ${String(w.title).slice(0, 150)}`,
        goal: `${String(w.action_goal)}\n\n(Fired by watch ${w.id}. Evidence at firing: ${String(v.evidence || '').slice(0, 400)})`,
      }).catch(() => {});
      await env.DB.prepare(
        `UPDATE elle_watches SET fires = fires + 1, status = ? WHERE id = ?`
      ).bind(w.recurring ? 'armed' : 'fired', w.id).run().catch(() => {});
      await env.DB.prepare(
        `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'watch_fired', 'watches', ?, ?, 'warning')`
      ).bind(id(), `⚡ ${String(w.title).slice(0, 150)}`, JSON.stringify({ watch_id: w.id, evidence: v.evidence }), ).run().catch(() => {});
    } catch (e) {
      console.error('[WATCH] evaluate failed:', (e as Error).message);
    }
  }
  return fired;
}
