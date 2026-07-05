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
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS elle_memory_edges (
      id TEXT PRIMARY KEY,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      kind TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      run_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT,
      UNIQUE(src, dst, kind)
    )`).run();
    await this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_src ON elle_memory_edges(src, kind)`).run().catch(() => {});
    await this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_edges_dst ON elle_memory_edges(dst, kind)`).run().catch(() => {});
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
}

// ── traversal driver: seed → spread over fetched frontiers ───
// Bounded BFS: fetch the seed frontier's edges, spread one hop, fetch the newly
// activated nodes' edges, spread again. Two indexed queries for a 2-hop reach.
export async function graphExpand(
  store: GraphStore,
  seeds: SeedActivation[],
  opts: SpreadOpts = {},
): Promise<Map<string, number>> {
  const hops = Math.max(1, opts.hops ?? 2);
  const seedIds = seeds.map(s => s.id);
  if (!seedIds.length) return new Map();

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
  return spreadActivation(seeds, collected, opts);
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
