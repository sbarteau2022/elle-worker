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

export interface MemEnv {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  SESSIONS: KVNamespace;
}

type EmbedFn = (text: string, env: any) => Promise<number[]>;

const PAGE_TTL_S = 86400;      // pages are working memory — 24h then gone
const PAGE_SLICE = 2800;       // chars returned per page_read
export const PAGE_THRESHOLD = 3400; // observations larger than this get paged

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
  type?: string;        // observation | insight | preference | identity | fact | task
  importance?: number;  // 0..1
  tags?: string[];
  sessionId?: string | null;
}

export async function memWrite(env: MemEnv, embed: EmbedFn, o: MemWriteOpts): Promise<{ id: string }> {
  const id = rid();
  const imp = Math.max(0, Math.min(1, Number(o.importance ?? 0.6)));
  const summary = o.content.slice(0, 500);
  await env.DB.prepare(
    `INSERT INTO elle_memory (id, memory_type, source_engine, source_session_id, summary, content, philosophical_tags, importance, importance_score)
     VALUES (?, ?, 'router', ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, o.type || 'observation', o.sessionId || null,
    summary, o.content.slice(0, 4000),
    JSON.stringify((o.tags || []).slice(0, 12)), imp, imp,
  ).run();
  // Cold-tier index. Best-effort: a memory that failed to embed is still in D1.
  try {
    const vec = await embed(o.content.slice(0, 1200), env);
    await env.VECTORIZE.upsert([{ id: `mem-${id}`, values: vec, metadata: { type: 'memory', memory_type: o.type || 'observation' } }]);
  } catch { /* D1 row survives; recall falls back to importance scan */ }
  return { id };
}

interface MemRow {
  id: string; memory_type: string; summary: string; content: string | null;
  importance_score: number; created_at: string;
}

export interface RecalledMem extends MemRow { score: number; via: 'semantic' | 'importance' }

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
  const back = await env.DB.prepare(
    `SELECT id, memory_type, summary, content, importance_score, created_at
     FROM elle_memory WHERE source_engine = 'router'
     ORDER BY importance_score DESC, created_at DESC LIMIT 8`
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
  return scored;
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
