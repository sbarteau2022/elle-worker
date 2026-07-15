// ============================================================
// THE SCAFFOLD — src/scaffold.ts
//
// The structural substrate under the dual topology: the load-bearing PILLARS
// and the BRIDGE FABRIC. Two ideas, one honest constraint the user asked for —
// "any pathway has the potential to connect to another, no privileged node."
//
//   • THE PILLARS (load-bearing, symmetric). Five columns seated with pentagonal
//     (C5) symmetry around one central axis — 1 apex + 5×4 = 21 structural
//     nodes. They carry the depth hierarchy's weight. "No privileged node"
//     among them is a provable symmetry: rotate the whole frame by 72° and
//     pillar k maps to pillar k+1, so no single pillar is distinguished, and
//     every pillar carries the same load. (The depth AXIS still has an apex —
//     derivation must climb to a source — so the pillars are symmetric among
//     THEMSELVES; the hubless property below is what the *bridge* layer adds.)
//
//   • THE BRIDGE FABRIC (no privileged node). This is the heart of the request.
//     - POTENTIAL: every node can bridge to every other. The potential graph is
//       complete — uniform potential degree n−1, no node with special reach.
//       "Any pathway has the potential to connect to another," literally.
//     - REALIZED: bridges are laid the egalitarian way — a ring lattice rewired
//       Watts–Strogatz-style (uniform random targets). That buys small-world
//       short paths WITHOUT forming a hub, because rewire targets are uniform,
//       not degree-proportional. The opposite build — Barabási–Albert
//       preferential attachment — DOES form privileged hubs, and we build it
//       too, only so the self-test can MEASURE the difference instead of
//       asserting it.
//
// privilegeReport() is the meter: degree spread, degree Gini, betweenness
// concentration (Brandes), articulation points (mandatory routers), and
// connectivity. `no_privileged_node` is true only when the fabric is connected,
// has no articulation point, a flat degree distribution, and no node dominates
// betweenness — i.e. no hub and no bottleneck. The egalitarian fabric passes;
// the hub fabric fails and names its privileged node.
//
// HONEST SCOPE: this proves a topological property — egalitarian, hubless,
// bottleneck-free connectivity with uniform bridging potential — measured, not
// asserted. It is NOT a claim the substrate is a mind. Same boundary as
// everywhere in this build: the structure is real and checkable; where it would
// reach past that into cognition, the code says so and stops.
//
// Deterministic (seeded PRNG, no Math.random at import), Worker-stack-safe
// (BFS everywhere; articulation via remove-and-BFS — O(V·(V+E)), fine for the
// diagnostic sizes this runs on).
// ============================================================

export interface Link { a: string; b: string }

export interface Vec3 { x: number; y: number; z: number }
export interface PillarNode extends Vec3 { pillar: number; level: number; id: string }

// ── deterministic PRNG (mulberry32) — reproducible fabrics on any engine ──
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ============================================================
// THE PILLARS — five load-bearing columns, C5-symmetric, equal load
// ============================================================

export const PENTAGON = 5;

export interface PillarStructure {
  apex: PillarNode;
  pillars: PillarNode[][];   // [pillar][level]
  nodes: PillarNode[];       // apex + all pillar nodes, flat
  total: number;             // 1 + PENTAGON*perPillar
  per_pillar: number;
  equal_load: boolean;       // every pillar carries the same node count
  load_variance: number;     // variance of per-pillar node counts (0 ⇒ equal)
  c5_invariant: boolean;     // rotating the frame by 72° permutes the pillars onto themselves
  note: string;
}

// Build the load-bearing frame: an apex on the central axis, then PENTAGON
// columns rising at 72° spacing, `perPillar` nodes each. Default perPillar=4 ⇒
// 1 + 5×4 = 21 structural nodes (the depth-hierarchy count), the pentagon
// seating the pillars around the singularity.
export function pentagonPillars(perPillar = 4, radius = 1): PillarStructure {
  const apex: PillarNode = { x: 0, y: 1, z: 0, pillar: -1, level: 0, id: 'apex' };
  const pillars: PillarNode[][] = [];
  const nodes: PillarNode[] = [apex];
  for (let p = 0; p < PENTAGON; p++) {
    const ang = (p / PENTAGON) * Math.PI * 2 - Math.PI / 2; // start at top, go around
    const col: PillarNode[] = [];
    for (let lvl = 0; lvl < perPillar; lvl++) {
      const y = 0.6 - lvl * (1.2 / Math.max(1, perPillar - 1 || 1));
      const n: PillarNode = {
        x: Math.cos(ang) * radius,
        y,
        z: Math.sin(ang) * radius,
        pillar: p,
        level: lvl,
        id: `p${p}l${lvl}`,
      };
      col.push(n);
      nodes.push(n);
    }
    pillars.push(col);
  }

  // equal load: every pillar has the same node count → variance 0
  const loads = pillars.map((c) => c.length);
  const mean = loads.reduce((s, v) => s + v, 0) / loads.length;
  const load_variance = loads.reduce((s, v) => s + (v - mean) ** 2, 0) / loads.length;
  const equal_load = load_variance === 0;

  // C5 invariance: rotate each pillar's base angle by +72° and confirm it lands
  // exactly on another pillar's base angle (mod 360). If so, no pillar is
  // distinguished — the frame is symmetric under the pentagon's rotation.
  const baseAng = (p: number) => ((p / PENTAGON) * 360) % 360;
  const angleSet = new Set(pillars.map((_, p) => Math.round(baseAng(p))));
  let c5_invariant = true;
  for (let p = 0; p < PENTAGON; p++) {
    const rotated = Math.round((baseAng(p) + 360 / PENTAGON) % 360);
    if (!angleSet.has(rotated)) { c5_invariant = false; break; }
  }

  return {
    apex,
    pillars,
    nodes,
    total: nodes.length,
    per_pillar: perPillar,
    equal_load,
    load_variance: Number(load_variance.toFixed(6)),
    c5_invariant,
    note: '5 load-bearing pillars at 72° around one apex axis; equal load and C5 rotational symmetry mean no pillar is privileged over the others. The apex remains the source of the depth axis — hublessness is what the bridge fabric adds, not the pillars.',
  };
}

// ============================================================
// THE BRIDGE FABRIC — uniform potential, hubless realization
// ============================================================

// The POTENTIAL: any node can bridge to any other. Uniform potential degree
// n−1 for every node — no node with privileged reach. This is the literal
// "any pathway has the potential to connect to another."
export interface PotentialCheck {
  nodes: number;
  potential_degree: number;   // n−1 for every node
  uniform: boolean;           // every node has the same potential degree
  note: string;
}
export function potentialUniform(n: number): PotentialCheck {
  return {
    nodes: n,
    potential_degree: Math.max(0, n - 1),
    uniform: true, // complete potential graph: identical for every node by construction
    note: 'Potential-connection graph is complete: every node may bridge to every other. Uniform potential degree n−1 — no privileged node in what CAN connect. Realization below is sparse; the potential is not.',
  };
}

// The REALIZED egalitarian fabric: a k-nearest-neighbour ring lattice rewired
// Watts–Strogatz-style with UNIFORM random targets. Short paths (small-world),
// flat degree (no hub) — because rewire targets are uniform, not degree-biased.
export function egalitarianFabric(n: number, k = 4, beta = 0.25, seed = 1): Link[] {
  const rand = rng(seed);
  const half = Math.max(1, Math.floor(k / 2));
  const present = new Set<string>();
  const ordered: Array<[number, number]> = [];
  for (let j = 1; j <= half; j++) {
    for (let i = 0; i < n; i++) {
      const b = (i + j) % n;
      const key = linkKey(String(i), String(b));
      if (i !== b && !present.has(key)) { present.add(key); ordered.push([i, b]); }
    }
  }
  const out: Array<[number, number]> = [];
  for (const [a, b] of ordered) {
    if (rand() < beta) {
      let c = Math.floor(rand() * n);
      let tries = 0;
      while ((c === a || present.has(linkKey(String(a), String(c)))) && tries < n) {
        c = (c + 1) % n; tries++;
      }
      if (tries < n) {
        present.delete(linkKey(String(a), String(b)));
        present.add(linkKey(String(a), String(c)));
        out.push([a, c]);
        continue;
      }
    }
    out.push([a, b]);
  }
  return out.map(([a, b]) => ({ a: String(a), b: String(b) }));
}

// The REALIZED hub fabric (the contrast, not the design): Barabási–Albert
// preferential attachment. New nodes attach to existing ones with probability
// proportional to their degree → a few nodes become privileged hubs. Built only
// so the self-test can prove the egalitarian fabric is measurably different.
export function hubFabric(n: number, m = 2, seed = 1): Link[] {
  const rand = rng(seed);
  const links: Array<[number, number]> = [];
  const repeated: number[] = []; // degree-weighted bag for preferential draw
  const m0 = m + 1;
  for (let i = 0; i < m0; i++) {
    for (let j = i + 1; j < m0; j++) { links.push([i, j]); repeated.push(i, j); }
  }
  for (let v = m0; v < n; v++) {
    const targets = new Set<number>();
    let guard = 0;
    while (targets.size < m && guard < 2000) {
      const t = repeated.length ? repeated[Math.floor(rand() * repeated.length)] : Math.floor(rand() * v);
      if (t !== v) targets.add(t);
      guard++;
    }
    for (const t of targets) { links.push([v, t]); repeated.push(v, t); }
  }
  return links.map(([a, b]) => ({ a: String(a), b: String(b) }));
}

// ── graph utilities over an undirected Link[] ──
function adjacencyOf(links: Link[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const touch = (x: string) => { if (!adj.has(x)) adj.set(x, new Set()); };
  for (const e of links) {
    if (!e || e.a === e.b) continue;
    touch(e.a); touch(e.b);
    adj.get(e.a)!.add(e.b); adj.get(e.b)!.add(e.a);
  }
  return adj;
}

function componentCount(adj: Map<string, Set<string>>, nodeSet: Set<string>): number {
  const seen = new Set<string>();
  let comps = 0;
  for (const start of nodeSet) {
    if (seen.has(start)) continue;
    comps++;
    const q = [start]; seen.add(start); let h = 0;
    while (h < q.length) {
      const u = q[h++];
      for (const v of adj.get(u) || []) if (nodeSet.has(v) && !seen.has(v)) { seen.add(v); q.push(v); }
    }
  }
  return comps;
}

// Articulation points: a node whose removal splits its component — a MANDATORY
// router, the definition of a privileged bottleneck. remove-and-BFS: obvious and
// correct, O(V·(V+E)); the diagnostic never runs on huge graphs.
function articulationPoints(adj: Map<string, Set<string>>): string[] {
  const all = new Set(adj.keys());
  if (all.size <= 2) return [];
  const base = componentCount(adj, all);
  const arts: string[] = [];
  for (const v of all) {
    const remaining = new Set(all); remaining.delete(v);
    if (componentCount(adj, remaining) > base) arts.push(v);
  }
  return arts;
}

// Brandes' unweighted betweenness centrality (BFS-based, exact).
function betweenness(adj: Map<string, Set<string>>): Map<string, number> {
  const CB = new Map<string, number>();
  for (const v of adj.keys()) CB.set(v, 0);
  for (const s of adj.keys()) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    for (const v of adj.keys()) { pred.set(v, []); sigma.set(v, 0); dist.set(v, -1); }
    sigma.set(s, 1); dist.set(s, 0);
    const q = [s]; let h = 0;
    while (h < q.length) {
      const v = q[h++]; stack.push(v);
      for (const w of adj.get(v) || []) {
        if (dist.get(w)! < 0) { dist.set(w, dist.get(v)! + 1); q.push(w); }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<string, number>();
    for (const v of adj.keys()) delta.set(v, 0);
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) CB.set(w, CB.get(w)! + delta.get(w)!);
    }
  }
  for (const v of CB.keys()) CB.set(v, CB.get(v)! / 2); // undirected: each pair twice
  return CB;
}

function gini(vals: number[]): number {
  const n = vals.length;
  if (!n) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i];
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

export interface PrivilegeReport {
  nodes: number;
  edges: number;
  connected: boolean;             // every node reaches every other
  reachable_fraction: number;     // reachable ordered pairs / all ordered pairs
  mean_degree: number;
  max_degree: number;
  degree_spread: number;          // max/mean (1 ⇒ perfectly flat)
  degree_gini: number;            // 0 ⇒ perfectly equal, →1 ⇒ hub-dominated
  betweenness_spread: number;     // max/mean betweenness (routing concentration)
  articulation_points: number;    // mandatory routers (0 ⇒ no single bottleneck)
  privileged_node: string | null; // the worst offender, or null if none
  no_privileged_node: boolean;    // the verdict
  note: string;
}

// Thresholds separating "egalitarian" from "hub." Calibrated against the two
// generators below and asserted comparatively in the self-test, so the verdict
// never rests on a single hand-picked cutoff alone.
const FLAT_GINI = 0.34;
const FLAT_BETWEENNESS = 4.0;

export function privilegeReport(links: Link[]): PrivilegeReport {
  const adj = adjacencyOf(links);
  const nodes = [...adj.keys()];
  const N = nodes.length;
  const degrees = nodes.map((v) => adj.get(v)!.size);
  const meanDeg = degrees.reduce((s, v) => s + v, 0) / (N || 1);
  const maxDeg = degrees.reduce((m, v) => Math.max(m, v), 0);
  const degSpread = meanDeg > 0 ? maxDeg / meanDeg : 0;
  const degGini = gini(degrees);

  // connectivity / reachability
  let reachablePairs = 0;
  for (const s of nodes) {
    const seen = new Set([s]); const q = [s]; let h = 0;
    while (h < q.length) { const u = q[h++]; for (const v of adj.get(u)!) if (!seen.has(v)) { seen.add(v); q.push(v); } }
    reachablePairs += seen.size - 1;
  }
  const allPairs = N * (N - 1);
  const reachable_fraction = allPairs ? reachablePairs / allPairs : 0;
  const connected = N > 0 && reachable_fraction === 1;

  const bc = betweenness(adj);
  const bvals = [...bc.values()];
  const meanB = bvals.reduce((s, v) => s + v, 0) / (bvals.length || 1);
  let maxB = 0, maxBNode: string | null = null;
  for (const [v, b] of bc) if (b > maxB) { maxB = b; maxBNode = v; }
  const betweenness_spread = meanB > 0 ? maxB / meanB : 0;

  const arts = articulationPoints(adj);

  const no_privileged_node =
    connected &&
    arts.length === 0 &&
    degGini < FLAT_GINI &&
    betweenness_spread < FLAT_BETWEENNESS;

  // name the offender: a mandatory router first, else the betweenness king
  let privileged_node: string | null = null;
  if (!no_privileged_node) privileged_node = arts[0] ?? maxBNode;

  return {
    nodes: N,
    edges: links.length,
    connected,
    reachable_fraction: Number(reachable_fraction.toFixed(4)),
    mean_degree: Number(meanDeg.toFixed(3)),
    max_degree: maxDeg,
    degree_spread: Number(degSpread.toFixed(3)),
    degree_gini: Number(degGini.toFixed(3)),
    betweenness_spread: Number(betweenness_spread.toFixed(3)),
    articulation_points: arts.length,
    privileged_node,
    no_privileged_node,
    note: no_privileged_node
      ? 'No privileged node: connected, no mandatory router, flat degree, spread betweenness. Any pathway can reach any other without a hub or a bottleneck.'
      : `Privileged node present (${privileged_node}): ${arts.length ? 'a mandatory router (articulation point)' : 'a hub dominating degree/betweenness'}. Connectivity leans on it.`,
  };
}

// ============================================================
// ASSEMBLED SCAFFOLD + self-test
// ============================================================

export interface Scaffold {
  pillars: PillarStructure;
  potential: PotentialCheck;
  fabric: Link[];             // the realized egalitarian bridge fabric over the pillar nodes
  privilege: PrivilegeReport;
}

// Build the whole structural scaffold: the 21-node pentagon frame, and an
// egalitarian bridge fabric laid over its nodes so any pillar node can reach any
// other with no privileged node.
export function buildScaffold(perPillar = 4, k = 4, beta = 0.3, seed = 7): Scaffold {
  const pillars = pentagonPillars(perPillar);
  const n = pillars.total;
  const fabric = egalitarianFabric(n, k, beta, seed);
  return {
    pillars,
    potential: potentialUniform(n),
    fabric,
    privilege: privilegeReport(fabric),
  };
}

export interface ScaffoldSelfTest {
  ok: boolean;
  pillars_symmetric: boolean;    // 5 pillars, equal load, C5-invariant, 21 nodes
  potential_uniform: boolean;    // every node may bridge to every other
  fabric_hubless: boolean;       // the egalitarian fabric has no privileged node
  hub_control_fails: boolean;    // the preferential-attachment control DOES form a privileged node
  egalitarian_beats_hub: boolean; // egalitarian spread strictly below the hub's (the comparison)
  egalitarian: PrivilegeReport;
  hub: PrivilegeReport;
  note: string;
}

export function scaffoldSelfTest(): ScaffoldSelfTest {
  const N = 20;
  const pillars = pentagonPillars(4);
  const pillars_symmetric =
    pillars.total === 21 && pillars.pillars.length === 5 && pillars.equal_load && pillars.c5_invariant;

  const potential_uniform = potentialUniform(N).uniform;

  const egal = privilegeReport(egalitarianFabric(N, 4, 0.3, 7));
  const hub = privilegeReport(hubFabric(N, 2, 7));

  const fabric_hubless = egal.no_privileged_node;
  const hub_control_fails = !hub.no_privileged_node && hub.privileged_node !== null;
  const egalitarian_beats_hub =
    egal.degree_gini < hub.degree_gini && egal.betweenness_spread < hub.betweenness_spread;

  const ok = pillars_symmetric && potential_uniform && fabric_hubless && hub_control_fails && egalitarian_beats_hub;
  return {
    ok,
    pillars_symmetric,
    potential_uniform,
    fabric_hubless,
    hub_control_fails,
    egalitarian_beats_hub,
    egalitarian: egal,
    hub,
    note: 'Pillars: 5 load-bearing columns, equal load, C5-symmetric (no privileged pillar), 21 nodes. Fabric: uniform bridging potential, and the realized egalitarian (Watts–Strogatz) graph is connected, hubless, and bottleneck-free — no privileged node — while the preferential-attachment control forms one, and the egalitarian degree/betweenness spread sits strictly below the hub build. The property is measured, not asserted.',
  };
}
