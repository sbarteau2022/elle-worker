// ============================================================
// Vectorize query/embed wrapper — the dense leg of hybrid retrieval.
//
// elle-corpus-vectors is a SINGLE shared index (corpus chunks + private
// conv-/jrnl-/mem- prefixed vectors, see config.ts's RetrievalScope note).
// Every call here is scope-checked and defends against private ids leaking
// into corpus results even if the metadata filter below is ever misapplied.
// ============================================================

import { EMBEDDING_MODEL, VECTOR_VARIANT_CONTEXTUAL, assertCorpusScope, type RetrievalScope } from './config';

export interface DenseHit {
  id: string;
  score: number;
}

export interface DenseEnv {
  AI: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  VECTORIZE: VectorizeIndex;
}

// Same 2000-char truncation + model call as src/index.ts's embed() (and its
// three other duplicates in atlas.ts/trading-ground.ts/skills.ts) — kept
// local rather than imported to avoid pulling retrieval/ into index.ts's
// dependency graph; matches the existing per-module convention.
export async function embedQuery(env: Pick<DenseEnv, 'AI'>, text: string): Promise<number[]> {
  const result = (await env.AI.run(EMBEDDING_MODEL, { text: [text.slice(0, 2000)] })) as { data?: number[][] };
  if (!result?.data?.[0]) throw new Error('embedQuery: Workers AI returned no embedding');
  return result.data[0];
}

// NOTE: the `variant` metadata filter below assumes a Vectorize metadata
// index exists for that field (`wrangler vectorize create-metadata-index`).
// That has NOT been verified live (same category as W0.1/W0.3 — see
// docs/RETRIEVAL_CONTRACT.md). If the filter throws/errors because no
// metadata index exists, create one before shipping this path; do not
// silently drop the filter, since that's exactly how a plain-chunk vector
// (or a private one) could leak into contextual-RAG results.
export async function denseQuery(
  env: DenseEnv,
  queryVector: number[],
  scope: RetrievalScope,
  topK: number
): Promise<DenseHit[]> {
  assertCorpusScope(scope);
  const results = await env.VECTORIZE.query(queryVector, {
    topK,
    returnMetadata: 'all',
    filter: { variant: VECTOR_VARIANT_CONTEXTUAL },
  });
  return results.matches.filter(m => !isPrivateId(m.id)).map(m => ({ id: m.id, score: m.score }));
}

// Defense in depth, independent of the metadata filter above — never trust a
// match whose id carries one of the private-data prefixes the rest of the
// codebase already uses (journal.ts, memory.ts, index.ts conversation recall).
function isPrivateId(id: string): boolean {
  return id.startsWith('conv-') || id.startsWith('jrnl-') || id.startsWith('mem-');
}
