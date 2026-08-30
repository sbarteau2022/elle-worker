import { describe, it, expect, vi } from 'vitest';
import {
  stageEntry,
  flushStaged,
  getStagedEntry,
  clearStagedEntry,
  listStagedKeys,
  DEFAULT_STAGING_TTL_SECONDS,
  DEFAULT_STAGING_PREFIX,
  D1_BATCH_MAX_STATEMENTS,
  type StagingEnv,
  type StagedPayload,
} from './kv-staging';

interface MockKvEntry {
  value: string;
  expirationTtl?: number;
}

interface MockD1Row {
  id: string;
  lane: string;
  direction: string;
  kind: string;
  reply_to: string | null;
  wire: string;
  plaintext: string;
  status: string;
  created_at: number;
}

interface MockStmt {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => MockStmt;
  run: () => Promise<{ success: boolean }>;
  all: () => Promise<{ results: unknown[] }>;
  first: () => Promise<unknown | null>;
}

function createMockStagingEnv(overrides: {
  throwOnKvPut?: boolean;
  throwOnKvGet?: boolean;
  throwOnKvList?: boolean;
  throwOnKvDelete?: boolean;
  throwOnD1Batch?: boolean;
  failOnBatchIndex?: number;
} = {}) {
  const kvStore = new Map<string, MockKvEntry>();
  const d1Rows: MockD1Row[] = [];
  const batchCalls: Array<Array<{ sql: string; args: unknown[] }>> = [];
  let batchCallCount = 0;

  const kv = {
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      if (overrides.throwOnKvPut) throw new Error('KV put storage fault: simulated disk I/O error');
      kvStore.set(key, { value, expirationTtl: options?.expirationTtl });
    },
    async get(key: string) {
      if (overrides.throwOnKvGet) throw new Error('KV get storage fault');
      const entry = kvStore.get(key);
      return entry ? entry.value : null;
    },
    async delete(key: string) {
      if (overrides.throwOnKvDelete) throw new Error('KV delete storage fault');
      kvStore.delete(key);
    },
    async list(options?: { prefix?: string; limit?: number }) {
      if (overrides.throwOnKvList) throw new Error('KV list storage fault: connection timeout');
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const matchingKeys: Array<{ name: string }> = [];
      for (const k of kvStore.keys()) {
        if (k.startsWith(prefix)) {
          matchingKeys.push({ name: k });
          if (matchingKeys.length >= limit) break;
        }
      }
      return {
        keys: matchingKeys,
        list_complete: true,
        cursor: '',
      };
    },
  } as unknown as KVNamespace;

  const mkStmt = (sql: string, args: unknown[] = []): MockStmt => ({
    sql,
    args,
    bind(...newArgs: unknown[]) {
      return mkStmt(sql, newArgs);
    },
    async run() {
      return { success: true };
    },
    async all() {
      return { results: d1Rows };
    },
    async first() {
      return d1Rows[0] ?? null;
    },
  });

  const db = {
    prepare(sql: string) {
      return mkStmt(sql);
    },
    async batch(stmts: MockStmt[]) {
      batchCallCount++;
      if (overrides.throwOnD1Batch) {
        throw new Error('D1_ERROR: stepping, database is locked (SQLITE_BUSY)');
      }
      if (typeof overrides.failOnBatchIndex === 'number' && batchCallCount === overrides.failOnBatchIndex) {
        throw new Error(`D1_ERROR: simulated failure on batch #${batchCallCount}`);
      }

      const recordedBatch: Array<{ sql: string; args: unknown[] }> = [];
      for (const s of stmts) {
        recordedBatch.push({ sql: s.sql, args: s.args });
        // Match the intent (an insert into this table), not the literal verb
        // phrasing — the statement carries an OR IGNORE conflict clause so a
        // replayed staging key is a no-op instead of a UNIQUE violation.
        if (/INSERT(\s+OR\s+\w+)?\s+INTO\s+elle_session_bus/i.test(s.sql)) {
          const [id, lane, direction, kind, reply_to, wire, plaintext, status, created_at] = s.args;
          d1Rows.push({
            id: String(id),
            lane: String(lane),
            direction: String(direction),
            kind: String(kind),
            reply_to: reply_to !== null && typeof reply_to !== 'undefined' ? String(reply_to) : null,
            wire: String(wire),
            plaintext: String(plaintext),
            status: String(status),
            created_at: Number(created_at),
          });
        }
      }
      batchCalls.push(recordedBatch);
      return stmts.map(() => ({ success: true }));
    },
  } as unknown as D1Database;

  const env: StagingEnv = {
    SESSIONS: kv,
    DB: db,
  };

  return { env, kvStore, d1Rows, batchCalls, kv, db };
}

describe('Stateless KV Staging Layer (src/kv-staging.ts)', () => {
  describe('stageEntry', () => {
    it('stages a payload into SESSIONS KV with default 5-minute TTL (300s)', async () => {
      const { env, kvStore } = createMockStagingEnv();
      const payload = {
        kind: 'result',
        wire: 'base64wiredata==',
        lane: 'primary',
        replyTo: 'req_001',
      };

      const res = await stageEntry(env, 'nonce-abc-123', payload);

      expect(res.ok).toBe(true);
      expect(res.key).toBe('staging:nonce-abc-123');

      const stored = kvStore.get('staging:nonce-abc-123');
      expect(stored).toBeDefined();
      expect(stored?.expirationTtl).toBe(DEFAULT_STAGING_TTL_SECONDS); // 300

      const parsed = JSON.parse(stored!.value) as StagedPayload;
      expect(parsed.id).toBe('nonce-abc-123');
      expect(parsed.key).toBe('staging:nonce-abc-123');
      expect(parsed.lane).toBe('primary');
      expect(parsed.kind).toBe('result');
      expect(parsed.wire).toBe('base64wiredata==');
      expect(parsed.replyTo).toBe('req_001');
      expect(parsed.direction).toBe('to_cloud');
      expect(parsed.status).toBe('done');
      expect(typeof parsed.staged_at).toBe('number');
      expect(typeof parsed.expires_at).toBe('number');
    });

    it('preserves existing prefix if key already starts with staging:', async () => {
      const { env, kvStore } = createMockStagingEnv();
      const res = await stageEntry(env, 'staging:already-prefixed', { data: 'test' });
      expect(res.ok).toBe(true);
      expect(res.key).toBe('staging:already-prefixed');
      expect(kvStore.has('staging:already-prefixed')).toBe(true);
      expect(kvStore.has('staging:staging:already-prefixed')).toBe(false);
    });

    it('honors custom ttlSeconds option', async () => {
      const { env, kvStore } = createMockStagingEnv();
      const res = await stageEntry(env, 'custom-ttl', { foo: 'bar' }, { ttlSeconds: 600 });
      expect(res.ok).toBe(true);
      const stored = kvStore.get('staging:custom-ttl');
      expect(stored?.expirationTtl).toBe(600);
    });

    it('honors custom prefix option', async () => {
      const { env, kvStore } = createMockStagingEnv();
      const res = await stageEntry(env, 'item1', { x: 1 }, { prefix: 'bus:stage:' });
      expect(res.ok).toBe(true);
      expect(res.key).toBe('bus:stage:item1');
      expect(kvStore.has('bus:stage:item1')).toBe(true);
    });

    it('handles primitive payload values (strings, numbers)', async () => {
      const { env, kvStore } = createMockStagingEnv();
      const resStr = await stageEntry(env, 'str-val', 'hello world');
      expect(resStr.ok).toBe(true);
      const stored = kvStore.get('staging:str-val');
      const parsed = JSON.parse(stored!.value) as StagedPayload;
      expect(parsed.data).toBe('hello world');
      expect(parsed.plaintext).toBe('hello world');
    });

    it('never throws on storage error and returns structured error object', async () => {
      const { env } = createMockStagingEnv({ throwOnKvPut: true });
      const res = await stageEntry(env, 'fail-key', { sample: 123 });
      expect(res.ok).toBe(false);
      expect(res.key).toBe('fail-key');
      expect(res.error).toContain('KV put storage fault');
    });

    it('never throws when env or SESSIONS is undefined or null', async () => {
      const resNull = await stageEntry(null, 'key', { data: 1 });
      expect(resNull.ok).toBe(false);
      expect(resNull.error).toContain('SESSIONS KV namespace is not configured');

      const resEmpty = await stageEntry({}, 'key', { data: 1 });
      expect(resEmpty.ok).toBe(false);
      expect(resEmpty.error).toContain('SESSIONS KV namespace is not configured');
    });

    it('never throws on invalid or empty keys', async () => {
      const { env } = createMockStagingEnv();
      const res = await stageEntry(env, '', { data: 1 });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Invalid key');
    });
  });

  describe('getStagedEntry and clearStagedEntry', () => {
    it('retrieves staged payload by key with getStagedEntry', async () => {
      const { env } = createMockStagingEnv();
      await stageEntry(env, 'entry-1', { message: 'hello', lane: 'sovereign' });

      const fetched = await getStagedEntry<{ message: string; lane: string }>(env, 'entry-1');
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe('entry-1');
      expect(fetched?.data?.message).toBe('hello');
      expect(fetched?.lane).toBe('sovereign');
    });

    it('getStagedEntry returns null for non-existent key or missing KV', async () => {
      const { env } = createMockStagingEnv();
      const nonExistent = await getStagedEntry(env, 'does-not-exist');
      expect(nonExistent).toBeNull();

      const missingKv = await getStagedEntry({}, 'any-key');
      expect(missingKv).toBeNull();
    });

    it('clearStagedEntry deletes staged entry and returns true', async () => {
      const { env, kvStore } = createMockStagingEnv();
      await stageEntry(env, 'to-delete', { temp: true });
      expect(kvStore.has('staging:to-delete')).toBe(true);

      const deleted = await clearStagedEntry(env, 'to-delete');
      expect(deleted).toBe(true);
      expect(kvStore.has('staging:to-delete')).toBe(false);
    });

    it('clearStagedEntry returns false when env is missing without throwing', async () => {
      const res = await clearStagedEntry(null, 'key');
      expect(res).toBe(false);
    });

    it('listStagedKeys lists all staged keys matching prefix', async () => {
      const { env } = createMockStagingEnv();
      await stageEntry(env, 'k1', { val: 1 });
      await stageEntry(env, 'k2', { val: 2 });
      await stageEntry(env, 'k3', { val: 3 });

      const keys = await listStagedKeys(env);
      expect(keys.sort()).toEqual(['staging:k1', 'staging:k2', 'staging:k3']);
    });
  });

  describe('flushStaged', () => {
    it('Stage -> flush -> D1 rows appear and KV keys are purged', async () => {
      const { env, kvStore, d1Rows } = createMockStagingEnv();

      // 1. Stage multiple items
      await stageEntry(env, 'nonce-1', {
        lane: 'primary',
        kind: 'tool_result',
        wire: 'wire_payload_1',
        replyTo: 'job_001',
      });
      await stageEntry(env, 'nonce-2', {
        lane: 'secondary',
        kind: 'telemetry',
        wire: 'wire_payload_2',
        replyTo: null,
      });

      expect(kvStore.size).toBe(2);
      expect(d1Rows.length).toBe(0);

      // 2. Flush staged items
      const flushRes = await flushStaged(env);

      expect(flushRes.status).toBe('ok');
      expect(flushRes.flushed).toBe(2);
      expect(flushRes.errors).toBe(0);

      // 3. Verify D1 rows appear
      expect(d1Rows.length).toBe(2);
      const row1 = d1Rows.find((r) => r.id === 'nonce-1');
      const row2 = d1Rows.find((r) => r.id === 'nonce-2');

      expect(row1).toBeDefined();
      expect(row1?.lane).toBe('primary');
      expect(row1?.kind).toBe('tool_result');
      expect(row1?.wire).toBe('wire_payload_1');
      expect(row1?.reply_to).toBe('job_001');
      expect(row1?.direction).toBe('to_cloud');
      expect(row1?.status).toBe('done');

      expect(row2).toBeDefined();
      expect(row2?.lane).toBe('secondary');
      expect(row2?.kind).toBe('telemetry');
      expect(row2?.wire).toBe('wire_payload_2');
      expect(row2?.reply_to).toBeNull();

      // 4. Verify KV keys are purged upon successful D1 commit
      expect(kvStore.size).toBe(0);
      expect(await getStagedEntry(env, 'nonce-1')).toBeNull();
      expect(await getStagedEntry(env, 'nonce-2')).toBeNull();
    });

    it('is idempotent on empty queue (returns flushed: 0, status: ok)', async () => {
      const { env, batchCalls } = createMockStagingEnv();

      const res = await flushStaged(env);

      expect(res).toMatchObject({
        flushed: 0,
        errors: 0,
        status: 'ok',
      });
      // Does not issue D1 batches when there are no items
      expect(batchCalls.length).toBe(0);
    });

    it('chunks D1 batch operations to <= 50 statements per batch', async () => {
      const { env, kvStore, d1Rows, batchCalls } = createMockStagingEnv();

      // Stage 125 items
      const totalItems = 125;
      for (let i = 0; i < totalItems; i++) {
        await stageEntry(env, `batch-item-${i.toString().padStart(3, '0')}`, {
          lane: 'primary',
          kind: 'batch_test',
          wire: `wire_${i}`,
        });
      }

      expect(kvStore.size).toBe(125);

      const flushRes = await flushStaged(env);

      expect(flushRes.status).toBe('ok');
      expect(flushRes.flushed).toBe(125);
      expect(flushRes.errors).toBe(0);

      // Verify batch chunking (125 items / max 50 = 3 batches: 50, 50, 25)
      expect(batchCalls.length).toBe(3);
      expect(batchCalls[0].length).toBe(50);
      expect(batchCalls[1].length).toBe(50);
      expect(batchCalls[2].length).toBe(25);

      // All batch calls strictly <= 50
      for (const batch of batchCalls) {
        expect(batch.length).toBeLessThanOrEqual(D1_BATCH_MAX_STATEMENTS);
      }

      // Verify all 125 rows persisted in D1 and all KV keys purged
      expect(d1Rows.length).toBe(125);
      expect(kvStore.size).toBe(0);
    });

    it('honors custom batchSize if smaller than 50', async () => {
      const { env, batchCalls } = createMockStagingEnv();

      for (let i = 0; i < 25; i++) {
        await stageEntry(env, `custom-batch-${i}`, { index: i });
      }

      const flushRes = await flushStaged(env, { batchSize: 10 });

      expect(flushRes.flushed).toBe(25);
      expect(batchCalls.length).toBe(3); // 10 + 10 + 5
      expect(batchCalls[0].length).toBe(10);
      expect(batchCalls[1].length).toBe(10);
      expect(batchCalls[2].length).toBe(5);
    });

    it('gracefully handles missing env, SESSIONS, or DB without throwing uncaught exceptions', async () => {
      const resNull = await flushStaged(null);
      expect(resNull.status).toBe('error');
      expect(resNull.flushed).toBe(0);
      expect(resNull.errors).toBe(1);
      expect(resNull.details).toBeDefined();

      const resNoDb = await flushStaged({ SESSIONS: {} as KVNamespace });
      expect(resNoDb.status).toBe('error');
      expect(resNoDb.errors).toBe(1);

      const resNoKv = await flushStaged({ DB: {} as D1Database });
      expect(resNoKv.status).toBe('error');
      expect(resNoKv.errors).toBe(1);
    });

    it('gracefully handles KV list failure without throwing', async () => {
      const { env } = createMockStagingEnv({ throwOnKvList: true });
      const res = await flushStaged(env);
      expect(res.status).toBe('error');
      expect(res.flushed).toBe(0);
      expect(res.errors).toBe(1);
      expect(res.details?.[0]).toContain('KV list operation failed');
    });

    it('gracefully handles D1 batch failure, retains KV keys for retry, and returns error status', async () => {
      const { env, kvStore, d1Rows } = createMockStagingEnv({ throwOnD1Batch: true });

      await stageEntry(env, 'd1-fail-1', { data: 'a' });
      await stageEntry(env, 'd1-fail-2', { data: 'b' });

      expect(kvStore.size).toBe(2);

      const res = await flushStaged(env);

      expect(res.status).toBe('error');
      expect(res.flushed).toBe(0);
      expect(res.errors).toBe(2);
      expect(res.details?.[0]).toContain('D1 batch write failed');

      // KV keys remain intact so they are NOT lost and can be retried on next flush
      expect(kvStore.size).toBe(2);
      expect(kvStore.has('staging:d1-fail-1')).toBe(true);
      expect(kvStore.has('staging:d1-fail-2')).toBe(true);
      expect(d1Rows.length).toBe(0);
    });

    it('handles partial batch failure (first chunk succeeds, second chunk fails)', async () => {
      // 30 items, batchSize 10 -> 3 chunks of 10. Fail on chunk 2.
      const { env, kvStore, d1Rows } = createMockStagingEnv({ failOnBatchIndex: 2 });

      for (let i = 0; i < 30; i++) {
        await stageEntry(env, `part-${i.toString().padStart(2, '0')}`, { index: i });
      }

      const res = await flushStaged(env, { batchSize: 10 });

      expect(res.status).toBe('partial');
      expect(res.flushed).toBe(20); // chunk 1 (10) + chunk 3 (10)
      expect(res.errors).toBe(10); // chunk 2 (10) failed
      expect(d1Rows.length).toBe(20);

      // Only failed keys remain in KV
      expect(kvStore.size).toBe(10);
    });
  });
});
