// ============================================================
// ELLE MEMORY KERNEL — src/memory.ts
//
// KV-cache-as-OS, one layer up from the GPU: we cannot page a hosted
// model's attention cache, but we ARE the kernel that decides what
// enters the context window on every call. So this module treats the
// memory substrate Elle actually owns as tiered process memory:
//
//   hot   → Cloudflare KV   (paged tool output, working set, TTL'd)
//   warm  → D1 elle_memory  (durable distilled records, importance-scored)
//   cold  → Vectorize       (latent tier — semantic recall over everything)
//
// Pieces:
//   pageStore / pageFetch  — demand paging for oversized tool output.
//                            A tool result over the threshold is written to
//                            KV as a page; the ReAct scratch gets the head
//                            slice + a page_id. page_read is the page-fault
//                            handler. Syscall → memory-mapped result: the
//                            scratch stays lean, the tail is never lost.
//   memWrite / memRecall   — durable memory records with priority scoring
//                            (semantic match + importance + recency) and
//                            refresh-on-recall: a record that keeps proving
//                            useful drifts up; one never touched decays by
//                            recency alone. Coherence without a daemon.
//   assembleContext        — the context assembler: pages the top-priority
//                            memories into a fixed char budget for a turn.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { CloudGraphStore, graphExpandAB, recordAssociations } from './graph';
import { jaccardDistance, orderedDivergence } from './recall-ab';

export interface MemEnv {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  SESSIONS: KVNamespace;
}

type EmbedFn = (text: string, env: any) => Promise<number[]>;

const PAGE_TTL_S = 86400;      // pages are working memory — 24h then gone
const PAGE_SLICE = 2800;       // chars returned per page_read
export const PAGE_THRESHOLD = 3400; // observations larger than this get paged
// Experiment: on-cycle (recurrent) edges pull this much harder than bridges in
// graph expansion. 1 = off (no behavior change). Bounded to the graph tier.
const GRAPH_CYCLE_BOOST = 1.3;

function rid(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── demand paging (hot tier · KV) ────────────────────────────

export async function pageStore(env: MemEnv, tool: string, fullText: string): Promise<{ id: string; size: number }> {
  const id = rid();
  await env.SESSIONS.put(`page:${id}`, fullText, {
    expirationTtl: PAGE_TTL_S,
    metadata: { tool, size: fullText.length },
  });
  return { id, size: fullText.length };
}

export async function pageFetch(env: MemEnv, pageId: string, seek = 0): Promise<string> {
  const full = await env.SESSIONS.get(`page:${pageId}`);
  if (full == null) return `(no page "${pageId}" — pages expire after 24h)`;
  const from = Math.max(0, Math.min(Math.trunc(seek) || 0, full.length));
  const slice = full.slice(from, from + PAGE_SLICE);
  const remain = full.length - (from + slice.length);
  return `[page ${pageId} · chars ${from}–${from + slice.length} of ${full.length}]\n${slice}` +
    (remain > 0 ? `\n…[${remain} chars remain — page_read {"page_id":"${pageId}","seek":${from + slice.length}}]` : '\n[end of page]');
}

// ── durable memory (warm tier · D1 + cold tier · Vectorize) ──

export interface MemWriteOpts {
  content: string;
  type?: string;        // observation | insight | preference | identity | fact | task | deliberate
  importance?: number;  // 0..1
  tags?: string[];
  sessionId?: string | null;
  sourceEngine?: string; // which writer this came through (default 'router')
}

// elle_memory predates the vector tier — track which rows have a mem- vector so
// the backfill is idempotent and cheap to resume. Best-effort ALTER, same
// pattern as the other late columns.
let memVecColumnReady = false;
async function ensureMemVecColumn(env: MemEnv): Promise<void> {
  if (memVecColumnReady) return;
  await env.DB.prepare('ALTER TABLE elle_memory ADD COLUMN vectorize_id TEXT').run().catch(() => {});
  memVecColumnReady = true;
}

export async function memWrite(env: MemEnv, embed: EmbedFn, o: MemWriteOpts): Promise<{ id: string }> {
  await ensureMemVecColumn(env);
  const id = rid();
  const imp = Math.max(0, Math.min(1, Number(o.importance ?? 0.6)));
  const summary = o.content.slice(0, 500);
  await env.DB.prepare(
    `INSERT INTO elle_memory (id, memory_type, source_engine, source_session_id, summary, content, philosophical_tags, importance, importance_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, o.type || 'observation', o.sourceEngine || 'router', o.sessionId || null,
    summary, o.content.slice(0, 4000),
    JSON.stringify((o.tags || []).slice(0, 12)), imp, imp,
  ).run();
  // Cold-tier index. Best-effort: a memory that failed to embed is still in D1
  // and the nightly backfill retries it (vectorize_id stays NULL). LOG the
  // failure — a silently dead vector tier is how the whole kernel starved once.
  try {
    const vec = await embed(o.content.slice(0, 1200), env);
    const vecId = `mem-${id}`;
    await env.VECTORIZE.upsert([{ id: vecId, values: vec, metadata: { type: 'memory', memory_type: o.type || 'observation' } }]);
    await env.DB.prepare('UPDATE elle_memory SET vectorize_id = ? WHERE id = ?').bind(vecId, id).run();
  } catch (e) { console.error('[MEMORY] memWrite vector upsert failed (row kept, backfill will retry):', (e as Error).message); }
  return { id };
}

// ── vector backfill (cold-tier repair) ───────────────────────
// 3,000+ memories were written by pipelines that never touched the vector tier,
// which left memRecall's semantic tier permanently empty. Walk rows without a
// vectorize_id, embed, upsert, mark. Idempotent, bounded per call — run from the
// nightly consolidation and/or the /mem/backfill door until it reports 0 left.
export async function memVectorBackfill(env: MemEnv, embed: EmbedFn, batch = 120): Promise<{ embedded: number; failed: number; remaining: number }> {
  await ensureMemVecColumn(env);
  const cap = Math.max(1, Math.min(200, batch));
  const rows = await env.DB.prepare(
    `SELECT id, memory_type, summary, content FROM elle_memory
     WHERE vectorize_id IS NULL ORDER BY created_at DESC LIMIT ?`
  ).bind(cap).all();
  let embedded = 0, failed = 0;
  for (const r of (rows.results as Array<{ id: string; memory_type: string; summary: string; content: string | null }>) || []) {
    const text = (r.content || r.summary || '').slice(0, 1200);
    if (!text.trim()) { failed++; continue; }
    try {
      const vec = await embed(text, env);
      const vecId = `mem-${r.id}`;
      await env.VECTORIZE.upsert([{ id: vecId, values: vec, metadata: { type: 'memory', memory_type: r.memory_type } }]);
      await env.DB.prepare('UPDATE elle_memory SET vectorize_id = ? WHERE id = ?').bind(vecId, r.id).run();
      embedded++;
    } catch (e) {
      failed++;
      console.error('[MEMORY] backfill embed failed for', r.id, (e as Error).message);
    }
  }
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM elle_memory WHERE vectorize_id IS NULL').first() as { n: number } | null;
  return { embedded, failed, remaining: left?.n ?? -1 };
}

interface MemRow {
  id: string; memory_type: string; summary: string; content: string | null;
  importance_score: number; created_at: string;
}

export interface RecalledMem extends MemRow { score: number; via: 'semantic' | 'importance' | 'graph' }

export async function memRecall(env: MemEnv, embed: EmbedFn, query: string, k = 5): Promise<RecalledMem[]> {
  const byId = new Map<string, { sem: number }>();
  // Cold tier first: semantic candidates (client-side prefix filter — no
  // metadata-index dependency, same pattern as conversation recall).
  try {
    const vec = await embed(query, env);
    const res = await env.VECTORIZE.query(vec, { topK: 60, returnMetadata: 'all' });
    for (const m of res.matches) {
      if (m.id.startsWith('mem-') && m.score > 0.35) byId.set(m.id.slice(4), { sem: m.score });
    }
  } catch { /* fall through to importance scan */ }

  const ids = [...byId.keys()].slice(0, 24);
  const rows: MemRow[] = [];
  if (ids.length) {
    const r = await env.DB.prepare(
      `SELECT id, memory_type, summary, content, importance_score, created_at
       FROM elle_memory WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    rows.push(...(r.results as unknown as MemRow[]));
  }
  // Warm-tier backstop: the highest-importance recent records, so recall
  // works even before anything matches semantically (or if Vectorize is down).
  // NO source_engine filter — the old `= 'router'` filter made recall
  // structurally blind to every memory the ingest/research/consolidation
  // pipelines wrote (which was ALL of them), so memRecall returned [] forever
  // and starved the graph tier. Deliberate/consolidated memories rank first;
  // bulk readings fill in behind them.
  const back = await env.DB.prepare(
    `SELECT id, memory_type, summary, content, importance_score, created_at
     FROM elle_memory
     ORDER BY (memory_type IN ('deliberate','consolidated')) DESC,
              importance_score DESC, created_at DESC LIMIT 8`
  ).all().catch(() => ({ results: [] as unknown[] }));
  for (const b of back.results as unknown as MemRow[]) {
    if (!rows.find(r => r.id === b.id)) rows.push(b);
  }
  if (!rows.length) return [];

  // Priority = semantic match + importance + recency decay (τ ≈ 45 days).
  const now = Date.now();
  const scored: RecalledMem[] = rows.map(r => {
    const sem = byId.get(r.id)?.sem ?? 0;
    const ageDays = Math.max(0, (now - Date.parse(r.created_at + 'Z')) / 86400000) || 0;
    const recency = Math.exp(-ageDays / 45);
    return {
      ...r,
      via: sem > 0 ? 'semantic' as const : 'importance' as const,
      score: 0.55 * sem + 0.30 * (r.importance_score ?? 0.5) + 0.15 * recency,
    };
  }).sort((a, b) => b.score - a.score).slice(0, k);

  // Refresh-on-recall: a memory that keeps getting pulled drifts up (capped),
  // so the working set self-organizes; untouched records sink by recency.
  const hot = scored.filter(s => s.via === 'semantic').map(s => s.id);
  if (hot.length) {
    await env.DB.prepare(
      `UPDATE elle_memory SET importance_score = MIN(0.98, importance_score + 0.02)
       WHERE id IN (${hot.map(() => '?').join(',')})`
    ).bind(...hot).run().catch(() => {});
  }

  // Graph expansion — navigate edges from the top hits to pull in memories that
  // MATTER to the query but share none of its words (the decision a fact led to,
  // the insight distilled from it). Additive and best-effort: on a fresh graph
  // this is one empty query and a no-op; a failure returns the base recall
  // untouched. Every successful recall also records the co-occurrence of the set
  // it returned as `assoc` edges, so the graph self-bootstraps from use.
  let result = scored;
  try {
    const store = new CloudGraphStore(env.DB);
    const seeds = scored.map(s => ({ id: s.id, activation: Math.max(0.05, s.score) }));
    // Structure-weighted expansion (experiment): memories on a CYCLE with the
    // seed — recurrent structure, the signal that survived the retrieval
    // benchmark — pull ~30% harder than those on a linear derivation bridge.
    // We compute BOTH arms in one traversal: serve the boosted arm (current
    // behavior), log both for the live A/B. One constant reverts it (set to 1).
    const { base, boosted } = await graphExpandAB(store, seeds, { hops: 2 }, GRAPH_CYCLE_BOOST);
    const activation = boosted;
    const extraIds = [...activation.keys()].filter(id => !scored.some(s => s.id === id)).slice(0, k);
    if (extraIds.length) {
      const er = await env.DB.prepare(
        `SELECT id, memory_type, summary, content, importance_score, created_at
         FROM elle_memory WHERE id IN (${extraIds.map(() => '?').join(',')})`
      ).bind(...extraIds).all();
      const extra: RecalledMem[] = (er.results as unknown as MemRow[]).map(r => {
        const ageDays = Math.max(0, (now - Date.parse(r.created_at + 'Z')) / 86400000) || 0;
        const recency = Math.exp(-ageDays / 45);
        const act = Math.min(1, activation.get(r.id) ?? 0);
        return { ...r, via: 'graph' as const, score: 0.40 * act + 0.30 * (r.importance_score ?? 0.5) + 0.10 * recency };
      });
      result = [...scored, ...extra].sort((a, b) => b.score - a.score).slice(0, k);
    }
    void recordAssociations(store, result.map(r => r.id))
      .catch((e) => console.error('[GRAPH] recordAssociations failed:', (e as Error).message));
    // Live A/B log: the top-k graph-tier ids each arm surfaces (by activation,
    // excluding the semantic hits) + their divergence. Best-effort, off the hot
    // path's success criteria — a failed log never touches the returned recall.
    void logRecallAB(env, query, scored, base, boosted)
      .catch((e) => console.error('[GRAPH] recall A/B log failed:', (e as Error).message));
  } catch (e) {
    // Still an enhancement, never a dependency — but a SILENT catch here is how
    // the whole graph tier sat dead for weeks with nobody noticing. Log it.
    console.error('[GRAPH] expansion failed (recall served without graph tier):', (e as Error).message);
  }

  return result;
}

// ── context assembler ────────────────────────────────────────
// Pages the top-priority memories into a char budget for one turn.
// Returns '' when there is nothing worth loading — silence is free.

export async function assembleContext(env: MemEnv, embed: EmbedFn, query: string, budgetChars = 1600): Promise<string> {
  try {
    const mems = await memRecall(env, embed, query, 5);
    if (!mems.length) return '';
    const lines: string[] = [];
    let used = 0;
    for (const m of mems) {
      const body = (m.content || m.summary).replace(/\s+/g, ' ').trim();
      const line = `- (${m.memory_type} · ${m.created_at.slice(0, 10)}) ${body}`.slice(0, 420);
      if (used + line.length > budgetChars) break;
      lines.push(line); used += line.length;
    }
    return lines.length ? lines.join('\n') : '';
  } catch { return ''; }
}

// ── live A/B logging for the cycle-boost experiment ───────────────────────
// Records the graph-tier ids each arm (boost off vs on) surfaces per real
// recall, plus their Jaccard divergence. Best-effort and off the hot path's
// success criteria — a failed log never affects the returned recall. Read back
// via the `recall_ab` tool (summarizeRecallAB).

let recallTracesReady = false;
async function ensureRecallTraces(env: MemEnv): Promise<void> {
  if (recallTracesReady) return;
  await ensureAllSchemas(env.DB);
  recallTracesReady = true;
}

async function logRecallAB(
  env: MemEnv, query: string, scored: RecalledMem[],
  base: Map<string, number>, boosted: Map<string, number>,
): Promise<void> {
  const semantic = new Set(scored.map(s => s.id));
  const topExtra = (m: Map<string, number>): string[] =>
    [...m.entries()].filter(([id]) => !semantic.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 8);
  const baseTop = topExtra(base), boostTop = topExtra(boosted);
  if (!baseTop.length && !boostTop.length) return;      // no graph tier — nothing to compare
  const divergence = orderedDivergence(baseTop, boostTop);   // primary: order-aware
  const setDivergence = jaccardDistance(baseTop, boostTop);  // secondary: membership
  await ensureRecallTraces(env);
  await env.DB.prepare(
    `INSERT INTO elle_recall_traces (id, created_at, session_id, query_preview, semantic_count, base_top, boost_top, divergence, set_divergence, boost)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID().replace(/-/g, ''), Date.now(), null,
    query.slice(0, 200), scored.length, JSON.stringify(baseTop), JSON.stringify(boostTop), divergence, setDivergence, GRAPH_CYCLE_BOOST,
  ).run();
}
