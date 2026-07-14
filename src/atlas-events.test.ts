import { describe, it, expect } from 'vitest';
import * as atlasEvents from './atlas-events';
import { logAtlasEvents, logCoRecallEvents, readAtlasEvents, type AtlasEventsEnv, type AtlasEventRow } from './atlas-events';

// In-memory D1 stand-in that actually executes the three statements this
// module issues (CREATE TABLE / INSERT / SELECT ... WHERE id > ?), so the
// tests exercise real cursor semantics, not just pinned SQL text.
function fakeEnv() {
  const rows: AtlasEventRow[] = [];
  let nextId = 1;
  const mkStmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mkStmt(sql, a),
    async run() { return { success: true }; },
    async all() {
      const since = Number(args[0]) || 0;
      const limit = Number(args[1]) || 500;
      return { results: rows.filter((r) => r.id > since).sort((a, b) => a.id - b.id).slice(0, limit) };
    },
    async first() { return null; },
    _insert(a: unknown[]) {
      rows.push({ id: nextId++, kind: String(a[0]), src: String(a[1]), dst: String(a[2]), weight: Number(a[3]), ts: Number(a[4]) });
    },
    _sql: sql, _args: args,
  });
  const db = {
    prepare: (sql: string) => mkStmt(sql),
    async batch(stmts: Array<ReturnType<typeof mkStmt>>) {
      for (const s of stmts) if (s._sql.startsWith('INSERT')) s._insert(s._args);
      return stmts.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
  return { env: { DB: db } as AtlasEventsEnv, rows };
}

describe('logAtlasEvents (append-only ledger)', () => {
  it('appends valid events with a caller-visible count', async () => {
    const { env, rows } = fakeEnv();
    const n = await logAtlasEvents(env, [
      { kind: 'assoc', src: 'a', dst: 'b' },
      { kind: 'derived', src: 'a', dst: 'c', weight: 0.5 },
    ], 1234);
    expect(n).toBe(2);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ kind: 'assoc', src: 'a', dst: 'b', weight: 1, ts: 1234 });
    expect(rows[1].weight).toBe(0.5);
  });

  it('drops self-loops and malformed events, clamps negative weight to 0', async () => {
    const { env, rows } = fakeEnv();
    const n = await logAtlasEvents(env, [
      { kind: 'assoc', src: 'a', dst: 'a' },
      { kind: '', src: 'a', dst: 'b' },
      { kind: 'assoc', src: 'a', dst: 'b', weight: -3 },
    ]);
    expect(n).toBe(1);
    expect(rows[0].weight).toBe(0);
  });

  it('the module exports no update or delete — the ledger is append-only by construction', () => {
    const names = Object.keys(atlasEvents);
    expect(names.some((n) => /update|delete|remove|prune|clear/i.test(n))).toBe(false);
  });
});

describe('logCoRecallEvents (the recall-time hook)', () => {
  it('logs the pairwise co-occurrences of the top cap ids — same pairs recordAssociations bumps', async () => {
    const { env, rows } = fakeEnv();
    const n = await logCoRecallEvents(env, ['m1', 'm2', 'm3']);
    expect(n).toBe(3); // C(3,2)
    expect(rows.every((r) => r.kind === 'assoc')).toBe(true);
    const pairs = rows.map((r) => `${r.src}-${r.dst}`).sort();
    expect(pairs).toEqual(['m1-m2', 'm1-m3', 'm2-m3']);
  });

  it('is a no-op for fewer than two distinct ids', async () => {
    const { env, rows } = fakeEnv();
    expect(await logCoRecallEvents(env, ['m1', 'm1'])).toBe(0);
    expect(rows.length).toBe(0);
  });

  it('caps at C(cap,2) pairs no matter how many ids a recall returns', async () => {
    const { env } = fakeEnv();
    const many = Array.from({ length: 40 }, (_, i) => `m${i}`);
    expect(await logCoRecallEvents(env, many)).toBe(10); // C(5,2) at default cap 5
  });
});

describe('readAtlasEvents (the device pull, cursor-paginated)', () => {
  it('serves oldest-first pages with a monotone cursor and an honest `more` flag', async () => {
    const { env } = fakeEnv();
    await logAtlasEvents(env, Array.from({ length: 7 }, (_, i) => ({ kind: 'assoc', src: `a${i}`, dst: `b${i}` })));
    const p1 = await readAtlasEvents(env, 0, 3);
    expect(p1.events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(p1.cursor).toBe(3);
    expect(p1.more).toBe(true);
    const p2 = await readAtlasEvents(env, p1.cursor, 3);
    expect(p2.events.map((e) => e.id)).toEqual([4, 5, 6]);
    const p3 = await readAtlasEvents(env, p2.cursor, 3);
    expect(p3.events.map((e) => e.id)).toEqual([7]);
    expect(p3.more).toBe(false);
    // Re-pulling from the final cursor is a stable empty page, not a reset.
    const p4 = await readAtlasEvents(env, p3.cursor, 3);
    expect(p4.events).toEqual([]);
    expect(p4.cursor).toBe(p3.cursor);
  });

  it('never serves an event twice across pages', async () => {
    const { env } = fakeEnv();
    await logAtlasEvents(env, Array.from({ length: 10 }, (_, i) => ({ kind: 'assoc', src: `a${i}`, dst: `b${i}` })));
    const seen = new Set<number>();
    let cursor = 0;
    for (let guard = 0; guard < 10; guard++) {
      const page = await readAtlasEvents(env, cursor, 4);
      for (const e of page.events) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
      cursor = page.cursor;
      if (!page.more) break;
    }
    expect(seen.size).toBe(10);
  });
});
