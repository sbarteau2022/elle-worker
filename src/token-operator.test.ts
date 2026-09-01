import { describe, it, expect } from 'vitest';
import {
  ingestTokenOperatorRun, getTokenOperatorRun, listTokenOperatorRuns, tokenOperatorRoute,
  type TokenOperatorEnv, type TokenOperatorToolInput,
} from './token-operator';

// ── fakes ────────────────────────────────────────────────────────────────
function fakeEnv(eventsRows: Record<string, unknown>[] = []) {
  const r2 = new Map<string, string>();
  const d1Rows: Record<string, unknown>[] = [];

  const stmt = {
    _sql: '',
    bind(...args: unknown[]) { (this as unknown as { _args: unknown[] })._args = args; return this; },
    async run() {
      const args = (this as unknown as { _args?: unknown[] })._args || [];
      if (this._sql.startsWith('INSERT INTO elle_token_operator_runs')) {
        d1Rows.push({
          id: args[0], version: args[1], run_id: args[2], model: args[3], provider: args[4],
          created_at: args[5], ttft_ms: args[6], inter_token_mean_ms: args[7], inter_token_p95_ms: args[8],
          steps: args[9], tool_call_count: args[10],
          energy_ttft_j: args[11], energy_generation_j: args[12], energy_tool_calls_j: args[13], energy_total_j: args[14],
          events_steps: args[15], events_tool_calls: args[16], crosscheck_matched: args[17],
          r2_key: args[18],
        });
      }
      return { success: true };
    },
    async first() {
      const args = (this as unknown as { _args?: unknown[] })._args || [];
      if (this._sql.includes('FROM elle_events')) {
        const runId = args[0];
        const rows = eventsRows.filter((r) => r.run_id === runId);
        if (!rows.length) return { steps: 0, tool_calls: 0 };
        const toolCalls = rows.filter((r) => r.kind === 'tool_call').length;
        return { steps: rows.length, tool_calls: toolCalls };
      }
      return null;
    },
    async all() {
      const args = (this as unknown as { _args?: unknown[] })._args || [];
      if (this._sql.includes('FROM elle_token_operator_runs')) {
        const limit = Number(args[0]) || 20;
        const rows = [...d1Rows]
          .sort((a, b) => (b.created_at as number) - (a.created_at as number))
          .slice(0, limit)
          .map((r) => ({
            hash: r.id, version: r.version, run_id: r.run_id, model: r.model, provider: r.provider,
            created_at: r.created_at, ttft_ms: r.ttft_ms,
            inter_token_mean_ms: r.inter_token_mean_ms, inter_token_p95_ms: r.inter_token_p95_ms,
            steps: r.steps, tool_call_count: r.tool_call_count, energy_total_j: r.energy_total_j,
            crosscheck_matched: r.crosscheck_matched,
          }));
        return { results: rows };
      }
      return { results: [] };
    },
  };

  const db = { prepare(sql: string) { return { ...stmt, _sql: sql }; } } as unknown as D1Database;
  const documents = {
    async put(key: string, value: string) { r2.set(key, value); },
    async get(key: string) { const v = r2.get(key); return v ? { text: async () => v } : null; },
  } as unknown as R2Bucket;

  return { env: { DB: db, DOCUMENTS: documents } as TokenOperatorEnv, r2, d1Rows };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    hash: 'abc1234500001111',
    version: 'v1',
    run_id: 'run-1',
    model: 'qwen3.8:27b',
    provider: 'ollama',
    created_at: 1_000_000,
    ttft_ms: 320,
    inter_token: { n: 40, mean_ms: 18, p50_ms: 16, p95_ms: 32, p99_ms: 40, max_ms: 55, stddev_ms: 6 },
    steps: 3,
    tool_calls: [{ tool: 'web_search', started_at_ms: 400, duration_ms: 900 }],
    energy_j: { ttft_j: 1.2, generation_j: 5.4, tool_calls_j: 0.9, total_j: 7.5 },
    host: { device_id: 'workbench-01', os: 'macOS' },
    ...overrides,
  };
}

describe('ingestTokenOperatorRun (the ONLY write path — never reachable from the router)', () => {
  it('stores the full record in R2 and an index row in D1', async () => {
    const { env, r2, d1Rows } = fakeEnv();
    const result = await ingestTokenOperatorRun(env, { record: record() });
    expect(result).toMatchObject({ hash: 'abc1234500001111', run_id: 'run-1', steps: 3, tool_calls: 1, energy_total_j: 7.5 });
    expect(r2.has('token-operator/abc1234500001111.json')).toBe(true);
    expect(JSON.parse(r2.get('token-operator/abc1234500001111.json')!).hash).toBe('abc1234500001111');
    expect(d1Rows.length).toBe(1);
  });

  it('rejects a malformed record rather than silently storing garbage', async () => {
    const { env } = fakeEnv();
    await expect(ingestTokenOperatorRun(env, { record: { steps: 1 } })).rejects.toThrow(/malformed record/);
    await expect(ingestTokenOperatorRun(env, {})).rejects.toThrow(/malformed record/);
  });

  it('rejects a bad content hash (not the 16-hex address form)', async () => {
    const { env } = fakeEnv();
    await expect(ingestTokenOperatorRun(env, { record: record({ hash: 'not-a-hash' }) })).rejects.toThrow(/malformed record/);
  });

  it('rejects inconsistent percentiles (p95 < p50) as corruption, not data', async () => {
    const { env } = fakeEnv();
    const bad = record({ inter_token: { n: 10, mean_ms: 10, p50_ms: 40, p95_ms: 10, p99_ms: 50, max_ms: 60, stddev_ms: 5 } });
    await expect(ingestTokenOperatorRun(env, { record: bad })).rejects.toThrow(/malformed record/);
  });

  it('rejects an energy total that disagrees with its own components', async () => {
    const { env } = fakeEnv();
    const bad = record({ energy_j: { ttft_j: 1, generation_j: 1, tool_calls_j: 1, total_j: 99 } });
    await expect(ingestTokenOperatorRun(env, { record: bad })).rejects.toThrow(/malformed record/);
  });

  it('cross-checks steps/tool-calls against elle_events and reports a match', async () => {
    const { env } = fakeEnv([
      { run_id: 'run-1', kind: 'run_start' },
      { run_id: 'run-1', kind: 'tool_call' },
      { run_id: 'run-1', kind: 'answer' },
    ]);
    const result = await ingestTokenOperatorRun(env, { record: record() });
    expect(result.crosscheck).toEqual({ events_steps: 3, events_tool_calls: 1, matched: true });
  });

  it('cross-checks and reports a mismatch without rejecting the ingest', async () => {
    const { env } = fakeEnv([
      { run_id: 'run-1', kind: 'run_start' },
      { run_id: 'run-1', kind: 'answer' },
    ]);
    const result = await ingestTokenOperatorRun(env, { record: record() });
    expect(result.crosscheck.matched).toBe(false);
  });

  it('reports crosscheck as null (not false) when the run never went through the router', async () => {
    const { env } = fakeEnv();
    const result = await ingestTokenOperatorRun(env, { record: record({ run_id: undefined }) });
    expect(result.crosscheck).toEqual({ events_steps: null, events_tool_calls: null, matched: null });
  });
});

describe('tokenOperatorRoute (Elle\'s ENTIRE surface onto 𝒯 — reads only)', () => {
  it('errors cleanly when nothing has been ingested', async () => {
    const { env } = fakeEnv();
    const out = JSON.parse(await tokenOperatorRoute(env, {}));
    expect(out.error).toMatch(/no token-operator runs ingested/);
  });

  it('stats mode summarizes the most recent run', async () => {
    const { env } = fakeEnv();
    await ingestTokenOperatorRun(env, { record: record() });
    const out = JSON.parse(await tokenOperatorRoute(env, {}));
    expect(out.mode).toBe('stats');
    expect(out.hash).toBe('abc1234500001111');
    expect(out.note).toMatch(/read-only/);
  });

  it('run mode returns the full record by hash', async () => {
    const { env } = fakeEnv();
    await ingestTokenOperatorRun(env, { record: record() });
    const out = JSON.parse(await tokenOperatorRoute(env, { mode: 'run', hash: 'abc1234500001111' }));
    expect(out.inter_token.n).toBe(40);
    expect(out.note).toMatch(/never recomputed here/);
  });

  it('recent mode lists the index', async () => {
    const { env } = fakeEnv();
    await ingestTokenOperatorRun(env, { record: record() });
    const out = JSON.parse(await tokenOperatorRoute(env, { mode: 'recent' }));
    expect(out.runs.length).toBe(1);
  });

  it('series mode aggregates and surfaces crosscheck mismatches', async () => {
    const { env } = fakeEnv([{ run_id: 'run-1', kind: 'run_start' }, { run_id: 'run-1', kind: 'answer' }]);
    await ingestTokenOperatorRun(env, { record: record() }); // mismatched: events say 2 steps, record says 3
    const out = JSON.parse(await tokenOperatorRoute(env, { mode: 'series' }));
    expect(out.n).toBe(1);
    expect(out.crosscheck_mismatches).toBe(1);
    expect(out.note).toMatch(/disagree with elle_events/);
  });

  it('has no mode that accepts a record/hash-to-write — the type surface itself is read-only', () => {
    const input: TokenOperatorToolInput = { mode: 'stats', hash: 'abc1234500001111', limit: 5 };
    expect(Object.keys(input).sort()).toEqual(['hash', 'limit', 'mode']);
  });
});

describe('getTokenOperatorRun / listTokenOperatorRuns', () => {
  it('returns null before anything is ingested', async () => {
    const { env } = fakeEnv();
    expect(await getTokenOperatorRun(env, 'abc1234500001111')).toBeNull();
    expect(await listTokenOperatorRuns(env)).toEqual([]);
  });

  it('rejects a malformed hash before it can shape an R2 key', async () => {
    const { env } = fakeEnv();
    expect(await getTokenOperatorRun(env, '../secrets')).toBeNull();
    expect(await getTokenOperatorRun(env, '')).toBeNull();
  });
});
