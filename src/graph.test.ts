import { describe, it, expect } from 'vitest';
import {
  spreadActivation,
  graphExpand,
  graphExpandAB,
  recordAssociations,
  canonicalEndpoints,
  lobeKindCorrelation,
  CONDUCTANCE,
  type MemEdge,
  type GraphStore,
  type SeedActivation,
} from './graph';

describe('spreadActivation', () => {
  it('returns nothing when there are no edges', () => {
    const out = spreadActivation([{ id: 'a', activation: 1 }], []);
    expect(out.size).toBe(0);
  });

  it('flows charge from a seed to a one-hop neighbor, excluding the seed', () => {
    const edges: MemEdge[] = [{ src: 'a', dst: 'b', kind: 'assoc', weight: 1 }];
    const out = spreadActivation([{ id: 'a', activation: 1 }], edges, { hops: 1 });
    expect(out.has('a')).toBe(false);
    // 1 · weight 1 · conductance(assoc)=0.6 · decay^1 (0.5) = 0.3
    expect(out.get('b')).toBeCloseTo(1 * 1 * CONDUCTANCE.assoc * 0.5, 6);
  });

  it('reaches two hops, damped further each hop', () => {
    const edges: MemEdge[] = [
      { src: 'a', dst: 'b', kind: 'assoc', weight: 1 },
      { src: 'b', dst: 'c', kind: 'assoc', weight: 1 },
    ];
    const out = spreadActivation([{ id: 'a', activation: 1 }], edges, { hops: 2 });
    expect(out.get('b')!).toBeGreaterThan(out.get('c')!);
    expect(out.get('c')!).toBeGreaterThan(0);
  });

  it('stops at the hop limit', () => {
    const edges: MemEdge[] = [
      { src: 'a', dst: 'b', kind: 'assoc', weight: 1 },
      { src: 'b', dst: 'c', kind: 'assoc', weight: 1 },
    ];
    const out = spreadActivation([{ id: 'a', activation: 1 }], edges, { hops: 1 });
    expect(out.has('b')).toBe(true);
    expect(out.has('c')).toBe(false);
  });

  it('treats edges as symmetric — reachable from either endpoint', () => {
    const edges: MemEdge[] = [{ src: 'a', dst: 'b', kind: 'assoc', weight: 1 }];
    const fromB = spreadActivation([{ id: 'b', activation: 1 }], edges, { hops: 1 });
    expect(fromB.get('a')).toBeGreaterThan(0);
  });

  it('weights stronger edges over weaker ones', () => {
    const edges: MemEdge[] = [
      { src: 'a', dst: 'strong', kind: 'assoc', weight: 3 },
      { src: 'a', dst: 'weak', kind: 'assoc', weight: 0.5 },
    ];
    const out = spreadActivation([{ id: 'a', activation: 1 }], edges, { hops: 1 });
    expect(out.get('strong')!).toBeGreaterThan(out.get('weak')!);
  });

  it('lets high-conductance kinds carry more than low ones', () => {
    const derived: MemEdge[] = [{ src: 'a', dst: 'b', kind: 'derived', weight: 1 }];
    const contra: MemEdge[] = [{ src: 'a', dst: 'b', kind: 'contradicts', weight: 1 }];
    const d = spreadActivation([{ id: 'a', activation: 1 }], derived, { hops: 1 }).get('b')!;
    const c = spreadActivation([{ id: 'a', activation: 1 }], contra, { hops: 1 }).get('b')!;
    expect(d).toBeGreaterThan(c);
  });

  it('prunes activation below the floor', () => {
    const edges: MemEdge[] = [{ src: 'a', dst: 'b', kind: 'contradicts', weight: 0.01 }];
    const out = spreadActivation([{ id: 'a', activation: 0.1 }], edges, { hops: 1, minActivation: 0.04 });
    expect(out.has('b')).toBe(false);
  });

  it('ignores self-loops and blank endpoints', () => {
    const edges: MemEdge[] = [
      { src: 'a', dst: 'a', kind: 'assoc', weight: 1 },
      { src: 'a', dst: '', kind: 'assoc', weight: 1 },
    ];
    expect(spreadActivation([{ id: 'a', activation: 1 }], edges).size).toBe(0);
  });
});

describe('canonicalEndpoints', () => {
  it('orders symmetric kinds by endpoint so a pair stores once', () => {
    expect(canonicalEndpoints('b', 'a', 'assoc')).toEqual({ src: 'a', dst: 'b' });
    expect(canonicalEndpoints('a', 'b', 'assoc')).toEqual({ src: 'a', dst: 'b' });
  });
  it('preserves direction for directed kinds', () => {
    expect(canonicalEndpoints('b', 'a', 'causal')).toEqual({ src: 'b', dst: 'a' });
  });
});

// A tiny in-memory GraphStore to exercise the traversal driver + recorder
// without any D1. Mirrors the reinforcement contract (weight bump on repeat).
class MemoryStore implements GraphStore {
  edges: MemEdge[] = [];
  async ensureSchema() {}
  async neighbors(ids: string[]): Promise<MemEdge[]> {
    const set = new Set(ids);
    return this.edges.filter(e => set.has(e.src) || set.has(e.dst));
  }
  async link(edges: Array<Omit<MemEdge, 'weight'> & { weight?: number }>) {
    for (const e of edges) {
      const { src, dst } = canonicalEndpoints(e.src, e.dst, e.kind);
      const found = this.edges.find(x => x.src === src && x.dst === dst && x.kind === e.kind);
      if (found) found.weight = Math.min(4, found.weight + 0.5);
      else this.edges.push({ src, dst, kind: e.kind, weight: e.weight ?? 1 });
    }
  }
}

describe('graphExpand', () => {
  it('surfaces a connected node the seed set did not contain', async () => {
    const store = new MemoryStore();
    store.edges = [{ src: 'seed', dst: 'connected', kind: 'assoc', weight: 2 }];
    const out = await graphExpand(store, [{ id: 'seed', activation: 1 }], { hops: 1 });
    expect(out.get('connected')).toBeGreaterThan(0);
  });

  it('is a clean no-op on an empty graph', async () => {
    const out = await graphExpand(new MemoryStore(), [{ id: 'x', activation: 1 }]);
    expect(out.size).toBe(0);
  });

  it('returns empty for no seeds', async () => {
    const store = new MemoryStore();
    store.edges = [{ src: 'a', dst: 'b', kind: 'assoc', weight: 1 }];
    expect((await graphExpand(store, [])).size).toBe(0);
  });

  describe('cycleBoost (structure-weighted expansion)', () => {
    // A triangle A-B-C (all edges on the cycle) plus a bridge tail A-D.
    const triangleWithTail = (): MemoryStore => {
      const s = new MemoryStore();
      s.edges = [
        { src: 'A', dst: 'B', kind: 'assoc', weight: 1 },
        { src: 'A', dst: 'C', kind: 'assoc', weight: 1 },
        { src: 'B', dst: 'C', kind: 'assoc', weight: 1 },
        { src: 'A', dst: 'D', kind: 'assoc', weight: 1 }, // bridge
      ];
      return s;
    };

    it('boosts a node reached through recurrence, leaves a bridge-only node untouched', async () => {
      const seeds = [{ id: 'A', activation: 1 }];
      const base = await graphExpand(triangleWithTail(), seeds, { hops: 2 });
      const boosted = await graphExpand(triangleWithTail(), seeds, { hops: 2, cycleBoost: 2 });
      expect(boosted.get('B')!).toBeGreaterThan(base.get('B')!);  // B is on the cycle
      expect(boosted.get('D')!).toBeCloseTo(base.get('D')!, 9);   // D hangs off a bridge — unchanged
    });

    it('cycleBoost of 1 (or absent) is exactly the baseline (no behavior change)', async () => {
      const seeds = [{ id: 'A', activation: 1 }];
      const base = await graphExpand(triangleWithTail(), seeds, { hops: 2 });
      const one = await graphExpand(triangleWithTail(), seeds, { hops: 2, cycleBoost: 1 });
      expect([...one.entries()].sort()).toEqual([...base.entries()].sort());
    });

    it('graphExpandAB returns both arms from one traversal, matching graphExpand', async () => {
      const seeds = [{ id: 'A', activation: 1 }];
      const ab = await graphExpandAB(triangleWithTail(), seeds, { hops: 2 }, 2);
      const base = await graphExpand(triangleWithTail(), seeds, { hops: 2 });
      const boosted = await graphExpand(triangleWithTail(), seeds, { hops: 2, cycleBoost: 2 });
      expect([...ab.base.entries()].sort()).toEqual([...base.entries()].sort());
      expect([...ab.boosted.entries()].sort()).toEqual([...boosted.entries()].sort());
      // the boosted arm diverges from base on the cycle node
      expect(ab.boosted.get('B')!).toBeGreaterThan(ab.base.get('B')!);
    });

    it('graphExpandAB with boost 1 returns identical arms', async () => {
      const ab = await graphExpandAB(triangleWithTail(), [{ id: 'A', activation: 1 }], { hops: 2 }, 1);
      expect(ab.base).toBe(ab.boosted);
    });
  });
});

describe('recordAssociations', () => {
  it('links all pairs in the set and reinforces on repeat', async () => {
    const store = new MemoryStore();
    await recordAssociations(store, ['a', 'b', 'c']); // 3 pairs
    expect(store.edges.length).toBe(3);
    expect(store.edges.every(e => e.weight === 1)).toBe(true);
    await recordAssociations(store, ['a', 'b']); // reinforce the a–b pair
    const ab = store.edges.find(e => e.src === 'a' && e.dst === 'b')!;
    expect(ab.weight).toBe(1.5);
    expect(store.edges.length).toBe(3); // no new edge, just reinforcement
  });

  it('does nothing for a set of fewer than two', async () => {
    const store = new MemoryStore();
    await recordAssociations(store, ['solo']);
    expect(store.edges.length).toBe(0);
  });

  it('caps how many members it links (bounded cost)', async () => {
    const store = new MemoryStore();
    await recordAssociations(store, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5); // cap 5 → 10 pairs
    expect(store.edges.length).toBe(10);
  });

  it('dedupes ids before pairing', async () => {
    const store = new MemoryStore();
    await recordAssociations(store, ['a', 'a', 'b']);
    expect(store.edges.length).toBe(1);
  });
});

// ── does "recognition" mean "closes a loop between branches"? ──────────────
// derived/causal/etc. build a widening tree from what a memory came from;
// assoc/session/contradicts get added later, when the system notices two
// things belong together regardless of which branch they grew on. If that
// story holds, recognition-kind edges should land on a lobe (non-bridge) far
// more often than derivation-kind edges, which mostly just extend the tree.
describe('lobeKindCorrelation', () => {
  const E = (src: string, dst: string, kind: MemEdge['kind']): MemEdge => ({ src, dst, kind, weight: 1 });

  it('a pure derivation tree has nothing on a lobe — no recognition edges to compare against', () => {
    const edges = [E('root', 'A', 'derived'), E('A', 'A1', 'derived'), E('A', 'A2', 'derived')];
    const r = lobeKindCorrelation(edges);
    expect(r.derivation_on_lobe_fraction).toBe(0);
    expect(r.recognition_edges).toBe(0);
    expect(r.confirms_hypothesis).toBe(false); // no recognition edges present — nothing to confirm
  });

  it('a reconnection between two tree branches is exactly what closes a lobe — and most of the tree stays untouched', () => {
    const edges: MemEdge[] = [
      // a wide tree — most of this never gets swept into any loop
      E('root', 'A', 'derived'), E('root', 'B', 'derived'), E('root', 'C', 'derived'), E('root', 'D', 'derived'),
      E('A', 'A1', 'derived'), E('A', 'A2', 'derived'), E('A', 'A3', 'derived'),
      E('B', 'B1', 'derived'), E('D', 'D1', 'causal'), E('D1', 'D1a', 'refines'), E('C', 'C1', 'about'),
      // the recognition edge: A2 and B1 were recalled together though they grew on separate branches
      E('A2', 'B1', 'assoc'),
    ];
    const r = lobeKindCorrelation(edges);
    expect(r.recognition_edges).toBe(1);
    expect(r.recognition_on_lobe_fraction).toBe(1); // the assoc edge itself always closes its own loop
    expect(r.derivation_on_lobe_fraction).toBeGreaterThan(0);  // the path it reconnects (A-A2, root-A, root-B, B-B1) is swept in too
    expect(r.derivation_on_lobe_fraction).toBeLessThan(1);     // but most of the tree (C, D branches) stays untouched
    expect(r.recognition_on_lobe_fraction).toBeGreaterThan(r.derivation_on_lobe_fraction);
    expect(r.confirms_hypothesis).toBe(true);
  });
});
