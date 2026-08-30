import { describe, it, expect, vi } from 'vitest';
import { flushStaged } from './kv-staging';

function makeKv(seed: Record<string, unknown>) {
  const store = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const state = { deleteFails: false };
  return {
    store, state,
    list: vi.fn(async () => ({ keys: [...store.keys()].map((name) => ({ name })) })),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async (k: string) => {
      if (state.deleteFails) throw new Error('KV delete failed (isolate evicted)');
      store.delete(k);
    }),
  };
}

// A D1 that enforces `id TEXT PRIMARY KEY` AND honors SQLite's OR IGNORE
// conflict clause, so the stub can't flatter either outcome.
function makeDb() {
  const rows = new Set<string>();
  const mk = (sql: string, id?: string) => ({
    __sql: sql, __id: id,
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => ({ results: [] })),
    first: vi.fn(async () => null),
  });
  return {
    rows,
    prepare: vi.fn((sql: string) => ({
      ...mk(sql),
      bind: vi.fn((...args: unknown[]) => mk(sql, String(args[0]))),
    })),
    batch: vi.fn(async (stmts: Array<{ __sql?: string; __id?: string }>) => {
      for (const s of stmts) {
        if (!s.__id) continue;
        if (rows.has(s.__id)) {
          if (/OR\s+IGNORE/i.test(s.__sql ?? '')) continue;      // conflict ignored
          throw new Error('D1_ERROR: UNIQUE constraint failed: elle_session_bus.id');
        }
      }
      for (const s of stmts) if (s.__id) rows.add(s.__id);
      return [];
    }),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
  };
}

// Regression: SWARM_INGESTION_AND_STORAGE_LIFECYCLE_PLAN.md §6.1 (poison pill)
// and §6.2 (KV eviction races). flushStaged commits to D1 first and purges KV
// second, so an isolate that dies in that window leaves the keys staged. With a
// plain INSERT against `id TEXT PRIMARY KEY` the replay raised UNIQUE, and since
// D1 batch() is one transaction that failure took the whole chunk of up to 50
// with it and purged nothing — wedging the queue permanently on every later
// flush. Inserts are now OR IGNORE, which is the correct semantics for
// at-least-once delivery keyed by a stable id.
describe('KV staging — an interrupted purge replays cleanly (§6.1/§6.2)', () => {
  it('does not permanently poison the queue when keys survive a committed batch', async () => {
    const staged = {
      'staging:a': { id: 'a', key: 'staging:a', lane: 'primary', direction: 'to_cloud', kind: 'llm', wire: 'w-a' },
      'staging:b': { id: 'b', key: 'staging:b', lane: 'primary', direction: 'to_cloud', kind: 'llm', wire: 'w-b' },
    };
    const kv = makeKv(staged);
    const db = makeDb();
    const env = { SESSIONS: kv, DB: db } as never;

    // Flush 1: D1 commits, then the isolate dies mid-purge.
    kv.state.deleteFails = true;
    const r1 = await flushStaged(env, {});
    expect(r1.flushed).toBe(2);
    expect(kv.store.size).toBe(2);            // keys survived the commit
    expect(r1.stagedKeysPurged).toBe(0);      // and must not claim otherwise

    // Flush 2: same ids replay against rows that already exist.
    kv.state.deleteFails = false;
    const r2 = await flushStaged(env, {});

    expect(r2.status).not.toBe('error');
    expect(kv.store.size).toBe(0);            // queue drains instead of wedging
    expect(db.rows.size).toBe(2);             // and no duplicate rows
  });
});
