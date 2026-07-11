// ============================================================
// EVENT BUS + PROVENANCE — src/events.ts
//
// Every reasoning run flows through ONE dispatch point in the router loop. Emit
// a structured event at each step from that single point and you get three
// capabilities for the price of one instrumentation site:
//
//   • State Replay        — the ordered event stream of a run, re-read after the
//                           fact: what she saw, what she called, what came back.
//   • Provenance          — for any answer, the exact chain of tool calls and
//                           observations it was built from. Where a fact CAME
//                           from, not just what it was.
//   • Observer Graph      — the raw material for a graph over runs/tools/results
//                           (built later on top of this table, no new capture).
//
// One append-only table, elle_events. Emitting is BEST-EFFORT and never throws:
// observability is a bonus laid over the run, never a dependency the run can
// die on. A run is correlated by run_id; step_index orders within a run.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';

export type EventKind = 'run_start' | 'tool_call' | 'answer' | 'error' | 'note';

export interface ElleEvent {
  run_id: string;
  session_id?: string | null;
  source: string;                 // elle-router | conductor | atlas | …
  scope?: string;                 // full | member | public | hospitality
  step_index: number;
  kind: EventKind;
  tool?: string | null;
  args?: unknown;                 // JSON-serialized on write
  result_preview?: string | null; // clipped observation / answer
  duration_ms?: number | null;
  created_at?: number;
}

let schemaReady = false;
export async function ensureEventsSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

// Fire-and-forget. Any failure (schema race, D1 blip) is swallowed — the run
// that emitted it must be unaffected. Returns nothing on purpose.
export async function emitEvent(env: Env, e: ElleEvent): Promise<void> {
  try {
    await ensureEventsSchema(env);
    await env.DB.prepare(
      `INSERT INTO elle_events (id, run_id, session_id, source, scope, step_index, kind, tool, args, result_preview, duration_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID().replace(/-/g, '').slice(0, 20),
      e.run_id,
      e.session_id ?? null,
      e.source,
      e.scope ?? null,
      e.step_index,
      e.kind,
      e.tool ?? null,
      e.args === undefined ? null : safeJson(e.args, 4000),
      e.result_preview == null ? null : String(e.result_preview).slice(0, 2000),
      e.duration_ms ?? null,
      e.created_at ?? Date.now(),
    ).run();
  } catch { /* observability is a bonus, not a dependency */ }
}

function safeJson(v: unknown, cap: number): string {
  try { return JSON.stringify(v).slice(0, cap); } catch { return String(v).slice(0, cap); }
}

// ── provenance tool ───────────────────────────────────────────────────────

export interface ProvenanceArgs {
  op?: 'replay' | 'recent' | 'trace';
  run_id?: string;
  session_id?: string;
  limit?: number;
}

// One tool, three reads of the same table:
//   replay{run_id}      — the ordered step stream of a single run.
//   recent{limit?}      — the most recent runs, one summary row each.
//   trace{session_id}   — every run in a session, newest first.
export async function provenanceTool(env: Env, a: ProvenanceArgs): Promise<string> {
  const op = a.op || (a.run_id ? 'replay' : 'recent');
  try {
    await ensureEventsSchema(env);
    if (op === 'replay') {
      if (!a.run_id) return 'provenance: replay needs a run_id (get one from op="recent").';
      const rows = await env.DB.prepare(
        `SELECT step_index, kind, tool, args, result_preview, duration_ms, created_at
         FROM elle_events WHERE run_id = ? ORDER BY step_index ASC, created_at ASC`
      ).bind(a.run_id).all();
      const evs = rows.results || [];
      if (!evs.length) return `provenance: no events for run ${a.run_id}.`;
      return JSON.stringify({ run_id: a.run_id, steps: evs.length, events: evs.map(shapeReplay) });
    }
    if (op === 'trace') {
      if (!a.session_id) return 'provenance: trace needs a session_id.';
      const rows = await env.DB.prepare(
        `SELECT run_id, MIN(created_at) started, COUNT(*) events,
                SUM(CASE WHEN kind='tool_call' THEN 1 ELSE 0 END) tool_calls
         FROM elle_events WHERE session_id = ? GROUP BY run_id ORDER BY started DESC LIMIT ?`
      ).bind(a.session_id, clampLimit(a.limit, 20)).all();
      return JSON.stringify({ session_id: a.session_id, runs: rows.results || [] });
    }
    // recent
    const rows = await env.DB.prepare(
      `SELECT run_id, source, scope, MIN(created_at) started, COUNT(*) events,
              SUM(CASE WHEN kind='tool_call' THEN 1 ELSE 0 END) tool_calls
       FROM elle_events GROUP BY run_id ORDER BY started DESC LIMIT ?`
    ).bind(clampLimit(a.limit, 15)).all();
    return JSON.stringify({ recent_runs: rows.results || [] });
  } catch (e) {
    return `provenance: query failed (${(e as Error).message})`;
  }
}

function shapeReplay(r: Record<string, unknown>): Record<string, unknown> {
  return {
    step: r.step_index,
    kind: r.kind,
    tool: r.tool ?? undefined,
    args: parseMaybe(r.args),
    result: r.result_preview ?? undefined,
    ms: r.duration_ms ?? undefined,
  };
}

function parseMaybe(v: unknown): unknown {
  if (v == null) return undefined;
  try { return JSON.parse(String(v)); } catch { return String(v); }
}

export function clampLimit(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(1, Math.min(100, Math.floor(n)));
}
