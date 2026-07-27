import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeStructured, generateWithEvaluator } from './primitives';
import type { LLMEnv } from '../llm';

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

const ROUTES = {
  billing: 'account charges, invoices, refunds',
  support: 'how-to / troubleshooting questions',
  sales: 'upgrades, new plans, pricing',
};

describe('routeStructured', () => {
  it('returns the selected route when the model answers with a valid route name', async () => {
    stubFetch([{ match: 'openrouter.ai', json: { choices: [{ message: { content: '{"selected_route":"billing"}' } }] } }]);
    const env = {} as unknown as LLMEnv;

    const out = await routeStructured(env, 'why was I charged twice?', ROUTES);

    expect(out).toEqual({ selectedRoute: 'billing' });
  });

  it('rejects a route name outside the schema enum, forcing the repair retry', async () => {
    const fn = stubFetch([
      { match: 'openrouter.ai', json: { choices: [{ message: { content: '{"selected_route":"not-a-real-route"}' } }] } },
    ]);
    const env = {} as unknown as LLMEnv;

    // Both attempts return the same invalid route — jsonLLM retries once then throws.
    await expect(routeStructured(env, 'q', ROUTES)).rejects.toThrow(/schema validation failed/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws synchronously for fewer than two routes, without calling any provider', async () => {
    const fn = stubFetch([]);
    const env = {} as unknown as LLMEnv;
    await expect(routeStructured(env, 'q', { only: 'one option' })).rejects.toThrow(/at least two options/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('generateWithEvaluator — the Looping_Agent_Workflow pattern, capped at 3', () => {
  // prefer:'local' rides env.AI.run; generator and evaluator alternate calls.
  function aiSequence(...responses: string[]) {
    let i = 0;
    return { run: vi.fn(async () => ({ response: responses[Math.min(i++, responses.length - 1)] })) };
  }

  it('returns on the first PASS', async () => {
    const ai = aiSequence('the draft', '{"status":"PASS","feedback":"meets every criterion"}');
    const env = { AI: ai } as unknown as LLMEnv;

    const out = await generateWithEvaluator(env, 'write X', 'must mention X', { prefer: 'local' });

    expect(out.passed).toBe(true);
    expect(out.iterations).toBe(1);
    expect(out.output).toBe('the draft');
    expect(out.feedback).toEqual([]);
  });

  it('feeds FAIL feedback back into the generator with the prior attempt attached', async () => {
    const ai = aiSequence(
      'draft one',
      '{"status":"FAIL","feedback":"missing the deadline"}',
      'draft two with the deadline',
      '{"status":"PASS","feedback":"good"}',
    );
    const env = { AI: ai } as unknown as LLMEnv;

    const out = await generateWithEvaluator(env, 'write X', 'must include the deadline', { prefer: 'local' });

    expect(out.passed).toBe(true);
    expect(out.iterations).toBe(2);
    expect(out.feedback).toEqual(['missing the deadline']);
    // The second generator call must carry both the prior attempt and the feedback.
    const secondGenPrompt = JSON.stringify(ai.run.mock.calls[2]);
    expect(secondGenPrompt).toContain('draft one');
    expect(secondGenPrompt).toContain('missing the deadline');
  });

  it('stops at 3 iterations and returns the last attempt honestly marked unpassed', async () => {
    const ai = aiSequence(
      'd1', '{"status":"FAIL","feedback":"f1"}',
      'd2', '{"status":"FAIL","feedback":"f2"}',
      'd3', '{"status":"FAIL","feedback":"f3"}',
    );
    const env = { AI: ai } as unknown as LLMEnv;

    const out = await generateWithEvaluator(env, 'write X', 'impossible bar', { prefer: 'local' });

    expect(out.passed).toBe(false);
    expect(out.iterations).toBe(3);
    expect(out.feedback).toEqual(['f1', 'f2', 'f3']);
    expect(ai.run).toHaveBeenCalledTimes(6); // 3 generate + 3 evaluate, then a hard stop
  });
});
