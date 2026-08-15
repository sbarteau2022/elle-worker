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

describe('runRouter — parallel tool execution ({"tools":[...]})', () => {
  it('dispatches multiple independent tools concurrently and feeds all observations back in one step', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'need two things', tools: [{ tool: 'calc', args: { expression: '1+1' } }, { tool: 'calc', args: { expression: '2+2' } }] }),
        geminiResponse({ answer: 'got both' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.answer).toBe('got both');
    expect(result.trace).toHaveLength(2);
    expect(result.trace.map(t => t.result).sort()).toEqual(['2', '4']);
    expect(result.steps).toBe(1); // one loop iteration produced both calls
  });

  it('advertises the parallel-tools protocol to hospitality scope too, not just full/public', async () => {
    // HOSPITALITY_TOOLS routinely wants independent lookups run together
    // (rapid_costs + rapid_pos for one question) — but the hospitality
    // system prompt used to be a hand-written early-return that never
    // mentioned {"tools":[...]} at all, so the model had no way to know
    // batching was even an option. Pin both halves: the prompt sent to the
    // model advertises it, and dispatch actually honors it end-to-end.
    const fetchFn = stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'need two things', tools: [{ tool: 'calc', args: { expression: '1+1' } }, { tool: 'calc', args: { expression: '2+2' } }] }),
        geminiResponse({ answer: 'got both' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'hospitality', sessionId: null });
    expect(result.answer).toBe('got both');
    expect(result.trace).toHaveLength(2);
    expect(result.steps).toBe(1);

    const firstCall = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const firstCallBody = JSON.parse(firstCall[1].body as string);
    const systemText = firstCallBody.system_instruction.parts[0].text as string;
    expect(systemText).toContain('"tools":[{"tool":"<name>"');
    expect(systemText).not.toContain('query_rapid2ai'); // stale tool name that never existed in this scope's catalog
  });

  it('caps a step at MAX_PARALLEL_TOOLS even if the model requests more', async () => {
    const requested = Array.from({ length: 6 }, (_, i) => ({ tool: 'calc', args: { expression: `${i}+${i}` } }));
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [geminiResponse({ tools: requested }), geminiResponse({ answer: 'done' })],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null });
    expect(result.trace).toHaveLength(4);
  });

  it('one failing call in the batch does not take down the others', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tools: [{ tool: 'calc', args: { expression: '1+1' } }, { tool: 'search_corpus', args: { q: 'x' } }] }),
        geminiResponse({ answer: 'ok' }),
      ],
    });
    const deps = makeDeps({ ragSearch: vi.fn(async () => { throw new Error('corpus down'); }) });
    const result = await runRouter('q', makeEnv(), deps, { scope: 'public', sessionId: null });
    expect(result.trace.find(t => t.tool === 'calc')?.result).toBe('2');
    // runTool catches this internally (its own try/catch) and returns a
    // failure STRING rather than throwing — same convention as the
    // single-tool path; the parallel dispatcher's own catch is a second,
    // defense-in-depth layer for the rarer case where runTool itself throws.
    expect(result.trace.find(t => t.tool === 'search_corpus')?.result).toContain('failed');
  });
});

describe('runRouter — opt-in planning pass (opts.plan)', () => {
  it('does not fire by default — no extra call, no behavior change', async () => {
    const fn = stubFetchRoutes({ 'generativelanguage.googleapis.com': [geminiResponse({ answer: 'hi' })] });
    await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never fires outside full scope even when explicitly requested', async () => {
    const fn = stubFetchRoutes({ 'generativelanguage.googleapis.com': [geminiResponse({ answer: 'hi' })] });
    await runRouter('q', makeEnv(), makeDeps(), { scope: 'public', sessionId: null, plan: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('when requested, makes one extra plain-text planning call and injects the plan into the next call\'s system context', async () => {
    const fn = stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiText('1. search the corpus for background\n2. answer'),
        geminiResponse({ answer: 'answered with plan' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null, plan: true });
    expect(result.answer).toBe('answered with plan');
    expect(fn).toHaveBeenCalledTimes(2);
    const secondCall = fn.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(secondCall[1].body as string);
    expect(body.system_instruction.parts[0].text).toContain('search the corpus for background');
  });

  it('a DIRECT verdict contributes no plan block (the question needs no research)', async () => {
    const fn = stubFetchRoutes({
      'generativelanguage.googleapis.com': [geminiText('DIRECT'), geminiResponse({ answer: 'ok' })],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null, plan: true });
    expect(result.answer).toBe('ok');
    const secondCall = fn.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(secondCall[1].body as string);
    expect(body.system_instruction.parts[0].text).not.toContain('ROUGH PLAN');
  });
});

describe('runTool — advisor (frontier escalation, budget-capped)', () => {
  const baseCtx = { userId: 'u1', sessionId: 's1' as string | null, runId: 'r1' };

  it('refuses cheaply when no Anthropic key is configured — the tool is dormant until founders-program credits land', async () => {
    const fn = stubFetchRoutes({});
    const out = await runTool('advisor', {}, makeEnv(), makeDeps(), { userId: 'u1', sessionId: null, transcript: [], advisorBudget: { used: 0, max: 3 } }, 'full');
    expect(out).toContain('not configured');
    expect(fn).not.toHaveBeenCalled();
  });

  it('reports unavailable when no transcript/budget context is passed', async () => {
    const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const out = await runTool('advisor', {}, env, makeDeps(), { userId: 'u1', sessionId: null }, 'full');
    expect(out).toBe('advisor: not available in this context');
  });

  it('is hidden from the prompt catalog when no key is configured, and appears once one is set', async () => {
    // No key: the system prompt sent to the model must not advertise advisor.
    const fnBare = stubFetchRoutes({ 'generativelanguage.googleapis.com': [geminiResponse({ answer: 'hi' })] });
    await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null });
    const bareCall = fnBare.mock.calls[0] as unknown as [string, RequestInit];
    const bareSystem = JSON.parse(bareCall[1].body as string).system_instruction.parts[0].text as string;
    expect(bareSystem).not.toContain('advisor()');
    vi.unstubAllGlobals();
    // Key present: the same prompt now carries it.
    const fnKeyed = stubFetchRoutes({ 'generativelanguage.googleapis.com': [geminiResponse({ answer: 'hi' })] });
    await runRouter('q', makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }), makeDeps(), { scope: 'full', sessionId: null });
    const keyedCall = fnKeyed.mock.calls[0] as unknown as [string, RequestInit];
    const keyedSystem = JSON.parse(keyedCall[1].body as string).system_instruction.parts[0].text as string;
    expect(keyedSystem).toContain('advisor()');
  });

  it('forwards the transcript to Claude, returns the advice, and spends one budget slot', async () => {
    stubFetchRoutes({ 'api.anthropic.com': [{ content: [{ type: 'text', text: 'try X instead' }] }] });
    const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const ctx = { ...baseCtx, transcript: [{ role: 'user' as const, content: 'stuck on Y' }], advisorBudget: { used: 0, max: 3 } };

    const out = await runTool('advisor', {}, env, makeDeps(), ctx, 'full');

    expect(out).toBe('try X instead');
    expect(ctx.advisorBudget.used).toBe(1);
  });

  it('refuses once the budget is spent, without calling Anthropic at all', async () => {
    const fn = stubFetchRoutes({ 'api.anthropic.com': [{ content: [{ type: 'text', text: 'advice' }] }] });
    const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const ctx = { ...baseCtx, transcript: [], advisorBudget: { used: 3, max: 3 } };

    const out = await runTool('advisor', {}, env, makeDeps(), ctx, 'full');

    expect(out).toContain('budget spent');
    expect(fn).not.toHaveBeenCalled();
  });

  it('degrades cleanly instead of throwing when the consult itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const ctx = { ...baseCtx, transcript: [], advisorBudget: { used: 0, max: 3 } };

    const out = await runTool('advisor', {}, env, makeDeps(), ctx, 'full');

    expect(out).toContain('consult failed');
    // The budget is spent on a genuine attempt, successful or not — otherwise
    // a consistently-failing advisor never actually gets capped.
    expect(ctx.advisorBudget.used).toBe(1);
  });

  it('logs the consult to advisor_calls', async () => {
    stubFetchRoutes({ 'api.anthropic.com': [{ content: [{ type: 'text', text: 'advice' }] }] });
    const statements: string[] = [];
    const db = { prepare: vi.fn((sql: string) => { statements.push(sql); return { bind: vi.fn(() => ({ run: vi.fn(async () => ({ success: true })) })) }; }) };
    const env = makeEnv({ ANTHROPIC_API_KEY: 'k', DB: db });
    const ctx = { ...baseCtx, transcript: [{ role: 'user' as const, content: 'hi' }], advisorBudget: { used: 0, max: 3 } };

    await runTool('advisor', {}, env, makeDeps(), ctx, 'full');

    expect(statements.some(sql => sql.includes('INSERT INTO advisor_calls'))).toBe(true);
  });
});

describe('runRouter — verification pass (devilTool second opinion on consequential runs)', () => {
  it('runs devilTool when a WRITE tool fired in privileged scope, and attaches the verdict without altering the answer', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'remember', args: { note: 'a decision worth keeping around for a while' } }),
        geminiResponse({ answer: 'noted, and I will remember this important decision we just made together here' }),
        geminiResponse({ verdict: 'holds', strongest_objection: 'none found', missed_case: '', the_tell: '', what_would_change_my_mind: '' }),
      ],
    });
    const result = await runRouter('remember this', makeEnv(), makeDeps(), { scope: 'full', sessionId: null });
    expect(result.answer).toBe('noted, and I will remember this important decision we just made together here');
    expect(result.verification?.verdict).toBe('holds');
  });

  it('skips verification when no WRITE tool was used', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'calc', args: { expression: '1+1' } }),
        geminiResponse({ answer: 'the answer is two, a purely computational result with no state change' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'full', sessionId: null });
    expect(result.verification).toBeUndefined();
  });

  it('skips verification outside privileged scope even when a write tool fires', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'remember', args: { note: 'something worth keeping for later reference here' } }),
        geminiResponse({ answer: 'got it, noted for later use in our ongoing conversation together' }),
      ],
    });
    const result = await runRouter('q', makeEnv(), makeDeps(), { scope: 'member', sessionId: null });
    expect(result.verification).toBeUndefined();
  });
});
