import { describe, it, expect, vi, afterEach } from 'vitest';
import { enqueueContextualBackfill, handleReembedMessage, reembedDocument, type ReembedEnv } from './reembed';

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

// A minimal in-memory corpus_chunks table, just enough to exercise the two
// real query shapes reembedDocument issues (pending-context vs. ready-to-
// embed) and the UPDATEs contextualizer.ts / reembed.ts make against them —
// so the test proves the two phases actually hand off to each other, not
// just that each SQL string was called once.
function fakeCorpusDb(rows: Array<{ id: string; chunk_text: string; embedding_status: string | null }>) {
  const table = new Map(rows.map(r => [r.id, { ...r, context_text: null as string | null, contextual_text: null as string | null, contextual_vectorize_id: null as string | null }]));
  const prepare = vi.fn((sql: string) => ({
    run: vi.fn(async () => ({ success: true })), // schema backfill's ALTER/CREATE/TRIGGER/rebuild statements
    bind: (...args: unknown[]) => ({
      run: vi.fn(async () => {
        if (sql.includes("embedding_status = 'contextualized', contextualized_at")) {
          const [context_text, contextual_text, context_source, , id] = args as [string, string, string, number, string];
          const row = table.get(id);
          if (row) Object.assign(row, { context_text, contextual_text, context_source, embedding_status: 'contextualized' });
        } else if (sql.includes("embedding_status = 'failed'")) {
          const row = table.get(args[0] as string);
          if (row) row.embedding_status = 'failed';
        } else if (sql.includes('contextual_vectorize_id = ?')) {
          const [contextualVectorizeId, id] = args as [string, string];
          const row = table.get(id);
          if (row) Object.assign(row, { contextual_vectorize_id: contextualVectorizeId, embedding_status: 'embedded' });
        }
        return { success: true };
      }),
      all: vi.fn(async () => {
        if (sql.includes("NOT IN ('contextualized', 'embedded')")) {
          const results = [...table.values()]
            .filter(r => r.embedding_status == null || !['contextualized', 'embedded'].includes(r.embedding_status))
            .map(r => ({ id: r.id, chunk_text: r.chunk_text }));
          return { results };
        }
        if (sql.includes("embedding_status = 'contextualized'")) {
          const results = [...table.values()]
            .filter(r => r.embedding_status === 'contextualized')
            .map((r, i) => ({ id: r.id, chunk_index: i, contextual_text: r.contextual_text }));
          return { results };
        }
        return { results: [] };
      }),
      first: vi.fn(async () => null),
    }),
  }));
  return { db: { prepare } as unknown as D1Database, table };
}

const PAPER = { id: 'p1', title: 'Test Paper', full_text: 'Whole document text about testing contextual retrieval.' };

describe('reembedDocument', () => {
  it('contextualizes pending chunks, then embeds+upserts the newly-contextualized ones, in one call', async () => {
    stubFetch([
      { match: 'generativelanguage.googleapis.com', json: { candidates: [{ content: { parts: [{ text: 'Explains testing.' }] } }] } },
    ]);
    const { db, table } = fakeCorpusDb([{ id: 'c1', chunk_text: 'about testing', embedding_status: null }]);
    const upsert = vi.fn(async () => ({}));
    const run = vi.fn(async () => ({ data: [[0.1, 0.2]] }));
    const env = { LLM_GEMINI_KEY: 'test-key', DB: db, AI: { run }, VECTORIZE: { upsert } } as unknown as ReembedEnv;

    const result = await reembedDocument(env, PAPER);

    expect(result).toEqual({ contextualized: { succeeded: 1, failed: 0 }, embedded: { succeeded: 1, failed: 0 } });
    const row = table.get('c1')!;
    expect(row.embedding_status).toBe('embedded');
    expect(row.contextual_vectorize_id).toBe('ctxv1-c1');
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'ctxv1-c1', metadata: expect.objectContaining({ variant: 'contextual_v1' }) }),
    ]);
  });

  it('skips already-embedded chunks entirely (idempotent re-run)', async () => {
    const fetchFn = stubFetch([]);
    const { db, table } = fakeCorpusDb([{ id: 'c1', chunk_text: 'x', embedding_status: 'embedded' }]);
    const env = { LLM_GEMINI_KEY: 'k', DB: db, AI: { run: vi.fn() }, VECTORIZE: { upsert: vi.fn() } } as unknown as ReembedEnv;

    const result = await reembedDocument(env, PAPER);

    expect(result).toEqual({ contextualized: { succeeded: 0, failed: 0 }, embedded: { succeeded: 0, failed: 0 } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(table.get('c1')!.embedding_status).toBe('embedded');
  });

  it('leaves a chunk contextualized (not embedded) if the embed/upsert step throws, so a retry only redoes that step', async () => {
    stubFetch([
      { match: 'generativelanguage.googleapis.com', json: { candidates: [{ content: { parts: [{ text: 'ctx' }] } }] } },
    ]);
    const { db, table } = fakeCorpusDb([{ id: 'c1', chunk_text: 'about testing', embedding_status: null }]);
    const run = vi.fn(async () => { throw new Error('Workers AI down'); });
    const env = { LLM_GEMINI_KEY: 'k', DB: db, AI: { run }, VECTORIZE: { upsert: vi.fn() } } as unknown as ReembedEnv;

    const result = await reembedDocument(env, PAPER);

    expect(result.embedded).toEqual({ succeeded: 0, failed: 1 });
    expect(table.get('c1')!.embedding_status).toBe('contextualized');
  });
});

describe('enqueueContextualBackfill', () => {
  it('sends one queue message per document with unfinished chunks', async () => {
    const results = [{ id: 'p1' }, { id: 'p2' }];
    const db = { prepare: vi.fn(() => ({ run: vi.fn(async () => ({})), all: vi.fn(async () => ({ results })) })) } as unknown as D1Database;
    const send = vi.fn(async () => {});
    const env = { DB: db, INGEST_QUEUE: { send } } as unknown as Parameters<typeof enqueueContextualBackfill>[0];

    const out = await enqueueContextualBackfill(env);

    expect(out).toEqual({ enqueued: 2 });
    expect(send).toHaveBeenCalledWith({ type: 'reembed_document', paper_id: 'p1' });
    expect(send).toHaveBeenCalledWith({ type: 'reembed_document', paper_id: 'p2' });
  });
});

describe('handleReembedMessage', () => {
  it('throws a clear error for a paper id that no longer exists', async () => {
    const db = {
      prepare: vi.fn(() => ({ run: vi.fn(async () => ({})), bind: vi.fn(() => ({ first: vi.fn(async () => null) })) })),
    } as unknown as D1Database;
    const env = { DB: db } as unknown as ReembedEnv;
    await expect(handleReembedMessage(env, 'missing')).rejects.toThrow(/paper missing not found/);
  });
});
