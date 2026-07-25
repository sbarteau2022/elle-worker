import { describe, it, expect } from 'vitest';
import { assembleMemoryStats, type RawMemoryCounts } from './memory';

const full: RawMemoryCounts = {
  total: 3421,
  byType: [
    { memory_type: 'observation', n: 2500 },
    { memory_type: 'deliberate', n: 421 },
    { memory_type: 'insight', n: 500 },
  ],
  bounds: { mn: '2025-01-02T00:00:00Z', mx: '2026-07-24T12:00:00Z' },
  withVector: 3300,
  papers: 812,
  chunks: 475321,
  vectorIndex: { count: 478621, dimensions: 1024 },
};

describe('assembleMemoryStats', () => {
  it('maps a full read into the stats shape', () => {
    const s = assembleMemoryStats(full);
    expect(s.durable_memory.total).toBe(3421);
    expect(s.durable_memory.by_type).toEqual({ observation: 2500, deliberate: 421, insight: 500 });
    expect(s.durable_memory.vectorized).toBe(3300);
    expect(s.durable_memory.oldest).toBe('2025-01-02T00:00:00Z');
    expect(s.durable_memory.newest).toBe('2026-07-24T12:00:00Z');
    expect(s.corpus).toEqual({ papers: 812, chunks: 475321 });
    expect(s.vector_index).toEqual({ count: 478621, dimensions: 1024 });
  });

  it('always carries the no-fabrication note', () => {
    const s = assembleMemoryStats(full);
    expect(s.note).toMatch(/no fixed capacity ceiling/i);
    expect(s.note).toMatch(/never a utilization percentage|never a.*percentage/i);
  });

  it('tolerates every facet being null (partial/failed read) without throwing', () => {
    const s = assembleMemoryStats({
      total: null, byType: null, bounds: null, withVector: null,
      papers: null, chunks: null, vectorIndex: null,
    });
    expect(s.durable_memory.total).toBe(0);          // count defaults to 0, not null
    expect(s.durable_memory.by_type).toEqual({});
    expect(s.durable_memory.vectorized).toBeNull();
    expect(s.durable_memory.oldest).toBeNull();
    expect(s.corpus).toEqual({ papers: null, chunks: null });
    expect(s.vector_index).toEqual({ count: null, dimensions: null });
  });

  it('ignores malformed by_type rows', () => {
    const s = assembleMemoryStats({
      ...full,
      byType: [
        { memory_type: 'fact', n: 10 },
        { memory_type: 'x', n: undefined as unknown as number },
        { memory_type: undefined as unknown as string, n: 5 },
      ],
    });
    expect(s.durable_memory.by_type).toEqual({ fact: 10 });
  });

  it('does not invent a utilization percentage anywhere in the output', () => {
    const s = assembleMemoryStats(full);
    // No numeric percentage field exists on the object — capacity is real counts only.
    expect(JSON.stringify(s)).not.toMatch(/utilization"\s*:/i);
    expect('percentage' in (s.durable_memory as object)).toBe(false);
  });
});
