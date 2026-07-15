import { describe, it, expect } from 'vitest';
import {
  pentagonPillars,
  potentialUniform,
  egalitarianFabric,
  hubFabric,
  privilegeReport,
  buildScaffold,
  scaffoldSelfTest,
  PENTAGON,
} from './scaffold';

describe('the pillars — load-bearing, symmetric, no privileged pillar', () => {
  it('seats 5 pillars at 72° around one apex axis', () => {
    const p = pentagonPillars(4);
    expect(PENTAGON).toBe(5);
    expect(p.pillars.length).toBe(5);
    expect(p.apex.id).toBe('apex');
  });

  it('carries equal load on every pillar (variance 0) — no pillar distinguished', () => {
    const p = pentagonPillars(4);
    expect(p.equal_load).toBe(true);
    expect(p.load_variance).toBe(0);
    expect(p.pillars.every((c) => c.length === 4)).toBe(true);
  });

  it('is C5-invariant: rotating the frame 72° permutes the pillars onto themselves', () => {
    expect(pentagonPillars(4).c5_invariant).toBe(true);
    expect(pentagonPillars(7).c5_invariant).toBe(true); // symmetry is independent of column height
  });

  it('1 apex + 5×4 = 21 structural nodes (the depth-hierarchy count)', () => {
    expect(pentagonPillars(4).total).toBe(21);
    expect(pentagonPillars(2).total).toBe(11);
  });
});

describe('the bridge fabric — uniform potential', () => {
  it('every node may bridge to every other: uniform potential degree n−1', () => {
    const c = potentialUniform(20);
    expect(c.uniform).toBe(true);
    expect(c.potential_degree).toBe(19);
  });
});

describe('no privileged node — measured, not asserted', () => {
  it('the egalitarian (Watts–Strogatz) fabric is connected, hubless, and bottleneck-free', () => {
    const r = privilegeReport(egalitarianFabric(20, 4, 0.3, 7));
    expect(r.connected).toBe(true);
    expect(r.articulation_points).toBe(0);      // no mandatory router
    expect(r.no_privileged_node).toBe(true);
    expect(r.privileged_node).toBeNull();
    expect(r.degree_gini).toBeLessThan(0.34);   // flat degree distribution
  });

  it('the preferential-attachment control DOES form a privileged node', () => {
    const r = privilegeReport(hubFabric(20, 2, 7));
    expect(r.no_privileged_node).toBe(false);
    expect(r.privileged_node).not.toBeNull();
    expect(r.betweenness_spread).toBeGreaterThan(4); // routing concentrates on a hub
  });

  it('the egalitarian fabric is measurably flatter than the hub fabric (the comparison)', () => {
    const egal = privilegeReport(egalitarianFabric(20, 4, 0.3, 7));
    const hub = privilegeReport(hubFabric(20, 2, 7));
    expect(egal.degree_gini).toBeLessThan(hub.degree_gini);
    expect(egal.betweenness_spread).toBeLessThan(hub.betweenness_spread);
  });

  it('a star graph is correctly flagged: its center is the privileged node', () => {
    const star = Array.from({ length: 8 }, (_, i) => ({ a: 'hub', b: `leaf${i}` }));
    const r = privilegeReport(star);
    expect(r.no_privileged_node).toBe(false);
    expect(r.privileged_node).toBe('hub');       // removing it shatters the graph
    expect(r.articulation_points).toBe(1);
  });

  it('a ring is correctly cleared: no node privileged, no bottleneck', () => {
    const ring = Array.from({ length: 8 }, (_, i) => ({ a: String(i), b: String((i + 1) % 8) }));
    const r = privilegeReport(ring);
    expect(r.connected).toBe(true);
    expect(r.articulation_points).toBe(0);
    expect(r.no_privileged_node).toBe(true);
  });
});

describe('buildScaffold — the assembled substrate', () => {
  it('lays an egalitarian bridge fabric over the 21 pillar nodes with no privileged node', () => {
    const s = buildScaffold();
    expect(s.pillars.total).toBe(21);
    expect(s.potential.potential_degree).toBe(20);
    expect(s.privilege.connected).toBe(true);
    expect(s.privilege.no_privileged_node).toBe(true);
  });
});

describe('scaffoldSelfTest — the whole thing green', () => {
  it('pillars symmetric, potential uniform, fabric hubless, hub control fails, egalitarian beats hub', () => {
    const st = scaffoldSelfTest();
    expect(st.pillars_symmetric).toBe(true);
    expect(st.potential_uniform).toBe(true);
    expect(st.fabric_hubless).toBe(true);
    expect(st.hub_control_fails).toBe(true);
    expect(st.egalitarian_beats_hub).toBe(true);
    expect(st.ok).toBe(true);
  });
});
