// ============================================================
// query → [dense ∥ fts] → RRF → rerank → top-k (§2.2/§2.3).
// The hybrid-retrieval entry point every caller (router.ts's search_corpus
// tool, the §2.4 eval harness) should use once the contextual re-embed has
// run and passed its eval gate — see docs/RETRIEVAL_CONTRACT.md.
// ============================================================

import type { LLMEnv, LLMTask } from '../llm';
import { denseQuery, embedQuery, type DenseEnv } from './dense';
import { ftsQuery } from './fts';
import { reciprocalRankFusion } from './fusion';
import { rerank, type RerankedPassage } from './rerank';
import { assertCorpusScope, type RerankStrategy, type RetrievalScope } from './config';

// DenseEnv's `AI` is required (a corpus query with no embedder makes no
// sense); LLMEnv's is optional (Workers AI is only ONE of several fallback
// providers there). Omit LLMEnv's before merging so the required one wins.
export interface PipelineEnv extends Omit<LLMEnv, 'AI'>, DenseEnv {
  DB: D1Database;
}

export interface PipelineOptions {
  denseTopK?: number;  // per-leg candidate count before fusion (default 20)
  ftsTopK?: number;    // default 20
  fusedTopK?: number;  // candidates passed into rerank (default 10, per plan)
  finalTopK?: number;  // results returned after rerank (default 5)
  rerankStrategy?: RerankStrategy;
  rerankTask?: LLMTask;
}

export interface PipelineResult extends RerankedPassage {
  chunkText: string;
  paperId: string;
  paperTitle: string;
}

interface ChunkRow {
  id: string;
  paper_id: string;
  chunk_text: string;
  title: string;
}

export async function retrieve(env: PipelineEnv, query: string, scope: RetrievalScope, opts: PipelineOptions = {}): Promise<PipelineResult[]> {
  assertCorpusScope(scope);
  const denseTopK = opts.denseTopK ?? 20;
  const ftsTopK = opts.ftsTopK ?? 20;
  const fusedTopK = opts.fusedTopK ?? 10;
  const finalTopK = opts.finalTopK ?? 5;

  const queryVector = await embedQuery(env, query);
  const [dense, fts] = await Promise.all([
    denseQuery(env, queryVector, scope, denseTopK),
    ftsQuery(env.DB, query, scope, ftsTopK),
  ]);

  const fused = reciprocalRankFusion([dense, fts]).slice(0, fusedTopK);
  if (!fused.length) return [];

  const rows = await loadChunks(env.DB, fused.map(f => f.id));
  const byId = new Map(rows.map(r => [r.id, r]));

  const passages = fused.filter(f => byId.has(f.id)).map(f => ({ id: f.id, text: byId.get(f.id)!.chunk_text }));
  const ranked = await rerank(env, query, passages, finalTopK, { strategy: opts.rerankStrategy, task: opts.rerankTask });

  return ranked
    .filter(r => byId.has(r.id))
    .map(r => {
      const row = byId.get(r.id)!;
      return { id: r.id, score: r.score, chunkText: row.chunk_text, paperId: row.paper_id, paperTitle: row.title };
    });
}

async function loadChunks(db: D1Database, chunkIds: string[]): Promise<ChunkRow[]> {
  if (!chunkIds.length) return [];
  const placeholders = chunkIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT c.id AS id, c.paper_id AS paper_id, c.chunk_text AS chunk_text, p.title AS title
       FROM corpus_chunks c JOIN corpus_papers p ON p.id = c.paper_id
       WHERE c.id IN (${placeholders})`
    )
    .bind(...chunkIds)
    .all<ChunkRow>();
  return results ?? [];
}
