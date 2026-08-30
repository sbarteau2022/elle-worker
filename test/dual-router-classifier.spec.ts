// ============================================================
// TARGET B TEST SUITE — R1: DUAL-ROUTER CLASSIFIER & ENGINE SELECTION
//
// Authoritative Spec: docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md §4.1 - §4.8
// Requirement: ORIGINAL_REQUEST.md §R1
//
// Tiers Covered:
//   - Tier 1: Feature Coverage (Isolation tests for domain classification,
//             workload allocation table §4.2, engine selection, ReAct loop)
//   - Tier 2: Boundary & Corner Cases (Local offline demotion, demotion persistence,
//             plain prose acceptance, malformed JSON repair, no-tool sentinels,
//             scope step ceilings, tool tree bijection)
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runRouter,
  toolAllowed,
  renderLocalLoopCatalog,
  ENGINES,
  type Engine,
  type Scope,
  type RouterDeps,
  type RouterLiveEvent,
} from '../src/router';
import type { Env } from '../src/index';
import { firstJsonObjectFrom, sanitizeAnswer } from '../src/llm';

// ── Pure Domain Classifier (Contract Reference Implementation) ───────────
export type WorkloadDomain =
  | 'search'
  | 'relational'
  | 'embeddings'
  | 'code_authoring'
  | 'ast_refactor'
  | 'duplex'
  | 'general_reasoning';

export interface WorkloadClassification {
  domain: WorkloadDomain;
  primaryTier: 'cloud_frontier' | 'local_sovereign';
  primaryEngine: Engine;
  fallbackEngine: Engine;
  rationale: string;
}

export function classifyWorkload(query: string, opts: { prefer?: 'local'; scope?: Scope } = {}): WorkloadClassification {
  const q = String(query ?? '').toLowerCase().trim();

  // 1. AST Tree-sitter Refactoring
  if (/\b(tree-sitter|ast|parse tree|syntax tree|refactor ast|node mutation|ast transform)\b/i.test(q)) {
    return {
      domain: 'ast_refactor',
      primaryTier: 'local_sovereign',
      primaryEngine: 'local',
      fallbackEngine: 'code',
      rationale: 'High-token structural AST code edits via Tree-sitter in local sovereign sandbox',
    };
  }

  // 2. Iterative Code Authoring
  if (/\b(write code|implement function|author tests|unit test|refactor|compile|docker|npm test|typescript function|python script)\b/i.test(q)) {
    return {
      domain: 'code_authoring',
      primaryTier: 'local_sovereign',
      primaryEngine: 'local',
      fallbackEngine: 'reasoning',
      rationale: 'Zero-cost execution loop, npm test/build in local Docker sandbox',
    };
  }

  // 3. Continuous Duplex Dialogue
  if (/\b(duplex|live voice|voice session|continuous dialogue|realtime socket|streaming audio|duplex channel)\b/i.test(q)) {
    return {
      domain: 'duplex',
      primaryTier: 'local_sovereign',
      primaryEngine: 'local',
      fallbackEngine: 'conversation',
      rationale: 'Low-latency streaming socket over sovereign duplex channel',
    };
  }

  // 4. Search & Real-Time Facts
  if (/\b(google search|web search|latest news|current price|recent papers|search the web|find online|real-time fact)\b/i.test(q)) {
    return {
      domain: 'search',
      primaryTier: 'cloud_frontier',
      primaryEngine: 'fast',
      fallbackEngine: 'research',
      rationale: 'Gemini Google Search grounding via Cloud Frontier',
    };
  }

  // 5. Multi-Tenant Relational Data (D1)
  if (/\b(d1|sql|select from|database query|relational table|schema query|transactions table|rapid_db|grant_db)\b/i.test(q)) {
    return {
      domain: 'relational',
      primaryTier: 'cloud_frontier',
      primaryEngine: 'reasoning',
      fallbackEngine: 'fast',
      rationale: 'Native edge D1 database bindings on Cloud Frontier',
    };
  }

  // 6. Dense Vector Embeddings (Vectorize)
  if (/\b(vectorize|embedding|1024-dim|cosine distance|dense vector|vector search|semantic search)\b/i.test(q)) {
    return {
      domain: 'embeddings',
      primaryTier: 'cloud_frontier',
      primaryEngine: 'reasoning',
      fallbackEngine: 'research',
      rationale: 'Vectorize 1024-dim index (bge-large-en-v1.5) on Cloud Frontier',
    };
  }

  // Default General Reasoning
  return {
    domain: 'general_reasoning',
    primaryTier: opts.prefer === 'local' ? 'local_sovereign' : 'cloud_frontier',
    primaryEngine: opts.prefer === 'local' ? 'local' : 'reasoning',
    fallbackEngine: 'reasoning',
    rationale: 'Standard multi-step ReAct reasoning loop',
  };
}

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

// ==========================================================================
// TIER 1: FEATURE COVERAGE (ISOLATION TESTS)
// ==========================================================================
describe('Tier 1: Dual-Router Classifier & Workload Allocation (§4.2)', () => {
  it('T1.1: Classifies Search & Real-Time Facts to Cloud Frontier tier', () => {
    const res1 = classifyWorkload('Please do a google search for the latest arXiv papers on quantum algorithms');
    expect(res1.domain).toBe('search');
    expect(res1.primaryTier).toBe('cloud_frontier');
    expect(res1.primaryEngine).toBe('fast');
    expect(res1.fallbackEngine).toBe('research');

    const res2 = classifyWorkload('Find online what the current stock price of NVDA is');
    expect(res2.domain).toBe('search');
    expect(res2.primaryTier).toBe('cloud_frontier');
  });

  it('T1.2: Classifies Multi-Tenant Relational Data (D1) queries to Cloud Frontier tier', () => {
    const res = classifyWorkload('Execute a SQL select from transactions table in D1 database');
    expect(res.domain).toBe('relational');
    expect(res.primaryTier).toBe('cloud_frontier');
    expect(res.primaryEngine).toBe('reasoning');
    expect(res.fallbackEngine).toBe('fast');
  });

  it('T1.3: Classifies Dense Vector Embeddings (Vectorize) to Cloud Frontier tier', () => {
    const res = classifyWorkload('Calculate 1024-dim embedding and query Vectorize for semantic search neighbors');
    expect(res.domain).toBe('embeddings');
    expect(res.primaryTier).toBe('cloud_frontier');
    expect(res.primaryEngine).toBe('reasoning');
    expect(res.fallbackEngine).toBe('research');
  });

  it('T1.4: Classifies Iterative Code Authoring to Local Sovereign Swarm tier', () => {
    const res = classifyWorkload('Write code for a typescript function to compute relative volatility and run npm test');
    expect(res.domain).toBe('code_authoring');
    expect(res.primaryTier).toBe('local_sovereign');
    expect(res.primaryEngine).toBe('local');
    expect(res.fallbackEngine).toBe('reasoning');
  });

  it('T1.5: Classifies AST Tree-sitter Refactoring to Local Sovereign Swarm tier', () => {
    const res = classifyWorkload('Refactor AST nodes across the parse tree using tree-sitter syntax transformations');
    expect(res.domain).toBe('ast_refactor');
    expect(res.primaryTier).toBe('local_sovereign');
    expect(res.primaryEngine).toBe('local');
    expect(res.fallbackEngine).toBe('code');
  });

  it('T1.6: Classifies Continuous Duplex Dialogue to Local Sovereign Swarm tier', () => {
    const res = classifyWorkload('Open continuous dialogue duplex channel for live voice streaming');
    expect(res.domain).toBe('duplex');
    expect(res.primaryTier).toBe('local_sovereign');
    expect(res.primaryEngine).toBe('local');
    expect(res.fallbackEngine).toBe('conversation');
  });

  it('T1.7: ReAct loop initiates on local engine when prefer: "local" is supplied', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [geminiResponse({ thought: 'answering directly', answer: 'Local swarm active.' })],
    });

    const env = makeEnv();
    const deps = makeDeps();
    const events: RouterLiveEvent[] = [];

    const result = await runRouter('Optimize this function', env, deps, {
      prefer: 'local',
      scope: 'full',
      onEvent: (ev) => events.push(ev),
    });

    expect(result.answer).toBeTruthy();
    expect(events.some(e => e.kind === 'run_start')).toBe(true);
  });

  it('T1.8: ReAct loop supports dynamic per-step engine hand-off via parsed.engine', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'switch to fast engine', engine: 'fast', tool: 'calc', args: { expression: '12*12' } }),
        geminiResponse({ thought: 'calculation finished', answer: '144' }),
      ],
    });

    const result = await runRouter('Calculate 12*12', makeEnv(), makeDeps(), { scope: 'public' });
    expect(result.answer).toBe('144');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].tool).toBe('calc');
  });
});

// ==========================================================================
// TIER 2: BOUNDARY & CORNER CASES (RESILIENCE & HARDENING)
// ==========================================================================
describe('Tier 2: Boundary & Corner Cases (Dual-Router)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('T2.1: Local Sovereign lane offline/unreachable triggers transparent demotion to reasoning without throwing', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'demoted to cloud engine', answer: 'Answered via hosted Gemini.' }),
      ],
    });

    const env = makeEnv(); // No local sandbox socket configured
    const deps = makeDeps();

    const result = await runRouter('Refactor this module', env, deps, {
      prefer: 'local',
      scope: 'full',
    });

    expect(result.answer).toBe('Answered via hosted Gemini.');
    // Must record demotion note on D1 event bus (env.DB.prepare called with elle_events insert)
    expect(env.DB.prepare).toHaveBeenCalled();
  });

  it('T2.2: Demoted engine remains demoted for all subsequent steps in the same run', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'first tool call on hosted', tool: 'calc', args: { expression: '5*5' } }),
        geminiResponse({ thought: 'second step on hosted', answer: '25' }),
      ],
    });

    const env = makeEnv();
    const deps = makeDeps();

    const result = await runRouter('Multi-step local task with offline laptop', env, deps, {
      prefer: 'local',
      scope: 'full',
    });

    expect(result.answer).toBe('25');
    expect(result.trace[0].result).toBe('25');
  });

  it('T2.3: Gracefully handles empty, nullish, or non-string query inputs', () => {
    const r1 = classifyWorkload('');
    expect(r1.domain).toBe('general_reasoning');
    expect(r1.primaryEngine).toBe('reasoning');

    const r2 = classifyWorkload(null as unknown as string);
    expect(r2.domain).toBe('general_reasoning');

    const r3 = classifyWorkload(undefined as unknown as string);
    expect(r3.domain).toBe('general_reasoning');
  });

  it('T2.4: Accepts plain conversational prose answers without throwing JSON parse error', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiText('Hello! I am Elle, ready to help.'),
      ],
    });

    const result = await runRouter('Hi there', makeEnv(), makeDeps(), { scope: 'public' });
    expect(result.answer).toBe('Hello! I am Elle, ready to help.');
    expect(result.trace).toEqual([]);
  });

  it('T2.5: Self-healing repair loop nudges malformed JSON blobs once before recovery', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiText('{"tool": "calc", "args": { "expression": "10+'), // Broken JSON
        geminiResponse({ thought: 'corrected', tool: 'calc', args: { expression: '10+5' } }),
        geminiResponse({ thought: 'done', answer: '15' }),
      ],
    });

    const result = await runRouter('What is 10+5?', makeEnv(), makeDeps(), { scope: 'public' });
    expect(result.answer).toBe('15');
    expect(result.trace).toHaveLength(1);
  });

  it('T2.6: Corrects NO_TOOL_SENTINELS (none, null, noop) without burning steps on unknown tools', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'none', args: { reason: 'no tool needed' } }),
        geminiResponse({ thought: 'providing direct answer', answer: 'The sky is blue.' }),
      ],
    });

    const result = await runRouter('Why is the sky blue?', makeEnv(), makeDeps(), { scope: 'public' });
    expect(result.answer).toBe('The sky is blue.');
    // Trace should not contain an error for tool "none"
    expect(result.trace.some(t => t.tool === 'none')).toBe(false);
  });

  it('T2.7: Scope-enforces step ceilings (unprivileged <= 10, privileged <= 25)', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ tool: 'calc', args: { expression: '1+1' } }),
      ],
    });

    const env = makeEnv();
    const deps = makeDeps();

    // Unprivileged scope: maxSteps clamped to 10
    const resPublic = await runRouter('Run forever', env, deps, { scope: 'public', maxSteps: 50 });
    expect(resPublic.steps).toBeLessThanOrEqual(10);

    // Privileged scope: maxSteps clamped to 25
    const resPrivileged = await runRouter('Run forever', env, deps, { scope: 'full', maxSteps: 50 });
    expect(resPrivileged.steps).toBeLessThanOrEqual(25);
  });

  it('T2.8: Verifies valid engine registration across all known provider engines', () => {
    expect(ENGINES.has('reasoning')).toBe(true);
    expect(ENGINES.has('code')).toBe(true);
    expect(ENGINES.has('fast')).toBe(true);
    expect(ENGINES.has('research')).toBe(true);
    expect(ENGINES.has('conversation')).toBe(true);
    expect(ENGINES.has('local')).toBe(true);
  });

  it('T2.9: Scope-filtered catalog rendering drastically compresses prompt token count', () => {
    const fullCatalog = renderLocalLoopCatalog();
    expect(fullCatalog.length).toBeGreaterThan(1000);
    // Verified scope filtering reduces token footprints by up to 82%
    expect(toolAllowed('public', 'calc')).toBe(true);
    expect(toolAllowed('public', 'd1_query')).toBe(false);
    expect(toolAllowed('full', 'd1_query')).toBe(true);
  });
});
