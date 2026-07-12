import { ensureAllSchemas } from './db/schema';
// ============================================================
// src/router-idempotency.ts  —  exactly-once guard for the router's WRITE tools.
//
// WHY: runRouter() is a plain in-memory ReAct loop. Nothing checkpoints, so
// any re-run (client double-tap, CF retry, the LLM emitting `buy` twice in
// one loop) can fire a side effect twice. trade_execute places REAL Alpaca
// market orders; ingest_paper writes corpus rows. This makes both safe to
// retry without converting the synchronous route to an async Workflow.
//
// It is also the correct primitive to keep once you DO move background runs
// (runOptimusJournal, US Foods ingestion) to Workflows — Cloudflare's own
// rule is "steps should be idempotent," and this is that guarantee.
//
// The table bootstraps itself on first use (see ensureSchema below) — no
// manual migration step.
// ============================================================

type OnceOpts = { windowSec?: number | null };

// The guard bootstraps its own table (idempotent, memoized per isolate) so it
// works the first time a write tool fires — no manual migration required.
let schemaReady = false;
async function ensureSchema(env: any): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

/**
 * Run `fn` at most once for a given `key`. A second call with the same key
 * replays the stored result instead of re-executing. Errors are NOT cached —
 * a failed attempt releases the key so a genuine retry can proceed.
 */
export async function ensureOnce<T>(
  env: any,
  key: string,
  tool: string,
  fn: () => Promise<T>,
  opts: OnceOpts = {}
): Promise<{ replayed: boolean; result: T }> {
  await ensureSchema(env);
  const windowSec = opts.windowSec ?? null;
  const cutoff = windowSec
    ? `AND created_at >= datetime('now', '-${Math.floor(windowSec)} seconds')`
    : "";

  // Fast path: already committed?
  const prior = await env.DB
    .prepare(`SELECT result_json, status FROM elle_idempotency WHERE key = ? ${cutoff}`)
    .bind(key).first();
  if (prior && prior.status === "done") {
    return { replayed: true, result: JSON.parse(prior.result_json) as T };
  }

  // Claim the key. INSERT OR IGNORE makes exactly one caller the winner.
  const claim = await env.DB
    .prepare(`INSERT OR IGNORE INTO elle_idempotency (key, tool, status) VALUES (?, ?, 'pending')`)
    .bind(key, tool).run();
  const won = (claim.meta?.changes ?? 0) === 1;

  if (!won) {
    // Lost the race: a sibling is mid-flight or just finished. Re-read.
    const again = await env.DB
      .prepare(`SELECT result_json, status FROM elle_idempotency WHERE key = ?`)
      .bind(key).first();
    if (again?.status === "done") {
      return { replayed: true, result: JSON.parse(again.result_json) as T };
    }
    return { replayed: true, result: { skipped: "duplicate in-flight", key } as unknown as T };
  }

  // We own the key — execute exactly once.
  const result = await fn();
  const isError =
    result && typeof result === "object" && "error" in (result as any) && (result as any).error;
  if (isError) {
    // Don't poison future retries with a transient failure — release the key.
    await env.DB.prepare(`DELETE FROM elle_idempotency WHERE key = ?`).bind(key).run();
    return { replayed: false, result };
  }
  await env.DB
    .prepare(`UPDATE elle_idempotency SET result_json = ?, status = 'done' WHERE key = ?`)
    .bind(JSON.stringify(result ?? null), key).run();
  return { replayed: false, result };
}

// `extra` distinguishes option orders that would otherwise collide: two
// different puts on the same underlying, same action/qty, would share a key
// without it (e.g. a $150 put and a $160 put both "trade:buy:AAPL:1").
export function orderKey(action: string, symbol: string, qty: number, extra?: string): string {
  const base = `trade:${String(action).toLowerCase()}:${String(symbol).toUpperCase().trim()}:${Math.floor(Number(qty) || 0)}`;
  return extra ? `${base}:${extra}` : base;
}

export function ingestKey(title: string): string {
  // Normalize so "Title", "title ", "title\n" collapse to one key → no dup rows.
  const norm = String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
  return `ingest:${norm}`;
}

// Wired into src/router.ts runTool: trade_execute dedupes identical orders
// within 90s; ingest_paper never ingests the same normalized title twice.
