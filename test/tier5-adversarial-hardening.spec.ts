// ============================================================
// ELLE WORKER — test/tier5-adversarial-hardening.spec.ts
// Phase 2 Adversarial Coverage Hardening (Tier 5) Test Suite
//
// Comprehensive adversarial test harness covering:
//   1. Exact TTL Boundary Expirations (KV Staging & Ingest Lifecycle)
//   2. Non-String / Malformed Payloads (Protocols, Envelopes, Parser FSM)
//   3. Rapid Consecutive Drain Calls & High-Concurrency Race Conditions
//   4. Empty Batch Flushes & Broken Infrastructure Fail-Safe Invariants
//   5. Mixed Duplex / AST Multi-Step Turns & Dynamic Engine Handoffs
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../src/index';
import {
  stageEntry,
  getStagedEntry,
  clearStagedEntry,
  listStagedKeys,
  flushStaged,
  DEFAULT_STAGING_TTL_SECONDS,
  DEFAULT_STAGING_PREFIX,
  D1_BATCH_MAX_STATEMENTS as KV_BATCH_MAX,
} from '../src/kv-staging';
import {
  InMemoryIngestQueue,
  enqueue,
  drain,
  getQueueStats,
  resetQueue,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_QUEUE_DEPTH,
  D1_BATCH_MAX_STATEMENTS as QUEUE_BATCH_MAX,
} from '../src/ingest-queue';
import {
  classifyEngineSelection,
  isLocalLaneAvailable,
  runRouter,
  type RouterDeps,
  type RouterLiveEvent,
  type Scope,
  type Engine,
} from '../src/router';
import {
  firstJsonObjectFrom,
  sanitizeAnswer,
  stripObservationScaffolding,
} from '../src/llm';
import { normalizeTitle, structuralReason, type PaperInput } from '../src/ingest-gate';

// ── Mock Helpers ────────────────────────────────────────────

function createMockKv() {
  const store = new Map<string, { value: string; expirationTtl?: number; createdAt: number }>();
  return {
    _store: store,
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expirationTtl && Date.now() > entry.createdAt + entry.expirationTtl * 1000) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, expirationTtl: opts?.expirationTtl, createdAt: Date.now() });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async (opts?: { prefix?: string; limit?: number }) => {
      const prefix = opts?.prefix ?? '';
      const now = Date.now();
      const keys: Array<{ name: string }> = [];
      for (const [name, entry] of store.entries()) {
        if (name.startsWith(prefix)) {
          if (!entry.expirationTtl || now <= entry.createdAt + entry.expirationTtl * 1000) {
            keys.push({ name });
          }
        }
      }
      return { keys: keys.slice(0, opts?.limit ?? 1000) };
    }),
  };
}

function createMockDb(opts: { slowMs?: number; failOnBatch?: boolean } = {}) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    _executed: executed,
    prepare: vi.fn((sql: string) => {
      let bound: unknown[] = [];
      return {
        _sql: sql,
        _params: bound,
        bind: vi.fn((...params: unknown[]) => {
          bound = params;
          return {
            _sql: sql,
            _params: bound,
            run: vi.fn(async () => {
              executed.push({ sql, params: bound });
              return { success: true, meta: { changes: 1 } };
            }),
            all: vi.fn(async () => ({ results: [] })),
            first: vi.fn(async () => null),
          };
        }),
      };
    }),
    batch: vi.fn(async (stmts: Array<{ _sql: string; _params: unknown[] }>) => {
      if (opts.slowMs) {
        await new Promise((r) => setTimeout(r, opts.slowMs));
      }
      if (opts.failOnBatch) {
        throw new Error('D1 transaction abort error: simulated database failure');
      }
      for (const s of stmts) {
        executed.push({ sql: s._sql, params: s._params });
      }
      return stmts.map(() => ({ success: true }));
    }),
  };
}

function makeDeps(overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    embed: vi.fn(async () => [0.1, 0.2, 0.3]),
    ragSearch: vi.fn(async () => 'corpus search result'),
    recallPastConversations: vi.fn(async () => ''),
    handleCodeEngine: vi.fn(async () => new Response(JSON.stringify({ response: 'ok' }))),
    handleIngest: vi.fn(async () => new Response('{}')),
    handleDiagnose: vi.fn(async () => new Response('{}')),
    handleResearch: vi.fn(async () => new Response(JSON.stringify({ content: 'research text', search_results: '' }))),
    runLibreMode: vi.fn(async () => {}),
    journalWrite: vi.fn(async () => ({})),
    journalRead: vi.fn(async () => ({})),
    journalThread: vi.fn(async () => ({})),
    journalAnnotate: vi.fn(async () => ({})),
    ...overrides,
  };
}

function geminiResponse(obj: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] };
}

function geminiRaw(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function stubFetch(routes: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  const fn = vi.fn(async (url: string) => {
    const match = Object.keys(routes).find((m) => String(url).includes(m));
    if (!match) throw new Error(`unrouted fetch: ${url}`);
    const queue = routes[match];
    const i = counters[match] ?? 0;
    counters[match] = i + 1;
    const json = queue[Math.min(i, queue.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => (typeof json === 'string' ? json : JSON.stringify(json)),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ============================================================
// SUITE 1: EXACT TTL BOUNDARY EXPIRATIONS
// ============================================================
describe('Suite 1: Exact TTL Boundary Expirations', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as unknown as KVNamespace,
      SCRATCHPAD: mockKv as unknown as KVNamespace,
      DB: mockDb as unknown as D1Database,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
    resetQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetQueue();
  });

  it('1.1: stageEntry uses default 300s TTL when ttlSeconds is 0, negative, or undefined', async () => {
    const res1 = await stageEntry(env, 'k_def', { val: 1 });
    expect(res1.ok).toBe(true);
    expect(mockKv.put).toHaveBeenCalledWith(
      'staging:k_def',
      expect.any(String),
      { expirationTtl: 300 }
    );

    const res2 = await stageEntry(env, 'k_zero', { val: 2 }, { ttlSeconds: 0 });
    expect(res2.ok).toBe(true);
    expect(mockKv.put).toHaveBeenCalledWith(
      'staging:k_zero',
      expect.any(String),
      { expirationTtl: 300 }
    );

    const res3 = await stageEntry(env, 'k_neg', { val: 3 }, { ttlSeconds: -60 });
    expect(res3.ok).toBe(true);
    expect(mockKv.put).toHaveBeenCalledWith(
      'staging:k_neg',
      expect.any(String),
      { expirationTtl: 300 }
    );
  });

  it('1.2: stageEntry supports custom ttl option aliases (ttl vs ttlSeconds) with exact boundaries', async () => {
    await stageEntry(env, 'k_ttl_1s', { val: 1 }, { ttlSeconds: 1 });
    expect(mockKv.put).toHaveBeenCalledWith(
      'staging:k_ttl_1s',
      expect.any(String),
      { expirationTtl: 1 }
    );

    await stageEntry(env, 'k_ttl_alias', { val: 2 }, { ttl: 600 });
    expect(mockKv.put).toHaveBeenCalledWith(
      'staging:k_ttl_alias',
      expect.any(String),
      { expirationTtl: 600 }
    );

    // Non-numeric or NaN ttl falls back safely to 300
    await stageEntry(env, 'k_ttl_nan', { val: 3 }, { ttlSeconds: NaN });
    expect(mockKv.put).toHaveBeenCalledWith(
      'staging:k_ttl_nan',
      expect.any(String),
      { expirationTtl: 300 }
    );
  });

  it('1.3: payload.expires_at matches staged_at + ttlSeconds * 1000 to exact millisecond', async () => {
    const t0 = Date.now();
    await stageEntry(env, 'k_exact', { data: 'precise' }, { ttlSeconds: 120 });
    const stored = await getStagedEntry(env, 'k_exact');

    expect(stored).not.toBeNull();
    expect(stored!.staged_at).toBeGreaterThanOrEqual(t0);
    expect(stored!.expires_at).toBe(stored!.staged_at + 120 * 1000);
  });

  it('1.4: getStagedEntry returns null when entry expires at TTL boundary', async () => {
    await stageEntry(env, 'k_short', { data: 'ephemeral' }, { ttlSeconds: 1 });

    // Staged item is present immediately
    const immediate = await getStagedEntry(env, 'k_short');
    expect(immediate).not.toBeNull();
    expect(immediate!.data).toBe('ephemeral');

    // Fast-forward time past 1s TTL expiration
    const entry = mockKv._store.get('staging:k_short');
    if (entry) {
      entry.createdAt = Date.now() - 2000; // simulated 2 seconds ago
    }

    const expired = await getStagedEntry(env, 'k_short');
    expect(expired).toBeNull();
  });

  it('1.5: flushStaged handles list-to-get expiration race condition without crashing', async () => {
    // Stage 3 items
    await stageEntry(env, 'live_1', { task: 'alive' }, { ttlSeconds: 300 });
    await stageEntry(env, 'dying_2', { task: 'expiring' }, { ttlSeconds: 1 });
    await stageEntry(env, 'live_3', { task: 'alive' }, { ttlSeconds: 300 });

    // Simulate dying_2 expiring in KV right after list() returns it
    const dyingEntry = mockKv._store.get('staging:dying_2');
    if (dyingEntry) {
      dyingEntry.createdAt = Date.now() - 5000; // expired
    }

    const res = await flushStaged(env);
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(2);
    expect(res.errors).toBe(0);
    expect(res.status).toBe('ok');

    // Live entries were written to D1 (after DDL schema init) and purged from KV
    expect(await getStagedEntry(env, 'live_1')).toBeNull();
    expect(await getStagedEntry(env, 'live_3')).toBeNull();
  });

  it('1.6: flushStaged handles scenario where ALL staged keys expired before get()', async () => {
    await stageEntry(env, 'exp_1', { a: 1 }, { ttlSeconds: 1 });
    await stageEntry(env, 'exp_2', { a: 2 }, { ttlSeconds: 1 });

    // Expire all in store
    for (const [, v] of mockKv._store) {
      v.createdAt = Date.now() - 5000;
    }

    const res = await flushStaged(env);
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(0);
    expect(res.errors).toBe(0);
    expect(res.status).toBe('ok');
  });

  it('1.7: clearStagedEntry on expired key returns true without throwing', async () => {
    await stageEntry(env, 'exp_del', { data: 'test' }, { ttlSeconds: 1 });
    const entry = mockKv._store.get('staging:exp_del');
    if (entry) entry.createdAt = Date.now() - 5000;

    const cleared = await clearStagedEntry(env, 'exp_del');
    expect(cleared).toBe(true);
  });
});

// ============================================================
// SUITE 2: NON-STRING & MALFORMED PAYLOADS
// ============================================================
describe('Suite 2: Non-String & Malformed Payloads', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as unknown as KVNamespace,
      SCRATCHPAD: mockKv as unknown as KVNamespace,
      DB: mockDb as unknown as D1Database,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
    resetQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetQueue();
  });

  it('2.1: stageEntry rejects empty/non-string keys and handles special character keys safely', async () => {
    // Non-string key rejected cleanly
    const res1 = await stageEntry(env, 12345 as unknown as string, { data: 'number key' });
    expect(res1.ok).toBe(false);
    expect(res1.error).toContain('Invalid key');

    // Empty string key rejected cleanly
    const res2 = await stageEntry(env, '', { data: 'empty' });
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('Invalid key');

    // Key with path traversal / special characters stored safely
    const res3 = await stageEntry(env, '../../etc/passwd', { data: 'traversal' });
    expect(res3.ok).toBe(true);
    expect(res3.key).toBe('staging:../../etc/passwd');
  });

  it('2.2: stageEntry handles non-string primitive payloads (numbers, booleans, arrays, null)', async () => {
    // Primitive number
    const r1 = await stageEntry(env, 'num_payload', 42);
    expect(r1.ok).toBe(true);
    const s1 = await getStagedEntry<number>(env, 'num_payload');
    expect(s1!.data).toBe(42);
    expect(s1!.plaintext).toBe('42');

    // Primitive boolean
    const r2 = await stageEntry(env, 'bool_payload', true);
    expect(r2.ok).toBe(true);
    const s2 = await getStagedEntry<boolean>(env, 'bool_payload');
    expect(s2!.data).toBe(true);
    expect(s2!.plaintext).toBe('true');

    // Array payload
    const r3 = await stageEntry(env, 'arr_payload', [1, 'two', { three: 3 }]);
    expect(r3.ok).toBe(true);
    const s3 = await getStagedEntry<unknown[]>(env, 'arr_payload');
    expect(s3!.data).toEqual([1, 'two', { three: 3 }]);
    expect(s3!.plaintext).toBe(JSON.stringify([1, 'two', { three: 3 }]));

    // Null payload
    const r4 = await stageEntry(env, 'null_payload', null);
    expect(r4.ok).toBe(true);
    const s4 = await getStagedEntry(env, 'null_payload');
    expect(s4!.data).toBeNull();
  });

  it('2.3: flushStaged isolates corrupted/unparseable JSON in KV without crashing whole flush', async () => {
    // Stage 1 valid entry
    await stageEntry(env, 'valid_1', { data: 'valid' });

    // Inject corrupted JSON directly into KV store
    mockKv._store.set('staging:corrupted_raw', {
      value: '{ unclosed json syntax: [1, 2, }',
      createdAt: Date.now(),
      expirationTtl: 300,
    });

    // Stage another valid entry
    await stageEntry(env, 'valid_2', { data: 'valid2' });

    const res = await flushStaged(env);
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(2);
    expect(res.errors).toBe(1);
    expect(res.status).toBe('partial');
    expect(res.details).toBeDefined();
    expect(res.details![0]).toContain('Failed to read/parse key');
  });

  it('2.4: InMemoryIngestQueue.enqueue rejects malformed PaperInput via structuralReason', async () => {
    const queue = new InMemoryIngestQueue();

    // Missing / non-string title
    const res1 = await queue.enqueue(env, { title: 12345, abstract: 'test' });
    expect(res1.ok).toBe(false);
    expect(res1.status).toBe('rejected');
    expect(res1.error).toContain('Structural validation failed');

    // Empty title
    const res2 = await queue.enqueue(env, { title: '   ', abstract: 'test' });
    expect(res2.ok).toBe(false);
    expect(res2.status).toBe('rejected');

    // Valid PaperInput with series, tag, and 50+ words of text accepted
    const validProse = Array.from({ length: 60 }, (_, i) => `term${i} analyzes rigorous post-quantum cryptographic lattice properties`).join(' ');
    const res3 = await queue.enqueue(
      env,
      { title: 'Valid Research Paper on PQC', series: 'research', tag: 'cryptography', text: validProse },
      { autoFlush: false }
    );
    expect(res3.ok).toBe(true);
    expect(res3.status).toBe('queued');
  });

  it('2.5: InMemoryIngestQueue deduplicates with non-string idempotencyKey / dedupKey', async () => {
    const queue = new InMemoryIngestQueue({ dedup: true });

    // Enqueue with string idempotencyKey
    const r1 = await queue.enqueue(env, { task: 'compute' }, { idempotencyKey: 'idemp_01', autoFlush: false });
    expect(r1.ok).toBe(true);
    expect(r1.status).toBe('queued');

    // Duplicate idempotencyKey dropped
    const r2 = await queue.enqueue(env, { task: 'compute' }, { idempotencyKey: 'idemp_01', autoFlush: false });
    expect(r2.ok).toBe(true);
    expect(r2.status).toBe('dedup_dropped');
    expect(r2.duplicate).toBe(true);
    expect(queue.getDepth()).toBe(1);

    // Non-string idempotencyKey ignored (does not crash dedup logic)
    const r3 = await queue.enqueue(env, { task: 'diff', idempotencyKey: 9999 as unknown as string }, { autoFlush: false });
    expect(r3.ok).toBe(true);
    expect(r3.status).toBe('queued');
  });

  it('2.6: classifyEngineSelection is resilient against non-string/malformed query inputs', () => {
    expect(classifyEngineSelection(null as unknown as string)).toBe('reasoning');
    expect(classifyEngineSelection(undefined as unknown as string)).toBe('reasoning');
    expect(classifyEngineSelection(12345 as unknown as string)).toBe('reasoning');
    expect(classifyEngineSelection({ query: 'write code' } as unknown as string)).toBe('reasoning');
    expect(classifyEngineSelection([1, 2, 3] as unknown as string)).toBe('reasoning');
    expect(classifyEngineSelection(NaN as unknown as string)).toBe('reasoning');

    // 1MB string input handled without stack overflow or regex freeze
    const largeStr = 'search the web '.repeat(50000);
    expect(classifyEngineSelection(largeStr)).toBe('research');
  });

  it('2.7: firstJsonObjectFrom parses complex, escaped, nested, and adversarial JSON outputs', () => {
    // Escaped quotes containing braces
    const raw1 = '{"thought": "evaluating", "msg": "brace { inside \\"escaped\\" string }"}';
    const parsed1 = firstJsonObjectFrom(raw1);
    expect(parsed1).toEqual({ thought: 'evaluating', msg: 'brace { inside "escaped" string }' });

    // Markdown fence with leading and trailing chatter
    const raw2 = 'Here is your tool call:\n```json\n{"tool": "rapid_costs", "args": {"limit": 10}}\n```\nLet me know if you need more.';
    const parsed2 = firstJsonObjectFrom(raw2);
    expect(parsed2).toEqual({ tool: 'rapid_costs', args: { limit: 10 } });

    // Truncated/unbalanced JSON returns null
    const raw3 = '{"tool": "rapid_costs", "args": {"limit": ';
    expect(firstJsonObjectFrom(raw3)).toBeNull();

    // Deeply nested JSON (depth 10)
    const raw4 = '{"a": {"b": {"c": {"d": {"e": {"f": "deep"}}}}}}';
    const parsed4 = firstJsonObjectFrom(raw4);
    expect(parsed4).toEqual({ a: { b: { c: { d: { e: { f: 'deep' } } } } } });

    // Non-string or null input
    expect(firstJsonObjectFrom(null)).toBeNull();
    expect(firstJsonObjectFrom(undefined)).toBeNull();
    expect(firstJsonObjectFrom(12345)).toBeNull();
  });

  it('2.8: sanitizeAnswer strips protocol plumbing, markdown fences, and servile preambles', () => {
    // Pure plumbing JSON suppressed
    expect(sanitizeAnswer('{"tool": "rapid_costs", "args": {}}')).toBe('');
    expect(sanitizeAnswer('{"thought": "internal plumbing only"}')).toBe('');

    // Inner answer extraction from JSON envelope
    expect(sanitizeAnswer('{"answer": "Total variance is 4.2% across 12 SKUs."}')).toBe(
      'Total variance is 4.2% across 12 SKUs.'
    );

    // Strips servile openers
    expect(sanitizeAnswer('Certainly! The report shows positive margin growth.')).toBe(
      'The report shows positive margin growth.'
    );
    expect(sanitizeAnswer("Sure, here is what I found: Everything looks good.")).toBe(
      'Here is what I found: Everything looks good.'
    );

    // Strips observation paging scaffolding
    const scaffolded = 'Here is the summary:\n[page pg_123 · chars 0–2800 of 14000]\n---\nData rows...';
    expect(stripObservationScaffolding(scaffolded)).not.toContain('[page pg_123');
    expect(stripObservationScaffolding(scaffolded)).not.toContain('---');
  });
});

// ============================================================
// SUITE 3: RAPID CONSECUTIVE DRAIN CALLS & CONCURRENCY
// ============================================================
describe('Suite 3: Rapid Consecutive Drain Calls & Concurrency', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb({ slowMs: 5 }); // 5ms simulated DB latency
    env = {
      SESSIONS: mockKv as unknown as KVNamespace,
      SCRATCHPAD: mockKv as unknown as KVNamespace,
      DB: mockDb as unknown as D1Database,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
    resetQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetQueue();
  });

  it('3.1: concurrent drain calls are mutually exclusive (no double inserts)', async () => {
    const queue = new InMemoryIngestQueue({ maxDepth: 100 });

    // Enqueue 30 items without autoFlush
    for (let i = 0; i < 30; i++) {
      await queue.enqueue(env, { item: i, hash: `h_${i}` }, { autoFlush: false });
    }
    expect(queue.getDepth()).toBe(30);

    // Fire 10 simultaneous drain calls concurrently
    const results = await Promise.all([
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
      queue.drain(env),
    ]);

    // Exactly one call should have flushed the 30 items
    const flushedCounts = results.map((r) => r.flushed);
    const totalFlushed = flushedCounts.reduce((a, b) => a + b, 0);
    expect(totalFlushed).toBe(30);

    // Exactly 30 rows written to DB
    expect(mockDb._executed.length).toBe(30);
    expect(queue.getDepth()).toBe(0);

    // Stats reflect 30 enqueued, 30 flushed
    const stats = queue.getStats();
    expect(stats.totalEnqueued).toBe(30);
    expect(stats.totalFlushed).toBe(30);
    expect(stats.totalRejected).toBe(0);
  });

  it('3.2: rapid consecutive sequential drain calls return empty gracefully', async () => {
    const queue = new InMemoryIngestQueue();

    await queue.enqueue(env, { id: 'single_item' }, { autoFlush: false });

    // First drain flushes 1 item
    const first = await queue.drain(env);
    expect(first.ok).toBe(true);
    expect(first.flushed).toBe(1);
    expect(first.status).toBe('ok');

    // 20 subsequent rapid drains return status 'empty' with flushed: 0
    for (let i = 0; i < 20; i++) {
      const subsequent = await queue.drain(env);
      expect(subsequent.ok).toBe(true);
      expect(subsequent.flushed).toBe(0);
      expect(subsequent.status).toBe('empty');
    }

    expect(mockDb._executed.length).toBe(1);
  });

  it('3.3: enqueuing items while drain is in-flight safely includes them or buffers for next drain', async () => {
    const queue = new InMemoryIngestQueue({ maxDepth: 100 });

    // Stage initial 5 items
    for (let i = 0; i < 5; i++) {
      await queue.enqueue(env, { initial: i }, { autoFlush: false });
    }

    // Start draining (with 10ms slow DB)
    const drainPromise = queue.drain(env);

    // While draining, enqueue 5 more items
    await queue.enqueue(env, { midFlight: 1 }, { autoFlush: false });
    await queue.enqueue(env, { midFlight: 2 }, { autoFlush: false });

    const drainRes = await drainPromise;
    expect(drainRes.ok).toBe(true);

    // Clean up any remaining buffered items
    if (queue.getDepth() > 0) {
      const secondDrain = await queue.drain(env);
      expect(secondDrain.ok).toBe(true);
    }

    expect(mockDb._executed.length).toBe(7);
    expect(queue.getDepth()).toBe(0);
  });

  it('3.4: back-pressure limiter strictly rejects excess items beyond maxDepth (100) under concurrent burst', async () => {
    const queue = new InMemoryIngestQueue({ maxDepth: 100 });

    // Concurrently enqueue 150 items
    const promises: Array<Promise<any>> = [];
    for (let i = 0; i < 150; i++) {
      promises.push(queue.enqueue(env, { burstId: i }, { autoFlush: false }));
    }

    const results = await Promise.all(promises);
    const accepted = results.filter((r) => r.ok && r.status === 'queued');
    const rejected = results.filter((r) => !r.ok && r.status === 'rejected');

    expect(accepted.length).toBe(100);
    expect(rejected.length).toBe(50);
    expect(queue.getDepth()).toBe(100);

    for (const rej of rejected) {
      expect(rej.error).toContain('Queue capacity exceeded');
      expect(rej.queueDepth).toBe(100);
    }

    const stats = queue.getStats();
    expect(stats.totalEnqueued).toBe(100);
    expect(stats.totalRejected).toBe(50);
  });

  it('3.5: D1 batch chunking splits large queues (e.g. 125 items) into chunks <= 50 statements', async () => {
    const queue = new InMemoryIngestQueue({ maxDepth: 200, batchSize: 50 });

    for (let i = 0; i < 125; i++) {
      await queue.enqueue(env, { itemIndex: i }, { autoFlush: false });
    }
    expect(queue.getDepth()).toBe(125);

    const res = await queue.drain(env, { batchSize: 50 });
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(125);
    expect(res.batchesProcessed).toBe(3); // 50 + 50 + 25
    expect(mockDb.batch).toHaveBeenCalledTimes(3);
    expect(queue.getDepth()).toBe(0);
  });

  it('3.6: D1 batch write failure halts drain and preserves remaining items in queue for retry', async () => {
    const failingDb = createMockDb({ failOnBatch: true });
    const failingEnv = { ...env, DB: failingDb as unknown as D1Database };

    const queue = new InMemoryIngestQueue();
    await queue.enqueue(failingEnv, { test: 'retryable' }, { autoFlush: false });
    expect(queue.getDepth()).toBe(1);

    const res = await queue.drain(failingEnv);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('error');
    expect(res.error).toContain('simulated database failure');

    // Item was preserved in queue
    expect(queue.getDepth()).toBe(1);

    // Successful retry when DB recovers
    const recoveredRes = await queue.drain(env);
    expect(recoveredRes.ok).toBe(true);
    expect(recoveredRes.flushed).toBe(1);
    expect(queue.getDepth()).toBe(0);
  });
});

// ============================================================
// SUITE 4: EMPTY BATCH FLUSHES & FAIL-SAFE INVARIANTS
// ============================================================
describe('Suite 4: Empty Batch Flushes & Fail-Safe Invariants', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as unknown as KVNamespace,
      SCRATCHPAD: mockKv as unknown as KVNamespace,
      DB: mockDb as unknown as D1Database,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
    resetQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetQueue();
  });

  it('4.1: flushStaged on completely empty KV store returns ok without DB interaction', async () => {
    const res = await flushStaged(env);
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(0);
    expect(res.errors).toBe(0);
    expect(res.status).toBe('ok');
    expect(res.flushedCount).toBe(0);
    expect(res.stagedKeysPurged).toBe(0);
    expect(mockDb.batch).not.toHaveBeenCalled();
  });

  it('4.2: flushStaged with custom prefix matching zero items returns ok', async () => {
    await stageEntry(env, 'custom_1', { data: 'test' }, { prefix: 'staging:' });
    const res = await flushStaged(env, { prefix: 'nonexistent_prefix:' });
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(0);
    expect(res.status).toBe('ok');
  });

  it('4.3: flushStaged gracefully handles missing or undefined env/KV/DB bindings', async () => {
    // Null env
    const r1 = await flushStaged(null);
    expect(r1.ok).toBe(false);
    expect(r1.status).toBe('error');
    expect(r1.details![0]).toContain('missing or unconfigured');

    // Missing SESSIONS KV
    const r2 = await flushStaged({ DB: mockDb as unknown as D1Database } as unknown as Env);
    expect(r2.ok).toBe(false);
    expect(r2.status).toBe('error');

    // Missing DB
    const r3 = await flushStaged({ SESSIONS: mockKv as unknown as KVNamespace } as unknown as Env);
    expect(r3.ok).toBe(false);
    expect(r3.status).toBe('error');
  });

  it('4.4: stageEntry and getStagedEntry handle missing KV gracefully without throwing', async () => {
    const brokenEnv = {} as unknown as Env;

    const stageRes = await stageEntry(brokenEnv, 'key', { a: 1 });
    expect(stageRes.ok).toBe(false);
    expect(stageRes.error).toContain('SESSIONS KV namespace is not configured');

    const getRes = await getStagedEntry(brokenEnv, 'key');
    expect(getRes).toBeNull();

    const clearRes = await clearStagedEntry(brokenEnv, 'key');
    expect(clearRes).toBe(false);

    const listRes = await listStagedKeys(brokenEnv);
    expect(listRes).toEqual([]);
  });

  it('4.5: InMemoryIngestQueue.drain on empty queue returns status empty without DB access', async () => {
    const queue = new InMemoryIngestQueue();
    const res = await queue.drain(env);
    expect(res.ok).toBe(true);
    expect(res.flushed).toBe(0);
    expect(res.errors).toBe(0);
    expect(res.status).toBe('empty');
    expect(mockDb.batch).not.toHaveBeenCalled();
  });

  it('4.6: InMemoryIngestQueue.drain handles broken DB binding gracefully', async () => {
    const queue = new InMemoryIngestQueue();
    await queue.enqueue(null, { item: 1 }, { autoFlush: false });

    const res = await queue.drain(null);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('error');
    expect(res.error).toContain('DB binding missing or invalid');
  });
});

// ============================================================
// SUITE 5: MIXED DUPLEX / AST MULTI-STEP TURNS & ROUTER RE-ROUTING
// ============================================================
describe('Suite 5: Mixed Duplex / AST Multi-Step Turns', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as unknown as KVNamespace,
      SCRATCHPAD: mockKv as unknown as KVNamespace,
      DB: mockDb as unknown as D1Database,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
    resetQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetQueue();
  });

  it('5.1: classifyEngineSelection routes AST refactoring & duplex tasks to local sovereign when available', () => {
    const localEnv = {
      ...env,
      SANDBOX_AGENT_KEY: 'pqc-local-key',
    } as unknown as Env;

    expect(isLocalLaneAvailable(localEnv)).toBe(true);

    // AST Refactoring
    expect(classifyEngineSelection('Perform structural AST refactoring of src/router.ts using Tree-sitter', 'full', undefined, localEnv)).toBe('local');

    // Continuous Duplex Dialogue
    expect(classifyEngineSelection('Establish continuous duplex dialogue session with live audio stream', 'full', undefined, localEnv)).toBe('local');

    // Iterative Code Authoring
    expect(classifyEngineSelection('Write code and author unit tests in local docker sandbox', 'full', undefined, localEnv)).toBe('local');
  });

  it('5.2: classifyEngineSelection demotes to reasoning when local sandbox lane is offline', () => {
    const offlineEnv = {
      ...env,
      // No SANDBOX_AGENT_KEY
    } as unknown as Env;

    // AST refactor demotes to reasoning
    expect(classifyEngineSelection('Refactor AST syntax tree with Tree-sitter', 'full', undefined, offlineEnv)).toBe('reasoning');

    // Duplex dialogue demotes to reasoning
    expect(classifyEngineSelection('Start continuous duplex voice session', 'full', undefined, offlineEnv)).toBe('reasoning');

    // Explicit prefer: 'local' demotes to reasoning
    expect(classifyEngineSelection('Any general query', 'full', { prefer: 'local' }, offlineEnv)).toBe('reasoning');
  });

  it('5.3: runRouter executes multi-step turn with dynamic tool dispatch & scope ceiling enforcement', async () => {
    stubFetch({
      'generativelanguage.googleapis.com': [
        // Step 0: Model calls calc tool
        geminiResponse({
          thought: 'Checking recent invoices for cost variance.',
          tool: 'calc',
          args: { expression: '12.50 * 4' },
        }),
        // Step 1: Model provides final answer
        geminiResponse({
          thought: 'Calculation complete.',
          answer: 'Total calculated cost is $50.00 across 4 units.',
        }),
      ],
    });

    const events: RouterLiveEvent[] = [];
    const deps = makeDeps();

    const result = await runRouter(
      'What is the cost of 4 units at $12.50?',
      env,
      deps,
      { scope: 'full', onEvent: (ev) => events.push(ev) }
    );

    expect(result.answer).toContain('$50.00');
    expect(result.steps).toBe(1);
    expect(result.trace.length).toBe(1);
    expect(result.trace[0].tool).toBe('calc');
    expect(result.trace[0].result).toBe('50');

    // Events emitted sequentially
    expect(events.some((e) => e.kind === 'run_start')).toBe(true);
    expect(events.some((e) => e.kind === 'step')).toBe(true);
    expect(events.some((e) => e.kind === 'obs')).toBe(true);
  });

  it('5.4: runRouter handles no-tool sentinels ("none", "null", "noop") without burning steps', async () => {
    stubFetch({
      'generativelanguage.googleapis.com': [
        // Step 0: Model emits pseudotool "none"
        geminiResponse({
          thought: 'No tools needed for this greeting.',
          tool: 'none',
          args: { reason: 'simple greeting' },
        }),
        // Step 1: Nudged model replies with answer
        geminiResponse({
          thought: 'Replying in voice.',
          answer: 'Hello Stewart, how can I assist you today?',
        }),
      ],
    });

    const deps = makeDeps();
    const result = await runRouter('Hello Elle', env, deps, { scope: 'full' });

    expect(result.answer).toContain('Hello Stewart');
    // Trace has 0 actual tool executions because "none" was handled as a nudge
    expect(result.trace.length).toBe(0);
  });

  it('5.5: runRouter enforces unprivileged step ceiling (10) vs privileged (25)', async () => {
    stubFetch({
      'generativelanguage.googleapis.com': Array(30).fill(
        geminiResponse({
          thought: 'Continuing search loop...',
          tool: 'calc',
          args: { expression: '1 + 1' },
        })
      ),
    });

    const deps = makeDeps();

    // Unprivileged scope requesting 50 steps gets clamped to 10
    const unprivResult = await runRouter('Looping search', env, deps, { scope: 'hospitality', maxSteps: 50 });
    expect(unprivResult.steps).toBeLessThanOrEqual(10);

    // Privileged scope requesting 50 steps gets clamped to 25
    const privResult = await runRouter('Looping search', env, deps, { scope: 'full', maxSteps: 50 });
    expect(privResult.steps).toBeLessThanOrEqual(25);
  });

  it('5.6: runRouter forced synthesis fallback extracts last tool observation when budget exhausts', async () => {
    stubFetch({
      'generativelanguage.googleapis.com': [
        // Step 0: Tool execution
        geminiResponse({
          thought: 'Executing data lookup',
          tool: 'calc',
          args: { expression: '100 * 0.15' },
        }),
        // Forced synthesis call returns broken json starting with '{'
        geminiRaw('{ unclosed broken json object: ['),
      ],
    });

    const deps = makeDeps();
    const result = await runRouter('Calculate 15% of 100', env, deps, { scope: 'full', maxSteps: 1 });

    expect(result.answer).toContain('calc');
    expect(result.answer).toContain('15');
  });

  it('5.7: End-to-End Pipeline: Staging -> Ingest Queue -> Deduplication -> D1 Persistence', async () => {
    // 1. Stage items into KV staging layer
    const s1 = await stageEntry(env, 'ast_task_01', { ast: 'tree_sitter_node', lane: 'sovereign' });
    const s2 = await stageEntry(env, 'ast_task_02', { ast: 'tree_sitter_node_2', lane: 'sovereign' });
    expect(s1.ok && s2.ok).toBe(true);

    // 2. Enqueue via Ingest Queue with dedup enabled
    const q1 = await enqueue(env, { stagedKey: s1.stageKey, task: 'AST Task 1' }, { idempotencyKey: 'task_01', autoFlush: false });
    const q2 = await enqueue(env, { stagedKey: s2.stageKey, task: 'AST Task 2' }, { idempotencyKey: 'task_02', autoFlush: false });
    const qDuplicate = await enqueue(env, { stagedKey: s1.stageKey, task: 'AST Task 1' }, { idempotencyKey: 'task_01', autoFlush: false });

    expect(q1.ok && q2.ok).toBe(true);
    expect(qDuplicate.duplicate).toBe(true);
    expect(qDuplicate.status).toBe('dedup_dropped');

    // 3. Drain ingest queue into D1
    const drainRes = await drain(env);
    expect(drainRes.ok).toBe(true);
    expect(drainRes.flushed).toBe(2);

    // 4. Flush staged KV buffer into D1
    const flushRes = await flushStaged(env);
    expect(flushRes.ok).toBe(true);
    expect(flushRes.flushed).toBe(2);

    // 5. Staged keys purged from KV
    expect(await getStagedEntry(env, 'ast_task_01')).toBeNull();
    expect(await getStagedEntry(env, 'ast_task_02')).toBeNull();
  });
});
