import { describe, it, expect, vi, afterEach } from 'vitest';
import { runRouter, runTool, type RouterDeps } from './router';
import type { Env } from './index';

// ============================================================
// Safety-net coverage for the core ReAct loop (runRouter) and tool
// dispatch (runTool) — previously exercised only indirectly, through
// scope-gate tests (scope.test.ts, chat-scope-pressure-test.test.ts) that
// never call either function for real. These tests pin down the CURRENT
// behavior of the step loop (malformed-JSON retry, unknown-tool handling,
// engine hand-off, steps-exhausted synthesis) so future changes to
// router.ts have something to check against instead of "looks right."
// ============================================================

function geminiText(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}
function geminiResponse(obj: unknown) {
  return geminiText(JSON.stringify(obj));
}
function openrouterResponse(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

// Routes fetch by URL substring; each route gets its own response queue,
// consumed in order (the last response repeats if a route is called more
// times than it has queued responses).
function stubFetchRoutes(routes: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  const fn = vi.fn(async (url: string) => {
    const match = Object.keys(routes).find(m => String(url).includes(m));
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

afterEach(() => vi.unstubAllGlobals());

function makeDb() {
  const stmt = () => ({
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => ({ results: [] })),
    first: vi.fn(async () => null),
  });
  return { prepare: vi.fn(() => ({ ...stmt(), bind: vi.fn(() => stmt()) })) };
}

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return { DB: makeDb(), LLM_GEMINI_KEY: 'test-key', ...overrides } as unknown as Env;
}

function makeDeps(overrides: Partial<RouterDeps> = {}): RouterDeps {
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
    ...overrides,
  };
}

describe('runRouter — the step loop', () => {
  it('returns the answer directly when the model needs no tool', async () => {
    stubFetchRoutes({ 'generativelanguage.googleapis.com': [geminiResponse({ thought: 'just answer', answer: 'Hello there.' })] });
    const result = await runRouter('hi', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toBe('Hello there.');
    expect(result.trace).toEqual([]);
  });

  it('dispatches a tool call, feeds the observation back, and returns the eventual answer', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'compute it', tool: 'calc', args: { expression: '1+1' } }),
        geminiResponse({ thought: 'done', answer: 'The answer is 2.' }),
      ],
    });
    const result = await runRouter('what is 1+1?', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toBe('The answer is 2.');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({ tool: 'calc', result: '2' });
  });

  it('nudges once on malformed-but-JSON-looking output, then accepts a clean retry', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiText('{"tool":"calc","args":{'), // truncated — looks like JSON, isn't valid
        geminiResponse({ answer: 'recovered' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null, maxSteps: 3 });
    expect(result.answer).toBe('recovered');
  });

  it('accepts plain prose with no JSON envelope as the answer (a bare greeting)', async () => {
    stubFetchRoutes({ 'generativelanguage.googleapis.com': [geminiText('Hello! How can I help?')] });
    const result = await runRouter('hi', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toBe('Hello! How can I help?');
  });

  it('feeds "unknown tool" back as an observation and continues, rather than crashing', async () => {
    // 'full' scope, so this exercises runTool's switch default: — not the
    // scope gate, which would report the same-shaped-but-different message
    // ("not available in this scope") for a name outside the current scope.
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'not_a_real_tool', args: {} }),
        geminiResponse({ answer: 'recovered after bad tool' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null });
    expect(result.answer).toBe('recovered after bad tool');
    expect(result.trace[0].result).toContain('unknown tool');
  });

  it('treats tool:"none" as a protocol slip and nudges for a direct answer, without burning a tool step', async () => {
    // Seen live on a quota-drained day: a small fallback model emitted
    // {"tool":"none","args":{"reason":"exceeded quota limit"}} to say "no tool
    // needed", and the loop fed `unknown tool "none"` back as an observation.
    // The sentinel path skips dispatch entirely — no trace entry, just a nudge.
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'quota issue', tool: 'none', args: { reason: 'exceeded quota limit' } }),
        geminiResponse({ answer: 'answered directly after the nudge' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null });
    expect(result.answer).toBe('answered directly after the nudge');
    expect(result.trace).toEqual([]);
  });

  it('refuses a tool outside the current scope without crashing the loop', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'read_sql', args: { sql: 'SELECT 1' } }), // read_sql is full-scope only
        geminiResponse({ answer: 'ok, skipping that' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.trace[0].result).toContain('not available in this scope');
    expect(result.answer).toBe('ok, skipping that');
  });

  it('honors a valid engine hand-off for the NEXT call', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [geminiResponse({ tool: 'calc', args: { expression: '1+1' }, engine: 'code' })],
      'openrouter.ai': [openrouterResponse({ answer: 'done via code engine' })],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toBe('done via code engine');
  });

  it('ignores an invalid engine value and keeps running on the current engine', async () => {
    const fetchFn = stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'calc', args: { expression: '1+1' }, engine: 'not-a-real-engine' }),
        geminiResponse({ answer: 'still on reasoning' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toBe('still on reasoning');
    expect(fetchFn.mock.calls.every(([url]) => String(url).includes('generativelanguage.googleapis.com'))).toBe(true);
  });

  it('forces a synthesis answer when steps run out without the model ever answering', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'calc', args: { expression: '1+1' } }),
        geminiResponse({ tool: 'calc', args: { expression: '2+2' } }),
        geminiResponse({ answer: 'synthesized from what I gathered' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null, maxSteps: 2 });
    expect(result.answer).toBe('synthesized from what I gathered');
    expect(result.steps).toBe(2);
    expect(result.trace).toHaveLength(2);
  });

  it('degrades to a clean message instead of throwing when the whole provider chain is unreachable', async () => {
    const fn = vi.fn(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', fn);
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toMatch(/could not reach a model/i);
  });
});

describe('runTool — dispatch', () => {
  const ctx = { userId: 'u1', sessionId: null };

  it('calc: deterministic arithmetic, no LLM involved', async () => {
    const out = await runTool('calc', { expression: '2 * (3 + 4)' }, makeEnv(), makeDeps(), ctx, 'full');
    expect(out).toBe('14');
  });

  it('an unrecognized tool name returns "unknown tool", not a throw', async () => {
    const out = await runTool('definitely_not_a_tool', {}, makeEnv(), makeDeps(), ctx, 'full');
    expect(out).toBe('unknown tool "definitely_not_a_tool"');
  });

  it('refuses a tool the scope does not allow, before dispatch', async () => {
    const out = await runTool('read_sql', { sql: 'SELECT 1' }, makeEnv(), makeDeps(), ctx, 'public');
    expect(out).toBe('tool "read_sql" is not available in this scope');
  });

  it('wraps a thrown dependency error as a tool-failure observation instead of propagating', async () => {
    const deps = makeDeps({ ragSearch: vi.fn(async () => { throw new Error('corpus unavailable'); }) });
    const out = await runTool('search_corpus', { q: 'anything' }, makeEnv(), deps, ctx, 'full');
    expect(out).toBe('tool "search_corpus" failed: corpus unavailable');
  });

  describe('read_sql — guardSelect', () => {
    it('rejects multiple statements', async () => {
      const out = await runTool('read_sql', { sql: 'SELECT 1; DROP TABLE users' }, makeEnv(), makeDeps(), ctx, 'full');
      expect(out).toContain('only a single statement is allowed');
    });

    it('rejects a write/DDL statement', async () => {
      const out = await runTool('read_sql', { sql: 'DELETE FROM elle_memory' }, makeEnv(), makeDeps(), ctx, 'full');
      expect(out).toContain('SELECT/WITH');
    });

    it('rejects a write keyword embedded inside an otherwise SELECT-shaped statement', async () => {
      const out = await runTool('read_sql', { sql: "SELECT * FROM (DELETE FROM elle_memory RETURNING *)" }, makeEnv(), makeDeps(), ctx, 'full');
      expect(out).toContain('write/DDL keywords are not allowed');
    });

    it('accepts a plain SELECT and auto-adds a LIMIT when none is given', async () => {
      const all = vi.fn(async () => ({ results: [{ n: 1 }] }));
      const env = makeEnv({ DB: { prepare: vi.fn(() => ({ all })) } });
      const out = await runTool('read_sql', { sql: 'SELECT 1 AS n' }, env, makeDeps(), ctx, 'full');
      const parsed = JSON.parse(out);
      expect(parsed.sql).toMatch(/LIMIT 200$/);
      expect(parsed.rows).toEqual([{ n: 1 }]);
    });

    it('rejects empty SQL', async () => {
      const out = await runTool('read_sql', { sql: '' }, makeEnv(), makeDeps(), ctx, 'full');
      expect(out).toContain('empty sql');
    });
  });
});
