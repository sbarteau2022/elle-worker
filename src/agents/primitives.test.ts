import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeStructured } from './primitives';
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
