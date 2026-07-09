import { describe, it, expect } from 'vitest';
import {
  dot, norm, project, mobiusAdd, poincareDist, depth,
  expMap0, logMap0, distGrad,
  fnv1a, mulberry32,
  numericLeaves, ripVector, placeFeatures, RIP_DIM,
  hyperMap, hyperNeighbors,
  type HyperNode,
} from './hyper';
import type { MemEdge } from './graph';

// ── geometry ──────────────────────────────────────────────────────────────

describe('poincare geometry', () => {
  it('projects a boundary-crossing point back inside the ball', () => {
    const p = project([3, 4]); // norm 5
    expect(norm(p)).toBeLessThan(1);
    // direction preserved
    expect(p[1] / p[0]).toBeCloseTo(4 / 3, 6);
  });

  it('mobiusAdd: 0 ⊕ v = v and (−u) ⊕ u = 0', () => {
    const v = [0.3, -0.2];
    expect(mobiusAdd([0, 0], v)[0]).toBeCloseTo(v[0], 9);
    expect(mobiusAdd([0, 0], v)[1]).toBeCloseTo(v[1], 9);
    const u = [0.4, 0.1];
    const zero = mobiusAdd(u.map((x) => -x), u);
    expect(norm(zero)).toBeLessThan(1e-9);
  });

  it('distance from origin is 2·atanh(‖x‖)', () => {
    const x = [0.5, 0];
    expect(poincareDist([0, 0], x)).toBeCloseTo(2 * Math.atanh(0.5), 9);
    expect(depth(x)).toBeCloseTo(2 * Math.atanh(0.5), 9);
  });

  it('distance is symmetric, zero at coincidence, and satisfies the triangle inequality', () => {
    const a = [0.1, 0.2], b = [-0.3, 0.4], c = [0.6, -0.1];
    expect(poincareDist(a, b)).toBeCloseTo(poincareDist(b, a), 9);
    expect(poincareDist(a, a)).toBeCloseTo(0, 9);
    expect(poincareDist(a, c)).toBeLessThanOrEqual(poincareDist(a, b) + poincareDist(b, c) + 1e-9);
  });

  it('distances blow up near the boundary (hyperbolic, not euclidean)', () => {
    const nearOrigin = poincareDist([0.0, 0.0], [0.1, 0]);
    const nearEdge = poincareDist([0.89, 0], [0.99, 0]); // same euclidean gap
    expect(nearEdge).toBeGreaterThan(nearOrigin * 5);
  });

  it('exp₀/log₀ round-trip', () => {
    const t = [0.7, -0.4, 0.2];
    const back = logMap0(expMap0(t));
    for (let i = 0; i < t.length; i++) expect(back[i]).toBeCloseTo(t[i], 6);
    expect(norm(expMap0([100, 0, 0]))).toBeLessThan(1); // never escapes the ball
  });

  it('distGrad matches a numeric gradient', () => {
    const u = [0.2, -0.3], v = [-0.1, 0.4];
    const g = distGrad(u, v);
    const h = 1e-6;
    for (let i = 0; i < u.length; i++) {
      const up = [...u]; up[i] += h;
      const dn = [...u]; dn[i] -= h;
      const numeric = (poincareDist(up, v) - poincareDist(dn, v)) / (2 * h);
      expect(g[i]).toBeCloseTo(numeric, 4);
    }
  });
});

// ── determinism plumbing ──────────────────────────────────────────────────

describe('prng + hash', () => {
  it('fnv1a is stable and spreads', () => {
    expect(fnv1a('spectrum.centroid')).toBe(fnv1a('spectrum.centroid'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
  it('mulberry32 is deterministic per seed and in [0,1)', () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual([c(), c(), c()]);
    for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

// ── the encoder ───────────────────────────────────────────────────────────

describe('ripVector (feature hashing over ripper reports)', () => {
  const vfarRip = {
    field: { mean: 128, contrast: 40.2, entropy: 0.8, edge_density: 0.3, anisotropy: 0.7, symmetry: { horizontal: 0.9, vertical: 0.4 }, balance: { x: 0.1, y: -0.2 } },
    rhythm: { horizontal: { centroid: 0.12, flatness: 0.5, periodicity: 0.6, dominant: [{ freq: 0.1, magnitude: 3.2 }] } },
  };

  it('walks numeric leaves with sorted, stable paths', () => {
    const leaves = numericLeaves({ b: 2, a: 1, c: { d: [3, 4] } });
    expect(leaves).toEqual([['a', 1], ['b', 2], ['c.d[0]', 3], ['c.d[1]', 4]]);
  });

  it('is deterministic and fixed-length', () => {
    const v1 = ripVector(vfarRip), v2 = ripVector(vfarRip);
    expect(v1).toEqual(v2);
    expect(v1.length).toBe(RIP_DIM);
  });

  it('stays bounded (‖f‖ ≤ 1) and differs across different structures', () => {
    const v1 = ripVector(vfarRip);
    const v2 = ripVector({ spectrum: { centroid: 0.4, flatness: 0.1, periodicity: 0.9 } });
    expect(norm(v1)).toBeLessThanOrEqual(1 + 1e-9);
    expect(norm(v2)).toBeLessThanOrEqual(1 + 1e-9);
    expect(v1).not.toEqual(v2);
  });

  it('handles junk and empties without throwing', () => {
    expect(ripVector(null).every((v) => v === 0)).toBe(true);
    expect(ripVector({ a: 'text', b: [NaN, Infinity] }).every((v) => v === 0)).toBe(true);
  });

  it('placeFeatures lands strictly inside the ball, at nonzero depth for a nonzero vector', () => {
    const p = placeFeatures(ripVector(vfarRip), 4);
    expect(p.length).toBe(4);
    expect(norm(p)).toBeLessThan(1);
    expect(depth(p)).toBeGreaterThan(0);
  });
});

// ── the mapping ───────────────────────────────────────────────────────────

const edge = (src: string, dst: string, kind: MemEdge['kind'] = 'assoc', weight = 2): MemEdge => ({ src, dst, kind, weight });

describe('hyperMap', () => {
  it('is a clean no-op on empty input', () => {
    const atlas = hyperMap([], []);
    expect(atlas.stats.nodes).toBe(0);
    expect(Object.keys(atlas.points).length).toBe(0);
  });

  it('derives nodes from edge endpoints and keeps every point inside the ball', () => {
    const atlas = hyperMap([], [edge('a', 'b'), edge('b', 'c')]);
    expect(atlas.stats.nodes).toBe(3);
    for (const p of Object.values(atlas.points)) expect(norm(p)).toBeLessThan(1);
  });

  it('is deterministic: same input, same atlas', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
    const a1 = hyperMap([], edges, { epochs: 50 });
    const a2 = hyperMap([], edges, { epochs: 50 });
    expect(a1.points).toEqual(a2.points);
    const a3 = hyperMap([], edges, { epochs: 50, seed: 99 });
    expect(a1.points).not.toEqual(a3.points);
  });

  it('pulls connected nodes closer than unconnected ones', () => {
    // two tight pairs, no cross edges
    const atlas = hyperMap([], [edge('a', 'b', 'assoc', 3), edge('c', 'd', 'assoc', 3)], { epochs: 300 });
    const dAB = poincareDist(atlas.points['a'], atlas.points['b']);
    const dAC = poincareDist(atlas.points['a'], atlas.points['c']);
    const dAD = poincareDist(atlas.points['a'], atlas.points['d']);
    expect(dAB).toBeLessThan(dAC);
    expect(dAB).toBeLessThan(dAD);
  });

  it('pushes the consequent of a provenance edge deeper than its antecedent', () => {
    // root —derived→ mid —derived→ leaf: depth should increase down the chain
    const atlas = hyperMap([], [edge('root', 'mid', 'derived'), edge('mid', 'leaf', 'derived')], { epochs: 400 });
    const dRoot = depth(atlas.points['root']);
    const dMid = depth(atlas.points['mid']);
    const dLeaf = depth(atlas.points['leaf']);
    expect(dMid).toBeGreaterThan(dRoot);
    expect(dLeaf).toBeGreaterThan(dMid);
  });

  it('uses features to place nodes (feature twins start together)', () => {
    const f = ripVector({ spectrum: { centroid: 0.3, flatness: 0.2, periodicity: 0.8 } });
    const nodes: HyperNode[] = [
      { id: 'twin1', features: f },
      { id: 'twin2', features: f },
      { id: 'stranger', features: ripVector({ field: { contrast: 90, entropy: 0.1 } }) },
    ];
    const atlas = hyperMap(nodes, [], { epochs: 1 });
    const dTwins = poincareDist(atlas.points['twin1'], atlas.points['twin2']);
    const dOther = poincareDist(atlas.points['twin1'], atlas.points['stranger']);
    expect(dTwins).toBeLessThan(dOther);
  });

  it('ignores self-loops and honors the node cap', () => {
    const atlas = hyperMap([], [edge('a', 'a'), edge('a', 'b')]);
    expect(atlas.stats.edges).toBe(1);
    const many: MemEdge[] = [];
    for (let i = 0; i < 400; i++) many.push(edge(`n${i}`, `n${i + 1}`));
    expect(hyperMap([], many).stats.nodes).toBeLessThanOrEqual(256);
  });

  it('reports coherent stats', () => {
    const atlas = hyperMap([], [edge('a', 'b'), edge('b', 'c')], { epochs: 100 });
    expect(atlas.stats.mean_edge_dist).toBeGreaterThan(0);
    expect(atlas.stats.depth.max).toBeGreaterThanOrEqual(atlas.stats.depth.min);
    expect(Number.isFinite(atlas.stats.loss)).toBe(true);
  });
});

describe('hyperNeighbors', () => {
  it('ranks by geodesic distance and excludes the query id', () => {
    const atlas = hyperMap([], [edge('a', 'b', 'assoc', 3), edge('a', 'c', 'assoc', 0.2), edge('c', 'd')], { epochs: 300 });
    const nn = hyperNeighbors(atlas, 'a', 3);
    expect(nn.length).toBe(3);
    expect(nn.map((n) => n.id)).not.toContain('a');
    for (let i = 1; i < nn.length; i++) expect(nn[i].dist).toBeGreaterThanOrEqual(nn[i - 1].dist);
  });

  it('accepts a raw point and rejects a dimension mismatch', () => {
    const atlas = hyperMap([], [edge('a', 'b')], { epochs: 10, dim: 2 });
    expect(hyperNeighbors(atlas, [0, 0], 2).length).toBeGreaterThan(0);
    expect(hyperNeighbors(atlas, [0, 0, 0], 2)).toEqual([]);
  });
});
