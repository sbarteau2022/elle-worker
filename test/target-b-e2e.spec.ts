// ============================================================
// TARGET B E2E TEST SUITE — TIERS 3 & 4: CROSS-FEATURE & WORKLOADS
//
// Authoritative Spec:
//   - docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md §4
//   - docs/SWARM_INGESTION_AND_STORAGE_LIFECYCLE_PLAN.md §3
//   - ORIGINAL_REQUEST.md §R1 - §R3
//
// Tiers Covered:
//   - Tier 3: Cross-Feature Combinations (KV Staging + Ingest Queue + Ingest Gate Dedup + Router Demotion)
//   - Tier 4: Real-World Application Workloads (High-volume submit bursts, code refactoring task allocation, multi-turn duplex session)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../src/index';
import {
  runRouter,
  type RouterDeps,
  type RouterLiveEvent,
  type Scope,
} from '../src/router';
import { classifyWorkload } from './dual-router-classifier.spec';
import { stageEntry, getStaged, listStagedKeys, flushStaged } from './kv-staging.spec';
import { InMemoryIngestQueue } from './ingest-queue.spec';
import { normalizeTitle, structuralReason } from '../src/ingest-gate';

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

function createMockKv() {
  const store = new Map<string, { value: string; expiration?: number }>();
  return {
    _store: store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, expiration: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? '';
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(k => ({ name: k }));
      return { keys };
    }),
  };
}

function createMockDb() {
  const executed: Array<{ sql: string; params: any[] }> = [];
  return {
    _executed: executed,
    prepare: vi.fn((sql: string) => {
      let bound: any[] = [];
      return {
        bind: vi.fn((...params: any[]) => {
          bound = params;
          return {
            _sql: sql,
            _params: bound,
            run: vi.fn(async () => {
              executed.push({ sql, params: bound });
              return { success: true };
            }),
            all: vi.fn(async () => ({ results: [] })),
            first: vi.fn(async () => null),
          };
        }),
      };
    }),
    batch: vi.fn(async (stmts: any[]) => {
      for (const s of stmts) {
        executed.push({ sql: s._sql, params: s._params });
      }
      return stmts.map(() => ({ success: true }));
    }),
  };
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
// TIER 3: CROSS-FEATURE COMBINATIONS
// ==========================================================================
describe('Tier 3: Cross-Feature Integration (Target B)', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as any,
      SCRATCHPAD: mockKv as any,
      DB: mockDb as any,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('T3.1: KV Staging + Ingest Queue Pipeline end-to-end flow', async () => {
    const queue = new InMemoryIngestQueue({ batchSize: 3, maxDepth: 50 });

    // Step 1: Stage raw items into KV
    const s1 = await stageEntry(env, 'lane_alpha', { step: 1, action: 'code_ast_scan' });
    const s2 = await stageEntry(env, 'lane_alpha', { step: 2, action: 'code_ast_mutate' });
    const s3 = await stageEntry(env, 'lane_alpha', { step: 3, action: 'code_ast_verify' });

    expect(s1.ok && s2.ok && s3.ok).toBe(true);

    // Step 2: Enqueue staged pointer envelopes
    await queue.enqueue(env, { stagedKey: s1.stageKey, lane: 'lane_alpha' });
    await queue.enqueue(env, { stagedKey: s2.stageKey, lane: 'lane_alpha' });
    const enq3 = await queue.enqueue(env, { stagedKey: s3.stageKey, lane: 'lane_alpha' });

    // Threshold 3 automatically flushes queue
    expect(enq3.status).toBe('flushed');
    expect(queue.getDepth()).toBe(0);

    // Step 3: Flush KV staged entries and purge
    const flushRes = await flushStaged(env);
    expect(flushRes.ok).toBe(true);
    expect(await listStagedKeys(env)).toEqual([]);
  });

  it('T3.2: Ingest Queue + Ingest Gate Deduplication prevents duplicate corpus ingestion', async () => {
    const queue = new InMemoryIngestQueue({ batchSize: 5, maxDepth: 20 });
    const validProse = Array.from({ length: 60 }, (_, i) => `word${i} provides analytical ground`).join(' ');

    const paperA = { title: 'Poincaré Gyrovector Synchronization', text: validProse, series: 'math', tag: 'geom' };
    const paperB = { title: 'Lyapunov Descent Dynamics', text: validProse, series: 'math', tag: 'dyn' };
    const paperADup = { title: 'poincaré gyrovector synchronization!', text: validProse, series: 'math', tag: 'geom' };

    const rA = await queue.enqueue(env, paperA);
    const rB = await queue.enqueue(env, paperB);
    const rADup = await queue.enqueue(env, paperADup);

    expect(rA.status).toBe('queued');
    expect(rB.status).toBe('queued');
    expect(rADup.status).toBe('dedup_dropped');
    expect(queue.getDepth()).toBe(2);
  });

  it('T3.3: Dual-Router Engine Selection + KV Staging + Sandbox Trace Logging', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'performing local calculation', tool: 'calc', args: { expression: '7*7' } }),
        geminiResponse({ thought: 'completed', answer: '49' }),
      ],
    });

    // 1. Classification
    const task = 'Implement typescript function to calculate hyperbolic distance';
    const classification = classifyWorkload(task, { prefer: 'local' });
    expect(classification.domain).toBe('code_authoring');
    expect(classification.primaryEngine).toBe('local');

    // 2. Execution in router
    const result = await runRouter(task, env, makeDeps(), { prefer: 'local', scope: 'full' });
    expect(result.answer).toBe('49');

    // 3. Stage the execution trace in KV
    const stageRes = await stageEntry(env, 'trace_log', {
      runId: result.run_id,
      trace: result.trace,
      answer: result.answer,
    });
    expect(stageRes.ok).toBe(true);

    // 4. Drain to D1
    const flushRes = await flushStaged(env);
    expect(flushRes.ok).toBe(true);
    expect(flushRes.flushedCount).toBe(1);
  });

  it('T3.4: Router Demotion + Ingest Queue Fallback Telemetry Buffering', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'hosted cloud fallback execution', answer: 'Result from hosted Gemini.' }),
      ],
    });

    const queue = new InMemoryIngestQueue({ batchSize: 2, maxDepth: 20 });
    const events: RouterLiveEvent[] = [];

    // Run router with prefer: 'local' when local sandbox is offline
    const result = await runRouter('Refactor AST module', env, makeDeps(), {
      prefer: 'local',
      scope: 'full',
      onEvent: (ev) => events.push(ev),
    });

    expect(result.answer).toBe('Result from hosted Gemini.');

    // Buffer the demotion audit into Ingest Queue
    const enqRes = await queue.enqueue(env, {
      event: 'demotion_audit',
      runId: result.run_id,
      originalEngine: 'local',
      demotedEngine: 'reasoning',
      timestamp: Date.now(),
    });
    expect(enqRes.ok).toBe(true);
    expect(queue.getDepth()).toBe(1);

    const drainRes = await queue.drain(env);
    expect(drainRes.flushedCount).toBe(1);
    expect(queue.getDepth()).toBe(0);
  });
});

// ==========================================================================
// TIER 4: REAL-WORLD APPLICATION WORKLOADS
// ==========================================================================
describe('Tier 4: Real-World Application Workloads (Target B)', () => {
  let mockKv: ReturnType<typeof createMockKv>;
  let mockDb: ReturnType<typeof createMockDb>;
  let env: Env;

  beforeEach(() => {
    mockKv = createMockKv();
    mockDb = createMockDb();
    env = {
      SESSIONS: mockKv as any,
      SCRATCHPAD: mockKv as any,
      DB: mockDb as any,
      LLM_GEMINI_KEY: 'test-key',
    } as unknown as Env;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('T4.1: Scenario 1: High-Volume Swarm Submission Bursts (50 concurrent sovereign agents)', async () => {
    const queue = new InMemoryIngestQueue({ batchSize: 10, maxDepth: 200 });

    // 50 parallel agents simultaneously submitting AST mutations and tool results
    const agentTasks = Array.from({ length: 50 }, async (_, i) => {
      const stageRes = await stageEntry(env, `agent_lane_${i % 5}`, {
        agentId: `qwen_coder_${i}`,
        patch: `export function fn${i}() { return ${i}; }`,
        exitCode: 0,
        testsPassed: true,
      });

      return queue.enqueue(env, {
        stagedKey: stageRes.stageKey,
        lane: `agent_lane_${i % 5}`,
        agentIndex: i,
      });
    });

    const results = await Promise.all(agentTasks);
    expect(results.every(r => r.ok)).toBe(true);

    // Drain all remaining batches to D1
    const drainRes = await queue.drain(env);
    expect(queue.getDepth()).toBe(0);

    // Flush all staged KV entries into D1
    const flushRes = await flushStaged(env, { batchSize: 50 });
    expect(flushRes.ok).toBe(true);
    expect(flushRes.flushedCount).toBe(50);
    expect(await listStagedKeys(env)).toEqual([]);
  });

  it('T4.2: Scenario 2: Sovereign AST Code Refactoring Task Allocation', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'planning ast edit', tool: 'calc', args: { expression: '100-20' } }),
        geminiResponse({ thought: 'patch complete', answer: 'AST refactor applied cleanly on 80 nodes.' }),
      ],
    });

    const query = 'Refactor AST parse tree to replace legacy var declarations with const';
    const classification = classifyWorkload(query, { prefer: 'local' });

    expect(classification.domain).toBe('ast_refactor');
    expect(classification.primaryTier).toBe('local_sovereign');
    expect(classification.primaryEngine).toBe('local');

    const result = await runRouter(query, env, makeDeps(), { prefer: 'local', scope: 'full' });
    expect(result.answer).toContain('AST refactor applied cleanly on 80 nodes.');
    expect(result.trace[0].tool).toBe('calc');
  });

  it('T4.3: Scenario 3: Multi-Turn Duplex Session with Cloud Fallback', async () => {
    stubFetchRoutes({
      'generativelanguage.googleapis.com': [
        geminiResponse({ thought: 'turn 1', answer: 'Duplex session opened.' }),
        geminiResponse({ thought: 'turn 2', answer: 'Working set retrieved.' }),
        geminiResponse({ thought: 'turn 3', answer: 'Session completed.' }),
      ],
    });

    const turns = [
      'Open continuous dialogue duplex channel for live voice streaming',
      'What did we establish in the previous turn?',
      'Wrap up the duplex audio session and store the transcript',
    ];

    for (let t = 0; t < turns.length; t++) {
      const cls = classifyWorkload(turns[t], { prefer: 'local' });
      if (t === 0) {
        expect(cls.domain).toBe('duplex');
        expect(cls.primaryEngine).toBe('local');
      }

      const res = await runRouter(turns[t], env, makeDeps(), { prefer: 'local', scope: 'full' });
      expect(res.answer).toBeTruthy();

      // Stage intermediate working memory per turn
      await stageEntry(env, 'duplex_session_mem', { turn: t, q: turns[t], a: res.answer });
    }

    const stagedMem = await listStagedKeys(env, 'stage:bus:duplex_session_mem');
    expect(stagedMem.length).toBe(3);

    const flushRes = await flushStaged(env);
    expect(flushRes.ok).toBe(true);
    expect(flushRes.flushedCount).toBe(3);
  });
});
