// ============================================================
// ELLE GRAPH MEMORY KERNEL — src/graph.ts
//
// The memory kernel (memory.ts) ranks nodes by semantic match + importance +
// recency. That finds memories that LOOK like the query. It cannot find the
// memory that MATTERS to the query but shares none of its words — the decision a
// fact led to, the insight distilled from an observation, the correction that
// superseded an old belief. Those are edges, not similarity.
//
// This is the graph layer over the same nodes. elle_memory rows are nodes; this
// module adds typed, weighted edges between them and a traversal that turns
// recall from a similarity lookup into memory NAVIGATION: seed with the semantic
// hits, then spread activation along edges to pull in what's connected.
//
// It self-bootstraps with no LLM and no daemon: every recall records the
// co-occurrence of the set it returned as `assoc` edges (reinforced on repeat),
// so the graph learns which memories belong together simply by being used. A
// memory that keeps getting recalled alongside another grows a strong edge to
// it; the next query that lands on either end pulls the other in for free. This
// is the "hot path / attention as memory navigation" claim, made concrete.
//
// Substrate seam (for the sovereign build): all D1 lives behind GraphStore.
// CloudGraphStore is the hosted (D1) implementation; a LocalGraphStore over
// SQLite drops in for the sovereign model with zero change to the pure traversal
// below. The spreading-activation core is store-agnostic and unit-tested.
// ============================================================

// Runtime dependency is one-way (graph → structure); structure imports only the
// MemEdge *type* back, which is erased, so there is no import cycle.
import { ensureAllSchemas } from './db/schema';
import { nonBridgeEdges, edgeKey } from './structure';

export type EdgeKind =
  | 'assoc'        // co-recall association (symmetric, self-bootstrapping)
  | 'causal'       // A led to B (directed)
  | 'derived'      // B distilled from A
  | 'refines'      // B refines A
  | 'supersedes'   // B replaces A (follow to the newest)
  | 'contradicts'  // A and B are in tension (weak pull — surface, don't dominate)
  | 'session'      // co-occurred in one run/session
  | 'about'        // A is about entity/topic B
  | 'tool';        // tool call → its result node

export interface MemEdge { src: string; dst: string; kind: EdgeKind; weight: number }

// How readily activation flows across each edge kind. Tuned so association and
// derivation carry signal, supersession is followed hard (the newer node is what
// you want), and contradiction is a faint pull — enough to surface a tension,
// not enough to let a disputed memory crowd out a good one.
export const CONDUCTANCE: Record<EdgeKind, number> = {
  assoc: 0.6, causal: 0.7, derived: 0.8, refines: 0.7,
  supersedes: 0.9, contradicts: 0.3, session: 0.5, about: 0.6, tool: 0.5,
};

export interface SeedActivation { id: string; activation: number }

export interface SpreadOpts {
  hops?: number;         // max BFS depth (default 2)
  decay?: number;        // per-hop damping (default 0.5)
  minActivation?: number; // prune below this (default 0.04)
  conductance?: Partial<Record<EdgeKind, number>>;
  // Multiply the weight of edges that lie on a CYCLE (recurrent structure) by
  // this factor before spreading — so activation flows harder along recurrence
  // than along linear derivation. 1 (or absent) = off, no behavior change.
  cycleBoost?: number;
}

// ── the pure core: spreading activation (store-agnostic, testable) ──
// From a seeded activation map, flow charge across edges up to `hops` deep,
// damped by edge weight · kind conductance · decay^hop. Returns accumulated
// activation for every node REACHED (seeds excluded — the caller already has
// those). An edge is usable from whichever endpoint is currently active, so
// symmetric kinds (assoc/session) need only be stored once.
export function spreadActivation(
  seeds: SeedActivation[],
  edges: MemEdge[],
  opts: SpreadOpts = {},
): Map<string, number> {
  const hops = Math.max(1, opts.hops ?? 2);
  const decay = opts.decay ?? 0.5;
  const floor = opts.minActivation ?? 0.04;
  const cond = { ...CONDUCTANCE, ...(opts.conductance || {}) };

  // Adjacency: node → [{ other, kind, weight }]. Every edge is traversable both
  // ways; directionality is expressed through conductance/formation, not by
  // refusing to walk backward (a fact you can reach a decision from, you can
  // reach back from the decision too).
  const adj = new Map<string, { other: string; kind: EdgeKind; weight: number }[]>();
  const push = (a: string, b: string, kind: EdgeKind, weight: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ other: b, kind, weight });
  };
  for (const e of edges) {
    if (!e || !e.src || !e.dst || e.src === e.dst) continue;
    push(e.src, e.dst, e.kind, e.weight);
    push(e.dst, e.src, e.kind, e.weight);
  }

  const seedIds = new Set(seeds.map(s => s.id));
  const out = new Map<string, number>();
  let frontier = new Map<string, number>();
  for (const s of seeds) frontier.set(s.id, Math.max(0, s.activation));

  for (let hop = 0; hop < hops; hop++) {
    const next = new Map<string, number>();
    const hopDamp = Math.pow(decay, hop + 1);
    for (const [node, act] of frontier) {
      if (act <= 0) continue;
      for (const { other, kind, weight } of adj.get(node) || []) {
        const delta = act * Math.max(0, weight) * (cond[kind] ?? 0.5) * hopDamp;
        if (delta < floor) continue;
        if (!seedIds.has(other)) out.set(other, (out.get(other) || 0) + delta);
        next.set(other, Math.max(next.get(other) || 0, delta));
      }
    }
    if (!next.size) break;
    frontier = next;
  }
  return out;
}

// Symmetric edges are stored once under a canonical endpoint order so a pair is
// never double-counted. Directed kinds keep their src→dst orientation.
const SYMMETRIC: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['assoc', 'session', 'contradicts']);
export function canonicalEndpoints(src: string, dst: string, kind: EdgeKind): { src: string; dst: string } {
  if (SYMMETRIC.has(kind) && dst < src) return { src: dst, dst: src };
  return { src, dst };
}

// ── the substrate seam ───────────────────────────────────────
export interface GraphStore {
  ensureSchema(): Promise<void>;
  // Edges touching any of `ids` on either endpoint — one frontier's worth.
  neighbors(ids: string[]): Promise<MemEdge[]>;
  // Upsert edges, reinforcing weight on an existing pair (hot paths strengthen).
  link(edges: Array<Omit<MemEdge, 'weight'> & { weight?: number }>): Promise<void>;
}

const WEIGHT_CAP = 4.0;   // an edge can strengthen, but not without bound
const WEIGHT_BUMP = 0.5;  // per co-recall reinforcement

export class CloudGraphStore implements GraphStore {
  private ready = false;
  constructor(private db: D1Database) {}

  async ensureSchema(): Promise<void> {
    if (this.ready) return;
    await ensureAllSchemas(this.db);
    this.ready = true;
  }

  async neighbors(ids: string[]): Promise<MemEdge[]> {
    if (!ids.length) return [];
    await this.ensureSchema();
    const ph = ids.map(() => '?').join(',');
    const r = await this.db.prepare(
      `SELECT src, dst, kind, weight FROM elle_memory_edges
       WHERE src IN (${ph}) OR dst IN (${ph}) LIMIT 400`
    ).bind(...ids, ...ids).all();
    return (r.results as unknown as MemEdge[]) || [];
  }

  async link(edges: Array<Omit<MemEdge, 'weight'> & { weight?: number }>): Promise<void> {
    if (!edges.length) return;
    await this.ensureSchema();
    // One statement per edge, ON CONFLICT reinforcing weight. D1 has no cheap
    // multi-row upsert with per-row conflict, so we batch the prepares.
    const now = new Date().toISOString();
    const stmts = edges.map(e => {
      const { src, dst } = canonicalEndpoints(e.src, e.dst, e.kind);
      const id = crypto.randomUUID().replace(/-/g, '');
      return this.db.prepare(
        `INSERT INTO elle_memory_edges (id, src, dst, kind, weight, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(src, dst, kind) DO UPDATE SET
           weight = MIN(${WEIGHT_CAP}, elle_memory_edges.weight + ${WEIGHT_BUMP}),
           last_seen_at = excluded.last_seen_at`
      ).bind(id, src, dst, e.kind, e.weight ?? 1.0, now);
    });
    await this.db.batch(stmts);
  }

  // The hygiene sweep — run once per consolidation cycle (nightly). Every edge
  // idle for ≥1 cycle loses one φ⁻¹ of weight; anything under `floor` is pruned.
  // A re-seen edge (link resets last_seen_at) is fresh and untouched — so an
  // edge must keep being recalled to keep its weight. Also returns the current
  // captured-resonance flags so the sleep pass can surface runaway hot paths.
  async sweep(opts: { cycleMs?: number; floor?: number; nowMs?: number; cap?: number } = {}): Promise<{ decayed: number; pruned: number; flags: ResonanceFlag[] }> {
    await this.ensureSchema();
    const cycleMs = opts.cycleMs ?? 86_400_000;      // 1 day = 1 cycle
    const floor = opts.floor ?? 0.05;
    const now = opts.nowMs ?? Date.now();
    const cap = Math.min(2000, opts.cap ?? 1000);
    const r = await this.db.prepare(
      `SELECT src, dst, kind, weight, last_seen_at FROM elle_memory_edges LIMIT 5000`
    ).all().catch(() => ({ results: [] as any[] }));
    const rows = (r.results as Array<{ src: string; dst: string; kind: EdgeKind; weight: number; last_seen_at: string | null }>) || [];
    if (!rows.length) return { decayed: 0, pruned: 0, flags: [] };

    const flags = capturedResonanceScan(rows.map((x) => ({ src: x.src, dst: x.dst, kind: x.kind, weight: x.weight })));
    const staleCutoff = now - cycleMs;
    const updates: Array<{ src: string; dst: string; kind: EdgeKind; w: number }> = [];
    const prunes: Array<{ src: string; dst: string; kind: EdgeKind }> = [];
    for (const row of rows) {
      const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : now;
      if (Number.isFinite(seen) && seen >= staleCutoff) continue; // fresh this cycle
      const nw = decayedWeight(row.weight, 1, floor);             // one cycle of φ⁻¹ decay
      if (nw <= 0) prunes.push({ src: row.src, dst: row.dst, kind: row.kind });
      else updates.push({ src: row.src, dst: row.dst, kind: row.kind, w: nw });
      if (updates.length + prunes.length >= cap) break;
    }

    const stmts = [
      ...updates.map((u) => this.db.prepare(`UPDATE elle_memory_edges SET weight = ? WHERE src = ? AND dst = ? AND kind = ?`).bind(u.w, u.src, u.dst, u.kind)),
      ...prunes.map((p) => this.db.prepare(`DELETE FROM elle_memory_edges WHERE src = ? AND dst = ? AND kind = ?`).bind(p.src, p.dst, p.kind)),
    ];
    if (stmts.length) await this.db.batch(stmts).catch(() => {});
    return { decayed: updates.length, pruned: prunes.length, flags: flags.slice(0, 10) };
  }
}

// ── edge hygiene: φ⁻ⁿ retention decay + captured-resonance diagnostic ──
// The association mechanism above (recordAssociations → weight bump on every
// co-recall, capped but never decayed) is a MONOTONE strengthener: hot edges
// get hotter by being recalled, the recall operation is recruited into its own
// reinforcement, and strong edges crowd out alternatives. That is exactly the
// three-feature "captured resonance" pathology of the corpus (a stable attractor
// against substrate maintenance, the integrative faculty recruited into it,
// alternatives suppressed). The corrective is the framework's own φ⁻ⁿ retention
// law: an edge must keep earning its weight or fade.

export const RETENTION_BASE = (1 + Math.sqrt(5)) / 2; // φ

// Total retained fraction after `ageCycles` idle consolidation cycles: φ⁻ⁿ.
export function retention(ageCycles: number): number {
  return Math.pow(RETENTION_BASE, -Math.max(0, ageCycles));
}

// Apply `cycles` of decay to a weight; below `floor` it is gone (prune).
export function decayedWeight(weight: number, cycles: number, floor = 0): number {
  const w = Math.max(0, weight) * retention(cycles);
  return w < floor ? 0 : round(w, 4);
}

export interface ResonanceFlag { node: string; dominance: number; degree: number; top: string; total_weight: number }

// A captured-resonance candidate is a well-connected node whose incident
// edge-weight mass concentrates on ONE neighbor past `threshold` — the recall
// loop has run away into a single hot path. Pure, O(edges).
export function capturedResonanceScan(
  edges: MemEdge[],
  opts: { threshold?: number; minDegree?: number } = {},
): ResonanceFlag[] {
  const threshold = opts.threshold ?? 0.6;
  const minDegree = opts.minDegree ?? 3;
  const inc = new Map<string, { total: number; max: number; top: string; deg: number }>();
  const add = (node: string, other: string, w: number) => {
    const e = inc.get(node) || { total: 0, max: 0, top: '', deg: 0 };
    e.total += w; e.deg += 1;
    if (w > e.max) { e.max = w; e.top = other; }
    inc.set(node, e);
  };
  for (const e of edges) {
    if (!e || !e.src || !e.dst || e.src === e.dst) continue;
    const w = Math.max(0, e.weight);
    add(e.src, e.dst, w); add(e.dst, e.src, w);
  }
  const flags: ResonanceFlag[] = [];
  for (const [node, s] of inc) {
    if (s.deg < minDegree || s.total <= 0) continue;
    const dominance = s.max / s.total;
    if (dominance >= threshold) flags.push({ node, dominance: round(dominance, 4), degree: s.deg, top: s.top, total_weight: round(s.total, 4) });
  }
  return flags.sort((a, b) => b.dominance - a.dominance);
}

function round(x: number, p: number): number { const f = 10 ** p; return Math.round(x * f) / f; }

// ── traversal driver: seed → spread over fetched frontiers ───
// Bounded BFS: fetch the seed frontier's edges, spread one hop, fetch the newly
// activated nodes' edges, spread again. Two indexed queries for a 2-hop reach.
export async function graphExpand(
  store: GraphStore,
  seeds: SeedActivation[],
  opts: SpreadOpts = {},
): Promise<Map<string, number>> {
  const seedIds = seeds.map(s => s.id);
  if (!seedIds.length) return new Map();
  const collected = await collectFrontierEdges(store, seedIds, Math.max(1, opts.hops ?? 2));
  const edges = opts.cycleBoost && opts.cycleBoost !== 1 ? applyCycleBoost(collected, opts.cycleBoost) : collected;
  return spreadActivation(seeds, edges, opts);
}

// The A/B variant: ONE traversal (one set of DB reads), then spread twice —
// without and with the cycle boost. Lets the live recall path serve one arm and
// log both for the experiment, at the cost of a second pure spread pass (cheap).
export async function graphExpandAB(
  store: GraphStore,
  seeds: SeedActivation[],
  opts: SpreadOpts = {},
  boost = 1.3,
): Promise<{ base: Map<string, number>; boosted: Map<string, number> }> {
  const seedIds = seeds.map(s => s.id);
  if (!seedIds.length) return { base: new Map(), boosted: new Map() };
  const collected = await collectFrontierEdges(store, seedIds, Math.max(1, opts.hops ?? 2));
  const base = spreadActivation(seeds, collected, opts);
  const boosted = boost === 1 ? base : spreadActivation(seeds, applyCycleBoost(collected, boost), opts);
  return { base, boosted };
}

// Bounded BFS: fetch the seed frontier's edges, note the newly reached nodes,
// fetch their edges, repeat up to `hops`. Shared by graphExpand + graphExpandAB.
async function collectFrontierEdges(store: GraphStore, seedIds: string[], hops: number): Promise<MemEdge[]> {
  const collected: MemEdge[] = [];
  let frontier = seedIds;
  const seen = new Set(seedIds);
  for (let h = 0; h < hops; h++) {
    const edges = await store.neighbors(frontier);
    if (!edges.length) break;
    collected.push(...edges);
    const nextIds: string[] = [];
    for (const e of edges) {
      for (const end of [e.src, e.dst]) {
        if (!seen.has(end)) { seen.add(end); nextIds.push(end); }
      }
    }
    if (!nextIds.length) break;
    frontier = nextIds.slice(0, 60); // cap frontier fan-out per hop
  }
  return collected;
}

// Boost edges on a cycle (recurrence) over bridges (linear derivation). The
// cycle test runs over the traversed subgraph only — cheap, and it is the local
// recurrence that matters for this seed's neighborhood.
function applyCycleBoost(edges: MemEdge[], boost: number): MemEdge[] {
  const onCycle = nonBridgeEdges(edges);
  return edges.map((e) => (onCycle.has(edgeKey(e.src, e.dst)) ? { ...e, weight: Math.max(0, e.weight) * boost } : e));
}

// ── does "recognition" actually mean "closes a loop between branches"? ──────
// The hierarchy/derivation kinds are how the graph grows OUTWARD from what a
// memory came from (a widening tree, root to leaves); the co-recall/
// co-occurrence/tension kinds are added AFTER the fact, precisely when the
// system notices two things belong together regardless of which branch they
// grew on (recordAssociations above is the clearest case: an `assoc` edge is
// drawn between memories that were merely relevant to the same recall, with
// no requirement that they share a tree parent). If that story is right, a
// recognition-kind edge should land on a LOBE (a non-bridge edge — see
// structure.ts's nonBridgeEdges/lobeStructure) far more often than a
// derivation-kind edge does, which mostly just extends the tree. This checks
// the correlation directly instead of assuming it holds.
const DERIVATION_KINDS: ReadonlySet<EdgeKind> = new Set(['causal', 'derived', 'refines', 'supersedes', 'about', 'tool']);
const RECOGNITION_KINDS: ReadonlySet<EdgeKind> = new Set(['assoc', 'session', 'contradicts']);

export interface LobeKindCorrelation {
  recognition_edges: number;
  recognition_on_lobe_fraction: number;   // of assoc/session/contradicts edges, how many sit on a lobe
  derivation_edges: number;
  derivation_on_lobe_fraction: number;    // of causal/derived/refines/supersedes/about/tool edges, how many do
  confirms_hypothesis: boolean;           // recognition-kind edges land on a lobe strictly more often
}

export function lobeKindCorrelation(edges: MemEdge[]): LobeKindCorrelation {
  const onCycle = nonBridgeEdges(edges);
  let recognitionEdges = 0, recognitionOnLobe = 0, derivationEdges = 0, derivationOnLobe = 0;
  for (const e of edges) {
    const onLobe = onCycle.has(edgeKey(e.src, e.dst));
    if (RECOGNITION_KINDS.has(e.kind)) { recognitionEdges++; if (onLobe) recognitionOnLobe++; }
    else if (DERIVATION_KINDS.has(e.kind)) { derivationEdges++; if (onLobe) derivationOnLobe++; }
  }
  const rFrac = recognitionEdges ? recognitionOnLobe / recognitionEdges : 0;
  const dFrac = derivationEdges ? derivationOnLobe / derivationEdges : 0;
  const round4 = (x: number) => Math.round(x * 10000) / 10000;
  return {
    recognition_edges: recognitionEdges, recognition_on_lobe_fraction: round4(rFrac),
    derivation_edges: derivationEdges, derivation_on_lobe_fraction: round4(dFrac),
    confirms_hypothesis: recognitionEdges > 0 && derivationEdges > 0 && rFrac > dFrac,
  };
}

// ── association recording (self-bootstrapping edge formation) ─
// The set a recall returned is, by definition, a set that was relevant together.
// Record that as `assoc` edges among the top members so the graph learns the
// association. Bounded: only the strongest few, so this stays O(1) per recall,
// not O(n²) over a big set.
export async function recordAssociations(store: GraphStore, ids: string[], cap = 5): Promise<void> {
  const top = [...new Set(ids)].slice(0, cap);
  if (top.length < 2) return;
  const edges: Array<Omit<MemEdge, 'weight'>> = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      edges.push({ src: top[i], dst: top[j], kind: 'assoc' });
    }
  }
  await store.link(edges);
}
