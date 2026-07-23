// ============================================================
// D1 FTS5 query wrapper — the BM25 (keyword) leg of hybrid retrieval.
// Vectorize has no keyword search; corpus_chunks_fts (see
// db/schema.ts's backfillCorpusChunksContext) is the D1 FTS5 replacement
// for the cookbook's bm25s library. FTS5's default ranking IS BM25 —
// `ORDER BY rank` below is the whole port of that step.
// ============================================================

import { assertCorpusScope, type RetrievalScope } from './config';

export interface FtsHit {
  id: string;
  rank: number; // SQLite FTS5 bm25 rank — more negative is MORE relevant
}

export async function ftsQuery(db: D1Database, query: string, scope: RetrievalScope, topK: number): Promise<FtsHit[]> {
  assertCorpusScope(scope);
  const q = query.trim();
  if (!q) return [];
  const { results } = await db
    .prepare(
      `SELECT c.id AS id, corpus_chunks_fts.rank AS rank
       FROM corpus_chunks_fts
       JOIN corpus_chunks c ON c.rowid = corpus_chunks_fts.rowid
       WHERE corpus_chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .bind(sanitizeFtsQuery(q), topK)
    .all<{ id: string; rank: number }>();
  return results ?? [];
}

// FTS5 MATCH has its own query syntax (AND/OR/NOT, -, ^, etc.) — a raw user
// query containing any of those characters is a syntax error, not a
// no-match. Quote each term individually (doubling embedded quotes) and OR
// them together: a valid MATCH expression for any input, and closer to
// true BM25 "any of these terms" ranking than a single-phrase match would be.
function sanitizeFtsQuery(query: string): string {
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 32);
  if (!terms.length) return '""';
  return terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}
