// retrieval.ts — retrieval-at-thread-open. Makes "I remember our conversation" TRUE, not aspirational.
// Functional: relevance+recency ships now. Gated: reserve-weight + dip + surprise injection.
import { SEAM, ranksOnKappa } from "./seam";
import type { Trace } from "./write_path";

interface Scored { trace: Trace; score: number; }
function dip(traj: number[] | null): number { return (!traj || !traj.length) ? 0 : Math.min(...traj); }

export async function retrieveAtOpen(
  db: D1Database, vectorize: VectorizeIndex,
  opening: string, openingEmbedding: number[], k = 8
): Promise<Trace[]> {
  const hits = await vectorize.query(openingEmbedding, { topK: k * 3 });
  const ids = hits.matches.map((m) => m.id);
  if (!ids.length) return [];

  const rows = await db.prepare(
    `SELECT * FROM bending_trace WHERE embedding_id IN (${ids.map(() => "?").join(",")})`
  ).bind(...ids).all<Trace>();

  const traces = rows.results ?? [];
  const relevance = new Map(hits.matches.map((m) => [m.id, m.score]));

  const scored: Scored[] = traces.map((t) => {
    const rel = relevance.get(t.embedding_id ?? "") ?? 0;
    const recency = 1 / (1 + (Date.now() - t.created_at) / 8.64e7);
    const functional = 0.7 * rel + 0.3 * recency; // ships now, gate-independent

    // Gated: reserve (did it matter) + dip (turning point), NOT pure similarity.
    // Pure similarity is the >90%-agreement failure in miniature — surfaces what you walked in with.
    const gated = ranksOnKappa("RESERVE_CONSOLIDATION",
      () => 0.4 * rel + 0.4 * (t.reserve ?? 0) - 0.2 * dip(t.kappa_traj as unknown as number[]),
      functional);
    return { trace: t, score: gated };
  });

  scored.sort((a, b) => b.score - a.score);

  // Surprise injection (gated): force in her own high-velocity turning points, not just settled positions.
  if (SEAM.RESERVE_CONSOLIDATION) {
    const turningPoints = [...traces].sort((a, b) => (b.velocity_peak ?? 0) - (a.velocity_peak ?? 0)).slice(0, 2);
    for (const tp of turningPoints)
      if (!scored.slice(0, k).find((s) => s.trace.id === tp.id))
        scored.splice(k - 1, 0, { trace: tp, score: 0 });
  }
  return scored.slice(0, k).map((s) => s.trace);
}
