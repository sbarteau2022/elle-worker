import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { callLLM, runLLM, jsonLLM } from './llm';
import type { LLMEnv } from './llm';

// A fetch stub that routes by URL substring; records every URL it saw so a test
// can assert which hosted providers were (and were NOT) reached.
function stubFetch(routes: Array<{ match: string; ok?: boolean; status?: number; json?: unknown; text?: string }>) {
  const seen: string[] = [];
  const fn = vi.fn(async (url: string) => {
    seen.push(String(url));
    const r = routes.find(x => String(url).includes(x.match));
    if (!r) throw new Error(`unrouted fetch: ${url}`);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      text: async () => r.text ?? '',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { seen, fn };
}

afterEach(() => vi.unstubAllGlobals());

describe("callLLM prefer:'local' — autonomous callers spare hosted quota", () => {
  it('uses Workers AI (free pool) and never touches a hosted provider when only env.AI is present', async () => {
    const { seen } = stubFetch([{ match: 'openrouter.ai' }]); // would throw if reached
    const run = vi.fn(async () => ({ response: 'from-workers-ai' }));
    const env = { AI: { run } } as unknown as LLMEnv;

    const out = await callLLM('conversation', 'sys', [{ role: 'user', content: 'hi' }], 100, env, { prefer: 'local' });

    expect(out.provider).toBe('workers-ai');
    expect(out.content).toBe('from-workers-ai');
    expect(run).toHaveBeenCalledOnce();
    expect(seen).toHaveLength(0); // no hosted fetch at all
  });

  it('prefers self-hosted Ollama over Workers AI when LLM_OLLAMA_URL is set', async () => {
    const { seen } = stubFetch([
      { match: '/api/chat', json: { message: { content: 'from-ollama' } } },
    ]);
    const run = vi.fn(async () => ({ response: 'from-workers-ai' }));
    const env = { AI: { run }, LLM_OLLAMA_URL: 'http://ollama.test' } as unknown as LLMEnv;

    const out = await callLLM('reasoning', 'sys', [{ role: 'user', content: 'hi' }], 100, env, { prefer: 'local' });

    expect(out.provider).toBe('ollama');
    expect(out.content).toBe('from-ollama');
    expect(run).not.toHaveBeenCalled(); // Workers AI never reached
    expect(seen.some(u => u.includes('/api/chat'))).toBe(true);
  });
});

describe('callLLM lane order — Workers AI first, hosted free chain as fallback', () => {
  it('answers from Workers AI without touching any hosted provider (no prefer flag needed)', async () => {
    const { seen } = stubFetch([{ match: 'openrouter.ai' }]); // would be recorded if reached
    const run = vi.fn(async () => ({ response: 'from-workers-ai' }));
    const env = { AI: { run }, LLM_OPENROUTER_KEY: 'sk-or-test' } as unknown as LLMEnv;

    const out = await callLLM('conversation', 'sys', [{ role: 'user', content: 'hi' }], 100, env);

    expect(out.provider).toBe('workers-ai');
    expect(out.content).toBe('from-workers-ai');
    expect(seen).toHaveLength(0); // hosted chain never reached
  });

  it('falls back to the hosted router chain when the Workers AI pool errors, without retrying it', async () => {
    const { seen } = stubFetch([
      { match: 'openrouter.ai', json: { choices: [{ message: { content: 'from-openrouter' } }] } },
    ]);
    const run = vi.fn(async () => { throw new Error('neuron allocation exhausted'); });
    const env = { AI: { run }, LLM_OPENROUTER_KEY: 'sk-or-test' } as unknown as LLMEnv;

    const out = await callLLM('conversation', 'sys', [{ role: 'user', content: 'hi' }], 100, env);

    expect(out.provider).toBe('openrouter');
    expect(out.content).toBe('from-openrouter');
    // callWorkersAI tries 70B then the 8B fallback = 2 run() calls, and the
    // tail-end safety net must NOT re-ask the same exhausted pool afterwards.
    expect(run).toHaveBeenCalledTimes(2);
    expect(seen.some(u => u.includes('openrouter.ai'))).toBe(true);
  });

  it("keeps 'research' hosted-first — Workers AI cannot do live search grounding", async () => {
    const { seen } = stubFetch([
      { match: 'generativelanguage.googleapis.com', json: { candidates: [{ content: { parts: [{ text: 'grounded answer' }] } }] } },
    ]);
    const run = vi.fn(async () => ({ response: 'from-workers-ai' }));
    const env = { AI: { run }, LLM_GEMINI_KEY: 'AIza-test' } as unknown as LLMEnv;

    const out = await callLLM('research', 'sys', [{ role: 'user', content: 'hi' }], 100, env);

    expect(out.provider).toBe('gemini');
    expect(run).not.toHaveBeenCalled();
    expect(seen.some(u => u.includes('generativelanguage.googleapis.com'))).toBe(true);
  });
});

describe('callExtraFreeTiers — Groq is reached as a free fallback tier', () => {
  it('falls through to Groq when OpenRouter fails and LLM_GROQ_KEY is set', async () => {
    const { seen } = stubFetch([
      { match: 'openrouter.ai', ok: false, status: 429, text: 'rate limited' },
      { match: 'api.groq.com', json: { choices: [{ message: { content: 'from-groq' } } ] } },
    ]);
    const env = { LLM_GROQ_KEY: 'gsk_test' } as unknown as LLMEnv;

    const out = await callLLM('conversation', 'sys', [{ role: 'user', content: 'hi' }], 100, env);

    expect(out.provider).toBe('groq');
    expect(out.content).toBe('from-groq');
    expect(seen.some(u => u.includes('openrouter.ai'))).toBe(true); // tried first
    expect(seen.some(u => u.includes('api.groq.com'))).toBe(true);  // then Groq
  });
});

describe('runLLM — thin text wrapper over callLLM', () => {
  it('returns the response content as a plain string', async () => {
    const run = vi.fn(async () => ({ response: 'plain text answer' }));
    const env = { AI: { run } } as unknown as LLMEnv;

    const out = await runLLM(env, 'say hi', { prefer: 'local' });

    expect(out).toBe('plain text answer');
  });
});

const RouteSchema = z.object({
  selected_route: z.enum(['billing', 'support', 'sales']),
});

describe('jsonLLM — schema-validated structured output with one repair retry', () => {
  it('parses and validates a well-formed JSON response on the first try', async () => {
    const run = vi.fn(async () => ({ response: '{"selected_route":"billing"}' }));
    const env = { AI: { run } } as unknown as LLMEnv;

    const out = await jsonLLM(env, 'route this ticket', RouteSchema, { task: 'conversation', prefer: 'local' });

    expect(out.repaired).toBe(false);
    expect(out.data.selected_route).toBe('billing');
    expect(run).toHaveBeenCalledOnce();
  });

  it('retries once with the validation error and succeeds on the repaired reply', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ response: '{"selected_route":"not-a-real-route"}' })
      .mockResolvedValueOnce({ response: '{"selected_route":"support"}' });
    const env = { AI: { run } } as unknown as LLMEnv;

    const out = await jsonLLM(env, 'route this ticket', RouteSchema, { prefer: 'local' });

    expect(out.repaired).toBe(true);
    expect(out.data.selected_route).toBe('support');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('throws after the repair retry also fails validation', async () => {
    const run = vi.fn(async () => ({ response: 'not json at all' }));
    const env = { AI: { run } } as unknown as LLMEnv;

    await expect(jsonLLM(env, 'route this ticket', RouteSchema, { prefer: 'local' })).rejects.toThrow(/schema validation failed/);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
