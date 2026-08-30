import { describe, it, expect, vi, afterEach } from 'vitest';
import { runRouter, type RouterDeps } from './router';
import type { Env } from './index';

function geminiResponse(obj: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] };
}
function stubFetchRoutes(routes: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  const fn = vi.fn(async (url: string) => {
    const match = Object.keys(routes).find((m) => String(url).includes(m));
    if (!match) throw new Error(`unrouted fetch: ${url}`);
    const queue = routes[match];
    const i = counters[match] ?? 0;
    counters[match] = i + 1;
    const json = queue[Math.min(i, queue.length - 1)];
    return { ok: true, status: 200, json: async () => json, text: async () => '' } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
function makeDb() {
  const stmt = () => ({
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => ({ results: [] })),
    first: vi.fn(async () => null),
  });
  return {
    prepare: vi.fn(() => ({ ...stmt(), bind: vi.fn(() => stmt()) })),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
  };
}
function makeEnv(o: Record<string, unknown> = {}): Env {
  return { DB: makeDb(), LLM_GEMINI_KEY: 'test-key', ...o } as unknown as Env;
}
function makeDeps(): RouterDeps {
  return {
    embed: vi.fn(async () => [0.1]),
    ragSearch: vi.fn(async () => 'corpus result'),
    recallPastConversations: vi.fn(async () => ''),
    handleCodeEngine: vi.fn(async () => new Response(JSON.stringify({ response: 'ok' }))),
    handleIngest: vi.fn(async () => new Response('{}')),
    handleDiagnose: vi.fn(async () => new Response('{}')),
    handleResearch: vi.fn(async () => new Response(JSON.stringify({ content: '', search_results: '' }))),
    runLibreMode: vi.fn(async () => {}),
    journalWrite: vi.fn(async () => ({})),
    journalRead: vi.fn(async () => ({})),
    journalThread: vi.fn(async () => ({})),
    journalAnnotate: vi.fn(async () => ({})),
  } as RouterDeps;
}

afterEach(() => vi.unstubAllGlobals());

// Regression: DUAL_ROUTER_ARCHITECTURE_SPEC.md §4.7 — once the sovereign lane
// fails, the run "keeps running on hosted models for the remainder of the run
// to avoid paying repeated socket timeout penalties." The per-step engine
// hand-off (parsed.engine) could previously put the run straight back on
// 'local', and the system prompt advertises local as "free and quota-less", so
// the model re-picked it every step. Each re-pick costs a full
// pathOpen -> laneHeartbeat -> D1 round-trip against a laptop that is closed.
describe('Router — sovereign lane demotion is sticky (§4.7)', () => {
  it('demotes at most ONCE per run even when the model keeps re-selecting local', async () => {
    // Model asks for the local lane again on every step.
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 's1', engine: 'local', tool: 'calc', args: { expression: '1+1' } }),
        geminiResponse({ thought: 's2', engine: 'local', tool: 'calc', args: { expression: '2+2' } }),
        geminiResponse({ thought: 's3', engine: 'local', tool: 'calc', args: { expression: '3+3' } }),
        geminiResponse({ thought: 's4', answer: 'done' }),
      ],
    });
    const errs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errs.push(a.map(String).join(' '));
    });

    // Sandbox CONFIGURED (so the lane is attempted) but path never opens.
    const env = makeEnv({ SANDBOX_AGENT_KEY: 'k' });
    await runRouter('Write code for a fibonacci function', env, makeDeps(), {
      scope: 'full',
      prefer: 'local',
    });
    spy.mockRestore();

    const demotions = errs.filter((e) => e.includes('local lane unavailable, demoting to hosted'));
    // §4.7: "keeps running on hosted models for the remainder of the run
    // to avoid paying repeated socket timeout penalties."
    expect(demotions.length).toBe(1);
  });
});
