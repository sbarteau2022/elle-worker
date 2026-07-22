import { describe, it, expect, vi } from 'vitest';
import { ftsQuery } from './fts';

// Minimal D1Database stub: records the bound SQL/args and returns a fixed result.
function stubDb(results: Array<{ id: string; rank: number }>) {
  const bind = vi.fn(() => ({ all: vi.fn(async () => ({ results })) }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare } as unknown as D1Database, prepare, bind };
}

describe('ftsQuery', () => {
  it('rejects any non-corpus_public scope', async () => {
    const { db } = stubDb([]);
    await expect(ftsQuery(db, 'q', 'user:abc', 10)).rejects.toThrow(/only serves the public corpus/);
  });

  it('returns an empty array for a blank query without touching the DB', async () => {
    const { db, prepare } = stubDb([]);
    expect(await ftsQuery(db, '   ', 'corpus_public', 10)).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('quotes each term and ORs them, escaping embedded quotes', async () => {
    const { db, bind } = stubDb([{ id: 'c1', rank: -1.2 }]);
    await ftsQuery(db, 'threshold "v4" superposition', 'corpus_public', 5);
    expect(bind).toHaveBeenCalledWith('"threshold" OR """v4""" OR "superposition"', 5);
  });

  it('returns the query results as-is', async () => {
    const rows = [{ id: 'c1', rank: -2.1 }, { id: 'c2', rank: -1.0 }];
    const { db } = stubDb(rows);
    expect(await ftsQuery(db, 'hello', 'corpus_public', 10)).toEqual(rows);
  });
});
