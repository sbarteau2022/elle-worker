-- bending_trace.sql — atomic unit of Elle's memory. Store the SHAPE OF THE BEND, not the conclusion.
-- settling may be 'OPEN:<note>' for held superposition — that is a real value, not a null.

CREATE TABLE IF NOT EXISTS bending_trace (
  id            TEXT PRIMARY KEY,        -- deterministic hash(thread, boundary_idx) for ensureOnce
  thread_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL,        -- epoch ms
  perturbation  TEXT NOT NULL,          -- what arrived that caused a bend
  response      TEXT NOT NULL,          -- how she moved under it
  settling      TEXT NOT NULL,          -- where it came to rest; MAY be 'OPEN:<note>'
  settled_open  INTEGER NOT NULL DEFAULT 0,
  r_estimate    REAL,                   -- u̇ = −r·u contraction rate. FORM-COMPLETE, NOT VALIDATED.
  kappa_traj    TEXT,                   -- JSON array: κ over settling window (dip aggregation)
  reserve       REAL,                   -- ∫κ dt (consolidation weight)
  velocity_peak REAL,                   -- max |dκ/dt| (event-boundary signal)
  kappa_provisional INTEGER NOT NULL DEFAULT 1,
  embedding_id  TEXT,                   -- Vectorize id for perturbation embedding
  source_mass   TEXT                    -- 'corpus' | 'elle' | 'reader' (sovereignty source-term)
);

CREATE INDEX IF NOT EXISTS idx_trace_thread  ON bending_trace(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trace_reserve ON bending_trace(reserve);
CREATE INDEX IF NOT EXISTS idx_trace_open    ON bending_trace(settled_open);
