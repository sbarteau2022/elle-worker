// src/corpus.ts
// Grounded retrieval primitives for elle-worker.
//
// Verified against the live elle-corpus D1 (2026-06-22):
//   - corpus_papers(id PK unique, title, series, tag, abstract, full_text, source_url,
//                   word_count, document_summary, document_score, ingest_pass, ...)
//       * full_text  : populated on 2015/2015
//       * abstract   : populated on 0/2015   <-- do NOT rely on it
//       * document_summary : populated on 0/2015
//       * id is unique (0 dup ids); title is NOT (105 dup titles across 221 rows)
//   - corpus_chunks(id PK, paper_id FK, chunk_index NOT NULL contiguous, chunk_text,
//                   token_count, vectorize_id, start_char, end_char, ...)
//       * chunk_index : 100% populated, contiguous per paper -> neighbor-fetch keys off this
//       * start_char  : 0 on ALL rows;  end_char = LENGTH(chunk_text)  -> offsets are USELESS,
//                       never use them to locate a chunk within its document
//       * match.id from Vectorize == vectorize_id == chunks.id (set equal at ingest)
//
// Design rules enforced here:
//   1. Resolve papers by id only. Title resolution returns ALL candidates; it never silently
//      picks one (would be wrong ~ for the 221 dup-title rows).
//   2. ragSearch returns structured handles (paper_id, chunk_index, vectorize_id, score),
//      NOT a pre-truncated string. The caller/agent decides what to expand or fetch in full.
//   3. Infra failures THROW. An empty array means "no matches", never "the query crashed".

export interface CorpusEnv {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
}

export interface RetrievalHit {
  vectorize_id: string;
  paper_id: string;
  chunk_index: number;
  title: string;
  series: string;
  score: number;
  chunk_text: string;   // full chunk, NOT truncated
  truncated: boolean;   // true only if the caller later slices it
}

export interface NeighborWindow {
  paper_id: string;
  title: string;
  series: string;
  center_index: number;
  from_index: number;
  to_index: number;
  total_chunks: number;
  chunks: { chunk_index: number; chunk_text: string }[];
  stitched: string;     // chunks joined in order, ready to drop into a prompt
}

export interface CorpusListItem {
  id: string;
  title: string;
  series: string;
  tag: string;
  word_count: number;
  has_chunks: boolean;  // false => full-text-only, invisible to vector search
  snippet: string;      // derived from full_text (no abstract exists)
}

export interface PaperRecord {
  id: string;
  title: string;
  series: string;
  tag: string;
  full_text: string;
  source_url: string | null;
  word_count: number;
}

const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5"; // 1024-dim, matches the Vectorize index

async function embedQuery(text: string, env: CorpusEnv): Promise<number[]> {
  const result: any = await env.AI.run(EMBED_MODEL, { text: [text.slice(0, 2000)] });
  const vec = result?.data?.[0];
  if (!vec) throw new Error("embedQuery: embedding model returned no data");
  return vec;
}

/**
 * Vector search that returns expandable handles instead of a flattened, pre-truncated string.
 * THROWS on infra failure (embed or Vectorize) so callers can distinguish failure from empty.
 */
export async function ragSearchStructured(
  query: string,
  topK: number,
  env: CorpusEnv,
): Promise<RetrievalHit[]> {
  const embedding = await embedQuery(query, env);
  const results = await env.VECTORIZE.query(embedding, {
    topK: Math.min(Math.max(topK, 1), 50),
    returnMetadata: "all",
  });
  if (!results.matches.length) return [];

  const ids = results.matches.map((m) => m.id);
  const scores = new Map(results.matches.map((m) => [m.id, m.score]));

  // Join on vectorize_id (== match.id). paper_id is the trustworthy FK; never resolve by title here.
  const rows = await env.DB.prepare(
    `SELECT c.vectorize_id, c.paper_id, c.chunk_index, c.chunk_text, p.title, p.series
       FROM corpus_chunks c
       JOIN corpus_papers p ON p.id = c.paper_id
      WHERE c.vectorize_id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all<any>();

  return (rows.results || [])
    .map((r) => ({
      vectorize_id: String(r.vectorize_id),
      paper_id: String(r.paper_id),
      chunk_index: Number(r.chunk_index),
      title: String(r.title),
      series: String(r.series),
      score: Number(scores.get(String(r.vectorize_id)) ?? 0),
      chunk_text: String(r.chunk_text),
      truncated: false,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Fetch chunk_index-1 .. chunk_index+window around a center chunk, in order, with the
 * document text stitched back together. Keys off chunk_index (start_char/end_char are useless).
 */
export async function getNeighbors(
  paperId: string,
  centerIndex: number,
  window: number,
  env: CorpusEnv,
): Promise<NeighborWindow | null> {
  const w = Math.min(Math.max(window, 0), 5);
  const lo = Math.max(centerIndex - w, 0);
  const hi = centerIndex + w;

  const paper = await env.DB.prepare(
    `SELECT title, series FROM corpus_papers WHERE id = ?`,
  ).bind(paperId).first<any>();
  if (!paper) return null;

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM corpus_chunks WHERE paper_id = ?`,
  ).bind(paperId).first<any>();

  const rows = await env.DB.prepare(
    `SELECT chunk_index, chunk_text
       FROM corpus_chunks
      WHERE paper_id = ? AND chunk_index BETWEEN ? AND ?
      ORDER BY chunk_index ASC`,
  ).bind(paperId, lo, hi).all<any>();

  const chunks = (rows.results || []).map((r) => ({
    chunk_index: Number(r.chunk_index),
    chunk_text: String(r.chunk_text),
  }));
  if (!chunks.length) return null;

  return {
    paper_id: paperId,
    title: String(paper.title),
    series: String(paper.series),
    center_index: centerIndex,
    from_index: chunks[0].chunk_index,
    to_index: chunks[chunks.length - 1].chunk_index,
    total_chunks: Number(totalRow?.n ?? chunks.length),
    chunks,
    stitched: chunks.map((c) => c.chunk_text).join("\n\n"),
  };
}

/** Full document by id. Returns null if not found. id is unique, so this is unambiguous. */
export async function getDocument(id: string, env: CorpusEnv): Promise<PaperRecord | null> {
  const p = await env.DB.prepare(
    `SELECT id, title, series, tag, full_text, source_url, word_count
       FROM corpus_papers WHERE id = ?`,
  ).bind(id).first<any>();
  if (!p) return null;
  return {
    id: String(p.id),
    title: String(p.title),
    series: String(p.series),
    tag: String(p.tag),
    full_text: String(p.full_text ?? ""),
    source_url: p.source_url != null ? String(p.source_url) : null,
    word_count: Number(p.word_count ?? 0),
  };
}

/**
 * Resolve a title to candidates. NEVER returns a single silent pick — there are 105 titles
 * with >1 row. Caller must disambiguate (by series/tag/word_count) and then call getDocument(id).
 */
export async function resolvePaperByTitle(
  title: string,
  env: CorpusEnv,
): Promise<{ id: string; title: string; series: string; tag: string; word_count: number }[]> {
  const rows = await env.DB.prepare(
    `SELECT id, title, series, tag, word_count
       FROM corpus_papers WHERE title = ? COLLATE NOCASE
      ORDER BY word_count DESC`,
  ).bind(title).all<any>();
  return (rows.results || []).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    series: String(r.series),
    tag: String(r.tag),
    word_count: Number(r.word_count ?? 0),
  }));
}

/**
 * List corpus papers for agent selection. No abstract exists, so `snippet` is derived from
 * full_text and `has_chunks` flags whether the paper is reachable by vector search at all.
 */
export async function listCorpus(
  opts: { series?: string; q?: string; limit?: number; offset?: number; onlyChunked?: boolean },
  env: CorpusEnv,
): Promise<{ items: CorpusListItem[]; total: number; limit: number; offset: number }> {
  const lim = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const off = Math.max(Number(opts.offset) || 0, 0);

  const filters: string[] = [];
  const binds: any[] = [];
  if (opts.series) { filters.push("p.series = ?"); binds.push(opts.series); }
  if (opts.q) { filters.push("p.title LIKE ?"); binds.push(`%${opts.q}%`); }
  if (opts.onlyChunked) {
    filters.push("EXISTS (SELECT 1 FROM corpus_chunks c WHERE c.paper_id = p.id)");
  }
  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM corpus_papers p ${whereSql}`,
  ).bind(...binds).first<any>();

  const rows = await env.DB.prepare(
    `SELECT p.id, p.title, p.series, p.tag, p.word_count,
            SUBSTR(p.full_text, 1, 180) AS snippet,
            EXISTS (SELECT 1 FROM corpus_chunks c WHERE c.paper_id = p.id) AS has_chunks
       FROM corpus_papers p ${whereSql}
      ORDER BY p.title LIMIT ? OFFSET ?`,
  ).bind(...binds, lim, off).all<any>();

  const items: CorpusListItem[] = (rows.results || []).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    series: String(r.series),
    tag: String(r.tag),
    word_count: Number(r.word_count ?? 0),
    has_chunks: !!Number(r.has_chunks),
    snippet: String(r.snippet ?? "").replace(/\s+/g, " ").trim(),
  }));

  return { items, total: Number(totalRow?.n ?? 0), limit: lim, offset: off };
}
