import { describe, it, expect, vi } from 'vitest';
import { denseQuery, embedAndUpsertContextual, embedQuery, type DenseEnv } from './dense';

describe('embedQuery', () => {
  it('truncates to 2000 chars and calls the confirmed embedding model', async () => {
    const run = vi.fn(async (_model: string, _inputs: Record<string, unknown>) => ({ data: [[0.1, 0.2, 0.3]] }));
    const env = { AI: { run } };

    const vec = await embedQuery(env, 'x'.repeat(3000));

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    const [model, inputs] = run.mock.calls[0];
    expect(model).toBe('@cf/baai/bge-large-en-v1.5');
    expect((inputs as { text: string[] }).text[0]).toHaveLength(2000);
  });

  it('throws if Workers AI returns no embedding data', async () => {
    const env = { AI: { run: vi.fn(async () => ({})) } };
    await expect(embedQuery(env, 'hi')).rejects.toThrow(/no embedding/);
  });
});

describe('denseQuery', () => {
  it('rejects any non-corpus_public scope', async () => {
    const env = { AI: { run: vi.fn() }, VECTORIZE: { query: vi.fn() } } as unknown as DenseEnv;
    await expect(denseQuery(env, [0.1], 'user:abc', 10)).rejects.toThrow(/only serves the public corpus/);
  });

  it('queries with the contextual_v1 variant filter and maps matches to {id, score}', async () => {
    const query = vi.fn(async () => ({
      matches: [
        { id: 'chunk-1', score: 0.9 },
        { id: 'chunk-2', score: 0.7 },
      ],
    }));
    const env = { AI: { run: vi.fn() }, VECTORIZE: { query } } as unknown as DenseEnv;

    const out = await denseQuery(env, [0.1, 0.2], 'corpus_public', 10);

    expect(out).toEqual([{ id: 'chunk-1', score: 0.9 }, { id: 'chunk-2', score: 0.7 }]);
    expect(query).toHaveBeenCalledWith([0.1, 0.2], expect.objectContaining({ topK: 10, filter: { variant: 'contextual_v1' } }));
  });

  it('defense-in-depth: strips conv-/jrnl-/mem- prefixed ids even if they somehow come back', async () => {
    const query = vi.fn(async () => ({
      matches: [
        { id: 'chunk-1', score: 0.9 },
        { id: 'conv-abc', score: 0.85 },
        { id: 'jrnl-def', score: 0.8 },
        { id: 'mem-ghi', score: 0.75 },
      ],
    }));
    const env = { AI: { run: vi.fn() }, VECTORIZE: { query } } as unknown as DenseEnv;

    const out = await denseQuery(env, [0.1], 'corpus_public', 10);

    expect(out).toEqual([{ id: 'chunk-1', score: 0.9 }]);
  });
});

describe('embedAndUpsertContextual', () => {
  it('upserts each chunk under its OWN vectorizeId, tagged variant=contextual_v1', async () => {
    const run = vi.fn(async () => ({ data: [[0.1, 0.2], [0.3, 0.4]] }));
    const upsert = vi.fn(async () => ({}));
    const env = { AI: { run }, VECTORIZE: { upsert } } as unknown as DenseEnv;

    await embedAndUpsertContextual(env, [
      { vectorizeId: 'ctxv1-c1', text: 'context one plus chunk one', paperId: 'p1', chunkIndex: 0 },
      { vectorizeId: 'ctxv1-c2', text: 'context two plus chunk two', paperId: 'p1', chunkIndex: 1 },
    ]);

    expect(upsert).toHaveBeenCalledWith([
      { id: 'ctxv1-c1', values: [0.1, 0.2], metadata: { paper_id: 'p1', chunk_index: 0, variant: 'contextual_v1' } },
      { id: 'ctxv1-c2', values: [0.3, 0.4], metadata: { paper_id: 'p1', chunk_index: 1, variant: 'contextual_v1' } },
    ]);
  });

  it('batches in groups of 25', async () => {
    const run = vi.fn(async (_model: string, inputs: Record<string, unknown>) => ({
      data: (inputs.text as string[]).map(() => [0.1]),
    }));
    const upsert = vi.fn(async () => ({}));
    const env = { AI: { run }, VECTORIZE: { upsert } } as unknown as DenseEnv;

    const chunks = Array.from({ length: 30 }, (_, i) => ({ vectorizeId: `ctxv1-c${i}`, text: `t${i}`, paperId: 'p1', chunkIndex: i }));
    await embedAndUpsertContextual(env, chunks);

    expect(run).toHaveBeenCalledTimes(2); // 25 + 5
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('throws if Workers AI returns a mismatched embedding count, rather than upserting misaligned vectors', async () => {
    const run = vi.fn(async () => ({ data: [[0.1, 0.2]] })); // 1 embedding for 2 chunks
    const upsert = vi.fn(async () => ({}));
    const env = { AI: { run }, VECTORIZE: { upsert } } as unknown as DenseEnv;

    await expect(
      embedAndUpsertContextual(env, [
        { vectorizeId: 'ctxv1-c1', text: 't1', paperId: 'p1', chunkIndex: 0 },
        { vectorizeId: 'ctxv1-c2', text: 't2', paperId: 'p1', chunkIndex: 1 },
      ])
    ).rejects.toThrow(/expected 2 embeddings, got 1/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
