import { describe, it, expect } from 'vitest';
import { coherenceReport, coherenceSelfTest } from './coherence-layer';
import type { MemEdge } from './graph';

const E = (src: string, dst: string, kind: MemEdge['kind']): MemEdge => ({ src, dst, kind, weight: 1 });

describe('coherenceReport — the derivation/recognition split', () => {
  it('separates hierarchy (derivation) edges from coherence (recognition) edges', () => {
    const r = coherenceReport([
      E('a', 'b', 'derived'), E('b', 'c', 'causal'),   // hierarchy — 2 distinct pairs
      E('a', 'c', 'assoc'), E('a', 'd', 'session'),     // coherence — 2 distinct pairs
    ]);
    expect(r.hierarchy_edges).toBe(2);
    expect(r.coherence_edges).toBe(2);
  });

  it('a bare derivation chain has a long characteristic path and no shortcut', () => {
    const chain: MemEdge[] = [];
    for (let i = 1; i < 6; i++) chain.push(E(`n${i - 1}`, `n${i}`, 'derived'));
    const r = coherenceReport(chain);
    expect(r.hierarchy.avg_path_len).toBeGreaterThan(2);
    expect(r.coherence_edges).toBe(0);
    expect(r.is_small_world_shortcut).toBe(false); // no coherence layer at all
  });

  it('one recognition edge across a chain measurably shortens the average path (small-world)', () => {
    const edges: MemEdge[] = [];
    for (let i = 1; i < 6; i++) edges.push(E(`n${i - 1}`, `n${i}`, 'derived'));
    const before = coherenceReport(edges).hierarchy.avg_path_len;
    edges.push(E('n0', 'n5', 'assoc')); // the shortcut linking the two ends
    const r = coherenceReport(edges);
    expect(r.full.avg_path_len).toBeLessThan(before);
    expect(r.path_len_gain).toBeGreaterThan(1);
    expect(r.is_small_world_shortcut).toBe(true);
  });

  it('a core-directed recognition layer pulls the hub closer to the far tips', () => {
    const edges: MemEdge[] = [];
    for (let i = 1; i < 6; i++) edges.push(E(`n${i - 1}`, `n${i}`, 'derived')); // root n0 … n5 deep
    const before = coherenceReport(edges).core_ecc_before;
    edges.push(E('n0', 'n5', 'assoc')); // co-recall of the deep tip with the root
    const r = coherenceReport(edges);
    expect(r.core_ecc_after).toBeLessThan(before);
  });

  it('recognition edges that only connect a new region widen reachability (reach_gain > 1)', () => {
    // two derivation islands with no hierarchical link between them…
    const edges: MemEdge[] = [
      E('a', 'b', 'derived'), E('b', 'c', 'derived'),
      E('x', 'y', 'derived'), E('y', 'z', 'derived'),
    ];
    const before = coherenceReport(edges).hierarchy.reachable_fraction;
    edges.push(E('c', 'x', 'assoc')); // recognition bridges the two islands
    const r = coherenceReport(edges);
    expect(r.full.reachable_fraction).toBeGreaterThan(before);
    expect(r.reach_gain).toBeGreaterThan(1);
    expect(r.is_small_world_shortcut).toBe(true);
  });
});

describe('coherenceSelfTest — the depth/relational decoupling, measured', () => {
  it('passes: deep hierarchy + core-directed coherence shortens paths and pulls the core in', () => {
    const r = coherenceSelfTest();
    expect(r.hierarchy_is_deep).toBe(true);
    expect(r.coherence_shortens).toBe(true);
    expect(r.core_pulled_closer).toBe(true);
    expect(r.ok).toBe(true);
  });
});
