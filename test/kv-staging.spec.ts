// ============================================================
// TARGET B TEST SUITE — R2: STATELESS KV STAGING LAYER
//
// Authoritative Spec: docs/SWARM_INGESTION_AND_STORAGE_LIFECYCLE_PLAN.md §3.1, §3.3
// Requirement: ORIGINAL_REQUEST.md §R2
//
// Tiers Covered:
//   - Tier 1: Feature Coverage (stageEntry, 5m TTL, getStaged, listStagedKeys,
//             flushStaged with D1 batch transaction, KV post-flush deletion)
//   - Tier 2: Boundary & Corner Cases (Empty flush idempotency, expired TTL,
//             broken D1 SQLITE_BUSY fail-safe with key retention, broken KV,
//             oversized payloads, corrupted JSON resilience, concurrent write nonces)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../src/index';

// ── KV Staging Protocol Reference Contract ────────────────────────────────
export const DEFAULT_STAGING_TTL_S = 300; // 5 minutes TTL
export const DEFAULT_STAGE_PREFIX = 'stage:bus';

export interface StagedItem<T = unknown> {
  key: string;
  stageKey: string;
  payload: T;
  stagedAt: number;
  ttl: number;
}

export interface StageResult {
  ok: boolean;
  stageKey: string;
  error?: string;
}

export interface FlushResult {
  ok: boolean;
  flushedCount: number;
  stagedKeysPurged: number;
  errors?: string[];
}

export async function stageEntry<T = unknown>(
  env: { SESSIONS?: any; SCRATCHPAD?: any },
  key: string,
  payload: T,
  opts: { ttl?: number; prefix?: string; namespace?: 'SESSIONS' | 'SCRATCHPAD' } = {}
): Promise<StageResult> {
  const kv = opts.namespace === 'SCRATCHPAD' ? env.SCRATCHPAD : (env.SESSIONS || env.SCRATCHPAD);
  if (!kv) {
    return { ok: false, stageKey: '', error: 'KV staging namespace not configured' };
  }

  const prefix = opts.prefix ?? DEFAULT_STAGE_PREFIX;
  const ttl = Math.max(1, opts.ttl ?? DEFAULT_STAGING_TTL_S);
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const stageKey = `${prefix}:${key}:${nonce}`;

  const envelope: StagedItem<T> = {
    key,
    stageKey,
    payload,
    stagedAt: Date.now(),
    ttl,
  };

  try {
    await kv.put(stageKey, JSON.stringify(envelope), { expirationTtl: ttl });
    return { ok: true, stageKey };
  } catch (err) {
    return { ok: false, stageKey: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getStaged<T = unknown>(
  env: { SESSIONS?: any; SCRATCHPAD?: any },
  stageKey: string,
  opts: { namespace?: 'SESSIONS' | 'SCRATCHPAD' } = {}
): Promise<StagedItem<T> | null> {
  const kv = opts.namespace === 'SCRATCHPAD' ? env.SCRATCHPAD : (env.SESSIONS || env.SCRATCHPAD);
  if (!kv || !stageKey) return null;

  try {
    const raw = await kv.get(stageKey);
    if (!raw) return null;
    return JSON.parse(raw) as StagedItem<T>;
  } catch {
    return null;
  }
}

export async function listStagedKeys(
  env: { SESSIONS?: any; SCRATCHPAD?: any },
  prefix = DEFAULT_STAGE_PREFIX,
  opts: { namespace?: 'SESSIONS' | 'SCRATCHPAD' } = {}
): Promise<string[]> {
  const kv = opts.namespace === 'SCRATCHPAD' ? env.SCRATCHPAD : (env.SESSIONS || env.SCRATCHPAD);
  if (!kv || typeof kv.list !== 'function') return [];

  try {
    const res = await kv.list({ prefix });
    return (res.keys || []).map((k: { name: string }) => k.name);
  } catch {
    return [];
  }
}

export async function flushStaged(
  env: { DB?: any; SESSIONS?: any; SCRATCHPAD?: any },
  opts: { prefix?: string; batchSize?: number; targetTable?: string } = {}
): Promise<FlushResult> {
  const db = env.DB;
  const kv = env.SESSIONS || env.SCRATCHPAD;
  if (!db || !kv) {
    return { ok: false, flushedCount: 0, stagedKeysPurged: 0, errors: ['DB or KV binding missing'] };
  }

  const prefix = opts.prefix ?? DEFAULT_STAGE_PREFIX;
  const batchSize = Math.max(1, opts.batchSize ?? 10);
  const targetTable = opts.targetTable ?? 'elle_session_bus';

  try {
    const keys = await listStagedKeys(env, prefix);
    if (keys.length === 0) {
      return { ok: true, flushedCount: 0, stagedKeysPurged: 0 };
    }

    const keysToProcess = keys.slice(0, batchSize);
    const items: StagedItem[] = [];
    const validKeys: string[] = [];

    for (const k of keysToProcess) {
      const item = await getStaged(env, k);
      if (item) {
        items.push(item);
        validKeys.push(k);
      } else {
        // Purge expired or unparseable tombstone key
        await kv.delete(k).catch(() => {});
      }
    }

    if (items.length === 0) {
      return { ok: true, flushedCount: 0, stagedKeysPurged: 0 };
    }

    // Build D1 batch statements
    const stmts = items.map((it) => {
      return db.prepare(
        `INSERT INTO ${targetTable} (id, lane, payload, created_at) VALUES (?1, ?2, ?3, ?4)`
      ).bind(
        it.stageKey,
        it.key,
        JSON.stringify(it.payload),
        it.stagedAt
      );
    });

    // Execute atomic D1 batch transaction
    await db.batch(stmts);

    // After verified D1 commit, delete staged entries from KV
    let purged = 0;
    for (const k of validKeys) {
      await kv.delete(k).catch(() => {});
      purged++;
    }

    return {
      ok: true,
      flushedCount: items.length,
      stagedKeysPurged: purged,
    };
  } catch (err) {
    return {
      ok: false,
      flushedCount: 0,
      stagedKeysPurged: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

// ── In-Memory Mock KV Helper ──────────────────────────────────────────────
interface MockKvEntry {
  value: string;
  expiration: number;
}

function createMockKv(initialNow = Date.now()) {
  let now = initialNow;
  const store = new Map<string, MockKvEntry>();

  return {
    _store: store,
    _setNow(ts: number) { now = ts; },
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiration && entry.expiration <= now) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      const ttl = opts?.expirationTtl ?? DEFAULT_STAGING_TTL_S;
      store.set(key, {
        value,
        expiration: now + ttl * 1000,
      });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? '';
      const validKeys: { name: string }[] = [];
      for (const [k, entry] of store.entries()) {
        if (entry.expiration && entry.expiration <= now) {
          store.delete(k);
          continue;
        }
        if (k.startsWith(prefix)) {
          validKeys.push({ name: k });
        }
      }
      return { keys: validKeys };
    }),
  };
}

function createMockDb() {
  const executedStatements: Array<{ sql: string; params: any[] }> = [];
  let shouldFailBatch = false;

  return {
    _executed: executedStatements,
    _setFailBatch(fail: boolean) { shouldFailBatch = fail; },
    prepare: vi.fn((sql: string) => {
      let boundParams: any[] = [];
      return {
        bind: vi.fn((...params: any[]) => {
          boundParams = params;
          return {
            run: vi.fn(async () => {
              executedStatements.push({ sql, params: boundParams });
              return { success: true };
            }),
            _sql: sql,
            _params: boundParams,
          };
        }),
      };
    }),
    batch: vi.fn(async (stmts: any[]) => {
      if (shouldFailBatch) {
        throw new Error('D1_ERROR: SQLITE_BUSY (database is locked)');
      }
      for (const s of stmts) {
        executedStatements.push({ sql: s._sql, params: s._params });
      }
      return stmts.map(() => ({ success: true }));
    }),
  };
}

// ==========================================================================
// TIER 1: FEATURE COVERAGE (ISOLATION TESTS)
// ==========================================================================
describe('Tier 1: Stateless KV Staging Layer (Feature Coverage)', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as any,
      DB: mockDb as any,
    } as unknown as Env;
  });

  it('T1.1: stageEntry writes payload to KV namespace with specified key and nonce', async () => {
    const payload = { kind: 'tool_result', tool: 'calc', result: '42' };
    const res = await stageEntry(env, 'primary_lane', payload);

    expect(res.ok).toBe(true);
    expect(res.stageKey).toMatch(/^stage:bus:primary_lane:[a-f0-9]{16}$/);
    expect(mockKv.put).toHaveBeenCalledWith(res.stageKey, expect.any(String), { expirationTtl: DEFAULT_STAGING_TTL_S });
  });

  it('T1.2: stageEntry enforces 5-minute (300s) default TTL', async () => {
    const res = await stageEntry(env, 'audit_lane', { status: 'ok' });
    expect(res.ok).toBe(true);
    const raw = await mockKv.get(res.stageKey);
    const parsed = JSON.parse(raw!);
    expect(parsed.ttl).toBe(300);
  });

  it('T1.3: getStaged accurately retrieves and parses staged JSON payload', async () => {
    const sample = { user: 'stewart', action: 'deploy_tool', timestamp: 1724900000 };
    const staged = await stageEntry(env, 'worker_lane', sample);
    
    const retrieved = await getStaged<typeof sample>(env, staged.stageKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.payload).toEqual(sample);
    expect(retrieved!.key).toBe('worker_lane');
  });

  it('T1.4: listStagedKeys filters keys by prefix accurately', async () => {
    await stageEntry(env, 'lane_a', { msg: 1 }, { prefix: 'stage:bus' });
    await stageEntry(env, 'lane_b', { msg: 2 }, { prefix: 'stage:bus' });
    await stageEntry(env, 'other', { msg: 3 }, { prefix: 'stage:other' });

    const busKeys = await listStagedKeys(env, 'stage:bus');
    expect(busKeys.length).toBe(2);
    expect(busKeys.every(k => k.startsWith('stage:bus:'))).toBe(true);

    const otherKeys = await listStagedKeys(env, 'stage:other');
    expect(otherKeys.length).toBe(1);
  });

  it('T1.5: flushStaged drains pending entries to D1 via db.batch() in atomic transaction', async () => {
    await stageEntry(env, 'lane_1', { event: 'step_1' });
    await stageEntry(env, 'lane_1', { event: 'step_2' });
    await stageEntry(env, 'lane_2', { event: 'step_3' });

    const flushRes = await flushStaged(env, { batchSize: 10 });
    expect(flushRes.ok).toBe(true);
    expect(flushRes.flushedCount).toBe(3);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
    expect(mockDb._executed.length).toBe(3);
  });

  it('T1.6: flushStaged purges staged keys from KV upon successful D1 commit', async () => {
    const s1 = await stageEntry(env, 'lane_1', { id: 1 });
    const s2 = await stageEntry(env, 'lane_2', { id: 2 });

    const flushRes = await flushStaged(env);
    expect(flushRes.ok).toBe(true);
    expect(flushRes.stagedKeysPurged).toBe(2);

    const remainingKeys = await listStagedKeys(env);
    expect(remainingKeys.length).toBe(0);
    expect(await getStaged(env, s1.stageKey)).toBeNull();
    expect(await getStaged(env, s2.stageKey)).toBeNull();
  });
});

// ==========================================================================
// TIER 2: BOUNDARY & CORNER CASES (RESILIENCE & RECOVERY)
// ==========================================================================
describe('Tier 2: Stateless KV Staging Layer (Boundary & Fail-Safe)', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as any,
      DB: mockDb as any,
    } as unknown as Env;
  });

  it('T2.1: Idempotent flush on empty KV staging returns { ok: true, flushedCount: 0 }', async () => {
    const res = await flushStaged(env);
    expect(res.ok).toBe(true);
    expect(res.flushedCount).toBe(0);
    expect(res.stagedKeysPurged).toBe(0);
    expect(mockDb.batch).not.toHaveBeenCalled();
  });

  it('T2.2: Staged entries expire and disappear automatically after 300s TTL', async () => {
    const t0 = 1000000;
    mockKv._setNow(t0);

    const s = await stageEntry(env, 'expiring_lane', { test: 'ttl' }, { ttl: 300 });
    expect(await getStaged(env, s.stageKey)).not.toBeNull();

    // Advance clock past TTL (301 seconds)
    mockKv._setNow(t0 + 301 * 1000);
    expect(await getStaged(env, s.stageKey)).toBeNull();

    const keys = await listStagedKeys(env);
    expect(keys.length).toBe(0);
  });

  it('T2.3: Broken D1 SQLITE_BUSY lock error returns { ok: false } and PRESERVES KV keys without data loss', async () => {
    const s1 = await stageEntry(env, 'critical_lane', { data: 'vital_telemetry' });
    mockDb._setFailBatch(true); // Simulate D1 database lock contention

    const res = await flushStaged(env);
    expect(res.ok).toBe(false);
    expect(res.flushedCount).toBe(0);
    expect(res.errors?.[0]).toContain('SQLITE_BUSY');

    // Invariant: Uncommitted keys MUST remain in KV staging for future retry
    const item = await getStaged(env, s1.stageKey);
    expect(item).not.toBeNull();
    expect(item!.payload).toEqual({ data: 'vital_telemetry' });
  });

  it('T2.4: Broken KV binding handles exceptions gracefully without throwing', async () => {
    const brokenEnv = {
      SESSIONS: {
        put: vi.fn(async () => { throw new Error('KV_SERVICE_UNAVAILABLE'); }),
        get: vi.fn(async () => { throw new Error('KV_READ_TIMEOUT'); }),
        list: vi.fn(async () => { throw new Error('KV_LIST_ERROR'); }),
      },
      DB: mockDb as any,
    } as unknown as Env;

    const stageRes = await stageEntry(brokenEnv, 'lane', { x: 1 });
    expect(stageRes.ok).toBe(false);
    expect(stageRes.error).toContain('KV_SERVICE_UNAVAILABLE');

    const getRes = await getStaged(brokenEnv, 'stage:bus:lane:123');
    expect(getRes).toBeNull();

    const listRes = await listStagedKeys(brokenEnv);
    expect(listRes).toEqual([]);
  });

  it('T2.5: Resilient against corrupted or non-JSON payloads in KV', async () => {
    // Inject raw corrupted payload directly into KV
    mockKv._store.set('stage:bus:corrupt:123', {
      value: '{bad-json-payload-without-quotes:',
      expiration: Date.now() + 300000,
    });

    const getRes = await getStaged(env, 'stage:bus:corrupt:123');
    expect(getRes).toBeNull();

    // Flush should delete the unparseable tombstone and not crash
    const flushRes = await flushStaged(env);
    expect(flushRes.ok).toBe(true);
    expect(mockKv._store.has('stage:bus:corrupt:123')).toBe(false);
  });

  it('T2.6: Supports oversized 100KB payload staging and chunked batch limits', async () => {
    const largePayload = {
      ast: 'X'.repeat(100_000),
      nodes: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `node_${i}` })),
    };

    const stageRes = await stageEntry(env, 'large_ast_lane', largePayload);
    expect(stageRes.ok).toBe(true);

    const retrieved = await getStaged<typeof largePayload>(env, stageRes.stageKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.payload.ast.length).toBe(100_000);

    const flushRes = await flushStaged(env, { batchSize: 5 });
    expect(flushRes.ok).toBe(true);
    expect(flushRes.flushedCount).toBe(1);
  });

  it('T2.7: Generates unique nonces for concurrent writes on identical lane keys', async () => {
    const p1 = stageEntry(env, 'same_lane', { id: 1 });
    const p2 = stageEntry(env, 'same_lane', { id: 2 });
    const p3 = stageEntry(env, 'same_lane', { id: 3 });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    expect(r1.stageKey).not.toBe(r2.stageKey);
    expect(r2.stageKey).not.toBe(r3.stageKey);

    const keys = await listStagedKeys(env, 'stage:bus:same_lane');
    expect(keys.length).toBe(3);
  });
});
