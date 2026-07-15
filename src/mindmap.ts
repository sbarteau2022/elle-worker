// ============================================================
// MINDMAP — the door + persistence for the mind-map pipeline.
//
// Wraps the pure end-to-end function (mindmap-pipeline.ts) with the two impure
// jobs it can't do itself: pull a real source in (YouTube captions) and write
// the run out (D1, append-only). The pipeline stays pure and tested; this is the
// thin edge that touches the network and the database.
//
//   POST /api/elle-mindmap { url }         → fetch a video's captions, run, store
//   POST /api/elle-mindmap { segments }    → run supplied {t0,t1,text}[] , store
//   POST /api/elle-mindmap { transcript }  → run plain text (1 line ≈ 1 segment)
//   GET  /api/elle-mindmap?id=<id>         → replay one stored run (result+trace)
//   GET  /api/elle-mindmap                 → list recent runs (no trace)
//
// Admin-gated (svc) in index.ts: it fetches an external URL and writes D1.
// Append-only, fail-loud on a bad source, best-effort on the D1 write (a store
// hiccup never loses the computed result to the caller).
// ============================================================

import type { Env } from './index';
import {
  runMindMap, fetchYouTubeSegments, youtubeVideoId, type Segment, type MindMapResult,
} from './mindmap-pipeline';

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS mindmap_runs (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         source TEXT NOT NULL,
         ok INTEGER NOT NULL,
         kappa REAL,
         grounding TEXT,
         node_count INTEGER,
         edge_count INTEGER,
         result_json TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_mindmap_created ON mindmap_runs (created_at DESC)`),
  ]);
  schemaReady = true;
}

function rid(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 24); }

// plain text → segments: one non-empty line per segment, ~2.5s each (no real
// clock, so the temporal channel is synthetic here and the pipeline says so via
// a lower, honest κ; a real YouTube source carries real timing).
function transcriptToSegments(text: string): Segment[] {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let t = 0;
  return lines.map((l) => { const dur = Math.max(1, Math.min(8, l.split(/\s+/).length / 3)); const s = { t0: t, t1: t + dur, text: l }; t += dur; return s; });
}

async function store(env: Env, source: string, r: MindMapResult): Promise<string> {
  const id = rid();
  try {
    await ensureSchema(env.DB);
    await env.DB.prepare(
      `INSERT INTO mindmap_runs (id, title, source, ok, kappa, grounding, node_count, edge_count, result_json)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, r.title || 'untitled', source, r.ok ? 1 : 0, r.kappa, r.grounding,
      r.nodes.length, r.edges.length, JSON.stringify(r),
    ).run();
  } catch { /* best-effort: the caller still gets the result even if the write fails */ }
  return id;
}

export async function handleMindmapPost(body: Record<string, unknown>, env: Env): Promise<Response> {
  let segments: Segment[] = [];
  let source = 'inline';
  let title = String(body.title || '').trim();

  try {
    if (typeof body.url === 'string' && body.url) {
      const vid = youtubeVideoId(body.url);
      if (!vid) return json({ ok: false, error: 'not a recognized YouTube URL' }, 400);
      source = `youtube:${vid}`;
      title = title || `YouTube ${vid}`;
      segments = await fetchYouTubeSegments(vid);   // fail-loud: throws if no captions
    } else if (Array.isArray(body.segments)) {
      source = 'segments';
      segments = (body.segments as Segment[]).filter((s) => s && typeof s.text === 'string');
    } else if (typeof body.transcript === 'string') {
      source = 'transcript';
      segments = transcriptToSegments(body.transcript);
    } else {
      return json({ ok: false, error: 'provide url, segments[], or transcript' }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502);
  }

  const result = runMindMap(title || 'untitled', segments);
  const id = await store(env, source, result);
  return json({ id, source, result });
}

export async function handleMindmapGet(url: URL, env: Env): Promise<Response> {
  await ensureSchema(env.DB).catch(() => {});
  const id = url.searchParams.get('id');
  if (id) {
    const row = await env.DB.prepare(`SELECT result_json FROM mindmap_runs WHERE id = ?`).bind(id).first<{ result_json: string }>().catch(() => null);
    if (!row) return json({ ok: false, error: 'run not found' }, 404);
    return json({ id, result: JSON.parse(row.result_json) });
  }
  const rows = await env.DB.prepare(
    `SELECT id, title, source, ok, kappa, grounding, node_count, edge_count, created_at
     FROM mindmap_runs ORDER BY created_at DESC LIMIT 30`
  ).all().then((r) => r.results || []).catch(() => []);
  return json({ runs: rows });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
