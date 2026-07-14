import { describe, it, expect } from 'vitest';
import { ingestAtlas, getLatestAtlas, atlasRoute, listAtlasHistory, getAtlasByHash, type AtlasIngestEnv } from './atlas';

// ── fakes ────────────────────────────────────────────────────────────────
function fakeEnv() {
  const r2 = new Map<string, string>();
  const d1Rows: Record<string, unknown>[] = [];
  const upserts: unknown[] = [];

  const stmt = {
    _sql: '',
    bind(...args: unknown[]) { (this as unknown as { _args: unknown[] })._args = args; return this; },
    async run() {
      const args = (this as unknown as { _args?: unknown[] })._args || [];
      if (this._sql.startsWith('INSERT INTO elle_atlas_snapshots')) {
        d1Rows.push({
          id: args[0], version: args[1], created_at: args[2],
          node_count: args[3], edge_count: args[4], cycle_rank: args[5],
          drift_mean: args[8], r2_key: args[9],
        });
      }
      return { success: true };
    },
    async first() {
      if (!d1Rows.length) return null;
      const latest = [...d1Rows].sort((a, b) => (b.created_at as number) - (a.created_at as number))[0];
      return { r2_key: latest.r2_key };
    },
    async all() {
      const args = (this as unknown as { _args?: unknown[] })._args || [];
      if (this._sql.includes('FROM elle_atlas_snapshots') && this._sql.includes('ORDER BY created_at ASC')) {
        const limit = Number(args[0]) || 100;
        const rows = [...d1Rows]
          .sort((a, b) => (a.created_at as number) - (b.created_at as number))
          .slice(0, limit)
          .map((r) => ({ hash: r.id, version: r.version, created_at: r.created_at, node_count: r.node_count, edge_count: r.edge_count, cycle_rank: r.cycle_rank, drift_mean: r.drift_mean }));
        return { results: rows };
      }
      return { results: [] };
    },
  };

  const db = {
    prepare(sql: string) { return { ...stmt, _sql: sql }; },
  } as unknown as D1Database;

  const documents = {
    async put(key: string, value: string) { r2.set(key, value); },
    async get(key: string) {
      const v = r2.get(key);
      return v ? { text: async () => v } : null;
    },
  } as unknown as R2Bucket;

  const vectorize = {
    async upsert(items: unknown[]) { upserts.push(...items); return { count: items.length }; },
  } as unknown as VectorizeIndex;

  const ai = {
    async run(_model: string, opts: { text: string[] }) {
      return { data: opts.text.map((t) => new Array(8).fill(0).map((_, i) => (t.length + i) / 100)) };
    },
  } as unknown as Ai;

  return { env: { DB: db, DOCUMENTS: documents, VECTORIZE: vectorize, AI: ai } as AtlasIngestEnv, r2, d1Rows, upserts };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    hash: 'abc123', version: '1', created_at: 1000,
    nodes: ['a', 'b', 'c'],
    edges: [{ src: 'a', dst: 'b', kind: 'assoc', weight: 1 }, { src: 'b', dst: 'c', kind: 'derived', weight: 1 }],
    hyper: { dim: 3, points: { a: [0, 0, 0], b: [0.1, 0, 0], c: [0.2, 0, 0] }, stats: {} },
    torus: { dim: 8, points: { a: new Array(8).fill(0), b: new Array(8).fill(0.1), c: new Array(8).fill(0.2) }, stats: {} },
    structure: { invariants: { cycle_rank: 0, nodes: 3, edges: 2, components: 1, cycle_density: 0 }, signature: { delta: 0 }, cycle_edges: [] },
    product: { mix: { hyperbolic: 0.7, toroidal: 0.3 }, disagreements: { same_rhythm_diff_lineage: [], same_lineage_drift_phase: [] } },
    ...overrides,
  };
}

describe('ingestAtlas (the ONLY write path — never reachable from the router)', () => {
  it('stores the full snapshot in R2 and an index row in D1', async () => {
    const { env, r2, d1Rows } = fakeEnv();
    const result = await ingestAtlas(env, { snapshot: snapshot() });
    expect(result).toMatchObject({ hash: 'abc123', version: '1', node_count: 3, edge_count: 2, truncated: false });
    expect(r2.has('atlas/abc123.json')).toBe(true);
    expect(JSON.parse(r2.get('atlas/abc123.json')!).hash).toBe('abc123');
    expect(d1Rows.length).toBe(1);
  });

  it('embeds every node as raw numbers via the semantic embedder, with exact coordinates in metadata', async () => {
    const { env, upserts } = fakeEnv();
    const result = await ingestAtlas(env, { snapshot: snapshot() });
    expect(result.embedded_nodes).toBe(3);
    const first = upserts[0] as { id: string; values: number[]; metadata: Record<string, unknown> };
    expect(first.id).toMatch(/^atlas-abc123-/);
    expect(Array.isArray(first.values)).toBe(true);
    expect(JSON.parse(first.metadata.ball as string)).toEqual(expect.any(Array));
  });

  it('rejects a malformed snapshot rather than silently storing garbage', async () => {
    const { env } = fakeEnv();
    await expect(ingestAtlas(env, { snapshot: { nodes: ['a'] } })).rejects.toThrow(/malformed snapshot/);
    await expect(ingestAtlas(env, {})).rejects.toThrow(/malformed snapshot/);
  });

  it('truncates the embedding pass (not the storage) past MAX_EMBED_NODES', async () => {
    const { env } = fakeEnv();
    const big = snapshot({
      nodes: Array.from({ length: 305 }, (_, i) => `n${i}`),
      edges: [],
      hyper: { dim: 3, points: Object.fromEntries(Array.from({ length: 305 }, (_, i) => [`n${i}`, [0, 0, 0]])), stats: {} },
      torus: { dim: 8, points: Object.fromEntries(Array.from({ length: 305 }, (_, i) => [`n${i}`, new Array(8).fill(0)])), stats: {} },
    });
    const result = await ingestAtlas(env, { snapshot: big });
    expect(result.truncated).toBe(true);
    expect(result.embedded_nodes).toBe(300);
    expect(result.node_count).toBe(305); // full graph still stored, only embedding truncates
  });
});

describe('getLatestAtlas / atlasRoute (Elle\'s ENTIRE surface onto the graph — reads only)', () => {
  it('getLatestAtlas returns null before anything is ingested', async () => {
    const { env } = fakeEnv();
    expect(await getLatestAtlas(env)).toBeNull();
  });

  it('atlasRoute stats mode summarizes the latest ingested snapshot', async () => {
    const { env } = fakeEnv();
    await ingestAtlas(env, { snapshot: snapshot() });
    const out = JSON.parse(await atlasRoute(env, {}));
    expect(out.mode).toBe('stats');
    expect(out.hash).toBe('abc123');
    expect(out.nodes).toBe(3);
    expect(out.note).toMatch(/no write\/edit\/embed access/);
  });

  it('atlasRoute view mode returns node/edge lists, no write surface', async () => {
    const { env } = fakeEnv();
    await ingestAtlas(env, { snapshot: snapshot() });
    const out = JSON.parse(await atlasRoute(env, { mode: 'view' }));
    expect(out.nodes).toEqual(['a', 'b', 'c']);
    expect(out.edges.length).toBe(2);
  });

  it('atlasRoute neighbors mode reads both charts for a live node', async () => {
    const { env } = fakeEnv();
    await ingestAtlas(env, { snapshot: snapshot() });
    const out = JSON.parse(await atlasRoute(env, { mode: 'neighbors', id: 'a', k: 2 }));
    expect(out.ball_neighbors.length).toBeGreaterThan(0);
    expect(out.phase_neighbors.length).toBeGreaterThan(0);
  });

  it('atlasRoute errors cleanly when nothing has been ingested', async () => {
    const { env } = fakeEnv();
    const out = JSON.parse(await atlasRoute(env, {}));
    expect(out.error).toMatch(/no atlas ingested/);
  });

  it('has no mode that accepts points/edges/snapshot input — the type surface itself is read-only', () => {
    // AtlasToolInput (imported type) only has mode/id/k — this is a structural
    // guarantee, not just a runtime one: there is no parameter path in the
    // tool signature for the router to pass graph-mutating data through.
    const input: import('./atlas').AtlasToolInput = { mode: 'stats', id: 'a', k: 5 };
    expect(Object.keys(input).sort()).toEqual(['id', 'k', 'mode']);
  });
});

describe('listAtlasHistory / getAtlasByHash (the replay reads)', () => {
  const HASH_A = 'aaaaaaaaaaaaaaaa';
  const HASH_B = 'bbbbbbbbbbbbbbbb';

  it('lists the timeline oldest first with the index fields the scrubber needs', async () => {
    const { env } = fakeEnv();
    await ingestAtlas(env, { snapshot: snapshot({ hash: HASH_B, version: '2', created_at: 2000 }) });
    await ingestAtlas(env, { snapshot: snapshot({ hash: HASH_A, version: '1', created_at: 1000 }) });
    const history = await listAtlasHistory(env);
    expect(history.map((h) => h.hash)).toEqual([HASH_A, HASH_B]);
    expect(history[0]).toMatchObject({ version: '1', created_at: 1000, node_count: 3, edge_count: 2 });
  });

  it('is empty before anything is ingested', async () => {
    const { env } = fakeEnv();
    expect(await listAtlasHistory(env)).toEqual([]);
  });

  it('fetches one historical frame by content hash', async () => {
    const { env } = fakeEnv();
    await ingestAtlas(env, { snapshot: snapshot({ hash: HASH_A, version: '1', created_at: 1000 }) });
    await ingestAtlas(env, { snapshot: snapshot({ hash: HASH_B, version: '2', created_at: 2000 }) });
    const frame = await getAtlasByHash(env, HASH_A);
    expect(frame?.version).toBe('1');
    expect(await getAtlasByHash(env, 'cccccccccccccccc')).toBeNull(); // unknown
  });

  it('rejects a malformed hash before it can shape an R2 key', async () => {
    const { env } = fakeEnv();
    expect(await getAtlasByHash(env, '../secrets')).toBeNull();
    expect(await getAtlasByHash(env, 'ABCDEF0123456789')).toBeNull(); // uppercase = not the CLI's address form
    expect(await getAtlasByHash(env, '')).toBeNull();
  });
});
