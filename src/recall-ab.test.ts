import { describe, it, expect } from 'vitest';
import { jaccardDistance, orderedDivergence, summarizeRecallAB, type RecallTraceRow } from './recall-ab';

describe('jaccardDistance (set membership)', () => {
  it('is 0 for identical sets and for two empties', () => {
    expect(jaccardDistance(['a', 'b'], ['b', 'a'])).toBe(0);
    expect(jaccardDistance([], [])).toBe(0);
  });
  it('is 1 for disjoint sets', () => {
    expect(jaccardDistance(['a', 'b'], ['c', 'd'])).toBe(1);
  });
  it('is fractional for partial overlap', () => {
    expect(jaccardDistance(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
  });
  it('ignores order (set semantics) — this is why it is only the secondary signal', () => {
    expect(jaccardDistance(['a', 'b'], ['b', 'a'])).toBe(0);
  });
});

describe('orderedDivergence (position-aware, the primary signal)', () => {
  it('is 0 for identical ordered lists', () => {
    expect(orderedDivergence(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
  });
  it('catches a pure reorder that Jaccard misses', () => {
    expect(jaccardDistance(['a', 'b'], ['b', 'a'])).toBe(0);      // set: unchanged
    expect(orderedDivergence(['a', 'b'], ['b', 'a'])).toBe(1);    // order: fully shuffled
  });
  it('is fractional for a partial shift', () => {
    // positions: a=a (same), b≠c, c≠b → 2 of 3 differ
    expect(orderedDivergence(['a', 'b', 'c'], ['a', 'c', 'b'])).toBeCloseTo(2 / 3, 4);
  });
});

const row = (q: string, base: string[], boost: string[], ord: number, set: number): RecallTraceRow => ({
  query_preview: q, base_top: JSON.stringify(base), boost_top: JSON.stringify(boost), divergence: ord, set_divergence: set, created_at: 0,
});

describe('summarizeRecallAB', () => {
  it('is an empty summary for no rows', () => {
    expect(summarizeRecallAB([])).toEqual({ traces: 0, changed_fraction: 0, mean_divergence: 0, mean_set_divergence: 0, reorder_only_fraction: 0, most_divergent: [] });
  });

  it('counts changed vs reorder-only and both mean divergences', () => {
    const rows = [
      row('q1', ['a'], ['a'], 0, 0),               // unchanged
      row('q2', ['a', 'b'], ['b', 'a'], 1, 0),      // reorder only (set unchanged)
      row('q3', ['x'], ['y'], 1, 1),                // membership changed
    ];
    const s = summarizeRecallAB(rows);
    expect(s.traces).toBe(3);
    expect(s.changed_fraction).toBeCloseTo(2 / 3, 4);      // q2 and q3 changed
    expect(s.reorder_only_fraction).toBeCloseTo(1 / 3, 4); // just q2
    expect(s.mean_divergence).toBeCloseTo((0 + 1 + 1) / 3, 4);
    expect(s.mean_set_divergence).toBeCloseTo((0 + 0 + 1) / 3, 4);
  });

  it('ranks the most-divergent queries first and parses the id lists', () => {
    const rows = [
      row('mild', ['a', 'b'], ['b', 'a'], 1, 0),
      row('total', ['p'], ['q'], 1, 1),
      row('none', ['z'], ['z'], 0, 0),
    ];
    const s = summarizeRecallAB(rows, 2);
    expect(s.most_divergent.length).toBe(2);
    // tie on ordered (1==1) broken by set_divergence → 'total' first
    expect(s.most_divergent[0].query).toBe('total');
    expect(s.most_divergent[0].boost_top).toEqual(['q']);
  });

  it('survives malformed id json (falls back to empty lists)', () => {
    const s = summarizeRecallAB([{ query_preview: 'bad', base_top: 'not json', boost_top: '', divergence: 0.5, set_divergence: 0.5, created_at: 0 }]);
    expect(s.most_divergent[0].base_top).toEqual([]);
    expect(s.most_divergent[0].boost_top).toEqual([]);
    expect(s.mean_divergence).toBe(0.5);
  });
});
