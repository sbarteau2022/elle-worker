// ============================================================
// ATLAS EVENTS — the append-only recall-event ledger  (src/atlas-events.ts)
//
// The other half of the atlas boundary (src/atlas.ts). The device-side
// cartographer (Dynanic-Hyperbolic-Neural-Graph) builds the memory graph
// from EVENTS, not edges: "these memories were recalled together" is a fact
// about a moment, recorded once and never revised. This module is that
// ledger on the worker side:
//
//   • logCoRecallEvents() fires best-effort on every real recall, writing
//     the same pairwise co-occurrences recordAssociations learns from — but
//     as immutable rows, not weight bumps. There is no update or delete
//     function in this file, deliberately: the ledger is append-only, so
//     the device can always re-derive the graph from scratch and get the
//     same answer (the fold, with its φ⁻ⁿ hygiene, lives on the device).
//   • readAtlasEvents() is the device's pull: monotone cursor over the
//     autoincrement id, service-key gated at the HTTP layer (index.ts).
//
// The LLM has no tool onto this table in either direction — recalls write
// to it as a side effect of remembering, the device reads it with the
// service key, and Elle only ever sees the finished geometry via `atlas`.
// ============================================================

export interface AtlasEventsEnv { DB: D1Database }

export interface AtlasEventRow {
  id: number;
  kind: string;
  src: string;
  dst: string;
  weight: number;
  ts: number;         // epoch ms, stamped at log time
}

const MAX_BATCH = 64;      // pairwise cap⁵ is 10 rows; headroom, not an invitation
const MAX_PULL = 2000;     // one device pull page

let schemaReady = false;
async function ensureSchema(env: AtlasEventsEnv): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_atlas_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    ts INTEGER NOT NULL
  )`).run();
  schemaReady = true;
}

export interface AtlasEventIn { kind: string; src: string; dst: string; weight?: number }

export async function logAtlasEvents(env: AtlasEventsEnv, events: AtlasEventIn[], now = Date.now()): Promise<number> {
  const rows = events
    .filter((e) => e && e.kind && e.src && e.dst && e.src !== e.dst)
    .slice(0, MAX_BATCH);
  if (!rows.length) return 0;
  await ensureSchema(env);
  const stmt = env.DB.prepare(
    `INSERT INTO elle_atlas_events (kind, src, dst, weight, ts) VALUES (?, ?, ?, ?, ?)`
  );
  await env.DB.batch(rows.map((e) => stmt.bind(e.kind, e.src, e.dst, Math.max(0, e.weight ?? 1), now)));
  return rows.length;
}

// The recall-time hook: the set a recall returned was relevant TOGETHER, so
// log the pairwise co-occurrence of the strongest few — the same pairs (and
// the same cap) recordAssociations bumps, so the device's graph and the
// worker's own graph tier learn from identical facts and cannot drift apart.
export async function logCoRecallEvents(env: AtlasEventsEnv, ids: string[], cap = 5): Promise<number> {
  const top = [...new Set(ids)].slice(0, cap);
  if (top.length < 2) return 0;
  const events: AtlasEventIn[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      events.push({ kind: 'assoc', src: top[i], dst: top[j] });
    }
  }
  return logAtlasEvents(env, events);
}

// The device's pull: everything after the cursor, oldest first, one page.
// Returns the new cursor (highest id served) so the device stores it and
// never sees the same event twice.
export async function readAtlasEvents(env: AtlasEventsEnv, since = 0, limit = 500):
  Promise<{ events: AtlasEventRow[]; cursor: number; more: boolean }> {
  await ensureSchema(env);
  const n = Math.max(1, Math.min(MAX_PULL, Math.trunc(limit) || 500));
  const r = await env.DB.prepare(
    `SELECT id, kind, src, dst, weight, ts FROM elle_atlas_events WHERE id > ? ORDER BY id ASC LIMIT ?`
  ).bind(Math.max(0, Math.trunc(since) || 0), n + 1).all();
  const rows = (r.results as unknown as AtlasEventRow[]) || [];
  const more = rows.length > n;
  const page = more ? rows.slice(0, n) : rows;
  return { events: page, cursor: page.length ? page[page.length - 1].id : Math.max(0, Math.trunc(since) || 0), more };
}
