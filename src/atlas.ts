// ============================================================
// ATLAS — the read/ingest boundary between the on-device cartographer
// (github.com/sbarteau2022/Dynanic-Hyperbolic-Neural-Graph) and Elle
// (src/atlas.ts)
//
// THE INVARIANT: the memory graph is computed OUTSIDE Elle, by pure static
// functions, on the device. This module is where that boundary is
// implemented server-side, as an asymmetry rather than a policy:
//
//   • ingestAtlas() is reachable ONLY from the device's own publish script
//     (service-key gated at the HTTP layer — see index.ts's
//     /api/atlas/ingest) — never from the router, never from any tool the
//     LLM can call.
//   • atlasRoute() is the LLM's ENTIRE surface onto the graph: read-only,
//     no snapshot/edge/point-writing parameters exist, and nothing it
//     returns can be fed back in to change what is stored.
//
// Elle can look at the shape of her own memory graph. She cannot write,
// edit, or embed anything into it. The "embed raw numbers" step in
// ingestAtlas is Elle building semantic embeddings OF the device's numbers
// for her OWN retrieval tier (elle-corpus-vectors) — a read/consume
// operation over data that already exists on the device side, not a write
// to the graph itself. The raw coordinates also travel verbatim as
// Vectorize metadata (not lossy-compressed into the embedding), and the
// full snapshot lives in R2 for exact reconstruction.
// ============================================================

import { hyperNeighbors, type HyperAtlas } from './hyper';
import { torusNeighbors, type TorusAtlas } from './torus';

export interface AtlasIngestEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
}

// Bounds the embedding cost of one ingest. A snapshot larger than this still
// stores in full (R2 + D1); only the Vectorize embedding pass truncates, and
// the response says so (`truncated: true`) rather than truncating silently.
const MAX_EMBED_NODES = 300;

let schemaReady = false;
async function ensureSchema(env: AtlasIngestEnv): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_atlas_snapshots (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ingested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    cycle_rank INTEGER,
    hyperbolic_mix REAL,
    toroidal_mix REAL,
    drift_mean REAL,
    r2_key TEXT NOT NULL,
    embedded_nodes INTEGER DEFAULT 0
  )`).run();
  schemaReady = true;
}

// Same model + batching as the corpus embedder (index.ts's embedBatch); kept
// local rather than imported to avoid a value-level circular import with
// index.ts (which imports ingestAtlas/getLatestAtlas from this file).
async function embedTexts(env: AtlasIngestEnv, texts: string[]): Promise<number[][]> {
  const BATCH = 25;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, 2000));
    const result = (await env.AI.run('@cf/baai/bge-large-en-v1.5', { text: batch })) as { data: number[][] };
    if (!result?.data) throw new Error('atlas embed: batch embedding returned no data');
    out.push(...result.data);
  }
  return out;
}

// A canonical text description of one node's raw numeric atlas position —
// the basis the semantic embedder runs over. The raw numbers travel exactly
// as Vectorize metadata; this text only makes them semantically findable
// (so e.g. recall_memory-style queries can surface "the densely cyclic part
// of the graph" without the caller knowing a node id).
function nodeText(id: string, ball?: number[], phase?: number[], mix?: { hyperbolic: number; toroidal: number }): string {
  const parts = [`atlas node ${id}`];
  if (ball?.length) parts.push(`ball position [${ball.map((v) => v.toFixed(4)).join(', ')}]`);
  if (phase?.length) parts.push(`phase [${phase.map((v) => v.toFixed(4)).join(', ')}]`);
  if (mix) parts.push(`curvature mix hyperbolic=${mix.hyperbolic.toFixed(3)} toroidal=${mix.toroidal.toFixed(3)}`);
  return parts.join(' · ');
}

export interface AtlasSnapshotShape {
  hash: string; version: string; created_at: number;
  nodes: string[]; edges: Array<{ src: string; dst: string; kind: string; weight: number }>;
  hyper: HyperAtlas & { drift?: { mean: number; max: number; moved: number } };
  torus: TorusAtlas;
  structure: { invariants: { cycle_rank: number; [k: string]: unknown }; signature: unknown; cycle_edges: string[] };
  product: { mix: { hyperbolic: number; toroidal: number }; disagreements: unknown };
}

// Minimal structural validation — trust the device's own 79-test suite for
// the geometry itself; this only checks the shape ingest actually reads.
function validSnapshot(s: unknown): s is AtlasSnapshotShape {
  const o = s as Record<string, unknown> | null;
  if (!o || typeof o.hash !== 'string' || typeof o.version !== 'string' || !Array.isArray(o.nodes) || !Array.isArray(o.edges)) return false;
  const hyper = o.hyper as Record<string, unknown> | undefined;
  const torus = o.torus as Record<string, unknown> | undefined;
  const structure = o.structure as Record<string, unknown> | undefined;
  const product = o.product as Record<string, unknown> | undefined;
  return !!hyper?.points && typeof hyper.points === 'object'
    && !!torus?.points && typeof torus.points === 'object'
    && !!structure?.invariants && !!product?.mix;
}

export interface AtlasIngestResult {
  hash: string; version: string; node_count: number; edge_count: number;
  embedded_nodes: number; truncated: boolean;
}

export async function ingestAtlas(env: AtlasIngestEnv, body: unknown): Promise<AtlasIngestResult> {
  const snapshot = (body as { snapshot?: unknown } | null)?.snapshot;
  if (!validSnapshot(snapshot)) {
    throw new Error('atlas ingest: malformed snapshot — expected {snapshot:{hash,version,created_at,nodes,edges,hyper.points,torus.points,structure.invariants,product.mix}}');
  }
  await ensureSchema(env);

  const r2Key = `atlas/${snapshot.hash}.json`;
  await env.DOCUMENTS.put(r2Key, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });

  const nodeIds = snapshot.nodes.slice(0, MAX_EMBED_NODES);
  const truncated = snapshot.nodes.length > nodeIds.length;
  let embedded = 0;
  if (nodeIds.length) {
    const texts = nodeIds.map((id) => nodeText(id, snapshot.hyper.points[id], snapshot.torus.points[id], snapshot.product.mix));
    try {
      const vectors = await embedTexts(env, texts);
      const upserts = nodeIds.map((id, i) => ({
        id: `atlas-${snapshot.hash}-${id}`,
        values: vectors[i],
        metadata: {
          type: 'atlas_point', node_id: id, hash: snapshot.hash, version: snapshot.version,
          ball: JSON.stringify(snapshot.hyper.points[id] ?? []),
          phase: JSON.stringify(snapshot.torus.points[id] ?? []),
        },
      }));
      await env.VECTORIZE.upsert(upserts);
      embedded = upserts.length;
    } catch { /* R2 + D1 rows are the durable record; a failed embed pass can be re-ingested */ }
  }

  await env.DB.prepare(
    `INSERT INTO elle_atlas_snapshots (id, version, created_at, node_count, edge_count, cycle_rank, hyperbolic_mix, toroidal_mix, drift_mean, r2_key, embedded_nodes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET embedded_nodes = excluded.embedded_nodes`
  ).bind(
    snapshot.hash, snapshot.version, snapshot.created_at,
    snapshot.nodes.length, snapshot.edges.length,
    snapshot.structure.invariants.cycle_rank ?? null,
    snapshot.product.mix.hyperbolic, snapshot.product.mix.toroidal,
    snapshot.hyper.drift?.mean ?? null,
    r2Key, embedded,
  ).run();

  return { hash: snapshot.hash, version: snapshot.version, node_count: snapshot.nodes.length, edge_count: snapshot.edges.length, embedded_nodes: embedded, truncated };
}

export async function getLatestAtlas(env: AtlasIngestEnv): Promise<AtlasSnapshotShape | null> {
  await ensureSchema(env);
  const row = (await env.DB.prepare(
    `SELECT r2_key FROM elle_atlas_snapshots ORDER BY created_at DESC LIMIT 1`
  ).first()) as { r2_key: string } | null;
  if (!row) return null;
  const obj = await env.DOCUMENTS.get(row.r2_key);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()) as AtlasSnapshotShape; } catch { return null; }
}

// ── replay reads (still strictly views) ────────────────────────────────────

export interface AtlasHistoryEntry {
  hash: string; version: string; created_at: number;
  node_count: number; edge_count: number; cycle_rank: number | null; drift_mean: number | null;
}

// The snapshot timeline, oldest first — the site's replay scrubber runs over
// this. Index rows only; each frame's full geometry loads via getAtlasByHash.
export async function listAtlasHistory(env: AtlasIngestEnv, limit = 100): Promise<AtlasHistoryEntry[]> {
  await ensureSchema(env);
  const n = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
  const r = await env.DB.prepare(
    `SELECT id AS hash, version, created_at, node_count, edge_count, cycle_rank, drift_mean
     FROM elle_atlas_snapshots ORDER BY created_at ASC LIMIT ?`
  ).bind(n).all();
  return (r.results as unknown as AtlasHistoryEntry[]) || [];
}

// One historical frame by content hash. The hash is the publish CLI's
// 16-hex-char content address — anything else is rejected before it can
// shape an R2 key.
const HASH_RE = /^[0-9a-f]{16}$/;

export async function getAtlasByHash(env: AtlasIngestEnv, hash: string): Promise<AtlasSnapshotShape | null> {
  if (!HASH_RE.test(hash)) return null;
  const obj = await env.DOCUMENTS.get(`atlas/${hash}.json`);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()) as AtlasSnapshotShape; } catch { return null; }
}

// ── the read-only LLM surface ──────────────────────────────────────────────
// No parameter here can write, edit, or embed anything — mode selects a VIEW.

export interface AtlasToolInput {
  mode?: 'stats' | 'view' | 'neighbors' | 'auto';
  id?: string;
  k?: number;
}

export async function atlasRoute(env: AtlasIngestEnv, input: AtlasToolInput): Promise<string> {
  const snapshot = await getLatestAtlas(env);
  if (!snapshot) return JSON.stringify({ error: 'no atlas ingested yet — the device cartographer has not published a snapshot (see Dynanic-Hyperbolic-Neural-Graph/scripts/publish.ts)' });

  const mode = input.mode && input.mode !== 'auto' ? input.mode : (input.id ? 'neighbors' : 'stats');

  if (mode === 'stats') {
    return JSON.stringify({
      mode, version: snapshot.version, hash: snapshot.hash, created_at: snapshot.created_at,
      nodes: snapshot.nodes.length, edges: snapshot.edges.length,
      invariants: snapshot.structure.invariants, signature: snapshot.structure.signature,
      mix: snapshot.product.mix, disagreements: snapshot.product.disagreements,
      drift: snapshot.hyper.drift ?? null,
      note: 'read-only view of the device-computed graph — you have no write/edit/embed access to it',
    });
  }
  if (mode === 'view') {
    return JSON.stringify({
      mode, version: snapshot.version, hash: snapshot.hash,
      nodes: snapshot.nodes, edges: snapshot.edges,
      note: 'full node/edge list — use mode=neighbors for one point\'s coordinates and nearest neighbors',
    });
  }
  if (mode === 'neighbors') {
    const id = String(input.id || '');
    if (!id || !snapshot.hyper.points[id]) return JSON.stringify({ mode, error: `atlas neighbors: no node "${id}" in the latest snapshot` });
    return JSON.stringify({
      mode, id,
      ball_neighbors: hyperNeighbors(snapshot.hyper, id, input.k ?? 5),
      phase_neighbors: torusNeighbors(snapshot.torus, id, input.k ?? 5),
    });
  }
  return JSON.stringify({ mode, error: 'atlas: unknown mode (stats | view | neighbors)' });
}
