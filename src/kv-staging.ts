// ============================================================
// ELLE WORKER — src/kv-staging.ts
// Stateless KV Staging Layer (Requirement R2)
// High-throughput write-through staging buffer backed by Cloudflare KV (env.SESSIONS)
// with 5-minute TTL protecting D1 single-writer limits.
// ============================================================

import type { Env } from './index';

export const DEFAULT_STAGING_TTL_SECONDS = 300; // 5 minutes (300 seconds)
export const DEFAULT_STAGING_PREFIX = 'staging:';

/** Identifiers permitted in an interpolated INSERT target. */
const STAGING_TABLE_ALLOWLIST = new Set(['elle_session_bus', 'elle_ingest_queue']);
export const D1_BATCH_MAX_STATEMENTS = 50; // Cloudflare D1 batch headroom

export interface StagedPayload<T = unknown> {
  id: string;
  key: string;
  lane?: string;
  direction?: 'to_local' | 'to_cloud';
  kind?: string;
  replyTo?: string;
  reply_to?: string;
  wire?: string;
  plaintext?: string;
  data?: T;
  payload?: T;
  status?: string;
  staged_at: number;
  expires_at: number;
  nonce: string;
  table?: string;
  sql?: string;
  args?: unknown[];
  [key: string]: unknown;
}

export interface StageEntryOptions {
  ttlSeconds?: number;
  ttl?: number;
  prefix?: string;
  namespace?: 'SESSIONS' | 'SCRATCHPAD';
  lane?: string;
  direction?: 'to_local' | 'to_cloud';
  kind?: string;
  replyTo?: string;
  reply_to?: string;
  wire?: string;
  table?: string;
}

export interface StageResult {
  ok: boolean;
  key: string;
  stageKey: string;
  error?: string;
}

export interface FlushOptions {
  prefix?: string;
  batchSize?: number;
  targetTable?: string;
  namespace?: 'SESSIONS' | 'SCRATCHPAD';
  limit?: number;
}

export interface FlushResult {
  flushed: number;
  errors: number;
  status: 'ok' | 'partial' | 'error';
  ok: boolean;
  flushedCount: number;
  stagedKeysPurged: number;
  details?: string[];
}

export interface StagingEnv {
  SESSIONS?: KVNamespace;
  SCRATCHPAD?: KVNamespace;
  DB?: D1Database;
  [key: string]: unknown;
}

let schemaReady = false;

async function ensureBusSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  try {
    await db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS elle_session_bus (
           id TEXT PRIMARY KEY,
           lane TEXT NOT NULL,
           direction TEXT NOT NULL CHECK (direction IN ('to_local','to_cloud')),
           kind TEXT NOT NULL,
           reply_to TEXT,
           wire TEXT NOT NULL,
           plaintext TEXT,
           status TEXT NOT NULL DEFAULT 'pending',
           created_at INTEGER NOT NULL
         )`
      ),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_bus_lane_dir_status ON elle_session_bus (lane, direction, status, created_at)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_bus_reply_to ON elle_session_bus (reply_to)`),
    ]);
    schemaReady = true;
  } catch {
    // Best-effort schema init; allow DB execution to handle if tables already exist
  }
}
function resolveKv(
  env: StagingEnv | Env | undefined | null,
  opts?: { namespace?: 'SESSIONS' | 'SCRATCHPAD' }
): KVNamespace | undefined {
  if (!env) return undefined;
  if (opts?.namespace === 'SCRATCHPAD') return env.SCRATCHPAD;
  return env.SESSIONS || env.SCRATCHPAD;
}

/**
 * Stages an inbound payload in Cloudflare KV (env.SESSIONS) with a default 5-minute TTL.
 * Never throws — catches all errors and returns a structured StageResult.
 */
export async function stageEntry<T = unknown>(
  env: StagingEnv | Env | undefined | null,
  key: string,
  payload: T,
  opts: StageEntryOptions = {}
): Promise<StageResult> {
  try {
    const kv = resolveKv(env, opts);
    if (!kv || typeof kv.put !== 'function') {
      return {
        ok: false,
        key: key || '',
        stageKey: key || '',
        error: 'SESSIONS KV namespace is not configured or unavailable',
      };
    }

    if (!key || typeof key !== 'string') {
      return {
        ok: false,
        key: String(key || ''),
        stageKey: String(key || ''),
        error: 'Invalid key provided for staging',
      };
    }

    const prefix = typeof opts.prefix === 'string' ? opts.prefix : DEFAULT_STAGING_PREFIX;
    const fullKey = key.startsWith(prefix) ? key : `${prefix}${key}`;
    const ttlSeconds = typeof opts.ttlSeconds === 'number' && opts.ttlSeconds > 0
      ? opts.ttlSeconds
      : typeof opts.ttl === 'number' && opts.ttl > 0
        ? opts.ttl
        : DEFAULT_STAGING_TTL_SECONDS;

    const now = Date.now();
    const rawNonce = key.startsWith(prefix) ? key.slice(prefix.length) : key;

    let stagedItem: StagedPayload<T>;

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const obj = payload as Record<string, unknown>;
      stagedItem = {
        id: typeof obj.id === 'string' && obj.id ? obj.id : rawNonce,
        key: fullKey,
        lane: typeof obj.lane === 'string' ? obj.lane : (opts.lane || 'primary'),
        direction: (obj.direction === 'to_local' || obj.direction === 'to_cloud')
          ? (obj.direction as 'to_local' | 'to_cloud')
          : (opts.direction || 'to_cloud'),
        kind: typeof obj.kind === 'string' ? obj.kind : (opts.kind || 'staged'),
        replyTo: typeof obj.replyTo === 'string'
          ? obj.replyTo
          : (typeof obj.reply_to === 'string' ? obj.reply_to : (opts.replyTo || opts.reply_to)),
        reply_to: typeof obj.reply_to === 'string'
          ? obj.reply_to
          : (typeof obj.replyTo === 'string' ? obj.replyTo : (opts.reply_to || opts.replyTo)),
        wire: typeof obj.wire === 'string' ? obj.wire : (opts.wire || ''),
        plaintext: typeof obj.plaintext === 'string'
          ? obj.plaintext
          : (typeof obj.data !== 'undefined'
              ? JSON.stringify(obj.data)
              : (typeof obj.payload !== 'undefined' ? JSON.stringify(obj.payload) : JSON.stringify(payload))),
        status: typeof obj.status === 'string' ? obj.status : 'done',
        data: (obj.data as T) ?? payload,
        payload: (obj.payload as T) ?? payload,
        table: typeof obj.table === 'string' ? obj.table : opts.table,
        staged_at: typeof obj.staged_at === 'number' ? obj.staged_at : now,
        expires_at: now + ttlSeconds * 1000,
        nonce: rawNonce,
      };
    } else {
      stagedItem = {
        id: rawNonce,
        key: fullKey,
        lane: opts.lane || 'primary',
        direction: opts.direction || 'to_cloud',
        kind: opts.kind || 'staged',
        replyTo: opts.replyTo || opts.reply_to,
        reply_to: opts.reply_to || opts.replyTo,
        wire: opts.wire || '',
        plaintext: typeof payload === 'string' ? payload : JSON.stringify(payload),
        status: 'done',
        data: payload,
        payload: payload,
        table: opts.table,
        staged_at: now,
        expires_at: now + ttlSeconds * 1000,
        nonce: rawNonce,
      };
    }

    await kv.put(fullKey, JSON.stringify(stagedItem), {
      expirationTtl: ttlSeconds,
    });

    return {
      ok: true,
      key: fullKey,
      stageKey: fullKey,
    };
  } catch (err) {
    return {
      ok: false,
      key: key || '',
      stageKey: key || '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Retrieves a single staged entry from KV by key.
 * Never throws — returns null on missing or error.
 */
export async function getStagedEntry<T = unknown>(
  env: StagingEnv | Env | undefined | null,
  key: string,
  opts: { prefix?: string; namespace?: 'SESSIONS' | 'SCRATCHPAD' } = {}
): Promise<StagedPayload<T> | null> {
  try {
    const kv = resolveKv(env, opts);
    if (!kv || typeof kv.get !== 'function') {
      return null;
    }
    if (!key || typeof key !== 'string') {
      return null;
    }
    const prefix = typeof opts.prefix === 'string' ? opts.prefix : DEFAULT_STAGING_PREFIX;
    const fullKey = key.startsWith(prefix) ? key : `${prefix}${key}`;
    const raw = await kv.get(fullKey);
    if (!raw) return null;
    return JSON.parse(raw) as StagedPayload<T>;
  } catch {
    return null;
  }
}

/**
 * Alias for getStagedEntry.
 */
export const getStaged = getStagedEntry;

/**
 * Clears/deletes a staged entry from KV by key.
 * Never throws — returns true on success, false on failure.
 */
export async function clearStagedEntry(
  env: StagingEnv | Env | undefined | null,
  key: string,
  opts: { prefix?: string; namespace?: 'SESSIONS' | 'SCRATCHPAD' } = {}
): Promise<boolean> {
  try {
    const kv = resolveKv(env, opts);
    if (!kv || typeof kv.delete !== 'function') {
      return false;
    }
    if (!key || typeof key !== 'string') {
      return false;
    }
    const prefix = typeof opts.prefix === 'string' ? opts.prefix : DEFAULT_STAGING_PREFIX;
    const fullKey = key.startsWith(prefix) ? key : `${prefix}${key}`;
    await kv.delete(fullKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to list all currently staged keys matching prefix.
 */
export async function listStagedKeys(
  env: StagingEnv | Env | undefined | null,
  opts: { prefix?: string; limit?: number; namespace?: 'SESSIONS' | 'SCRATCHPAD' } = {}
): Promise<string[]> {
  try {
    const kv = resolveKv(env, opts);
    if (!kv || typeof kv.list !== 'function') {
      return [];
    }
    const prefix = typeof opts.prefix === 'string' ? opts.prefix : DEFAULT_STAGING_PREFIX;
    const listRes = await kv.list({ prefix, limit: opts.limit ?? 1000 });
    return (listRes.keys || []).map((k) => k.name);
  } catch {
    return [];
  }
}

function buildD1Statement(
  db: D1Database,
  item: StagedPayload,
  targetTable?: string
): D1PreparedStatement {
  // No caller-supplied SQL branch. This used to be
  //   if (item.sql) return db.prepare(item.sql).bind(...(item.args ?? []));
  // with no allowlist and no read-only check, executed with full D1
  // privileges over whatever a staged payload happened to carry — a stored
  // injection gadget that bypassed both the scope model and guardSelect().
  // Every statement below is parameterized against a fixed schema.

  // Interpolated into the statement text, so it can never come from a payload.
  const requested = targetTable || item.table || 'elle_session_bus';
  const table = STAGING_TABLE_ALLOWLIST.has(requested) ? requested : 'elle_session_bus';

  if (table === 'elle_session_bus') {
    const id = item.id || item.nonce || `stg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lane = item.lane || 'primary';
    const direction = (item.direction === 'to_local' || item.direction === 'to_cloud')
      ? item.direction
      : 'to_cloud';
    const kind = item.kind || 'staged';
    const replyTo = item.replyTo || item.reply_to || null;
    const wire = typeof item.wire === 'string' ? item.wire : '';
    const plaintext = typeof item.plaintext === 'string'
      ? item.plaintext
      : (typeof item.data !== 'undefined'
          ? JSON.stringify(item.data)
          : (typeof item.payload !== 'undefined' ? JSON.stringify(item.payload) : JSON.stringify(item)));
    const status = item.status || 'done';
    const createdAt = typeof item.staged_at === 'number' ? item.staged_at : Date.now();

    return db.prepare(
      // OR IGNORE, not plain INSERT: staging is at-least-once. A purge that
      // does not complete after a committed batch (isolate evicted, CPU limit)
      // leaves the key staged, and the next flush replays the same id. Against
      // `id TEXT PRIMARY KEY` a plain INSERT raises UNIQUE — and because D1
      // batch() is one transaction, that failure takes the whole chunk of up
      // to 50 with it and no key is purged, so the queue wedges permanently.
      `INSERT OR IGNORE INTO elle_session_bus (id, lane, direction, kind, reply_to, wire, plaintext, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, lane, direction, kind, replyTo, wire, plaintext, status, createdAt);
  }

  // Generic fallback destination table
  const id = item.id || item.nonce || `stg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payloadStr = typeof item.data !== 'undefined'
    ? JSON.stringify(item.data)
    : (typeof item.payload !== 'undefined' ? JSON.stringify(item.payload) : JSON.stringify(item));
  const createdAt = typeof item.staged_at === 'number' ? item.staged_at : Date.now();

  return db.prepare(
    `INSERT OR IGNORE INTO ${table} (id, payload, created_at) VALUES (?, ?, ?)`
  ).bind(id, payloadStr, createdAt);
}

/**
 * Scans and drains pending staged entries from Cloudflare KV (env.SESSIONS),
 * constructs prepared D1 statements, writes them to D1 via env.DB.batch()
 * chunked to <= 50 statements per batch, and deletes committed keys from KV.
 *
 * Idempotent on empty queue (returns { flushed: 0, errors: 0, status: 'ok' }).
 * Gracefully handles KV or D1 failures without throwing uncaught exceptions.
 */
export async function flushStaged(
  env: StagingEnv | Env | undefined | null,
  opts: FlushOptions = {}
): Promise<FlushResult> {
  try {
    const kv = resolveKv(env, opts);
    if (!env || !kv || typeof kv.list !== 'function' || !env.DB || typeof env.DB.batch !== 'function') {
      return {
        flushed: 0,
        errors: 1,
        status: 'error',
        ok: false,
        flushedCount: 0,
        stagedKeysPurged: 0,
        details: ['KV staging namespace or DB D1 database binding is missing or unconfigured'],
      };
    }

    const prefix = typeof opts.prefix === 'string' ? opts.prefix : DEFAULT_STAGING_PREFIX;
    const batchSizeSetting = typeof opts.batchSize === 'number' && opts.batchSize > 0
      ? opts.batchSize
      : D1_BATCH_MAX_STATEMENTS;
    const maxChunkSize = Math.min(batchSizeSetting, D1_BATCH_MAX_STATEMENTS);

    let listRes: KVNamespaceListResult<unknown>;
    try {
      listRes = await kv.list({
        prefix,
        limit: opts.limit ?? 1000,
      });
    } catch (err) {
      return {
        flushed: 0,
        errors: 1,
        status: 'error',
        ok: false,
        flushedCount: 0,
        stagedKeysPurged: 0,
        details: [`KV list operation failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    const keys = listRes.keys || [];
    if (keys.length === 0) {
      return {
        flushed: 0,
        errors: 0,
        status: 'ok',
        ok: true,
        flushedCount: 0,
        stagedKeysPurged: 0,
      };
    }

    // Ensure schema exists for default target table
    if (!opts.targetTable || opts.targetTable === 'elle_session_bus') {
      await ensureBusSchema(env.DB);
    }

    // Read staged entries in parallel
    const entries: Array<{ key: string; item: StagedPayload }> = [];
    const parseErrors: string[] = [];

    await Promise.all(
      keys.map(async (k) => {
        try {
          const raw = await kv.get(k.name);
          if (raw) {
            const item = JSON.parse(raw) as StagedPayload;
            entries.push({ key: k.name, item });
          } else {
            // Listed but gone by the time we read it: the TTL expired inside
            // the list->get window (§6.2). Count it — dropping it silently
            // makes a lossy flush indistinguishable from a clean one.
            parseErrors.push(`Staged key "${k.name}" expired between list and get (TTL eviction)`);
          }
        } catch (err) {
          parseErrors.push(`Failed to read/parse key "${k.name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    );

    if (entries.length === 0) {
      return {
        flushed: 0,
        errors: parseErrors.length,
        status: parseErrors.length > 0 ? 'error' : 'ok',
        ok: parseErrors.length === 0,
        flushedCount: 0,
        stagedKeysPurged: 0,
        details: parseErrors.length > 0 ? parseErrors : undefined,
      };
    }

    let totalFlushed = 0;
    let totalPurged = 0;
    let totalErrors = parseErrors.length;
    const errorDetails: string[] = [...parseErrors];

    // Chunk into D1 batches of <= 50 statements
    for (let i = 0; i < entries.length; i += maxChunkSize) {
      const chunk = entries.slice(i, i + maxChunkSize);
      const statements: D1PreparedStatement[] = [];
      const chunkKeys: string[] = [];

      for (const entry of chunk) {
        try {
          const stmt = buildD1Statement(env.DB, entry.item, opts.targetTable);
          statements.push(stmt);
          chunkKeys.push(entry.key);
        } catch (stmtErr) {
          totalErrors++;
          errorDetails.push(`Failed to prepare D1 statement for key "${entry.key}": ${stmtErr instanceof Error ? stmtErr.message : String(stmtErr)}`);
        }
      }

      if (statements.length > 0) {
        try {
          await env.DB.batch(statements);
          totalFlushed += statements.length;

          // Delete committed keys from KV upon successful D1 batch write
          await Promise.all(
            chunkKeys.map(async (k) => {
              // Only count a key we actually removed; a swallowed failure that
              // still increments makes stagedKeysPurged report a purge that
              // did not happen, hiding exactly the replay case above.
              try {
                await kv.delete(k);
                totalPurged++;
              } catch { /* key survives; the OR IGNORE replay handles it */ }
            })
          );
        } catch (batchErr) {
          totalErrors += statements.length;
          errorDetails.push(`D1 batch write failed for chunk: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`);
        }
      }
    }

    const status: 'ok' | 'partial' | 'error' =
      totalErrors === 0 ? 'ok' : totalFlushed > 0 ? 'partial' : 'error';

    return {
      flushed: totalFlushed,
      errors: totalErrors,
      status,
      ok: status !== 'error',
      flushedCount: totalFlushed,
      stagedKeysPurged: totalPurged,
      details: errorDetails.length > 0 ? errorDetails : undefined,
    };
  } catch (err) {
    return {
      flushed: 0,
      errors: 1,
      status: 'error',
      ok: false,
      flushedCount: 0,
      stagedKeysPurged: 0,
      details: [`Unhandled flushStaged error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
