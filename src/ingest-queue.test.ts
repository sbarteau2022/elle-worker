// ============================================================
// ELLE WORKER — src/ingest-queue.test.ts
// Comprehensive Unit Tests for INGEST_QUEUE Batching (Requirement R3)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from './index';
import {
  enqueue,
  drain,
  getQueueStats,
  resetQueue,
  InMemoryIngestQueue,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FLUSH_WINDOW_MS,
  DEFAULT_MAX_QUEUE_DEPTH,
  D1_BATCH_MAX_STATEMENTS,
  type IngestQueueEnv,
} from './ingest-queue';

function createMockDb() {
  const executed: Array<{ sql: string; params: any[] }> = [];
  let shouldFail = false;
  let failAfterBatches = -1;
  let batchCount = 0;

  return {
    _executed: executed,
    _setFail(fail: boolean) {
      shouldFail = fail;
    },
    _setFailAfterBatches(count: number) {
      failAfterBatches = count;
    },
    prepare: vi.fn((sql: string) => {
      let bound: any[] = [];
      return {
        _sql: sql,
        _params: bound,
        bind: vi.fn((...params: any[]) => {
          bound = params;
          return {
            _sql: sql,
            _params: bound,
            run: vi.fn(async () => {
              executed.push({ sql, params: bound });
              return { success: true };
            }),
          };
        }),
      };
    }),
    batch: vi.fn(async (stmts: any[]) => {
      batchCount++;
      if (shouldFail || (failAfterBatches >= 0 && batchCount > failAfterBatches)) {
        throw new Error('D1_ERROR: SQLITE_BUSY (lock contention on commit)');
      }
      for (const s of stmts) {
        executed.push({ sql: s._sql, params: s._params });
      }
      return stmts.map(() => ({ success: true }));
    }),
  };
}

describe('Requirement R3: INGEST_QUEUE Batching (src/ingest-queue.ts)', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let env: IngestQueueEnv;

  beforeEach(() => {
    resetQueue();
    mockDb = createMockDb();
    env = { DB: mockDb as any };
  });

  afterEach(() => {
    resetQueue();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── 1. Batch Accumulation ─────────────────────────────────
  describe('1. Batch Accumulation without Premature Flush', () => {
    it('accumulates items 1..9 in queue buffer without calling D1 batch', async () => {
      for (let i = 1; i <= 9; i++) {
        const res = await enqueue(env, { event: `telemetry_${i}`, step: i });
        expect(res.ok).toBe(true);
        expect(res.status).toBe('queued');
        expect(res.enqueued).toBe(true);
        expect(res.flushed).toBe(false);
        expect(res.queueDepth).toBe(i);
        expect(res.id).toBeTruthy();
        expect(res.queueId).toBe(res.id);
      }

      const stats = getQueueStats();
      expect(stats.depth).toBe(9);
      expect(stats.totalEnqueued).toBe(9);
      expect(stats.totalFlushed).toBe(0);
      expect(mockDb.batch).not.toHaveBeenCalled();
    });

    it('records oldestTimestamp on first enqueue', async () => {
      const before = Date.now();
      await enqueue(env, { item: 'first' });
      const after = Date.now();

      const stats = getQueueStats();
      expect(stats.oldestTimestamp).toBeGreaterThanOrEqual(before);
      expect(stats.oldestTimestamp).toBeLessThanOrEqual(after);
    });
  });

  // ── 2. Auto-Flush on Size Threshold (10 items) ────────────
  describe('2. Auto-Flush at Size Threshold (10 Items)', () => {
    it('automatically flushes all 10 items on reaching threshold', async () => {
      for (let i = 1; i <= 9; i++) {
        const r = await enqueue(env, { message: `msg_${i}` });
        expect(r.status).toBe('queued');
      }
      expect(getQueueStats().depth).toBe(9);
      expect(mockDb.batch).not.toHaveBeenCalled();

      // 10th item hits batchSize threshold
      const r10 = await enqueue(env, { message: 'msg_10' });
      expect(r10.ok).toBe(true);
      expect(r10.status).toBe('flushed');
      expect(r10.flushed).toBe(true);
      expect(r10.queueDepth).toBe(0);

      const stats = getQueueStats();
      expect(stats.depth).toBe(0);
      expect(stats.totalEnqueued).toBe(10);
      expect(stats.totalFlushed).toBe(10);
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
      expect(mockDb._executed.length).toBe(10);
    });

    it('persists correct statement bindings in D1', async () => {
      for (let i = 1; i <= 10; i++) {
        await enqueue(env, { action: `exec_${i}` }, { lane: 'alpha_lane' });
      }

      expect(mockDb._executed.length).toBe(10);
      // elle_ingest_queue, not elle_session_bus: the lane bus has no `payload`
      // column, so the old target threw on every batch and persisted nothing.
      expect(mockDb._executed[0].sql).toContain('INTO elle_ingest_queue');
      expect(mockDb._executed[0].params[1]).toBe('alpha_lane');
      expect(JSON.parse(mockDb._executed[0].params[2])).toEqual({ action: 'exec_1' });
    });
  });

  // ── 3. Flush at Time Window (500ms Elapsed) ───────────────
  describe('3. Flush at Time Window (500ms Elapsed)', () => {
    it('flushes accumulated queue items when temporal window expires', async () => {
      vi.useFakeTimers();

      await enqueue(env, { event: 'step_1' });
      await enqueue(env, { event: 'step_2' });
      await enqueue(env, { event: 'step_3' });

      expect(getQueueStats().depth).toBe(3);
      expect(mockDb.batch).not.toHaveBeenCalled();

      // Advance time by 499ms (should not flush yet)
      await vi.advanceTimersByTimeAsync(499);
      expect(getQueueStats().depth).toBe(3);
      expect(mockDb.batch).not.toHaveBeenCalled();

      // Advance by remaining 1ms (500ms total)
      await vi.advanceTimersByTimeAsync(1);
      expect(getQueueStats().depth).toBe(0);
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
      expect(mockDb._executed.length).toBe(3);
    });

    it('cancels pending flush timer if manual drain is called before window', async () => {
      vi.useFakeTimers();

      await enqueue(env, { event: 'early_1' });
      await enqueue(env, { event: 'early_2' });

      // Explicit drain
      const drainRes = await drain(env);
      expect(drainRes.flushed).toBe(2);
      expect(mockDb.batch).toHaveBeenCalledTimes(1);

      // Advance time past 500ms
      await vi.advanceTimersByTimeAsync(600);
      // D1 batch should not have been called a second time
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
    });
  });

  // ── 4. Back-Pressure Rejection at Capacity (100) ──────────
  describe('4. Back-Pressure Rejection when Queue Exceeds Max Depth (100)', () => {
    it('rejects submissions with clear error when queue capacity is reached', async () => {
      // Create isolated queue with maxDepth 5 and batchSize 10 so it does not auto-drain
      const smallQueue = new InMemoryIngestQueue({ batchSize: 10, maxDepth: 5 });

      for (let i = 1; i <= 5; i++) {
        const r = await smallQueue.enqueue(env, { id: `item_${i}` });
        expect(r.ok).toBe(true);
        expect(r.status).toBe('queued');
      }
      expect(smallQueue.getDepth()).toBe(5);

      // 6th item exceeds capacity
      const r6 = await smallQueue.enqueue(env, { id: 'item_6' });
      expect(r6.ok).toBe(false);
      expect(r6.status).toBe('rejected');
      expect(r6.enqueued).toBe(false);
      expect(r6.error).toContain('Queue capacity exceeded');
      expect(r6.error).toContain('max depth: 5');
      expect(smallQueue.getDepth()).toBe(5);

      const stats = smallQueue.getStats();
      expect(stats.totalRejected).toBe(1);
    });

    it('rejects at default max depth 100 on global queue with autoFlush disabled', async () => {
      for (let i = 1; i <= 100; i++) {
        const r = await enqueue(env, { burst: i }, { autoFlush: false });
        expect(r.ok).toBe(true);
      }
      expect(getQueueStats().depth).toBe(100);

      // 101st item
      const r101 = await enqueue(env, { burst: 101 }, { autoFlush: false });
      expect(r101.ok).toBe(false);
      expect(r101.status).toBe('rejected');
      expect(r101.error).toContain('Queue capacity exceeded (max depth: 100)');
      expect(getQueueStats().depth).toBe(100);
      expect(getQueueStats().totalRejected).toBe(1);
    });
  });

  // ── 5. Dedup Gate Integration ─────────────────────────────
  describe('5. Dedup Gate Integration (src/ingest-gate.ts)', () => {
    const validProse = Array.from(
      { length: 60 },
      (_, i) => `word${i} establishes rigorous logical mathematical derivation`
    ).join(' ');

    it('drops duplicate paper submissions matching normalized title', async () => {
      const paper1 = {
        title: 'Geodesic Flow Regulators in Neural Architectures',
        text: validProse,
        series: 'research',
        tag: 'ml',
      };

      const r1 = await enqueue(env, paper1);
      expect(r1.ok).toBe(true);
      expect(r1.status).toBe('queued');
      expect(getQueueStats().depth).toBe(1);

      // Duplicate with differing casing and punctuation
      const r2 = await enqueue(env, {
        ...paper1,
        title: '  geodesic flow regulators in neural architectures!!!  ',
      });
      expect(r2.ok).toBe(true);
      expect(r2.status).toBe('dedup_dropped');
      expect(r2.duplicate).toBe(true);
      expect(r2.enqueued).toBe(false);
      expect(r2.error).toContain('Duplicate item dropped');
      expect(getQueueStats().depth).toBe(1);
      expect(getQueueStats().totalDuplicatesDropped).toBe(1);
    });

    it('rejects structurally invalid paper submissions', async () => {
      const badPaper = {
        title: 'Short',
        text: 'too short for research paper',
        series: 'math',
        tag: 'geometry',
      };

      const res = await enqueue(env, badPaper);
      expect(res.ok).toBe(false);
      expect(res.status).toBe('rejected');
      expect(res.enqueued).toBe(false);
      expect(res.error).toContain('Structural validation failed');
      expect(getQueueStats().depth).toBe(0);
    });

    it('drops duplicate non-paper submissions by dedupKey / idempotencyKey', async () => {
      const item1 = { taskId: 'task_abc_123', action: 'compile' };
      const r1 = await enqueue(env, item1, { dedupKey: 'task_abc_123' });
      expect(r1.status).toBe('queued');

      const r2 = await enqueue(env, item1, { dedupKey: 'task_abc_123' });
      expect(r2.status).toBe('dedup_dropped');
      expect(r2.duplicate).toBe(true);
      expect(getQueueStats().depth).toBe(1);
    });

    it('drops duplicate payload containing idempotencyKey in object', async () => {
      const r1 = await enqueue(env, { idempotencyKey: 'idempotent-key-99', payload: 'data1' });
      expect(r1.status).toBe('queued');

      const r2 = await enqueue(env, { idempotencyKey: 'idempotent-key-99', payload: 'data2' });
      expect(r2.status).toBe('dedup_dropped');
      expect(r2.duplicate).toBe(true);
      expect(getQueueStats().depth).toBe(1);
    });
  });

  // ── 6. Broken D1 Fail-Safe & Chunking ──────────────────────
  describe('6. Resilient Never-Throw Guarantee on Broken D1/KV', () => {
    it('returns structured error envelope on missing or broken D1 without throwing', async () => {
      await enqueue(env, { data: 1 }, { autoFlush: false });
      expect(getQueueStats().depth).toBe(1);

      // Drain with undefined / broken env
      const drainRes = await drain(null);
      expect(drainRes.ok).toBe(false);
      expect(drainRes.flushed).toBe(0);
      expect(drainRes.flushedCount).toBe(0);
      expect(drainRes.errors).toBe(1);
      expect(drainRes.status).toBe('error');
      expect(drainRes.errorDetails?.[0]).toContain('DB binding missing or invalid');
    });

    it('retains uncommitted queue items when D1 throws SQLITE_BUSY', async () => {
      for (let i = 1; i <= 4; i++) {
        await enqueue(env, { item: i }, { autoFlush: false });
      }
      expect(getQueueStats().depth).toBe(4);

      mockDb._setFail(true);

      const drainRes = await drain(env);
      expect(drainRes.ok).toBe(false);
      expect(drainRes.flushed).toBe(0);
      expect(drainRes.errors).toBe(1);
      expect(drainRes.status).toBe('error');
      expect(drainRes.errorDetails?.[0]).toContain('SQLITE_BUSY');

      // Items must be preserved in queue for subsequent retry
      expect(getQueueStats().depth).toBe(4);

      // Restore DB and retry
      mockDb._setFail(false);
      const retryRes = await drain(env);
      expect(retryRes.ok).toBe(true);
      expect(retryRes.flushed).toBe(4);
      expect(retryRes.status).toBe('ok');
      expect(getQueueStats().depth).toBe(0);
    });

    it('handles partial batch failure while preserving remaining items', async () => {
      // 25 items drained in chunks of 10
      for (let i = 1; i <= 25; i++) {
        await enqueue(env, { item: i }, { autoFlush: false });
      }
      expect(getQueueStats().depth).toBe(25);

      // First batch (10 items) succeeds, second batch fails
      mockDb._setFailAfterBatches(1);

      const drainRes = await drain(env, { batchSize: 10 });
      expect(drainRes.ok).toBe(false);
      expect(drainRes.flushed).toBe(10);
      expect(drainRes.errors).toBe(1);
      expect(drainRes.status).toBe('partial');
      expect(drainRes.batchesProcessed).toBe(1);

      // Remaining 15 items stay in queue
      expect(getQueueStats().depth).toBe(15);
    });

    it('chunks large drains to <= 50 statements per D1 batch transaction', async () => {
      // Enqueue 120 items with maxDepth 200
      for (let i = 1; i <= 120; i++) {
        await enqueue(env, { payloadId: i }, { autoFlush: false, maxDepth: 200 });
      }
      expect(getQueueStats().depth).toBe(120);

      const drainRes = await drain(env, { batchSize: 100 }); // requesting 100, should be capped at 50
      expect(drainRes.ok).toBe(true);
      expect(drainRes.flushed).toBe(120);
      expect(drainRes.batchesProcessed).toBe(3); // 50 + 50 + 20
      expect(mockDb.batch).toHaveBeenCalledTimes(3);

      // Inspect stmts array size in each batch call
      const firstBatchStmts = (mockDb.batch as any).mock.calls[0][0];
      const secondBatchStmts = (mockDb.batch as any).mock.calls[1][0];
      const thirdBatchStmts = (mockDb.batch as any).mock.calls[2][0];

      expect(firstBatchStmts.length).toBe(50);
      expect(secondBatchStmts.length).toBe(50);
      expect(thirdBatchStmts.length).toBe(20);
      expect(getQueueStats().depth).toBe(0);
    });
  });

  // ── 7. Idempotent Empty Drain & Reset ──────────────────────
  describe('7. Idempotent Empty Drain & State Reset', () => {
    it('is a non-blocking no-op on empty queue', async () => {
      const res = await drain(env);
      expect(res.ok).toBe(true);
      expect(res.flushed).toBe(0);
      expect(res.flushedCount).toBe(0);
      expect(res.errors).toBe(0);
      expect(res.batchesProcessed).toBe(0);
      expect(res.status).toBe('empty');
      expect(mockDb.batch).not.toHaveBeenCalled();
    });

    it('resetQueue clears all state and counters', async () => {
      await enqueue(env, { item: 1 }, { autoFlush: false });
      expect(getQueueStats().depth).toBe(1);

      resetQueue();
      const stats = getQueueStats();
      expect(stats.depth).toBe(0);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.totalEnqueued).toBe(0);
      expect(stats.totalFlushed).toBe(0);
      expect(stats.totalRejected).toBe(0);
      expect(stats.totalDuplicatesDropped).toBe(0);
    });
  });

  // ── 8. High Concurrency Burst Workloads ────────────────────
  describe('8. High Concurrency Burst Workload Handling', () => {
    it('processes 100 concurrent enqueues in 10 batched flushes', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        enqueue(env, { burstIdx: i, ts: Date.now() })
      );

      const results = await Promise.all(promises);
      expect(results.every((r) => r.ok)).toBe(true);

      // Remaining tail if any
      await drain(env);
      expect(getQueueStats().depth).toBe(0);
      expect(mockDb._executed.length).toBe(100);
      expect(mockDb.batch).toHaveBeenCalled();
    });
  });

  // ── 9. Custom IngestQueue Class Instances ──────────────────
  describe('9. Custom InMemoryIngestQueue Class Instances', () => {
    it('operates independently with customized configuration', async () => {
      const customQueue = new InMemoryIngestQueue({
        batchSize: 4,
        maxDepth: 8,
        flushWindowMs: 200,
        dedup: false,
      });

      // Dedup disabled allows identical strings
      const r1 = await customQueue.enqueue(env, { data: 'same' }, { dedupKey: 'k1' });
      const r2 = await customQueue.enqueue(env, { data: 'same' }, { dedupKey: 'k1' });
      expect(r1.status).toBe('queued');
      expect(r2.status).toBe('queued');
      expect(customQueue.getDepth()).toBe(2);

      // 4th item triggers batch flush of size 4
      await customQueue.enqueue(env, { data: 3 });
      const r4 = await customQueue.enqueue(env, { data: 4 });
      expect(r4.status).toBe('flushed');
      expect(customQueue.getDepth()).toBe(0);
      expect(mockDb._executed.length).toBe(4);
    });
  });
});
