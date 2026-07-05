// schema.ts — self-healing DDL for bending_trace, mirroring bending_trace.sql.
// The worker has no out-of-band migration step, so every isolate ensures the
// table exists on first touch (same pattern as ensureEventsSchema / ensureNotebook).
// Best-effort and idempotent; a race just no-ops on IF NOT EXISTS.

let ready = false;
export async function ensureBendingTraceSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS bending_trace (
    id            TEXT PRIMARY KEY,
    thread_id     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    perturbation  TEXT NOT NULL,
    response      TEXT NOT NULL,
    settling      TEXT NOT NULL,
    settled_open  INTEGER NOT NULL DEFAULT 0,
    r_estimate    REAL,
    kappa_traj    TEXT,
    reserve       REAL,
    velocity_peak REAL,
    kappa_provisional INTEGER NOT NULL DEFAULT 1,
    embedding_id  TEXT,
    source_mass   TEXT
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_thread  ON bending_trace(thread_id, created_at)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_reserve ON bending_trace(reserve)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_open    ON bending_trace(settled_open)`).run().catch(() => {});
  ready = true;
}
