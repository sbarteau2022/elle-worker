import { describe, it, expect, vi, afterEach } from 'vitest';
import { rerank } from './rerank';
import type { LLMEnv } from '../llm';
import type { WorkersAIEnv } from './rerank';

// Same fetch-stub pattern as src/llm.test.ts — routes by URL substring.
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

const PASSAGES = [
  { id: 'c1', text: 'Contextual retrieval prepends generated context to each chunk.' },
  { id: 'c2', text: 'The capital of France is Paris.' },
  { id: 'c3', text: 'Reciprocal rank fusion combines dense and sparse rankings.' },
];

describe('rerank — workers-ai strategy', () => {
  it('maps response indices back to passage ids and sorts by score', async () => {
    const run = vi.fn(async () => ({
      response: [
        { id: 1, score: 0.1 }, // c2 — low relevance
        { id: 0, score: 0.9 }, // c1 — high relevance
        { id: 2, score: 0.5 }, // c3 — mid relevance
      ],
    }));
    const env = { AI: { run } } as unknown as LLMEnv & WorkersAIEnv;

    const out = await rerank(env, 'what is contextual retrieval?', PASSAGES, 2, { strategy: 'workers-ai' });

    expect(out).toEqual([
      { id: 'c1', score: 0.9 },
      { id: 'c3', score: 0.5 },
    ]);
    expect(run).toHaveBeenCalledWith('@cf/baai/bge-reranker-base', expect.objectContaining({ query: 'what is contextual retrieval?' }));
  });

  it('throws if env.AI is not bound', async () => {
    await expect(rerank({} as any, 'q', PASSAGES, 2, { strategy: 'workers-ai' })).rejects.toThrow(/env\.AI/);
  });
});

describe('rerank — llm strategy (default fallback)', () => {
  it('parses the scored JSON array and returns topK sorted by score', async () => {
    stubFetch([
      {
        match: 'openrouter.ai',
        json: { choices: [{ message: { content: '{"scores":[{"id":"c1","score":9},{"id":"c2","score":1},{"id":"c3","score":6}]}' } }] },
      },
    ]);
    const env = {} as unknown as LLMEnv;

    const out = await rerank(env, 'what is contextual retrieval?', PASSAGES, 2, { strategy: 'llm' });

    expect(out).toEqual([
      { id: 'c1', score: 9 },
      { id: 'c3', score: 6 },
    ]);
  });

  it('scores an unmentioned passage as 0 rather than dropping the request', async () => {
    stubFetch([
      { match: 'openrouter.ai', json: { choices: [{ message: { content: '{"scores":[{"id":"c1","score":9}]}' } }] } },
    ]);
    const env = {} as unknown as LLMEnv;

    const out = await rerank(env, 'q', PASSAGES, 3, { strategy: 'llm' });

    expect(out.find(r => r.id === 'c2')).toEqual({ id: 'c2', score: 0 });
    expect(out.find(r => r.id === 'c3')).toEqual({ id: 'c3', score: 0 });
  });
});

describe('rerank — edge cases', () => {
  it('returns an empty array for no passages without calling any provider', async () => {
    const run = vi.fn();
    const env = { AI: { run } } as unknown as LLMEnv;
    expect(await rerank(env, 'q', [], 5)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
