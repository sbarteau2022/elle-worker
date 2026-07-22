// ============================================================
// RETRIEVAL CONFIG — single source of truth for §2's contextual RAG pipeline.
//
// Every retrieval module (chunker, contextualizer, fts, dense, fusion,
// rerank, pipeline) imports its constants from here — never re-derives or
// hardcodes them. Values below are the verified facts recorded in
// docs/RETRIEVAL_CONTRACT.md (Phase 0 / W0.1); update both together.
// ============================================================

import { BGE_LARGE_DIMS } from '../mem-intake';

// Vectorize index this corpus lives in (wrangler.toml binding VECTORIZE).
export const VECTORIZE_INDEX = 'elle-corpus-vectors';

// Embedding model that populates elle-corpus-vectors today (env.AI.run(...)
// in index.ts/atlas.ts/trading-ground.ts/skills.ts). Re-exported (not
// redefined) so this file is the one place retrieval code reads it from —
// mem-intake.ts remains the source of truth since memWrite's fail-fast
// vector check is the load-bearing use of this constant.
export const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
export const EMBEDDING_DIMS = BGE_LARGE_DIMS;

// D1 database holding the corpus (wrangler.toml binding DB).
export const CORPUS_DB_NAME = 'elle-corpus';

// Existing corpus tables (out-of-band DDL — see docs/RETRIEVAL_CONTRACT.md
// §"Existing schema" for the confirmed column list). Contextual RAG EXTENDS
// these tables with new columns rather than replacing them.
export const CORPUS_PAPERS_TABLE = 'corpus_papers';
export const CORPUS_CHUNKS_TABLE = 'corpus_chunks';

// Reranker strategy. Workers AI's @cf/baai/bge-reranker-base availability is
// UNVERIFIED (W0.3 — blocked in the sandbox that authored this file; outbound
// access to api.cloudflare.com was denied by the network policy in effect,
// see docs/RETRIEVAL_CONTRACT.md). Default to the LLM-rerank fallback the
// plan itself names for this exact case; flip to 'workers-ai' only after a
// live probe from an environment with Workers AI access confirms the model
// responds.
export type RerankStrategy = 'workers-ai' | 'llm';
export const RERANK_STRATEGY: RerankStrategy = 'llm';

// Reciprocal Rank Fusion constant (togethercomputer/together-cookbook
// Open_Contextual_RAG.ipynb uses K=60; ported verbatim).
export const RRF_K = 60;

// Metadata field distinguishing re-embedded contextual vectors from the
// legacy plain-chunk vectors already in the index, so old vectors stay
// queryable during the §2.4 eval-gated cutover.
export const VECTOR_VARIANT_CONTEXTUAL = 'contextual_v1';

// ── Mandatory query scope (P0 privacy constraint) ───────────────────────────
// elle-corpus-vectors is ONE shared Vectorize index for corpus chunks AND
// private per-user data (conv-/jrnl-/mem- id-prefixed vectors — see
// journal.ts, memory.ts, index.ts). Existing queries scope by filtering the
// RETURNED matches by id prefix, in application code, AFTER the query runs —
// none of them pass a user_id filter INTO Vectorize, and journalSearch()
// (journal.ts) queries the whole index with no owner check before the
// prefix filter. That is the "existing journal-read bug" the port plan
// names explicitly and requires new code not repeat.
//
// Every retrieval/dense.ts and retrieval/fts.ts query takes a mandatory
// RetrievalScope — no default parameter, so omitting it is a compile error,
// not a runtime one. Corpus retrieval only ever needs 'corpus_public' today
// (corpus_chunks has no owner column); the `user:${id}` arm exists so this
// module's query surface is ready if a per-user retrieval path is ever
// layered on the same index, without repeating the unscoped-query mistake.
export type RetrievalScope = 'corpus_public' | `user:${string}`;

export function assertCorpusScope(scope: RetrievalScope): void {
  if (scope !== 'corpus_public') {
    throw new Error(
      `retrieval/pipeline.ts only serves the public corpus today (scope='corpus_public'); ` +
      `got '${scope}'. There is no per-user corpus data yet — if you're adding one, extend ` +
      `dense.ts/fts.ts's actual filtering (not just this assertion) first.`
    );
  }
}
