import { describe, it, expect, vi } from 'vitest';
import { retrieve, type PipelineEnv } from './pipeline';

function stubDb(routes: Array<{ match: string; results: unknown[] }>) {
  const prepare = vi.fn((sql: string) => {
    const route = routes.find(r => sql.includes(r.match));
    return { bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: route?.results ?? [] })) })) };
  });
  return { prepare } as unknown as D1Database;
}

describe('retrieve — full pipeline (query -> [dense || fts] -> RRF -> rerank -> top-k)', () => {
  it('fuses dense + fts, reranks, and returns chunk/paper metadata for the winners', async () => {
    const run = vi.fn(async (model: string) => {
      if (model === '@cf/baai/bge-large-en-v1.5') return { data: [[0.1, 0.2]] };
      if (model === '@cf/baai/bge-reranker-base') return { response: [{ id: 0, score: 0.9 }, { id: 1, score: 0.2 }] };
      throw new Error(`unexpected model ${model}`);
    });
    // Both legs agree c1 > c2, so the fused order is unambiguous: [c1, c2].
    const query = vi.fn(async () => ({ matches: [{ id: 'c1', score: 0.95 }, { id: 'c2', score: 0.5 }] }));
    const db = stubDb([
      { match: 'corpus_chunks_fts', results: [{ id: 'c1', rank: -2.0 }, { id: 'c2', rank: -1.0 }] },
      {
        match: 'JOIN corpus_papers',
        results: [
          { id: 'c1', paper_id: 'p1', chunk_text: 'chunk one text', title: 'Paper One' },
          { id: 'c2', paper_id: 'p2', chunk_text: 'chunk two text', title: 'Paper Two' },
        ],
      },
    ]);
    const env = { AI: { run }, VECTORIZE: { query }, DB: db } as unknown as PipelineEnv;

    const out = await retrieve(env, 'what is contextual retrieval?', 'corpus_public', { rerankStrategy: 'workers-ai', finalTopK: 2 });

    expect(out).toEqual([
      { id: 'c1', score: 0.9, chunkText: 'chunk one text', paperId: 'p1', paperTitle: 'Paper One' },
      { id: 'c2', score: 0.2, chunkText: 'chunk two text', paperId: 'p2', paperTitle: 'Paper Two' },
    ]);
  });

  it('rejects any non-corpus_public scope before touching any binding', async () => {
    const env = {} as unknown as PipelineEnv;
    await expect(retrieve(env, 'q', 'user:x')).rejects.toThrow(/only serves the public corpus/);
  });

  it('returns an empty array when fusion yields nothing (no dense or fts hits)', async () => {
    const run = vi.fn(async () => ({ data: [[0.1]] }));
    const query = vi.fn(async () => ({ matches: [] }));
    const db = stubDb([{ match: 'corpus_chunks_fts', results: [] }]);
    const env = { AI: { run }, VECTORIZE: { query }, DB: db } as unknown as PipelineEnv;

    expect(await retrieve(env, 'q', 'corpus_public')).toEqual([]);
  });
});
