import { describe, it, expect, vi } from 'vitest';
import { denseQuery, embedQuery, type DenseEnv } from './dense';

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
