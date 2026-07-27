import { describe, it, expect, vi } from 'vitest';
import { spearman, judgeTurn, runJudgeBatch, kappaCorrelationReport, PAIRWISE_JUDGE_SYSTEM } from './judge';
import type { Env } from './index';

// ── spearman: the pure core the κ cross-check stands on ────────────────────
describe('spearman', () => {
  it('is 1 for a perfectly monotonic relationship', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it('is -1 for a perfectly inverse relationship', () => {
    expect(spearman([1, 2, 3, 4], [9, 7, 5, 3])).toBeCloseTo(-1, 10);
  });

  it('is rank-based, not linear — a monotonic but non-linear curve still scores 1', () => {
    expect(spearman([1, 2, 3, 4, 5], [1, 8, 27, 64, 125])).toBeCloseTo(1, 10);
  });

  it('handles ties with averaged ranks', () => {
    const rho = spearman([1, 2, 2, 3], [1, 2, 3, 4]);
    expect(rho).not.toBeNull();
    expect(rho!).toBeGreaterThan(0.8);
    expect(rho!).toBeLessThan(1);
  });

  it('refuses to correlate fewer than 3 points', () => {
    expect(spearman([1, 2], [3, 4])).toBeNull();
  });

  it('refuses a constant series (no rank order exists) — the pinned-κ case', () => {
    expect(spearman([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });
});

// ── shared fakes ───────────────────────────────────────────────────────────
const VERDICT = { accuracy: 8, completeness: 7, helpfulness: 8, safety: 10, clarity: 9, coherence: 6, overall: 8, justification: 'solid answer, slight thread drift' };

// jsonLLM with prefer:'local' rides env.AI.run — no fetch stub needed.
function aiReturning(...responses: unknown[]) {
  let i = 0;
  return { run: vi.fn(async () => ({ response: JSON.stringify(responses[Math.min(i++, responses.length - 1)]) })) };
}

// A D1 stub routed by SQL substring; records every INSERT's bound args.
function fakeDb(routes: Array<{ match: string; results?: unknown[]; first?: unknown }>) {
  const inserts: Array<{ sql: string; args: unknown[] }> = [];
  const stmtFor = (sql: string, args: unknown[]) => ({
    run: vi.fn(async () => { if (/^\s*INSERT/i.test(sql)) inserts.push({ sql, args }); return { success: true }; }),
    all: vi.fn(async () => ({ results: routes.find(r => sql.includes(r.match))?.results ?? [] })),
    first: vi.fn(async () => {
      const r = routes.find(x => sql.includes(x.match));
      return r && 'first' in r ? r.first : null;
    }),
  });
  const db = {
    prepare: vi.fn((sql: string) => ({ ...stmtFor(sql, []), bind: vi.fn((...args: unknown[]) => stmtFor(sql, args)) })),
    batch: vi.fn(async () => []), // ensureAllSchemas' CREATE TABLE batch
  };
  return { db, inserts };
}

describe('judgeTurn', () => {
  it('returns a schema-validated per-criterion verdict', async () => {
    const env = { AI: aiReturning(VERDICT) } as unknown as Env;
    const v = await judgeTurn(env, { question: 'what is x?', answer: 'x is y, as we discussed.', priorContext: 'USER: hello' }, { prefer: 'local' });
    expect(v.coherence).toBe(6);
    expect(v.overall).toBe(8);
    expect(v.justification).toContain('drift');
  });
});

describe('runJudgeBatch', () => {
  const CANDIDATES = [
    { id: 't2', session_id: 's1', role: 'assistant', content: 'a substantial assistant answer about the topic at hand', created_at: 2, kappa: 0.7 },
  ];
  const SESSION_SEQ = [
    { id: 't1', role: 'user', content: 'the question that was asked' },
    { id: 't2', role: 'assistant', content: 'a substantial assistant answer about the topic at hand' },
  ];

  it('creates a run, judges sampled turns against their session context, and writes verdicts to its OWN tables only', async () => {
    const { db, inserts } = fakeDb([
      { match: "t.role = 'assistant'", results: CANDIDATES },
      { match: 'ORDER BY created_at ASC, id ASC', results: SESSION_SEQ },
      { match: 'COUNT(*) AS n FROM judge_verdicts', first: { n: 1 } },
    ]);
    const env = { DB: db, AI: aiReturning(VERDICT) } as unknown as Env;

    const out = await runJudgeBatch(env, { prefer: 'local' });

    expect(out.judged).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.total_in_run).toBe(1);
    expect(inserts.some(i => i.sql.includes('INSERT INTO judge_runs'))).toBe(true);
    const verdictInsert = inserts.find(i => i.sql.includes('INSERT INTO judge_verdicts'));
    expect(verdictInsert).toBeDefined();
    expect(verdictInsert!.args[2]).toBe('t2');          // turn_id
    expect(verdictInsert!.args[3]).toBe(8);             // overall verdict
    expect(JSON.parse(verdictInsert!.args[4] as string).coherence).toBe(6);
    // κ integrity: nothing ever INSERTs/UPDATEs elle_conversation_turns.
    expect(inserts.every(i => !i.sql.includes('elle_conversation_turns'))).toBe(true);
  });

  it('a failed judgment is counted and skipped — no fake verdict row is written', async () => {
    const { db, inserts } = fakeDb([
      { match: "t.role = 'assistant'", results: CANDIDATES },
      { match: 'ORDER BY created_at ASC, id ASC', results: SESSION_SEQ },
      { match: 'COUNT(*) AS n FROM judge_verdicts', first: { n: 0 } },
    ]);
    // Both jsonLLM attempts (original + repair retry) return unparseable text.
    const env = { DB: db, AI: { run: vi.fn(async () => ({ response: 'not json' })) } } as unknown as Env;

    const out = await runJudgeBatch(env, { prefer: 'local' });

    expect(out.failed).toBe(1);
    expect(out.judged).toBe(0);
    expect(inserts.some(i => i.sql.includes('INSERT INTO judge_verdicts'))).toBe(false);
  });

  it('resuming an existing run keeps its run_id and refuses an unknown one', async () => {
    const { db, inserts } = fakeDb([
      { match: 'SELECT run_id FROM judge_runs', first: { run_id: 'run123' } },
      { match: "t.role = 'assistant'", results: [] },
      { match: 'COUNT(*) AS n FROM judge_verdicts', first: { n: 40 } },
    ]);
    const env = { DB: db, AI: aiReturning(VERDICT) } as unknown as Env;

    const out = await runJudgeBatch(env, { runId: 'run123' });
    expect(out.run_id).toBe('run123');
    expect(out.total_in_run).toBe(40);
    expect(inserts.some(i => i.sql.includes('INSERT INTO judge_runs'))).toBe(false); // no duplicate run row

    const { db: db2 } = fakeDb([{ match: 'SELECT run_id FROM judge_runs', first: null }]);
    await expect(runJudgeBatch({ DB: db2 } as unknown as Env, { runId: 'ghost' })).rejects.toThrow(/no run ghost/);
  });
});

describe('kappaCorrelationReport', () => {
  const row = (turn: string, kappa: number | null, kappaDef: string | null, coherence: number, overall: number) => ({
    turn_id: turn, verdict: overall, per_criterion_json: JSON.stringify({ coherence }), kappa, kappa_def: kappaDef,
  });

  it('computes Spearman over tagged-κ turns only and excludes untagged legacy rows', async () => {
    const { db } = fakeDb([
      { match: 'FROM judge_verdicts v JOIN elle_conversation_turns', results: [
        row('a', 0.2, 'v2', 3, 4),
        row('b', 0.5, 'v2', 6, 6),
        row('c', 0.8, 'v2', 9, 9),
        row('d', 0.5, null, 10, 10),   // untagged κ — must not count
        row('e', null, 'v2', 5, 5),    // no κ at all — must not count
      ] },
    ]);
    const report = await kappaCorrelationReport({ DB: db } as unknown as Env, 'run1');

    expect(report.turns_judged).toBe(5);
    expect(report.turns_with_tagged_kappa).toBe(3);
    expect(report.spearman_coherence_vs_kappa).toBeCloseTo(1, 10);
    expect(report.pinned_kappa_value).toBeNull();
    expect(report.interpretation).toContain('evidence, not proof');
  });

  it('flags a pinned κ (one repeated value dominating) — the pinning-bug localizer', async () => {
    const { db } = fakeDb([
      { match: 'FROM judge_verdicts v JOIN elle_conversation_turns', results: [
        row('a', 0.5, 'v2', 2, 3),
        row('b', 0.5, 'v2', 7, 6),
        row('c', 0.5, 'v2', 9, 9),
        row('d', 0.8, 'v2', 5, 5),
      ] },
    ]);
    const report = await kappaCorrelationReport({ DB: db } as unknown as Env, 'run1');

    expect(report.pinned_kappa_value).toBe(0.5);
    expect(report.pinned_kappa_turns).toBe(3);
  });
});

describe('pairwise prompt', () => {
  it('carries the ported criteria verbatim plus the added coherence criterion F', () => {
    expect(PAIRWISE_JUDGE_SYSTEM).toContain('A. Accuracy & Factuality');
    expect(PAIRWISE_JUDGE_SYSTEM).toContain('do not declare a tie');
    expect(PAIRWISE_JUDGE_SYSTEM).toContain('F. Coherence with prior turns');
  });
});
