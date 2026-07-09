import { describe, it, expect } from 'vitest';
import { summarizeGraphShape, graphShape } from './self-shape';
import type { MemEdge } from './graph';

const e = (src: string, dst: string, weight = 1, kind: MemEdge['kind'] = 'assoc'): MemEdge => ({ src, dst, kind, weight });

describe('summarizeGraphShape — correctness', () => {
  it('a tree reads hierarchical with cycle rank 0 and no flags', () => {
    const tree = [e('r', 'a'), e('r', 'b'), e('a', 'c'), e('a', 'd'), e('b', 'f'), e('b', 'g')];
    const s = summarizeGraphShape(tree)!;
    expect(s.cycle_rank).toBe(0);
    expect(s.curvature.delta).toBe(0);
    expect(s.curvature.leaning).toBe('hierarchical');
    expect(s.captured_resonance).toEqual([]);
  });

  it('a dense cyclic graph reads cyclic with cycle rank > 0', () => {
    const cyclic = [e('0', '1'), e('1', '2'), e('2', '3'), e('3', '0'), e('0', '2'), e('1', '3')];
    const s = summarizeGraphShape(cyclic)!;
    expect(s.cycle_rank).toBeGreaterThan(0);
    expect(s.curvature.leaning).toBe('cyclic');
    expect(s.curvature.toroidal).toBeGreaterThan(s.curvature.hyperbolic);
  });

  it('surfaces a captured-resonance runaway (one hot neighbor on a hub)', () => {
    const runaway = [e('h', 'hot', 4), e('h', 'a', 0.2), e('h', 'b', 0.2), e('h', 'c', 0.2)];
    const s = summarizeGraphShape(runaway)!;
    expect(s.captured_resonance.length).toBeGreaterThanOrEqual(1);
    expect(s.captured_resonance[0].node).toBe('h');
    expect(s.captured_resonance[0].top).toBe('hot');
  });

  it('caps the number of flags surfaced', () => {
    const edges: MemEdge[] = [];
    // five independent runaway hubs; default flagCap = 3
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5']) {
      edges.push(e(h, `${h}_hot`, 4), e(h, `${h}_a`, 0.1), e(h, `${h}_b`, 0.1), e(h, `${h}_c`, 0.1));
    }
    expect(summarizeGraphShape(edges)!.captured_resonance.length).toBe(3);
    expect(summarizeGraphShape(edges, { flagCap: 5 })!.captured_resonance.length).toBe(5);
  });
});

describe('summarizeGraphShape — robustness (pressure)', () => {
  it('returns null for an empty graph, never throws', () => {
    expect(summarizeGraphShape([])).toBeNull();
  });

  it('survives self-loops, duplicate undirected edges, and blank endpoints', () => {
    const nasty = [
      e('a', 'a', 9),          // self-loop
      e('a', 'b'), e('b', 'a'), // duplicate (undirected)
      { src: '', dst: 'x', kind: 'assoc', weight: 1 } as MemEdge, // blank endpoint
      e('b', 'c'),
    ];
    const s = summarizeGraphShape(nasty)!;
    expect(s.edges).toBe(2);        // a–b and b–c; self-loop and blank dropped, dup deduped
    expect(s.cycle_rank).toBe(0);
    expect(Number.isFinite(s.curvature.delta)).toBe(true);
  });

  it('handles non-finite / negative weights without NaN in the output', () => {
    const edges = [e('a', 'b', NaN), e('b', 'c', -5), e('c', 'a', Infinity)];
    const s = summarizeGraphShape(edges)!;
    expect(Number.isFinite(s.curvature.hyperbolic)).toBe(true);
    expect(Number.isFinite(s.curvature.toroidal)).toBe(true);
    expect(s.cycle_rank).toBe(1); // triangle
  });

  it('is deterministic — same edges, same shape', () => {
    const edges = [e('0', '1'), e('1', '2'), e('2', '0'), e('2', '3'), e('3', '4')];
    expect(summarizeGraphShape(edges)).toEqual(summarizeGraphShape(edges));
  });

  it('a disconnected graph counts components correctly', () => {
    const s = summarizeGraphShape([e('a', 'b'), e('c', 'd'), e('e', 'f')])!;
    expect(s.components).toBe(3);
    expect(s.cycle_rank).toBe(0);
  });

  it('stays bounded and well-formed on a large graph (scale)', () => {
    const edges: MemEdge[] = [];
    for (let i = 0; i < 2000; i++) edges.push(e(`n${i}`, `n${(i * 7 + 3) % 1500}`, 1 + (i % 4)));
    const t0 = Date.now();
    const s = summarizeGraphShape(edges)!;
    // pure, bounded work — should be far under a second; generous ceiling for CI
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(s.nodes).toBeGreaterThan(0);
    expect(s.cycle_rank).toBeGreaterThan(0);
    expect(['hierarchical', 'cyclic', 'balanced']).toContain(s.curvature.leaning);
    expect(s.captured_resonance.length).toBeLessThanOrEqual(3);
  });
});

describe('graphShape — DB read (best-effort)', () => {
  const fakeEnv = (impl: () => Promise<{ results: unknown[] }>) => ({
    DB: { prepare: () => ({ bind: () => ({ all: impl }) }) },
  }) as any;

  it('reads rows into a shape', async () => {
    const rows = [
      { src: '0', dst: '1', kind: 'assoc', weight: 2 },
      { src: '1', dst: '2', kind: 'assoc', weight: 1 },
      { src: '2', dst: '0', kind: 'assoc', weight: 1 },
    ];
    const s = await graphShape(fakeEnv(async () => ({ results: rows })));
    expect(s!.cycle_rank).toBe(1);
    expect(s!.nodes).toBe(3);
  });

  it('returns null when the table is empty or the query throws', async () => {
    expect(await graphShape(fakeEnv(async () => ({ results: [] })))).toBeNull();
    expect(await graphShape(fakeEnv(async () => { throw new Error('no such table'); }))).toBeNull();
  });
});
