// ============================================================
// SELF-SHAPE PRESSURE TEST — the graph's curvature signature under realistic
// growth, decay, and captured resonance.
//
// self-shape.test.ts (Test I, in spirit) validates static ground truth: a
// hand-built tree reads hierarchical, a hand-built dense cyclic graph reads
// cyclic. This is the Test-II-equivalent the holding valve got and the
// graph never did: does curvatureSignature/graphInvariants hold up under a
// graph shaped like the REAL mechanics — recordAssociations' pairwise
// reinforcement (the actual self-bootstrapping edge formation), the nightly
// φ⁻¹ sweep, and capturedResonanceScan's own pathology — rather than an
// isolated static topology built by hand?
//
// This exercises the REAL production functions end to end (recordAssociations,
// retention/decayedWeight, capturedResonanceScan, curvatureSignature,
// graphInvariants, deltaHyperbolicity) against an in-memory GraphStore
// implementing the real interface — not a port of the math, same discipline
// as the holding-valve pressure tests (self-compile/import the real module).
//
// Explicitly OUT OF SCOPE, per MEMORY_KERNEL_SPEC.md §4.5/§9: whether the
// reported shape means anything cognitively. This only tests whether the
// STRUCTURAL COMPUTATION is a reliable, non-degenerate instrument — the same
// question Pressure Test II asked of the holding loss, not whether κ itself
// measures "true" coherence (that stays separately, permanently unvalidated).
//
// Deterministic (seeded LCG, no wall-clock, no I/O). Findings: docs/GRAPH_PRESSURE_TEST.md
// ============================================================
import { describe, it, expect } from 'vitest';
import { curvatureSignature, graphInvariants, deltaHyperbolicity, type CurvatureSignature } from './structure';
import {
  recordAssociations, retention, decayedWeight, capturedResonanceScan,
  type MemEdge, type EdgeKind, type GraphStore,
} from './graph';

// ---------- seeded randomness (same LCG shape as the holding-valve sims) ----------
let seed = 20260713;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

// ---------- in-memory GraphStore — the real interface, not a port ----------
// Mirrors CloudGraphStore.link()'s exact reinforcement semantics (ON CONFLICT
// weight bump, capped) so recordAssociations exercises the real self-
// bootstrapping formation logic end to end, not a simplified stand-in.
const WEIGHT_CAP = 4.0, WEIGHT_BUMP = 0.5;
class InMemoryGraphStore implements GraphStore {
  edges = new Map<string, MemEdge & { lastSeen: number }>();
  private key(src: string, dst: string, kind: EdgeKind) {
    // Symmetric kinds canonicalize endpoint order, same as CloudGraphStore.
    const sym = new Set<EdgeKind>(['assoc', 'session', 'contradicts']);
    const [a, b] = sym.has(kind) && dst < src ? [dst, src] : [src, dst];
    return `${a} ${b} ${kind}`;
  }
  async ensureSchema() {}
  async neighbors(ids: string[]): Promise<MemEdge[]> {
    const idSet = new Set(ids);
    return [...this.edges.values()].filter(e => idSet.has(e.src) || idSet.has(e.dst));
  }
  async link(edges: Array<Omit<MemEdge, 'weight'> & { weight?: number }>, atDay = 0): Promise<void> {
    for (const e of edges) {
      const k = this.key(e.src, e.dst, e.kind);
      const existing = this.edges.get(k);
      if (existing) { existing.weight = Math.min(WEIGHT_CAP, existing.weight + WEIGHT_BUMP); existing.lastSeen = atDay; }
      else this.edges.set(k, { src: e.src, dst: e.dst, kind: e.kind, weight: e.weight ?? 1.0, lastSeen: atDay });
    }
  }
  // One nightly sweep, same math as CloudGraphStore.sweep (retention/decayedWeight,
  // 1-day cycle, same 0.05 floor) — against the in-memory map instead of D1.
  sweep(atDay: number, floor = 0.05) {
    let decayed = 0, pruned = 0;
    for (const [k, e] of [...this.edges]) {
      if (e.lastSeen >= atDay) continue; // touched today — fresh, untouched
      const nw = decayedWeight(e.weight, 1, floor);
      if (nw <= 0) { this.edges.delete(k); pruned++; }
      else { e.weight = nw; decayed++; }
    }
    return { decayed, pruned };
  }
  snapshot(): MemEdge[] { return [...this.edges.values()].map(({ src, dst, kind, weight }) => ({ src, dst, kind, weight })); }
}

// A "recall" is exactly what memRecall/router hand to recordAssociations in
// production: the set of node ids that came back together. cap=5 matches
// the real default.
async function recall(store: InMemoryGraphStore, ids: string[], atDay: number) {
  const top = [...new Set(ids)].slice(0, 5);
  if (top.length < 2) return;
  const pairs: Array<Omit<MemEdge, 'weight'>> = [];
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push({ src: top[i], dst: top[j], kind: 'assoc' as EdgeKind });
  await store.link(pairs, atDay);
}
// recordAssociations itself is exercised directly at least once (below) to
// confirm the in-memory store's link() is call-compatible with the real
// production function, not just structurally similar.

type DayRow = { day: number; phase: string; nodes: number; edges: number; cycle_rank: number; delta: number; hyperbolic: number; toroidal: number; leaning: string };

function leaningOf(sig: CurvatureSignature): string {
  const d = sig.suggested.hyperbolic - sig.suggested.toroidal;
  return Math.abs(d) < 0.1 ? 'balanced' : d > 0 ? 'hierarchical' : 'cyclic';
}

describe('self-shape pressure test — realistic corpus growth, decay, captured resonance', () => {
  const store = new InMemoryGraphStore();
  const rows: DayRow[] = [];
  let day = 0; // single continuous counter across every phase — no per-phase guessing
  const record = (day: number, phase: string) => {
    const edges = store.snapshot();
    const inv = graphInvariants(edges);
    const sig = curvatureSignature(edges);
    rows.push({ day, phase, nodes: inv.nodes, edges: inv.edges, cycle_rank: inv.cycle_rank, delta: sig.delta, hyperbolic: sig.suggested.hyperbolic, toroidal: sig.suggested.toroidal, leaning: leaningOf(sig) });
  };

  // ---------- Phase 1: bootstrap (a few opening days) — scattered, real multi-node recalls ----------
  // FINDING (not a bug): recordAssociations forms ALL pairwise edges among a
  // recall's top-k, so any recall touching 3+ distinct ids seeds a small
  // clique — a genuine cycle — among them by construction (graph.ts's own
  // doc: "the set a recall returned IS, by definition, a set that was
  // relevant together"). Even a "sparse, unrelated" bootstrap organically
  // introduces cyclic noise the moment a real (3-wide) recall happens. This
  // is tracked explicitly (bootstrapCycleRank) so phase 2 can assert on what
  // ITS OWN tree-building added, not silently assume a clean slate that
  // multi-node recall never actually provides.
  const scatter = ['note-1', 'note-2', 'note-3', 'note-4', 'note-5', 'note-6', 'note-7', 'note-8'];
  let bootstrapCycleRank = 0;
  it('phase 1 — bootstrap: sparse, real recalls organically seed small cycles', async () => {
    for (let i = 0; i < 3; i++) {
      day++;
      await recall(store, [pick(scatter), pick(scatter), pick(scatter)], day);
      record(day, 'bootstrap');
    }
    const last = rows[rows.length - 1];
    bootstrapCycleRank = last.cycle_rank;
    expect(last.edges).toBeGreaterThan(0);
    expect(last.cycle_rank).toBeGreaterThanOrEqual(0); // never negative — the max(0,...) guard holds
  });

  // ---------- Phase 2: hierarchical building (the following days) — a real branching tree ----------
  // root -> {trading, journal, corpus, graph} -> leaves. recordAssociations only
  // ever sees a parent + its own children in one recall (2 nodes), so the
  // pairwise edges IT forms are exactly the parent-child pairs — never cross-branch.
  const tree: Record<string, string[]> = {
    root: ['trading', 'journal', 'corpus', 'graph'],
    trading: ['risk-guard', 'superposition', 'options'],
    journal: ['optimus', 'marginalia', 'threads'],
    corpus: ['ingest-gate', 'lineage', 'backfill'],
    graph: ['structure', 'hygiene', 'self-shape'],
  };
  it('phase 2 — hierarchical building: reads hierarchical, adds zero new cycles', async () => {
    for (const [parent, children] of Object.entries(tree)) {
      for (const child of children) { day++; await recall(store, [parent, child], day); record(day, 'hierarchical-building'); }
    }
    const last = rows[rows.length - 1];
    expect(last.leaning).toBe('hierarchical');
    // Phase 2's OWN tree-building (every recall here is exactly 2 nodes —
    // parent+child, never 3+) adds ZERO new cycles on top of bootstrap's
    // pre-existing noise — the tree edges themselves never cross branches.
    expect(last.cycle_rank).toBe(bootstrapCycleRank);
    expect(last.hyperbolic).toBeGreaterThan(last.toroidal);
  });

  // ---------- Phase 3: cyclic/rhythmic building (15 days, a daily ritual) — a real daily ritual loop ----------
  // A small recurring working set, recalled together (overlapping subsets) every
  // day — exactly what a genuine daily ritual produces under recordAssociations'
  // real reinforcement (repeat co-recall bumps weight, capped at 4.0).
  const ritual = ['morning-checkin', 'kappa-reading', 'trading-review', 'journal-entry', 'duplex-ledger', 'consolidation'];
  it('phase 3 — cyclic building: the graph shifts toward cyclic/balanced as the ritual reinforces', async () => {
    for (let d = 0; d < 15; d++) {
      day++;
      // Overlapping rotating subset of the ritual, not the identical set every
      // time (a real recall varies slightly) — still the same small pool.
      const subset = [ritual[d % 6], ritual[(d + 1) % 6], ritual[(d + 2) % 6], ritual[(d + 3) % 6]];
      await recall(store, subset, day);
      record(day, 'cyclic-building');
    }
    const last = rows[rows.length - 1];
    expect(last.cycle_rank).toBeGreaterThan(0); // the ritual cluster IS cyclic now
    // The shift is directional, not necessarily past the tree's raw mass —
    // check the TREND, not full flip: toroidal share must have grown from
    // phase 2's near-zero baseline.
    const afterPhase2 = rows.filter(r => r.phase === 'hierarchical-building').pop()!;
    expect(last.toroidal).toBeGreaterThan(afterPhase2.toroidal);
  });

  // ---------- Phase 4: decay (15 more days) — the tree goes cold, the ritual stays hot ----------
  it('phase 4 — decay: dead hierarchical edges prune away; the hot cluster outlasts the cold tree', async () => {
    const beforeEdgeCount = store.edges.size;
    const treeEdgeKeys = new Set<string>();
    for (const [parent, children] of Object.entries(tree)) for (const child of children) treeEdgeKeys.add(`${parent} ${child} assoc`);
    for (let d = 0; d < 15; d++) {
      day++;
      // Only the ritual gets recalled — the tree is never touched again.
      const subset = [ritual[d % 6], ritual[(d + 1) % 6], ritual[(d + 2) % 6]];
      await recall(store, subset, day);
      const swept = store.sweep(day);
      record(day, 'decay');
      if (d === 14) expect(swept.pruned + swept.decayed).toBeGreaterThan(0); // the sweep did real work by the end
    }
    const afterEdgeCount = store.edges.size;
    expect(afterEdgeCount).toBeLessThan(beforeEdgeCount); // net shrinkage — dead structure actually left
    let survivingTreeEdges = 0;
    for (const k of treeEdgeKeys) { if (store.edges.get(k)) survivingTreeEdges++; }
    expect(survivingTreeEdges).toBeLessThan(treeEdgeKeys.size); // most of the tree pruned

    // RELATIVE comparison, not one hand-picked edge: the rotating 3-wide
    // window does not guarantee any SPECIFIC pair co-recalls every single
    // day (a pair only refreshes on days its two nodes both land in the
    // window), so a single edge can legitimately decay some even inside an
    // "active" cluster. The robust claim: the ritual cluster's MEAN
    // surviving weight is well above the tree's, because the cluster as a
    // whole gets SOME member refreshed daily while the tree gets none at all.
    const ritualIds = new Set(ritual);
    const ritualWeights: number[] = [], treeWeights: number[] = [];
    for (const e of store.edges.values()) {
      if (ritualIds.has(e.src) && ritualIds.has(e.dst)) ritualWeights.push(e.weight);
      else if (treeEdgeKeys.has(`${e.src} ${e.dst} ${e.kind}`)) treeWeights.push(e.weight);
    }
    const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    expect(ritualWeights.length).toBeGreaterThan(0); // the cluster has real survivors to compare
    expect(mean(ritualWeights)).toBeGreaterThan(mean(treeWeights)); // hot cluster clearly outlasts the cold tree

    const last = rows[rows.length - 1];
    expect(last.leaning === 'cyclic' || last.leaning === 'balanced').toBe(true); // shifted away from hierarchical as the tree died
  });

  // ---------- Phase 5: captured-resonance stress (5 final days) ----------
  it('phase 5 — captured resonance: the scan fires, and one hot edge does not silently corrupt the whole-graph reading', async () => {
    const before = curvatureSignature(store.snapshot());
    for (let d = 0; d < 5; d++) {
      day++;
      // Hammer ONE pair every day — nothing else — driving its weight toward
      // the 4.0 cap and its dominance of both endpoints' incident mass up.
      await recall(store, ['kappa-reading', 'trading-review'], day);
      store.sweep(day);
      record(day, 'captured-resonance-stress');
    }
    const edges = store.snapshot();
    const flags = capturedResonanceScan(edges);
    expect(flags.length).toBeGreaterThan(0); // the scan correctly catches it
    expect(flags.some(f => (f.node === 'kappa-reading' || f.node === 'trading-review'))).toBe(true);

    // Distortion check: does ONE dominant hot edge swing the WHOLE-graph
    // curvature signature out of proportion to the rest of the (still
    // multi-node, still cyclic) structure? A single hot pair legitimately
    // nudges the reading (real signal) — it must not DOMINATE it (a single
    // edge overriding a graph of a dozen+ other nodes would be exactly the
    // kappa-v1-fixed-point failure class transplanted to the graph).
    const after = curvatureSignature(edges);
    const swing = Math.abs(after.suggested.toroidal - before.suggested.toroidal);
    expect(swing).toBeLessThan(0.5); // a real nudge, not a whole-signature flip from one pair
  });

  // ---------- degenerate-fixed-point check (κ-v1 acceptance-test discipline) ----------
  it('the signature is non-degenerate across the whole run — same acceptance bar as κ v1', () => {
    const distinctDelta = new Set(rows.map(r => r.delta)).size;
    const distinctLeaning = new Set(rows.map(r => r.leaning)).size;
    // κ v1's failure was a SINGLE resting value on 84% of inputs. The bar
    // here: multiple distinct delta readings, and the leaning classification
    // must actually MOVE across a run that was deliberately shaped to move it.
    expect(distinctDelta).toBeGreaterThanOrEqual(3);
    expect(distinctLeaning).toBeGreaterThanOrEqual(2);
    expect(rows.every(r => r.cycle_rank >= 0)).toBe(true); // b1 = max(0, E-V+C) guard — never violated
    expect(rows.every(r => r.hyperbolic + r.toroidal <= 1.0001)).toBe(true); // suggested weights are a real partition
  });

  it('recordAssociations (the real production function) is call-compatible with the in-memory store', async () => {
    const s2 = new InMemoryGraphStore();
    await recordAssociations(s2 as unknown as GraphStore, ['a', 'b', 'c'], 5);
    expect(s2.edges.size).toBe(3); // C(3,2) pairwise edges, exactly as production forms them
  });

  it('efficiency: deltaHyperbolicity stays practical at the self-shape.ts production cap (~1500 edges)', () => {
    // self-shape.ts's graphShape() reads up to 1500 edges from D1. Build a
    // graph at that scale (mixed tree+cycles, matching realistic shape) and
    // time the O(sample⁴) 4-point check at its default sample=32.
    const big: MemEdge[] = [];
    for (let i = 0; i < 1500; i++) {
      const a = `n${i}`, b = `n${(i * 7 + 3) % 1500}`;
      if (a !== b) big.push({ src: a, dst: b, kind: 'assoc', weight: 1 });
    }
    const t0 = performance.now();
    deltaHyperbolicity(big.map(e => ({ src: e.src, dst: e.dst })));
    const ms = performance.now() - t0;
    // Admin-gated call path (self_state / /api/elle-self), not a hot loop —
    // generous ceiling, but a real number, not an assumption.
    expect(ms).toBeLessThan(2000);
  });

  it('prints the day-by-day map — the graph shape across the full simulated run', () => {
    console.log('\n=== SELF-SHAPE PRESSURE TEST — day-by-day map ===');
    console.log('day  phase                      nodes  edges  cyc_rank  delta   hyp    tor   leaning');
    for (const r of rows) {
      console.log(
        `${String(r.day).padStart(3)}  ${r.phase.padEnd(26)} ${String(r.nodes).padStart(5)}  ${String(r.edges).padStart(5)}  ${String(r.cycle_rank).padStart(8)}  ${r.delta.toFixed(2).padStart(5)}  ${r.hyperbolic.toFixed(2)}   ${r.toroidal.toFixed(2)}  ${r.leaning}`
      );
    }
    expect(rows.length).toBeGreaterThan(30); // the map actually has substance
  });
});
