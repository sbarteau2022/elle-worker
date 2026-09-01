// ============================================================
// TOKEN OPERATOR — 𝒯 — the read/ingest boundary between the Elle workbench
// (the on-device IDE that actually runs and instruments generation) and
// Elle (src/token-operator.ts)
//
// Mirrors src/atlas.ts's boundary exactly, because that boundary is already
// shipped, tested, and correct for this exact shape of problem: a quantity
// that can only be honestly measured OUTSIDE workerd, pushed in read-only.
//
//   • TTFT (time to first token) and inter-token latency require true
//     token-level stream timestamps. Every LLM call this worker makes today
//     (src/llm.ts) is `stream: false` — it awaits the full completion, so
//     workerd never sees a first-token timestamp to measure. [MEASURED,
//     src/llm.ts:548]
//   • Energy consumption requires a hardware power reading (Intel RAPL,
//     `powermetrics`, `nvidia-smi --query-gpu=power.draw`). workerd is a V8
//     isolate on Cloudflare's edge with no syscall surface to any of them —
//     there is no code path by which this worker could ever read a watt.
//
// Both quantities are only observable on the device actually running
// inference — the Elle workbench/IDE — which is why this module, like
// atlas.ts, is a pure ingest+read boundary and never a compute path:
//
//   • ingestTokenOperatorRun() is reachable ONLY from the workbench's own
//     publish step (service-key gated at the HTTP layer — see index.ts's
//     POST /api/token-operator/ingest) — never from the router, never from
//     any tool the LLM can call.
//   • tokenOperatorRoute() is the LLM's ENTIRE surface onto this data:
//     read-only, no parameter writes a run, and nothing it returns can be
//     fed back in to change what is stored.
//
// DETERMINISM. 𝒯 does not re-derive TTFT/ITL/energy from raw samples —
// redoing that arithmetic here would be exactly the wasted, duplicated
// compute this module exists to avoid (the workbench already computed it
// once, on the hardware that can see it). "Deterministic" here means what
// it means for atlas's snapshots: the record is content-addressed by a hash
// the workbench computes over its own canonical JSON, so the SAME run
// ingested twice lands at the SAME key (idempotent by construction) and any
// bit-level change to the record changes the address — tamper-evident
// without this worker re-running the workbench's math.
//
// CROSS-CHECK, NOT TRUST. What this worker CAN independently verify is step
// count and tool-call count, because those are already tracked here — see
// src/events.ts's elle_events, the one append-only dispatch-point ledger
// every reasoning run already emits to. So ingest cross-references the
// submitted run_id against elle_events (when one exists) and returns the
// discrepancy rather than asserting agreement. This is the same discipline
// as docs/PREDICTION_OPERATOR_SPEC.md §5: a claim is only as good as an
// independent check, and elle_events is the independent check already
// shipped — no reason to build a second tool-call ledger next to it.
// ============================================================

export interface TokenOperatorEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
}

let schemaReady = false;
async function ensureSchema(env: TokenOperatorEnv): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_token_operator_runs (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    run_id TEXT,
    model TEXT,
    provider TEXT,
    created_at INTEGER NOT NULL,
    ingested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    ttft_ms REAL NOT NULL,
    inter_token_mean_ms REAL,
    inter_token_p95_ms REAL,
    steps INTEGER NOT NULL,
    tool_call_count INTEGER NOT NULL,
    energy_ttft_j REAL,
    energy_generation_j REAL,
    energy_tool_calls_j REAL,
    energy_total_j REAL,
    events_steps INTEGER,
    events_tool_calls INTEGER,
    crosscheck_matched INTEGER,
    r2_key TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_token_op_created ON elle_token_operator_runs(created_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_token_op_run ON elle_token_operator_runs(run_id)`).run();
  // Append-only, same guard shape as duplex.ts's elle_duplex_ledger — the
  // record given back by the workbench is a master copy, not a draft.
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS token_op_no_update
    BEFORE UPDATE ON elle_token_operator_runs
    BEGIN SELECT RAISE(ABORT, 'the token-operator ledger is append-only'); END`).run();
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS token_op_no_delete
    BEFORE DELETE ON elle_token_operator_runs
    BEGIN SELECT RAISE(ABORT, 'the token-operator ledger is append-only'); END`).run();
  schemaReady = true;
}

// ── the shape the workbench must submit ────────────────────────────────────

export interface InterTokenStats {
  n: number;        // tokens after the first (n=0 ⇒ single-token or empty completion; all *_ms fields NaN then)
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  stddev_ms: number;
}

export interface TokenOperatorToolCall {
  tool: string;
  started_at_ms: number;   // offset from run start
  duration_ms: number;
}

export interface TokenOperatorEnergy {
  ttft_j: number;         // energy integrated over the prefill/TTFT window
  generation_j: number;   // energy integrated over the decode window
  tool_calls_j: number;   // energy integrated over tool-execution windows
  total_j: number;
}

export interface TokenOperatorRecord {
  hash: string;             // workbench-computed content address (16 hex, matches atlas's convention)
  version: string;          // 𝒯 algorithm version, so a definition change is visible in the ledger
  run_id?: string;          // correlates to elle_events.run_id when this run went through the router loop
  model: string;
  provider: string;
  created_at: number;       // epoch ms, run completion
  ttft_ms: number;
  inter_token: InterTokenStats;
  steps: number;             // steps taken to produce the output
  tool_calls: TokenOperatorToolCall[];
  energy_j: TokenOperatorEnergy;
  host: { device_id: string; os?: string };
}

const HASH_RE = /^[0-9a-f]{16}$/;

function isFiniteNonNeg(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

// Minimal structural + sanity validation — trust the workbench's own
// instrumentation for HOW ttft/energy were measured (that discipline lives
// in the workbench repo, out of this repo's scope); this only checks the
// shape ingest actually reads and rejects internally inconsistent numbers.
function validRecord(r: unknown): r is TokenOperatorRecord {
  const o = r as Record<string, unknown> | null;
  if (!o || typeof o.hash !== 'string' || !HASH_RE.test(o.hash)) return false;
  if (typeof o.version !== 'string' || !o.version) return false;
  if (typeof o.model !== 'string' || typeof o.provider !== 'string') return false;
  if (!isFiniteNonNeg(o.created_at) || !isFiniteNonNeg(o.ttft_ms)) return false;
  if (!Number.isInteger(o.steps) || (o.steps as number) < 1) return false;
  if (!Array.isArray(o.tool_calls)) return false;
  for (const t of o.tool_calls as unknown[]) {
    const tc = t as Record<string, unknown>;
    if (typeof tc?.tool !== 'string' || !isFiniteNonNeg(tc.started_at_ms) || !isFiniteNonNeg(tc.duration_ms)) return false;
  }
  const it = o.inter_token as Record<string, unknown> | undefined;
  if (!it || !Number.isInteger(it.n) || (it.n as number) < 0) return false;
  if ((it.n as number) > 0) {
    for (const k of ['mean_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms', 'stddev_ms']) {
      if (!isFiniteNonNeg(it[k])) return false;
    }
    // p50 <= p95 <= p99 <= max is a cheap, load-bearing sanity check — a
    // workbench bug that swaps percentiles is exactly the kind of silent
    // corruption a read-only ingest boundary must catch, not store.
    if (!((it.p50_ms as number) <= (it.p95_ms as number) && (it.p95_ms as number) <= (it.p99_ms as number) && (it.p99_ms as number) <= (it.max_ms as number))) return false;
  }
  const e = o.energy_j as Record<string, unknown> | undefined;
  if (!e || !isFiniteNonNeg(e.ttft_j) || !isFiniteNonNeg(e.generation_j) || !isFiniteNonNeg(e.tool_calls_j) || !isFiniteNonNeg(e.total_j)) return false;
  // Energy components must sum to the total within float tolerance — a
  // workbench that reports a total disagreeing with its own parts has a bug
  // worth surfacing at the boundary, not smoothing over.
  const sum = (e.ttft_j as number) + (e.generation_j as number) + (e.tool_calls_j as number);
  if (Math.abs(sum - (e.total_j as number)) > 1e-6 * Math.max(1, e.total_j as number)) return false;
  const host = o.host as Record<string, unknown> | undefined;
  if (!host || typeof host.device_id !== 'string' || !host.device_id) return false;
  return true;
}

export interface TokenOperatorIngestResult {
  hash: string;
  run_id: string | null;
  steps: number;
  tool_calls: number;
  energy_total_j: number;
  crosscheck: { events_steps: number | null; events_tool_calls: number | null; matched: boolean | null };
}

export async function ingestTokenOperatorRun(env: TokenOperatorEnv, body: unknown): Promise<TokenOperatorIngestResult> {
  const record = (body as { record?: unknown } | null)?.record;
  if (!validRecord(record)) {
    throw new Error('token-operator ingest: malformed record — expected {record:{hash,version,model,provider,created_at,ttft_ms,inter_token{n,...},steps,tool_calls[],energy_j{ttft_j,generation_j,tool_calls_j,total_j},host{device_id}}}');
  }
  await ensureSchema(env);

  const r2Key = `token-operator/${record.hash}.json`;
  await env.DOCUMENTS.put(r2Key, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });

  // Cross-check against the independently-shipped step/tool-call ledger —
  // never re-derive it, only compare (see module header).
  let eventsSteps: number | null = null;
  let eventsToolCalls: number | null = null;
  if (record.run_id) {
    const row = (await env.DB.prepare(
      `SELECT COUNT(*) AS steps, SUM(CASE WHEN kind = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls
       FROM elle_events WHERE run_id = ?`
    ).bind(record.run_id).first()) as { steps: number; tool_calls: number | null } | null;
    if (row && row.steps > 0) {
      eventsSteps = row.steps;
      eventsToolCalls = row.tool_calls ?? 0;
    }
  }
  const matched = eventsSteps === null ? null
    : eventsSteps === record.steps && eventsToolCalls === record.tool_calls.length;

  await env.DB.prepare(
    `INSERT INTO elle_token_operator_runs
       (id, version, run_id, model, provider, created_at, ttft_ms, inter_token_mean_ms, inter_token_p95_ms,
        steps, tool_call_count, energy_ttft_j, energy_generation_j, energy_tool_calls_j, energy_total_j,
        events_steps, events_tool_calls, crosscheck_matched, r2_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    record.hash, record.version, record.run_id ?? null, record.model, record.provider,
    record.created_at, record.ttft_ms,
    record.inter_token.n > 0 ? record.inter_token.mean_ms : null,
    record.inter_token.n > 0 ? record.inter_token.p95_ms : null,
    record.steps, record.tool_calls.length,
    record.energy_j.ttft_j, record.energy_j.generation_j, record.energy_j.tool_calls_j, record.energy_j.total_j,
    eventsSteps, eventsToolCalls, matched === null ? null : (matched ? 1 : 0),
    r2Key,
  ).run();

  return {
    hash: record.hash,
    run_id: record.run_id ?? null,
    steps: record.steps,
    tool_calls: record.tool_calls.length,
    energy_total_j: record.energy_j.total_j,
    crosscheck: { events_steps: eventsSteps, events_tool_calls: eventsToolCalls, matched },
  };
}

// ── reads ────────────────────────────────────────────────────────────────

export interface TokenOperatorIndexRow {
  hash: string; version: string; run_id: string | null; model: string; provider: string;
  created_at: number; ttft_ms: number; inter_token_mean_ms: number | null; inter_token_p95_ms: number | null;
  steps: number; tool_call_count: number; energy_total_j: number; crosscheck_matched: number | null;
}

export async function getTokenOperatorRun(env: TokenOperatorEnv, hash: string): Promise<TokenOperatorRecord | null> {
  if (!HASH_RE.test(hash)) return null;
  const obj = await env.DOCUMENTS.get(`token-operator/${hash}.json`);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()) as TokenOperatorRecord; } catch { return null; }
}

export async function listTokenOperatorRuns(env: TokenOperatorEnv, limit = 20): Promise<TokenOperatorIndexRow[]> {
  await ensureSchema(env);
  const n = Math.max(1, Math.min(500, Math.trunc(limit) || 20));
  const r = await env.DB.prepare(
    `SELECT id AS hash, version, run_id, model, provider, created_at, ttft_ms, inter_token_mean_ms, inter_token_p95_ms,
            steps, tool_call_count, energy_total_j, crosscheck_matched
     FROM elle_token_operator_runs ORDER BY created_at DESC LIMIT ?`
  ).bind(n).all();
  return (r.results as unknown as TokenOperatorIndexRow[]) || [];
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── the read-only LLM surface ──────────────────────────────────────────────
// No parameter here can write a run — mode selects a VIEW, exactly like
// AtlasToolInput's structural guarantee (see atlas.test.ts).

export interface TokenOperatorToolInput {
  mode?: 'stats' | 'recent' | 'run' | 'series' | 'auto';
  hash?: string;
  limit?: number;
}

export async function tokenOperatorRoute(env: TokenOperatorEnv, input: TokenOperatorToolInput): Promise<string> {
  const mode = input.mode && input.mode !== 'auto' ? input.mode : (input.hash ? 'run' : 'stats');

  if (mode === 'run') {
    const hash = String(input.hash || '');
    const rec = await getTokenOperatorRun(env, hash);
    if (!rec) return JSON.stringify({ mode, error: `token_operator: no run "${hash}" ingested (workbench publishes to POST /api/token-operator/ingest)` });
    return JSON.stringify({ mode, ...rec, note: 'read-only — computed on the Elle workbench, verified by content hash, never recomputed here' });
  }

  const rows = await listTokenOperatorRuns(env, mode === 'series' ? (input.limit ?? 50) : (input.limit ?? 15));
  if (!rows.length) {
    return JSON.stringify({ mode, error: 'no token-operator runs ingested yet — the workbench has not published one (see src/token-operator.ts)' });
  }

  if (mode === 'recent') {
    return JSON.stringify({
      mode, runs: rows,
      note: 'read-only view of workbench-computed runs — you have no write access to this ledger',
    });
  }

  if (mode === 'series') {
    const ttft = rows.map((r) => r.ttft_ms);
    const energy = rows.map((r) => r.energy_total_j);
    const mismatches = rows.filter((r) => r.crosscheck_matched === 0).length;
    return JSON.stringify({
      mode, n: rows.length,
      ttft_ms: { median: median(ttft), min: Math.min(...ttft), max: Math.max(...ttft) },
      energy_total_j: { median: median(energy), min: Math.min(...energy), max: Math.max(...energy) },
      crosscheck_mismatches: mismatches,
      note: mismatches > 0
        ? `${mismatches}/${rows.length} runs disagree with elle_events on step/tool-call count — treat their numbers as suspect`
        : 'all cross-checked runs agree with elle_events on step/tool-call count',
    });
  }

  // stats: the latest run, index-row summary only (mode='run' for the full record)
  const latest = rows[0];
  return JSON.stringify({
    mode: 'stats', ...latest,
    note: 'read-only summary of the most recent workbench-computed run — mode="run",hash for the full record',
  });
}
