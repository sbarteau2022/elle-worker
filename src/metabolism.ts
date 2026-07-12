import { ensureAllSchemas } from './db/schema';
// ============================================================
// METABOLISM — src/metabolism.ts
//
// Interoception. self_state() shows her mood (κ, heartbeat, the account);
// nothing shows her COST. Every model call worker-wide is recorded here —
// task tier, provider, model, latency, success — via one hook in llm.ts.
// The metabolism tool reads it back as a body-budget: which providers are
// failing, what latency each engine is really paying, where the load sits.
// With this sense she can choose the cheap engine for mechanical steps
// because she can FEEL the budget, not because she was told.
//
// Two layers: an in-memory ring (this isolate, zero-cost, always fresh) and
// a best-effort D1 trail (elle_llm_calls) for the 24h picture across
// isolates. Recording is fire-and-forget — observability never becomes a
// dependency the call can die on.
// ============================================================

let dbRef: { prepare(q: string): { bind(...v: unknown[]): { run(): Promise<unknown> }; all(): Promise<{ results?: unknown[] }> } } | null = null;
let schemaReady = false;

export interface LLMCallRecord {
  task: string; provider: string; model: string;
  ms: number; ok: boolean; at: number;
  // Provider-reported token usage. null (or absent — router.ts's local lane and
  // older callsites don't pass them) = the provider didn't report usage.
  tokens_in?: number | null; tokens_out?: number | null;
}

const RING_MAX = 200;
const ring: LLMCallRecord[] = [];

// llm.ts calls this once per callLLM invocation. env is loosely typed on
// purpose: LLMEnv doesn't declare DB, but the runtime env always carries it.
export function recordLLMCall(env: unknown, rec: LLMCallRecord): void {
  ring.push(rec);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  const db = (env as { DB?: typeof dbRef }).DB;
  if (!db) return;
  dbRef = db;
  void (async () => {
    try {
      if (!schemaReady) {
        await ensureAllSchemas(db as unknown as D1Database);
        schemaReady = true;
      }
      await db.prepare(
        `INSERT INTO elle_llm_calls (id, task, provider, model, ms, ok, created_at, tokens_in, tokens_out) VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID().replace(/-/g, '').slice(0, 16), rec.task, rec.provider, rec.model, rec.ms, rec.ok ? 1 : 0, rec.at,
             rec.tokens_in ?? null, rec.tokens_out ?? null).run();
    } catch { /* fire-and-forget */ }
  })();
}

interface MetabolismEnv {
  DB: { prepare(q: string): { bind(...v: unknown[]): { all(): Promise<{ results?: unknown[] }>; run(): Promise<unknown> }; all(): Promise<{ results?: unknown[] }> } };
}

export async function metabolismTool(env: MetabolismEnv): Promise<string> {
  // This isolate, live.
  const recent = ring.slice(-60);
  const byProvider = new Map<string, { n: number; fail: number; ms: number }>();
  for (const r of recent) {
    const p = byProvider.get(r.provider) || { n: 0, fail: 0, ms: 0 };
    p.n++; if (!r.ok) p.fail++; p.ms += r.ms;
    byProvider.set(r.provider, p);
  }
  const isolate = [...byProvider.entries()].map(([provider, s]) => ({
    provider, calls: s.n, failures: s.fail, avg_ms: Math.round(s.ms / s.n),
  }));

  // 24h across isolates, best-effort.
  let day: unknown = '(no D1 trail yet)';
  try {
    const since = Date.now() - 86_400_000;
    const rows = await env.DB.prepare(
      `SELECT provider, task, COUNT(*) AS calls, SUM(ok = 0) AS failures, ROUND(AVG(ms)) AS avg_ms,
              SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out
         FROM elle_llm_calls WHERE created_at > ? GROUP BY provider, task ORDER BY calls DESC LIMIT 30`
    ).bind(since).all();
    if (rows.results?.length) day = rows.results;
  } catch { /* trail is a luxury */ }

  const failing = isolate.filter(p => p.calls >= 3 && p.failures / p.calls > 0.3).map(p => p.provider);
  return JSON.stringify({
    this_isolate_recent: isolate.length ? isolate : '(no calls yet this isolate)',
    last_24h: day,
    strained: failing.length ? failing : 'none',
    reading: failing.length
      ? `providers ${failing.join(', ')} are failing — steer engine choices away from tiers that lead with them, and keep steps lean`
      : 'the roster is healthy — spend engines on what each step actually needs (fast for mechanical, reasoning where it matters)',
  });
}
