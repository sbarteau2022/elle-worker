// ============================================================
// B3 GATE — cycle-boost retrieval lift on a structured synthetic graph
//
// Claim under test (COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md, benchmark B3):
// boosting on-cycle edge weights ×1.3 during spreading activation improves
// ranking of RELEVANT memories (same community, 2 hops around the ring) over
// IRRELEVANT distractors (hub-adjacent nodes in other communities), because
// community structure is cycle-rich while hub attachments are locally tree-like
// (bridges) and never get boosted.
//
// Graph (500 nodes, exactly 1200 edges — asserted):
//   • 25 communities × 12 members. Each community: a 12-ring (i, i+1 mod 12)
//     plus chords (i, i+2 mod 12) → 24 edges, kind 'assoc', weight U(0.30,0.35).
//     Every community edge sits on triangles/4-cycles → boosted when the local
//     2-hop ego collection contains the cycle.
//   • 24 bridge edges c{k}_m0 – c{k+1}_m0, kind 'session', weight U(0.80,0.92).
//   • 200 hubs: hub h<176 gets 3 member attachments, h≥176 gets 2 (576 ends),
//     kind 'session', weight U(0.80,0.92). Attachment is round-robin over the
//     member list ordered i-outer/ci-inner, so consecutive ends land in
//     DISTINCT communities — every hub edge is a local bridge, never boosted.
//   600 + 24 + 576 = 1200.
//
// Per query (40 seeded seeds): relevant = same community at ring distance
// {3,4}; excluded = ring distance {1,2} (direct neighbors — trivially ranked
// in both arms); irrelevant = everything else reached. Score = midrank
// Mann-Whitney AUC per arm. Gates:
//   mean(AUC_boosted − AUC_base) ≥ +0.06,
//   one-sided sign-flip permutation p < 0.01 (10000 iters, seeded),
//   mean Jaccard distance(boosted top-10 vs graph-BFS top-10) > 0.15,
//   ≥ 35 of 40 queries valid (nRel > 0 and nIrr > 0).
// minActivation is set to 1e-4: hop-2 community activations run ~0.005–0.016
// and the default 0.04 floor would prune exactly the signal being measured.
// ============================================================

import { describe, expect, it } from 'vitest';
import { graphExpandAB, type GraphStore, type MemEdge, type SeedActivation } from './graph';
import { jaccardDistance } from './recall-ab';
import { mulberry32 } from './hyper';

const COMMUNITIES = 25;
const MEMBERS = 12;
const HUBS = 200;
const QUERIES = 40;

const member = (ci: number, i: number) => `c${ci}_m${i}`;

interface B3Graph {
  edges: MemEdge[];
  store: GraphStore;
  adjacency: Map<string, string[]>; // sorted, deduped — for the BFS baseline
}

function buildGraph(): B3Graph {
  const rand = mulberry32(0xb3b3b3);
  const wLow = () => 0.3 + rand() * 0.05; // community: U(0.30, 0.35)
  const wHigh = () => 0.8 + rand() * 0.12; // bridge/hub: U(0.80, 0.92)
  const edges: MemEdge[] = [];

  for (let ci = 0; ci < COMMUNITIES; ci++) {
    for (let i = 0; i < MEMBERS; i++) {
      edges.push({ src: member(ci, i), dst: member(ci, (i + 1) % MEMBERS), kind: 'assoc', weight: wLow() });
      edges.push({ src: member(ci, i), dst: member(ci, (i + 2) % MEMBERS), kind: 'assoc', weight: wLow() });
    }
  }
  for (let ci = 0; ci < COMMUNITIES - 1; ci++) {
    edges.push({ src: member(ci, 0), dst: member(ci + 1, 0), kind: 'session', weight: wHigh() });
  }
  // Flat member list ordered i-outer/ci-inner: c0_m0, c1_m0, …, c24_m0, c0_m1, …
  // Any consecutive run of ≤3 entries spans distinct communities, so a hub's
  // attachments never collide and hub edges never close a local cycle.
  const flat: string[] = [];
  for (let i = 0; i < MEMBERS; i++) for (let ci = 0; ci < COMMUNITIES; ci++) flat.push(member(ci, i));
  let p = 0;
  for (let h = 0; h < HUBS; h++) {
    const ends = h < 176 ? 3 : 2;
    for (let e = 0; e < ends; e++) {
      edges.push({ src: `hub${h}`, dst: flat[p % flat.length], kind: 'session', weight: wHigh() });
      p++;
    }
  }

  const byNode = new Map<string, MemEdge[]>();
  const push = (id: string, e: MemEdge) => {
    const arr = byNode.get(id);
    if (arr) arr.push(e);
    else byNode.set(id, [e]);
  };
  for (const e of edges) {
    push(e.src, e);
    push(e.dst, e);
  }
  const store: GraphStore = {
    async ensureSchema() {},
    async link() {},
    // Faithful to the D1 store: each edge touching the queried id set is
    // returned once per call (dedup within the call, not across calls).
    async neighbors(ids: string[]): Promise<MemEdge[]> {
      const seen = new Set<MemEdge>();
      const out: MemEdge[] = [];
      for (const id of ids) {
        for (const e of byNode.get(id) ?? []) {
          if (!seen.has(e)) {
            seen.add(e);
            out.push(e);
          }
        }
      }
      return out;
    },
  };

  const adjSets = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjSets.has(a)) adjSets.set(a, new Set());
    adjSets.get(a)!.add(b);
  };
  for (const e of edges) {
    link(e.src, e.dst);
    link(e.dst, e.src);
  }
  const adjacency = new Map<string, string[]>();
  for (const [id, s] of adjSets) adjacency.set(id, [...s].sort());
  return { edges, store, adjacency };
}

function ringDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, MEMBERS - d);
}

/** Midrank Mann-Whitney AUC: P(relevant scores above irrelevant), ties → 0.5. */
function midrankAUC(rel: number[], irr: number[]): number {
  const all = rel
    .map((v) => ({ v, isRel: true }))
    .concat(irr.map((v) => ({ v, isRel: false })));
  all.sort((a, b) => a.v - b.v); // ascending
  let sumRelRanks = 0;
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j].v === all[i].v) j++;
    const mid = (i + 1 + j) / 2; // midrank of the tie block spanning ranks i+1..j
    for (let k = i; k < j; k++) if (all[k].isRel) sumRelRanks += mid;
    i = j;
  }
  const nR = rel.length;
  const nI = irr.length;
  return (sumRelRanks - (nR * (nR + 1)) / 2) / (nR * nI);
}

/** First 10 nodes a plain BFS reaches (sorted-neighbor order), seed excluded. */
function bfsFirst10(adjacency: Map<string, string[]>, seed: string): string[] {
  const visited = new Set<string>([seed]);
  const queue: string[] = [seed];
  const out: string[] = [];
  while (queue.length && out.length < 10) {
    const cur = queue.shift()!;
    for (const nb of adjacency.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      queue.push(nb);
      out.push(nb);
      if (out.length === 10) break;
    }
  }
  return out;
}

describe('B3 — cycle-boost retrieval lift (ΔAUC gate)', () => {
  it('synthetic graph has exactly 500 nodes and 1200 edges with the declared mix', () => {
    const { edges } = buildGraph();
    const nodes = new Set<string>();
    let assoc = 0;
    let session = 0;
    let badWeight = 0;
    for (const e of edges) {
      nodes.add(e.src);
      nodes.add(e.dst);
      if (e.kind === 'assoc') {
        assoc++;
        if (!(e.weight >= 0.3 && e.weight <= 0.35)) badWeight++;
      } else {
        session++;
        if (!(e.weight >= 0.8 && e.weight <= 0.92)) badWeight++;
      }
      if (e.src === e.dst) badWeight++;
    }
    expect(nodes.size).toBe(500);
    expect(edges.length).toBe(1200);
    expect(assoc).toBe(600);
    expect(session).toBe(600); // 24 bridges + 576 hub ends
    expect(badWeight).toBe(0);
  }, 30000);

  it('boost lifts relevant-vs-distractor AUC: mean ΔAUC ≥ +0.06, permutation p < 0.01, top-10 shifts', async () => {
    const { store, adjacency } = buildGraph();
    const qRand = mulberry32(0xdecade);
    const deltas: number[] = [];
    const jaccards: number[] = [];

    for (let q = 0; q < QUERIES; q++) {
      const ci = Math.floor(qRand() * COMMUNITIES);
      const si = Math.floor(qRand() * MEMBERS);
      const seed = member(ci, si);
      const seeds: SeedActivation[] = [{ id: seed, activation: 1 }];
      const { base, boosted } = await graphExpandAB(store, seeds, { hops: 2, minActivation: 1e-4 }, 1.3);

      const universe = new Set<string>();
      for (const id of base.keys()) universe.add(id);
      for (const id of boosted.keys()) universe.add(id);
      universe.delete(seed);
      for (let i = 0; i < MEMBERS; i++) {
        if (ringDistance(si, i) <= 2) universe.delete(member(ci, i)); // incl. dist 0 = seed
      }

      const relevantIds = new Set<string>();
      for (let i = 0; i < MEMBERS; i++) {
        const d = ringDistance(si, i);
        if ((d === 3 || d === 4) && universe.has(member(ci, i))) relevantIds.add(member(ci, i));
      }
      const relBase: number[] = [];
      const irrBase: number[] = [];
      const relBoost: number[] = [];
      const irrBoost: number[] = [];
      for (const id of universe) {
        const b = base.get(id) ?? 0;
        const s = boosted.get(id) ?? 0;
        if (relevantIds.has(id)) {
          relBase.push(b);
          relBoost.push(s);
        } else {
          irrBase.push(b);
          irrBoost.push(s);
        }
      }
      if (relBase.length === 0 || irrBase.length === 0) continue;
      deltas.push(midrankAUC(relBoost, irrBoost) - midrankAUC(relBase, irrBase));

      const boostedTop10 = [...boosted.entries()]
        .filter(([id]) => id !== seed)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 10)
        .map(([id]) => id);
      jaccards.push(jaccardDistance(boostedTop10, bfsFirst10(adjacency, seed)));
    }

    expect(deltas.length).toBeGreaterThanOrEqual(35);
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    expect(meanDelta).toBeGreaterThanOrEqual(0.06);

    // One-sided sign-flip permutation test on the per-query ΔAUCs.
    const pRand = mulberry32(0x9e97);
    const ITERS = 10000;
    let atLeast = 0;
    for (let it = 0; it < ITERS; it++) {
      let sum = 0;
      for (const d of deltas) sum += pRand() < 0.5 ? d : -d;
      if (sum / deltas.length >= meanDelta) atLeast++;
    }
    const p = (atLeast + 1) / (ITERS + 1);
    expect(p).toBeLessThan(0.01);

    // The boosted ranking must actually diverge from plain graph proximity.
    const meanJaccard = jaccards.reduce((a, b) => a + b, 0) / jaccards.length;
    expect(meanJaccard).toBeGreaterThan(0.15);
  }, 30000);
});
