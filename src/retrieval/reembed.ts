// ============================================================
// §2.2's full contextual re-embed, orchestrated: contextualize (D1) →
// embed + upsert (Vectorize), per document, checkpointed via
// corpus_chunks.embedding_status so a killed run resumes rather than
// restarts. This is the piece the port plan calls "the only expensive
// step: ~5,774 chunks × (1 context-gen call + 1 embed call)."
//
// Entry points:
//   enqueueContextualBackfill(env) — one INGEST_QUEUE message per document
//     that still has unfinished chunks. Call this ONCE to kick off the
//     backfill (see docs/RETRIEVAL_CONTRACT.md for the exact trigger).
//   handleReembedMessage(env, paperId) — what the queue consumer calls per
//     message; wired in src/index.ts's queue() handler.
//
// NOT wired to run automatically on any schedule or on ingest — this only
// runs when explicitly enqueued, since it's real LLM/embedding cost against
// the live corpus.
// ============================================================

import { contextualizeDocument, type ContextualizeEnv, type CorpusPaperRow, type CorpusChunkRow } from './contextualizer';
import { embedAndUpsertContextual, type DenseEnv, type ContextualChunkInput } from './dense';
import { backfillCorpusChunksContext } from '../db/schema';

// ContextualizeEnv's `AI` is optional (inherited from LLMEnv — Workers AI is
// just one of several LLM fallback providers there); DenseEnv's is required
// (embedding has no fallback). Omit the optional one before merging.
export interface ReembedEnv extends Omit<ContextualizeEnv, 'AI'>, DenseEnv {}

export interface ReembedResult {
  contextualized: { succeeded: number; failed: number };
  embedded: { succeeded: number; failed: number };
}

const CONTEXTUAL_VECTOR_PREFIX = 'ctxv1-';

// Runs both phases for ONE document. Safe to re-run: each phase only
// touches chunks whose embedding_status isn't already past that phase.
export async function reembedDocument(env: ReembedEnv, paper: CorpusPaperRow): Promise<ReembedResult> {
  await backfillCorpusChunksContext(env.DB);

  const pendingContext = await env.DB.prepare(
    `SELECT id, chunk_text FROM corpus_chunks
     WHERE paper_id = ? AND (embedding_status IS NULL OR embedding_status NOT IN ('contextualized', 'embedded'))`
  )
    .bind(paper.id)
    .all<CorpusChunkRow>();

  const toContextualize = pendingContext.results ?? [];
  const contextualized = toContextualize.length ? await contextualizeDocument(env, paper, toContextualize) : { succeeded: 0, failed: 0 };

  const readyToEmbed = await env.DB.prepare(
    `SELECT id, chunk_index, contextual_text FROM corpus_chunks WHERE paper_id = ? AND embedding_status = 'contextualized'`
  )
    .bind(paper.id)
    .all<{ id: string; chunk_index: number; contextual_text: string }>();

  const rows = readyToEmbed.results ?? [];
  let embSucceeded = 0;
  let embFailed = 0;

  if (rows.length) {
    const inputs: ContextualChunkInput[] = rows.map(r => ({
      vectorizeId: `${CONTEXTUAL_VECTOR_PREFIX}${r.id}`,
      text: r.contextual_text,
      paperId: paper.id,
      chunkIndex: r.chunk_index,
    }));
    try {
      await embedAndUpsertContextual(env, inputs);
      for (const r of rows) {
        await env.DB.prepare(`UPDATE corpus_chunks SET contextual_vectorize_id = ?, embedding_status = 'embedded' WHERE id = ?`)
          .bind(`${CONTEXTUAL_VECTOR_PREFIX}${r.id}`, r.id)
          .run();
      }
      embSucceeded = rows.length;
    } catch (e) {
      // Leave embedding_status='contextualized' — context generation isn't
      // redone; the next invocation retries only the embed/upsert step.
      embFailed = rows.length;
      console.error(`[reembed] embed/upsert failed for paper ${paper.id}:`, (e as Error).message);
    }
  }

  return { contextualized, embedded: { succeeded: embSucceeded, failed: embFailed } };
}

export interface IngestQueueEnv {
  INGEST_QUEUE: Queue;
}

// Kicks off the backfill: one queue message per document that has at least
// one chunk not yet fully embedded. Idempotent to call again later (a
// document with nothing left pending contributes no message).
export async function enqueueContextualBackfill(env: ReembedEnv & IngestQueueEnv): Promise<{ enqueued: number }> {
  await backfillCorpusChunksContext(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.id AS id
     FROM corpus_papers p JOIN corpus_chunks c ON c.paper_id = p.id
     WHERE c.embedding_status IS NULL OR c.embedding_status != 'embedded'`
  ).all<{ id: string }>();

  const paperIds = results ?? [];
  for (const { id } of paperIds) {
    await env.INGEST_QUEUE.send({ type: 'reembed_document', paper_id: id });
  }
  return { enqueued: paperIds.length };
}

// What the queue consumer calls per 'reembed_document' message.
export async function handleReembedMessage(env: ReembedEnv, paperId: string): Promise<ReembedResult> {
  const paper = await env.DB.prepare(`SELECT id, title, full_text FROM corpus_papers WHERE id = ?`).bind(paperId).first<CorpusPaperRow>();
  if (!paper) throw new Error(`reembed: paper ${paperId} not found`);
  return reembedDocument(env, paper);
}
