// ============================================================
// ELLE WORKER — src/ingest-queue.ts
// INGEST_QUEUE Batching & Back-Pressure (Requirement R3)
//
// Micro-batching ingest queue for /api/sandbox-bus/submit and inbound payloads:
//   - Batch accumulation thresholds: configurable batch size (default 10) or time window (default 500ms).
//   - Back-pressure handling: immediate rejection with clear error when queue depth exceeds max capacity (default 100).
//   - Deduplication integration: integrates with src/ingest-gate.ts (normalizeTitle, structuralReason, idempotencyKey).
//   - D1 batch chunking: chunked to <= 50 statements per transaction.
//   - Never-throw fail-safe guarantee on broken D1/KV.
// ============================================================

import type { Env } from './index';
import { normalizeTitle, structuralReason, type PaperInput } from './ingest-gate';

// ── Default Constants ───────────────────────────────────────
export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_QUEUE_BATCH_SIZE = 10;
export const DEFAULT_FLUSH_WINDOW_MS = 500;
export const DEFAULT_QUEUE_TIME_WINDOW_MS = 500;
export const DEFAULT_MAX_QUEUE_DEPTH = 100;
export const DEFAULT_QUEUE_MAX_DEPTH = 100;
export const D1_BATCH_MAX_STATEMENTS = 50;

// ── Types & Interfaces ──────────────────────────────────────
export interface IngestQueueItem<T = unknown> {
  id: string;
  type: string;
  lane?: string;
  payload: T;
  enqueuedAt: number;
  hashKey?: string;
}

export interface IngestItem<T = unknown> {
  id?: string;
  idempotencyKey?: string;
  lane?: string;
  kind?: string;
  type?: string;
  replyTo?: string;
  reply_to?: string;
  wire?: string;
  payload?: T;
  data?: T;
  title?: string;
  series?: string;
  tag?: string;
  text?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface IngestQueueOptions {
  batchSize?: number;
  timeWindowMs?: number;
  flushWindowMs?: number;
  maxDepth?: number;
  dedup?: boolean;
  dedupKey?: string;
  idempotencyKey?: string;
  type?: string;
  lane?: string;
  autoFlush?: boolean;
}

export interface EnqueueResult {
  ok: boolean;
  id: string;
  queueId: string;
  status: 'queued' | 'flushed' | 'rejected' | 'dedup_dropped';
  enqueued?: boolean;
  duplicate?: boolean;
  queueDepth?: number;
  flushed?: boolean;
  error?: string;
}

export interface DrainOptions {
  batchSize?: number;
  maxItems?: number;
  targetTable?: string;
}

export interface DrainResult {
  ok: boolean;
  flushed: number;
  flushedCount: number;
  errors: number;
  batchesProcessed: number;
  duplicatesDropped: number;
  status: 'ok' | 'partial' | 'error' | 'empty';
  errorDetails?: string[];
  details?: string[];
  error?: string;
}

export interface IngestQueueStats {
  depth: number;
  oldestTimestamp: number | null;
  totalEnqueued: number;
  totalFlushed: number;
  totalRejected: number;
  totalDuplicatesDropped: number;
}

export interface IngestQueueEnv {
  DB?: D1Database;
  SESSIONS?: KVNamespace;
  [key: string]: unknown;
}

// ── In-Memory Queue Class ───────────────────────────────────
export class InMemoryIngestQueue {
  private queue: IngestQueueItem[] = [];
  private seenHashes = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isDraining = false;
  private batchSize: number;
  private flushWindowMs: number;
  private maxDepth: number;
  private dedup: boolean;
  private lastEnv: IngestQueueEnv | Env | null = null;

  // Telemetry counters
  private totalEnqueued = 0;
  private totalFlushed = 0;
  private totalRejected = 0;
  private totalDuplicatesDropped = 0;

  constructor(opts: {
    batchSize?: number;
    flushWindowMs?: number;
    timeWindowMs?: number;
    maxDepth?: number;
    dedup?: boolean;
  } = {}) {
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushWindowMs = opts.timeWindowMs ?? opts.flushWindowMs ?? DEFAULT_FLUSH_WINDOW_MS;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
    this.dedup = opts.dedup ?? true;
  }

  public getDepth(): number {
    return this.queue.length;
  }

  public getStats(): IngestQueueStats {
    return {
      depth: this.queue.length,
      oldestTimestamp: this.queue.length > 0 ? this.queue[0].enqueuedAt : null,
      totalEnqueued: this.totalEnqueued,
      totalFlushed: this.totalFlushed,
      totalRejected: this.totalRejected,
      totalDuplicatesDropped: this.totalDuplicatesDropped,
    };
  }

  public clear(): void {
    this.reset();
  }

  public reset(): void {
    this.queue = [];
    this.seenHashes.clear();
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.isDraining = false;
    this.lastEnv = null;
    this.totalEnqueued = 0;
    this.totalFlushed = 0;
    this.totalRejected = 0;
    this.totalDuplicatesDropped = 0;
  }

  public async enqueue<T = unknown>(
    env: IngestQueueEnv | Env | undefined | null,
    payload: T,
    opts: IngestQueueOptions = {}
  ): Promise<EnqueueResult> {
    this.lastEnv = env ?? null;
    const maxDepth = opts.maxDepth ?? this.maxDepth;

    // 1. Backpressure check: reject immediately when queue depth >= maxDepth
    if (this.queue.length >= maxDepth) {
      this.totalRejected++;
      return {
        ok: false,
        id: '',
        queueId: '',
        status: 'rejected',
        enqueued: false,
        duplicate: false,
        queueDepth: this.queue.length,
        error: `Queue capacity exceeded (max depth: ${maxDepth})`,
      };
    }

    // 2. Ingest Gate Deduplication & Structural Validation Check
    const dedupEnabled = opts.dedup ?? this.dedup;
    if (payload && typeof payload === 'object' && 'title' in payload) {
      const paper = payload as PaperInput;
      const structuralErr = structuralReason(paper);
      if (structuralErr) {
        this.totalRejected++;
        return {
          ok: false,
          id: '',
          queueId: '',
          status: 'rejected',
          enqueued: false,
          duplicate: false,
          queueDepth: this.queue.length,
          error: `Structural validation failed: ${structuralErr}`,
        };
      }

      if (dedupEnabled) {
        const norm = normalizeTitle(paper.title);
        if (this.seenHashes.has(norm)) {
          this.totalDuplicatesDropped++;
          return {
            ok: true,
            id: '',
            queueId: '',
            status: 'dedup_dropped',
            enqueued: false,
            duplicate: true,
            queueDepth: this.queue.length,
            error: 'Duplicate item dropped prior to queueing',
          };
        }
        this.seenHashes.add(norm);
      }
    } else if (dedupEnabled) {
      const dedupKey = opts.dedupKey ?? opts.idempotencyKey ?? (payload as Record<string, unknown> | null)?.idempotencyKey ?? (payload as Record<string, unknown> | null)?.hashKey;
      if (dedupKey && typeof dedupKey === 'string') {
        if (this.seenHashes.has(dedupKey)) {
          this.totalDuplicatesDropped++;
          return {
            ok: true,
            id: '',
            queueId: '',
            status: 'dedup_dropped',
            enqueued: false,
            duplicate: true,
            queueDepth: this.queue.length,
            error: 'Duplicate item dropped prior to queueing',
          };
        }
        this.seenHashes.add(dedupKey);
      }
    }

    // 3. Generate identifier & queue item
    const queueId = (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).id === 'string' && (payload as Record<string, unknown>).id)
      ? (payload as Record<string, unknown>).id as string
      : crypto.randomUUID().replace(/-/g, '').slice(0, 20);

    const lane = opts.lane ?? (payload && typeof payload === 'object' && (payload as Record<string, unknown>).lane ? String((payload as Record<string, unknown>).lane) : 'default');
    const itemType = opts.type ?? (payload && typeof payload === 'object' && ((payload as Record<string, unknown>).type || (payload as Record<string, unknown>).kind) ? String((payload as Record<string, unknown>).type || (payload as Record<string, unknown>).kind) : 'bus_submission');

    const item: IngestQueueItem<T> = {
      id: queueId,
      type: itemType,
      lane,
      payload,
      enqueuedAt: Date.now(),
      hashKey: opts.dedupKey ?? opts.idempotencyKey,
    };

    this.queue.push(item);
    this.totalEnqueued++;

    // 4. Batch threshold trigger
    const batchThreshold = opts.batchSize ?? this.batchSize;
    const autoFlush = opts.autoFlush ?? true;

    if (autoFlush && this.queue.length >= batchThreshold && !this.isDraining) {
      const drainRes = await this.drain(env, { batchSize: batchThreshold });
      return {
        ok: drainRes.ok,
        id: queueId,
        queueId,
        status: 'flushed',
        enqueued: true,
        flushed: true,
        queueDepth: this.queue.length,
      };
    }

    // 5. Schedule temporal flush timer if not already running
    const flushWindow = opts.timeWindowMs ?? opts.flushWindowMs ?? this.flushWindowMs;
    if (autoFlush && this.flushTimer === null && flushWindow > 0) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.queue.length > 0 && !this.isDraining) {
          this.drain(this.lastEnv).catch(() => {});
        }
      }, flushWindow);
    }

    return {
      ok: true,
      id: queueId,
      queueId,
      status: 'queued',
      enqueued: true,
      flushed: false,
      queueDepth: this.queue.length,
    };
  }

  public async drain(
    env: IngestQueueEnv | Env | undefined | null,
    opts: DrainOptions = {}
  ): Promise<DrainResult> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const db = env?.DB;
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
      return {
        ok: false,
        flushed: 0,
        flushedCount: 0,
        errors: 1,
        batchesProcessed: 0,
        duplicatesDropped: 0,
        status: 'error',
        errorDetails: ['DB binding missing or invalid'],
        details: ['DB binding missing or invalid'],
        error: 'DB binding missing or invalid',
      };
    }

    if (this.queue.length === 0 || this.isDraining) {
      return {
        ok: true,
        flushed: 0,
        flushedCount: 0,
        errors: 0,
        batchesProcessed: 0,
        duplicatesDropped: 0,
        status: 'empty',
      };
    }

    this.isDraining = true;
    const limit = Math.min(opts.batchSize ?? opts.maxItems ?? this.batchSize, D1_BATCH_MAX_STATEMENTS, 50);
    let totalFlushed = 0;
    let batches = 0;
    const errorDetails: string[] = [];
    // NOT elle_session_bus. That table is the cloud<->laptop lane bus: its
    // columns are (id, lane, direction, kind, reply_to, wire, plaintext,
    // status, created_at), it has no `payload`, and direction/kind/wire are
    // NOT NULL with no defaults. Every drain against it threw "no such column:
    // payload", the loop broke to preserve items, the queue filled to
    // maxDepth and then rejected everything after — zero rows ever persisted.
    // Generic ingest payloads get their own table.
    const targetTable = opts.targetTable || 'elle_ingest_queue';

    try {
      while (this.queue.length > 0) {
        const batchItems = this.queue.slice(0, limit);
        try {
          const stmts = batchItems.map((item) => {
            const payloadStr = typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload);
            return db.prepare(
              // OR IGNORE: drain is at-least-once keyed by a stable id, and
              // D1 batch() is one transaction — a plain INSERT lets a single
              // replayed id fail all 50 statements alongside it.
              `INSERT OR IGNORE INTO ${targetTable} (id, lane, payload, created_at) VALUES (?1, ?2, ?3, ?4)`
            ).bind(
              item.id,
              item.lane ?? 'default',
              payloadStr,
              item.enqueuedAt
            );
          });

          await db.batch(stmts);
          this.queue.splice(0, batchItems.length);
          totalFlushed += batchItems.length;
          this.totalFlushed += batchItems.length;
          batches++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errorDetails.push(errMsg);
          break; // Stop draining on error to preserve remaining uncommitted items
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errorDetails.push(errMsg);
    } finally {
      this.isDraining = false;
    }

    const errorsCount = errorDetails.length;
    const isOk = errorsCount === 0;
    const status = errorsCount > 0 ? (totalFlushed > 0 ? 'partial' : 'error') : (totalFlushed > 0 ? 'ok' : 'empty');

    return {
      ok: isOk,
      flushed: totalFlushed,
      flushedCount: totalFlushed,
      errors: errorsCount,
      batchesProcessed: batches,
      duplicatesDropped: 0,
      status,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      details: errorDetails.length > 0 ? errorDetails : undefined,
      error: errorDetails.length > 0 ? errorDetails[0] : undefined,
    };
  }
}

// ── Global Singleton Queue Instance ─────────────────────────
const globalQueue = new InMemoryIngestQueue();

/**
 * Enqueues an item for batched persistence.
 * Applies back-pressure if depth exceeds maxDepth (100).
 * Triggers batch flush if batchSize (10) or time window (500ms) is reached.
 * Integrates with src/ingest-gate.ts deduplication.
 * Never throws — returns structured result.
 */
export async function enqueue<T = unknown>(
  env: IngestQueueEnv | Env | undefined | null,
  payload: T,
  opts?: IngestQueueOptions
): Promise<EnqueueResult> {
  return globalQueue.enqueue(env, payload, opts);
}

/**
 * Explicitly drains all accumulated queue items into D1 in transactions
 * chunked to <= 50 statements per batch.
 * Idempotent on empty queue — never throws on broken D1/KV.
 */
export async function drain(
  env: IngestQueueEnv | Env | undefined | null,
  opts?: DrainOptions
): Promise<DrainResult> {
  return globalQueue.drain(env, opts);
}

/**
 * Returns current queue telemetry and depth.
 */
export function getQueueStats(): IngestQueueStats {
  return globalQueue.getStats();
}

/**
 * Resets internal queue state (used for test isolation).
 */
export function resetQueue(): void {
  globalQueue.reset();
}
