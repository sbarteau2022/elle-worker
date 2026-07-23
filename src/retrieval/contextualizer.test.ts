import { describe, it, expect, vi, afterEach } from 'vitest';
import { contextualizeDocument, type ContextualizeEnv } from './contextualizer';

function stubFetch(routes: Array<{ match: string; ok?: boolean; status?: number; json?: unknown }>) {
  const fn = vi.fn(async (url: string) => {
    const r = routes.find(x => String(url).includes(x.match));
    if (!r) throw new Error(`unrouted fetch: ${url}`);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json ?? {}, text: async () => '' } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

function stubDb() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => ({
    run: vi.fn(async () => {
      calls.push({ sql, args: [] });
      return { success: true };
    }),
    bind: vi.fn((...args: unknown[]) => ({
      run: vi.fn(async () => {
        calls.push({ sql, args });
        return { success: true };
      }),
      all: vi.fn(async () => ({ results: [] })),
      first: vi.fn(async () => null),
    })),
  }));
  return { db: { prepare } as unknown as D1Database, calls };
}

const PAPER = { id: 'p1', title: 'Test Paper', full_text: 'This is the whole document text about testing.' };
const CHUNKS = [{ id: 'c1', chunk_text: 'about testing' }];

describe('contextualizeDocument', () => {
  it('stores generated_context + " " + chunk_text as contextual_text (context PREPENDED, per §2.1)', async () => {
    stubFetch([
      { match: 'generativelanguage.googleapis.com', json: { candidates: [{ content: { parts: [{ text: 'Explains the testing methodology.' }] } }] } },
    ]);
    const { db, calls } = stubDb();
    const env = { LLM_GEMINI_KEY: 'test-key' } as unknown as ContextualizeEnv & { DB: D1Database };
    (env as any).DB = db;

    const result = await contextualizeDocument(env, PAPER, CHUNKS);

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    const update = calls.find(c => c.sql.includes('UPDATE corpus_chunks') && c.sql.includes('contextualized'));
    expect(update).toBeDefined();
    expect(update!.args[0]).toBe('Explains the testing methodology.');
    expect(update!.args[1]).toBe('Explains the testing methodology. about testing'); // context PREPENDED
    expect(update!.args[2]).toBe('full'); // short doc → 'full', not 'windowed'
  });

  it('marks the chunk failed (not silently dropped) after retries are exhausted', async () => {
    stubFetch([{ match: 'generativelanguage.googleapis.com', ok: false, status: 500 }]);
    const { db, calls } = stubDb();
    const env = { LLM_GEMINI_KEY: 'test-key' } as unknown as ContextualizeEnv & { DB: D1Database };
    (env as any).DB = db;

    const result = await contextualizeDocument(env, PAPER, CHUNKS, { maxRetries: 0 });

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    const failUpdate = calls.find(c => c.sql.includes("embedding_status = 'failed'"));
    expect(failUpdate).toBeDefined();
  });
});
