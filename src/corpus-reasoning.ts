// ============================================================
// CORPUS REASONING — src/corpus-reasoning.ts
//
// The impure edge that lets Elle reason WITH her corpus (search_corpus's own
// Vectorize + D1) instead of only over ad hoc input. Pulls real, independent
// passages for a claim, then runs the unified reasoning function — the same
// witness gate, the same two graphs, the same bimodal κ — over the retrieved
// text, with corpus CORROBORATION (convergence.ts) as the third axis: do
// independent papers/authors actually agree, or is this one voice echoed?
//
//   corpusSourcesFor()  — real Vectorize query + D1 join (the same shape as
//                         index.ts's ragSearch), but returns STRUCTURED,
//                         per-paper sources instead of one flattened blob —
//                         corroboration needs to know which passage came from
//                         which independent origin.
//   reasonWithCorpus()  — pulls sources, builds the graph FROM the retrieved
//                         passages (so derivation/recognition reflect how the
//                         corpus actually holds together on this claim), and
//                         reports convergence across the papers as the
//                         corroboration axis.
//
// HONEST SCOPE: "origin" here is the paper (paper_id) — the closest robust
// proxy for independence this schema has. Two chunks of the SAME paper are
// obviously not independent; two DIFFERENT papers by the same author, or one
// citing the other, are still nominally "independent" here even though they
// may not be — convergence.ts can only see the text, not citation graphs or
// authorship. That is a real, stated limit, not a hidden one.
// ============================================================

import type { Env } from './index';
import { embed } from './index';
import { reason, type ReasoningResult } from './reasoning';
import type { Source } from './convergence';

export interface CorpusMatch {
  id: string;
  origin: string;   // paper_id — the independence proxy
  title: string;
  series: string;
  text: string;
  score: number;    // Vectorize similarity
}

// Real retrieval: embed the claim, query Vectorize, join back to D1 for the
// chunk text + paper identity. Fails soft (empty array) so a retrieval hiccup
// degrades to "no sources" rather than a 500 — same posture as ragSearch.
export async function corpusSourcesFor(env: Env, claim: string, limit = 12): Promise<CorpusMatch[]> {
  try {
    const embedding = await embed(claim, env);
    const results = await env.VECTORIZE.query(embedding, { topK: limit, returnMetadata: 'all' });
    if (!results.matches.length) return [];
    const ids = results.matches.map((m) => m.id);
    const scoreOf = new Map(results.matches.map((m) => [m.id, m.score ?? 0]));
    const rows = await env.DB.prepare(
      `SELECT c.id, c.vectorize_id, c.chunk_text, c.paper_id, p.title, p.series
       FROM corpus_chunks c JOIN corpus_papers p ON p.id = c.paper_id
       WHERE c.vectorize_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    return (rows.results as unknown as { id: string; vectorize_id: string; chunk_text: string; paper_id: string; title: string; series: string }[])
      .map((r) => ({
        id: r.id, origin: r.paper_id, title: r.title, series: r.series,
        text: r.chunk_text, score: scoreOf.get(r.vectorize_id) ?? 0,
      }));
  } catch {
    return []; // fail-soft: retrieval trouble reads as "no sources," never a crash
  }
}

// Reason with the corpus: retrieve real, independent passages for a claim,
// build the graph from them, and report corpus corroboration as the third
// axis alongside the modality-driven grounding ceiling.
export async function reasonWithCorpus(env: Env, claim: string, limit = 12): Promise<ReasoningResult> {
  const matches = await corpusSourcesFor(env, claim, limit);
  const sources: Source[] = matches.map((m) => ({ id: m.id, origin: m.origin, text: m.text }));
  const segments = matches.map((m, i) => ({ t0: i, t1: i + 1, text: `[${m.title}] ${m.text}` }));
  if (segments.length === 0) segments.push({ t0: 0, t1: 1, text: claim }); // never hand the witness zero segments
  return reason(claim, segments, { text: true }, { sources, claim });
}
