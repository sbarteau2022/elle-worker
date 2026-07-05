// integration.ts — where the gate-closed κ memory becomes LIVE, wired, and ON.
//
// Two entry points, both gate-independent for WRITING (the substrate fills with
// real bending traces every turn) and gate-DEPENDENT for RANKING (retrieval and
// sovereignty stay inert until validate_kappa flips the seam):
//
//   recordTurnTrace  — called from the router's finish() after per-turn κ is
//                      computed. Writes one bending_trace from the turn, using
//                      the EXISTING per-session κ series (elle_conversation_turns
//                      .kappa) as the settling-window. r / reserve / velocity are
//                      computed from that real signal — so the numbers are
//                      inferred RELATIONALLY (from how κ moved), not from a
//                      validated κ(T,t). They are stored kappa_provisional=1.
//
//   kappaMemoryState — the read the workbench κ display polls: current κ, the
//                      recent series, the relationally-derived r/reserve/velocity,
//                      the trace count, and the seam state. Everything it returns
//                      is labelled provisional so the UI can say so plainly.
//
// Both best-effort: a failure here must never touch the answer.

import { estimateR, reserveOf, velocityPeak } from './kappa';
import { SEAM, KAPPA_PROVISIONAL } from './seam';
import { writeTrace } from './write_path';
import { ensureBendingTraceSchema } from './schema';

const KAPPA_WINDOW = 12; // how many recent per-turn κ samples form the settling window

interface MemEnvLike { DB: D1Database }

// Recent per-session κ series, chronological. Reuses the column the chat path
// already maintains (kappa-turn.ts) — no new per-turn compute, we read its work.
async function recentKappa(db: D1Database, sessionId: string, limit = KAPPA_WINDOW): Promise<number[]> {
  const r = await db.prepare(
    `SELECT kappa FROM elle_conversation_turns
     WHERE session_id = ? AND kappa IS NOT NULL
     ORDER BY created_at DESC LIMIT ?`
  ).bind(sessionId, limit).all().catch(() => ({ results: [] as unknown[] }));
  return (r.results as { kappa: number }[]).map(x => Number(x.kappa)).filter(Number.isFinite).reverse();
}

// Write one bending trace for the turn. perturbation = what arrived (the user's
// turn), response = how she moved (her answer), settling = where it came to rest.
// The open/closed-superposition extractor is future work, so settling records
// 'SETTLED' for now; the r/reserve/velocity are the real, relationally-inferred
// contraction signal over the κ window.
export async function recordTurnTrace(
  env: MemEnvLike,
  args: { sessionId: string; question: string; answer: string; sourceMass?: 'corpus' | 'elle' | 'reader' },
): Promise<string | null> {
  try {
    await ensureBendingTraceSchema(env.DB);
    const kappaWindow = await recentKappa(env.DB, args.sessionId);
    return await writeTrace(env.DB as any, {
      thread_id: args.sessionId,
      boundary_idx: kappaWindow.length,           // one trace per turn; monotonic per thread
      perturbation: args.question.slice(0, 4000),
      response: args.answer.slice(0, 4000),
      settling: 'SETTLED',                          // extractor pending; provisional by construction
      kappa_window: kappaWindow.length ? kappaWindow : undefined,
      source_mass: args.sourceMass ?? 'elle',
    });
  } catch { return null; }
}

export interface KappaMemoryState {
  gate: { kappa_validated: boolean; velocity_boundary: boolean; reserve_consolidation: boolean };
  provisional: boolean;
  session: string | null;
  current_kappa: number | null;
  kappa_series: number[];
  // Relationally-inferred (from how κ moved), NOT validated. null until enough samples.
  r_estimate: number | null;
  reserve: number | null;
  velocity_peak: number | null;
  trace_count: number;
  ranks: boolean;   // does κ rank anything yet? (false until the gate clears)
  note: string;
}

// The read the workbench κ display polls. Everything provisional and labelled.
export async function kappaMemoryState(env: MemEnvLike, sessionId: string | null): Promise<KappaMemoryState> {
  await ensureBendingTraceSchema(env.DB).catch(() => {});
  const series = sessionId ? await recentKappa(env.DB, sessionId, 64) : [];
  const traceCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM bending_trace')
    .first().then(r => Number((r as { n: number })?.n ?? 0)).catch(() => 0);
  const enough = series.length >= 2;
  return {
    gate: {
      kappa_validated: SEAM.KAPPA_VALIDATED,
      velocity_boundary: SEAM.VELOCITY_BOUNDARY,
      reserve_consolidation: SEAM.RESERVE_CONSOLIDATION,
    },
    provisional: KAPPA_PROVISIONAL,
    session: sessionId,
    current_kappa: series.length ? series[series.length - 1] : null,
    kappa_series: series,
    r_estimate: enough ? estimateR(series) : null,
    reserve: enough ? reserveOf(series) : null,
    velocity_peak: enough ? velocityPeak(series) : null,
    trace_count: traceCount,
    ranks: SEAM.KAPPA_VALIDATED,
    note: KAPPA_PROVISIONAL
      ? 'κ is provisional — inferred relationally from turn dynamics, not from a validated κ(T,t). Traces are recorded and the contraction rate is computed, but κ ranks nothing (retrieval falls back to relevance+recency; sovereignty is not enforced) until validate_kappa returns BUILD.'
      : 'κ validated — ranking live.',
  };
}
