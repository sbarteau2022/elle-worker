// ============================================================
// DUAL-ROUTER CLASSIFIER & ENGINE SELECTION UNIT TEST SUITE
//
// Spec Reference: docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md §4.1 - §4.8
// Requirement: R1 (Dual-Router Classifier & Engine Selection)
//
// Tests:
//   1. Domain classification across all 6 Section 4.2 workload domains
//   2. Local sovereign lane pre-flight availability check and transparent demotion
//   3. Never-throw guarantee on null/broken env or empty/malformed questions
//   4. ReAct multi-step loop execution with dual-router selection & per-step handoff
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyEngineSelection,
  isLocalLaneAvailable,
  runRouter,
  ENGINES,
  type Engine,
  type Scope,
  type RouterDeps,
  type RouterLiveEvent,
} from './router';
import type { Env } from './index';

// ── Test Harness Helpers ──────────────────────────────────────────────────
function geminiResponse(obj: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] };
}
function geminiText(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
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
  return { prepare: vi.fn(() => ({ ...stmt(), bind: vi.fn(() => stmt()) })) };
}

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    DB: makeDb(),
    LLM_GEMINI_KEY: 'test-key',
    ...overrides,
  } as unknown as Env;
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

describe('Dual-Router Classifier — Workload Allocation (§4.2)', () => {
  const localEnv = makeEnv({ SANDBOX_AGENT_KEY: 'test-sandbox-key' });
  const offlineEnv = makeEnv(); // No SANDBOX_AGENT_KEY

  describe('Search & Real-Time Facts Domain -> Cloud Frontier (Gemini/Research)', () => {
    it('routes web search queries to research or reasoning engine', () => {
      const q1 = 'search the web for latest TypeScript 5.5 release features';
      const engine1 = classifyEngineSelection(q1, 'full', undefined, localEnv);
      expect(engine1).toBe('research');

      const q2 = 'Please do a google search for recent research papers on LLM routing';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('research');

      const q3 = 'What is the current stock price of NVDA today?';
      const engine3 = classifyEngineSelection(q3, 'full', undefined, localEnv);
      expect(['reasoning', 'research']).toContain(engine3);
    });

    it('routes live fact queries to Cloud Frontier tier', () => {
      const q = 'Who won the championship in latest news?';
      const engine = classifyEngineSelection(q, 'public', undefined, localEnv);
      expect(['reasoning', 'research']).toContain(engine);
    });
  });

  describe('Multi-Tenant Relational Data (D1) Domain -> Cloud Frontier (reasoning)', () => {
    it('routes SQL table queries and D1 relational operations to reasoning engine', () => {
      const q1 = 'Execute a SQL select from elle_trades where pnl > 0';
      const engine1 = classifyEngineSelection(q1, 'full', undefined, localEnv);
      expect(engine1).toBe('reasoning');

      const q2 = 'Query D1 database schema for grant_organizations table';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('reasoning');

      const q3 = 'SELECT * FROM corpus_papers ORDER BY ingested_at DESC';
      const engine3 = classifyEngineSelection(q3, 'full', undefined, localEnv);
      expect(engine3).toBe('reasoning');

      const q4 = 'Inspect transactions table in rapid_db database';
      const engine4 = classifyEngineSelection(q4, 'hospitality', undefined, localEnv);
      expect(engine4).toBe('reasoning');
    });
  });

  describe('Dense Vector Embeddings (Vectorize) Domain -> Cloud Frontier (reasoning)', () => {
    it('routes Vectorize embeddings and semantic vector queries to reasoning engine', () => {
      const q1 = 'Calculate 1024-dim embedding and query Vectorize for semantic search neighbors';
      const engine1 = classifyEngineSelection(q1, 'full', undefined, localEnv);
      expect(engine1).toBe('reasoning');

      const q2 = 'Execute dense vector search over corpus chunks using bge-large-en-v1.5';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('reasoning');

      const q3 = 'Find nearest cosine distance embedding similarity in vector index';
      const engine3 = classifyEngineSelection(q3, 'member', undefined, localEnv);
      expect(engine3).toBe('reasoning');
    });
  });

  describe('Iterative Code Authoring Domain -> Local Sovereign (Qwen) / Demotes to Reasoning', () => {
    it('routes code authoring and test execution to local engine when sovereign lane is online', () => {
      const q1 = 'Write code for a typescript function to compute relative volatility and run npm test';
      const engine1 = classifyEngineSelection(q1, 'full', undefined, localEnv);
      expect(engine1).toBe('local');

      const q2 = 'Implement function to parse json and author unit tests in vitest';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('local');

      const q3 = 'Execute bash commands to build project in docker sandbox container';
      const engine3 = classifyEngineSelection(q3, 'full', undefined, localEnv);
      expect(engine3).toBe('local');

      const q4 = 'Write a python script to validate data and run pytest';
      const engine4 = classifyEngineSelection(q4, 'full', undefined, localEnv);
      expect(engine4).toBe('local');
    });

    it('demotes code authoring to reasoning engine when sovereign lane is offline', () => {
      const q = 'Write code for a typescript function and run tests';
      const engine = classifyEngineSelection(q, 'full', undefined, offlineEnv);
      expect(engine).toBe('reasoning');
    });
  });

  describe('AST Tree-sitter Refactoring Domain -> Local Sovereign (Qwen) / Demotes to Reasoning', () => {
    it('routes AST tree-sitter refactoring to local engine when sovereign lane is online', () => {
      const q1 = 'Refactor AST nodes across the parse tree using tree-sitter syntax transformations';
      const engine1 = classifyEngineSelection(q1, 'full', undefined, localEnv);
      expect(engine1).toBe('local');

      const q2 = 'Perform structural refactoring using abstract syntax tree mutations';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('local');

      const q3 = 'Rename symbol across codebase using tree-sitter AST traversal';
      const engine3 = classifyEngineSelection(q3, 'full', undefined, localEnv);
      expect(engine3).toBe('local');
    });

    it('demotes AST refactoring to reasoning engine when sovereign lane is offline', () => {
      const q = 'Refactor AST nodes using tree-sitter';
      const engine = classifyEngineSelection(q, 'full', undefined, offlineEnv);
      expect(engine).toBe('reasoning');
    });
  });

  describe('Continuous Duplex Dialogue Domain -> Local Sovereign (Qwen) / Demotes to Reasoning', () => {
    it('routes continuous duplex dialogue to local engine when sovereign lane is online', () => {
      const q1 = 'Open continuous dialogue duplex channel for live voice streaming';
      const engine1 = classifyEngineSelection(q1, 'full', undefined, localEnv);
      expect(engine1).toBe('local');

      const q2 = 'Connect duplex audio socket for real-time speech stream';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('local');

      const q3 = 'Initiate continuous duplex voice session';
      const engine3 = classifyEngineSelection(q3, 'member', undefined, localEnv);
      expect(engine3).toBe('local');
    });

    it('demotes continuous duplex dialogue to reasoning engine when sovereign lane is offline', () => {
      const q = 'Open continuous dialogue duplex channel for live voice streaming';
      const engine = classifyEngineSelection(q, 'full', undefined, offlineEnv);
      expect(engine).toBe('reasoning');
    });
  });

  describe('General Reasoning & Dialogue Default', () => {
    it('routes standard chat and general questions to reasoning engine', () => {
      const q1 = 'What is the nature of consciousness and cognition?';
      const engine1 = classifyEngineSelection(q1, 'public', undefined, localEnv);
      expect(engine1).toBe('reasoning');

      const q2 = 'Help me summarize our strategy discussion';
      const engine2 = classifyEngineSelection(q2, 'full', undefined, localEnv);
      expect(engine2).toBe('reasoning');
    });
  });
});

describe('Local Availability Pre-Flight & Transparent Demotion', () => {
  afterEach(() => vi.restoreAllMocks());

  it('isLocalLaneAvailable returns true only when SANDBOX_AGENT_KEY is present and path not closed', () => {
    expect(isLocalLaneAvailable(undefined)).toBe(false);
    expect(isLocalLaneAvailable(makeEnv({ SANDBOX_AGENT_KEY: '' }))).toBe(false);
    expect(isLocalLaneAvailable(makeEnv({ SANDBOX_AGENT_KEY: 'valid-key' }))).toBe(true);
    expect(isLocalLaneAvailable(makeEnv({ SANDBOX_AGENT_KEY: 'valid-key', SANDBOX_PATH_OPEN: false }))).toBe(false);
    expect(isLocalLaneAvailable(makeEnv({ SANDBOX_AGENT_KEY: 'valid-key', LOCAL_LANE_OPEN: false }))).toBe(false);
    expect(isLocalLaneAvailable(makeEnv({ SANDBOX_AGENT_KEY: 'valid-key', path_open: false }))).toBe(false);
  });

  it('honors opts.prefer === "local" when local lane is available', () => {
    const env = makeEnv({ SANDBOX_AGENT_KEY: 'valid-key' });
    const engine = classifyEngineSelection('Any general question', 'full', { prefer: 'local' }, env);
    expect(engine).toBe('local');
  });

  it('transparently demotes opts.prefer === "local" to reasoning when local lane is offline with a log note', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = makeEnv(); // No SANDBOX_AGENT_KEY
    const engine = classifyEngineSelection('Any general question', 'full', { prefer: 'local' }, env);
    expect(engine).toBe('reasoning');
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('Local sovereign lane preferred but unavailable'))).toBe(true);
  });

  it('logs demotion warning when code authoring task is demoted due to offline lane', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = makeEnv();
    const engine = classifyEngineSelection('Write code and run tests', 'full', undefined, env);
    expect(engine).toBe('reasoning');
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('Resilience & Never-Throw Invariants', () => {
  it('never throws on empty, whitespace, null, or undefined question inputs', () => {
    expect(classifyEngineSelection('', 'full', undefined, makeEnv())).toBe('reasoning');
    expect(classifyEngineSelection('   \n\t  ', 'full', undefined, makeEnv())).toBe('reasoning');
    expect(classifyEngineSelection(null as unknown as string, 'full', undefined, makeEnv())).toBe('reasoning');
    expect(classifyEngineSelection(undefined as unknown as string, 'full', undefined, makeEnv())).toBe('reasoning');
  });

  it('never throws on null or undefined env', () => {
    expect(classifyEngineSelection('write code', 'full', undefined, undefined)).toBe('reasoning');
    expect(classifyEngineSelection('write code', 'full', undefined, null as unknown as Env)).toBe('reasoning');
    expect(classifyEngineSelection('search the web', 'full', undefined, undefined)).toBe('research');
  });

  it('never throws when env properties throw an error', () => {
    const brokenEnv = new Proxy({}, {
      get() {
        throw new Error('Access denied to env bindings');
      },
    }) as unknown as Env;

    expect(() => classifyEngineSelection('Write code for unit tests', 'full', undefined, brokenEnv)).not.toThrow();
    expect(classifyEngineSelection('Write code for unit tests', 'full', undefined, brokenEnv)).toBe('reasoning');
  });

  it('never throws on unexpected non-string object as question', () => {
    expect(classifyEngineSelection({ query: 'hello' } as unknown as string, 'full', undefined, makeEnv())).toBe('reasoning');
    expect(classifyEngineSelection(12345 as unknown as string, 'full', undefined, makeEnv())).toBe('reasoning');
  });
});

describe('ReAct Loop Step Execution with Dual-Router Selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runRouter initializes with auto-classified reasoning engine for general queries', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'reasoning step', answer: 'General query answered.' }),
      ],
    });

    const env = makeEnv();
    const deps = makeDeps();
    const result = await runRouter('What is the philosophy of mind?', env, deps, { scope: 'public' });
    expect(result.answer).toBe('General query answered.');
  });

  it('runRouter auto-classifies code authoring to local lane and demotes seamlessly when offline', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'demoted code task', answer: 'Code authored via hosted engine.' }),
      ],
    });

    const env = makeEnv(); // No sandbox key -> offline
    const deps = makeDeps();
    const result = await runRouter('Write code for a typescript function to calculate fibonacci', env, deps, { scope: 'full' });
    expect(result.answer).toBe('Code authored via hosted engine.');
  });

  it('runRouter executes tool dispatch and dynamic per-step engine hand-off', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'performing calc', engine: 'fast', tool: 'calc', args: { expression: '7*8' } }),
        geminiResponse({ thought: 'calculation complete', answer: '56' }),
      ],
    });

    const env = makeEnv();
    const deps = makeDeps();
    const result = await runRouter('Calculate 7*8', env, deps, { scope: 'public' });
    expect(result.answer).toBe('56');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({ tool: 'calc', result: '56' });
  });

  it('runRouter verifies engine registration validity for all ENGINES members', () => {
    expect(ENGINES.has('reasoning')).toBe(true);
    expect(ENGINES.has('code')).toBe(true);
    expect(ENGINES.has('fast')).toBe(true);
    expect(ENGINES.has('research')).toBe(true);
    expect(ENGINES.has('conversation')).toBe(true);
    expect(ENGINES.has('local')).toBe(true);
  });
});
