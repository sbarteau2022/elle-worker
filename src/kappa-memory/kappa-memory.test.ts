import { describe, it, expect } from 'vitest';
import { SEAM, ranksOnKappa, KAPPA_PROVISIONAL } from './seam';
import { estimateR, reserveOf, velocityPeak, kappaOf } from './kappa';
import { isBoundary, writeTrace, extractSettling } from './write_path';
import { retrieveAtOpen } from './retrieval';
import { assessSovereignty } from './sovereignty';
import { kappaMemoryState, recordTurnTrace } from './integration';

// Minimal D1 / Vectorize doubles for the gate-closed paths. kappaRows are given
// CHRONOLOGICALLY; the real query is ORDER BY created_at DESC, so the double
// hands them back newest-first (reversed), which recentKappa re-reverses.
function fakeDb(kappaRows: number[] = [], traceCount = 0): any {
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async run() { return {}; },
        async first() { return sql.includes('COUNT(*)') ? { n: traceCount } : null; },
        async all() { return { results: kappaRows.slice().reverse().map(k => ({ kappa: k })) }; },
      };
    },
    async batch(stmts: Array<{ run(): Promise<unknown> }>) { return Promise.all(stmts.map(s => s.run())); },
  };
}
const fakeVectorize: any = { query: async () => ({ matches: [] }) };

describe('gate-closed invariant: KAPPA_VALIDATED=false never throws and never ranks', () => {
  it('master gate reads false and provisional reads true', () => {
    expect(SEAM.KAPPA_VALIDATED).toBe(false);
    expect(KAPPA_PROVISIONAL).toBe(true);
  });
  it('kappaOf returns an explicit inert 0', () => {
    expect(kappaOf({}, 0)).toBe(0);
  });
  it('ranksOnKappa returns the stub, not the live branch, while gated', () => {
    expect(ranksOnKappa('RESERVE_CONSOLIDATION', () => 'LIVE', 'STUB')).toBe('STUB');
    expect(ranksOnKappa('KAPPA_VALIDATED', () => 1, 0)).toBe(0);
  });
  it('writeTrace resolves to an id and does not throw', async () => {
    const id = await writeTrace(fakeDb(), {
      thread_id: 't', boundary_idx: 0, perturbation: 'p', response: 'r',
      settling: 'SETTLED', kappa_window: [1, 0.9, 0.7], source_mass: 'elle',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
  it('retrieveAtOpen falls back cleanly on an empty index', async () => {
    await expect(retrieveAtOpen(fakeDb(), fakeVectorize, 'hi', [0.1, 0.2], 8)).resolves.toEqual([]);
  });
  it('assessSovereignty reports non-computable and enforces nothing', () => {
    const r = assessSovereignty([{ perturbation: 'p', r_estimate: 0.5, source_mass: 'corpus' } as any], new Map());
    expect(r.computable).toBe(false);
    expect(r.enforced).toBe(false);
    expect(r.sourceMassWarning).toContain('source-term'); // warning still surfaces
  });
});

describe('contraction operators (real, gate-independent)', () => {
  it('estimateR recovers a positive rate from a decaying trajectory', () => {
    // u_t = e^{-0.5 t} → r ≈ 0.5
    const traj = [0, 1, 2, 3, 4].map(t => Math.exp(-0.5 * t));
    expect(estimateR(traj)).toBeCloseTo(0.5, 2);
  });
  it('estimateR is 0 for a trajectory too short to fit', () => {
    expect(estimateR([1])).toBe(0);
  });
  it('reserveOf is the trapezoidal ∫κ and velocityPeak the max |Δκ|', () => {
    expect(reserveOf([1, 1, 1])).toBeCloseTo(2, 6);
    expect(velocityPeak([1, 0.4, 0.5])).toBeCloseTo(0.6, 6);
  });
  it('isBoundary uses the heuristic while VELOCITY_BOUNDARY is gated off', () => {
    expect(isBoundary(2, false, 0)).toBe(true);
    expect(isBoundary(0, true, 0)).toBe(true);
    expect(isBoundary(0, false, 99)).toBe(false);
  });
});

describe('kappaMemoryState (the workbench read)', () => {
  it('reports the gate, provisional flag, and relationally-inferred metrics', async () => {
    const series = [1, 0.9, 0.8, 0.7];
    const state = await kappaMemoryState({ DB: fakeDb(series, 5) }, 'sess-1');
    expect(state.gate.kappa_validated).toBe(false);
    expect(state.provisional).toBe(true);
    expect(state.ranks).toBe(false);
    expect(state.current_kappa).toBe(0.7);
    expect(state.kappa_series).toEqual(series);
    expect(state.r_estimate).not.toBeNull();
    expect(state.trace_count).toBe(5);
    expect(state.note).toContain('provisional');
  });
  it('leaves metrics null when there are too few samples', async () => {
    const state = await kappaMemoryState({ DB: fakeDb([], 0) }, null);
    expect(state.current_kappa).toBeNull();
    expect(state.r_estimate).toBeNull();
    expect(state.kappa_series).toEqual([]);
  });
});

describe('recordTurnTrace (live write path)', () => {
  it('writes a trace best-effort and returns its id', async () => {
    const id = await recordTurnTrace({ DB: fakeDb([1, 0.9, 0.8]) }, { sessionId: 's', question: 'q', answer: 'a' });
    expect(typeof id).toBe('string');
  });
  it('never throws — a broken db yields null, not an exception', async () => {
    const brokenDb: any = { prepare() { throw new Error('d1 down'); } };
    await expect(recordTurnTrace({ DB: brokenDb }, { sessionId: 's', question: 'q', answer: 'a' })).resolves.toBeNull();
  });
  it('boundary_idx follows the thread trace COUNT, not the capped κ window, so ids never collide', async () => {
    // 12-sample window (the cap) but 40 traces already written: the id must be
    // derived from 40. Same window at count 41 must yield a DIFFERENT id.
    const window = Array.from({ length: 12 }, (_, i) => 1 - i * 0.01);
    const a = await recordTurnTrace({ DB: fakeDb(window, 40) }, { sessionId: 's', question: 'q', answer: 'a' });
    const b = await recordTurnTrace({ DB: fakeDb(window, 41) }, { sessionId: 's', question: 'q', answer: 'a' });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });
});

describe('extractSettling (lexical OPEN/SETTLED over the answer tail)', () => {
  it('a conclusive close settles', () => {
    expect(extractSettling('The fix is deployed. All three columns now populate on every turn.')).toBe('SETTLED');
  });
  it('an ending question is OPEN and drives settled_open in writeTrace', async () => {
    const s = extractSettling('I patched the write path. Do you want the migration applied too?');
    expect(s.startsWith('OPEN:')).toBe(true);
  });
  it('an unresolved marker in the close is OPEN', () => {
    const s = extractSettling('The write lands now. Whether lex2 tracks real coherence remains unknown.');
    expect(s.startsWith('OPEN:')).toBe(true);
  });
  it('a hedge-saturated close is OPEN', () => {
    const s = extractSettling('It works. Maybe the cause is caching, or perhaps a race; possibly both, I think.');
    expect(s.startsWith('OPEN:')).toBe(true);
  });
  it('empty text settles trivially', () => {
    expect(extractSettling('')).toBe('SETTLED');
  });
});
