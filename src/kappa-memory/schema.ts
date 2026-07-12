import { ensureAllSchemas } from '../db/schema';
// schema.ts — self-healing DDL for bending_trace, mirroring bending_trace.sql.
// The worker has no out-of-band migration step, so every isolate ensures the
// table exists on first touch (same pattern as ensureEventsSchema / ensureNotebook).
// Best-effort and idempotent; a race just no-ops on IF NOT EXISTS.

let ready = false;
export async function ensureBendingTraceSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await ensureAllSchemas(db);
  ready = true;
}
