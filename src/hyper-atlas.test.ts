import { describe, it, expect } from 'vitest';
import { hyperMap } from './hyper';
import type { MemEdge } from './graph';

function tree(branch = 3, depth = 4) {
  const nodes: { id: string }[] = [];
  const edges: MemEdge[] = [];
  const mk = (p: string | null, d: number, path: string) => {
    nodes.push({ id: path });
    if (p) edges.push({ src: p, dst: path, kind: 'derived', weight: 1 });
    if (d < depth) for (let b = 0; b < branch; b++) mk(path, d + 1, `${path}.${b}`);
  };
  mk(null, 0, 'r');
  return { nodes, edges };
}

describe('hyperMap atlas', () => {
  // Regression: an edge missing `weight` propagated NaN through the gradient.
  // The run completed with loss = NaN and every point at the origin — a
  // degenerate atlas indistinguishable from a good one.
  it('does not produce a NaN atlas from malformed edges', () => {
    const { nodes, edges } = tree();
    const malformed = edges.map((e) => ({ src: e.src, dst: e.dst })) as unknown as MemEdge[];
    const a = hyperMap(nodes, malformed, { epochs: 50, seed: 42 });
    expect(Number.isFinite(a.stats.loss)).toBe(true);
    expect(a.stats.depth.max).toBeGreaterThan(0);
    for (const p of Object.values(a.points)) for (const x of p) expect(Number.isFinite(x)).toBe(true);
  });

  // The default must be the dimension where the atlas actually beats the
  // retriever it augments. At dim=2 it measured 71% WORSE than cosine + 2-hop
  // spreading activation; 128 is the first dimension that wins.
  it('defaults to a dimension the atlas is useful at', () => {
    const { nodes, edges } = tree();
    expect(hyperMap(nodes, edges, { epochs: 20 }).dim).toBe(128);
  });

  it('honors a requested dimension above the old 16 clamp', () => {
    const { nodes, edges } = tree();
    expect(hyperMap(nodes, edges, { dim: 64, epochs: 20 }).dim).toBe(64);
  });

  // Points must stay strictly inside the ball or every downstream distance
  // divides by a non-positive denominator.
  it('keeps every point inside the Poincare ball', () => {
    const { nodes, edges } = tree();
    const a = hyperMap(nodes, edges, { dim: 32, epochs: 100, seed: 7 });
    for (const p of Object.values(a.points)) {
      expect(Math.hypot(...p)).toBeLessThan(1);
    }
  });
});
