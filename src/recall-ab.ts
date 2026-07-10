// ============================================================
// RECALL-AB — the live A/B substrate for cycle-weighted recall  (src/recall-ab.ts)
//
// The cycle boost (memory.ts / graph.ts) is a live experiment with no offline
// eval. This is the measurement: on each real recall, memory.ts computes both
// arms of graphExpandAB (boost off vs on), serves the boosted arm, and logs what
// each arm surfaced. These pure helpers score the divergence at log time and
// aggregate the trace table for a readout (the `recall_ab` tool).
//
// Note this measures IMPACT (how much / how often the boost changes recall), not
// quality — there is no ground-truth recall label here. Quality is judged by
// inspecting the most-divergent cases, or by correlating with a downstream usage
// signal once one exists. The honest live test is: is the boost changing the
// graph tier at all, and in which cases.
// ============================================================

// Jaccard distance between two id lists: 0 = identical set, 1 = disjoint. Set
// membership only — blind to reordering, so it's the SECONDARY signal.
export function jaccardDistance(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? round(1 - inter / uni, 4) : 0;
}

// Ordered positional divergence: fraction of positions where the two ordered
// lists differ. 0 iff the ordered top-k are identical. This is the PRIMARY
// signal — the served recall is an ordered slice, so a pure reorder (same
// members, different order) is a real change Jaccard would miss.
export function orderedDivergence(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  if (!n) return 0;
  let diff = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) diff++;
  return round(diff / n, 4);
}

export interface RecallTraceRow {
  query_preview: string;
  base_top: string;         // JSON array of ids (boost off)
  boost_top: string;        // JSON array of ids (boost on)
  divergence: number;       // ordered positional divergence (primary)
  set_divergence: number;   // Jaccard set distance (secondary)
  created_at: number;
}

export interface RecallABSummary {
  traces: number;
  changed_fraction: number;      // fraction of recalls the boost changed at all (ordered > 0)
  mean_divergence: number;       // mean ordered positional divergence
  mean_set_divergence: number;   // mean Jaccard set distance
  reorder_only_fraction: number; // changed order but NOT membership (the boost's subtle effect)
  most_divergent: Array<{ query: string; base_top: string[]; boost_top: string[]; divergence: number; set_divergence: number }>;
}

export function summarizeRecallAB(rows: RecallTraceRow[], topN = 5): RecallABSummary {
  if (!rows.length) return { traces: 0, changed_fraction: 0, mean_divergence: 0, mean_set_divergence: 0, reorder_only_fraction: 0, most_divergent: [] };
  let changed = 0, reorderOnly = 0, sumOrd = 0, sumSet = 0;
  const parsed = rows.map((r) => {
    const ord = Number.isFinite(r.divergence) ? r.divergence : 0;
    const set = Number.isFinite(r.set_divergence) ? r.set_divergence : 0;
    if (ord > 0) changed++;
    if (ord > 0 && set === 0) reorderOnly++;    // order shuffled, same members
    sumOrd += ord; sumSet += set;
    return { query: r.query_preview, base_top: parseIds(r.base_top), boost_top: parseIds(r.boost_top), divergence: round(ord, 4), set_divergence: round(set, 4) };
  });
  parsed.sort((a, b) => b.divergence - a.divergence || b.set_divergence - a.set_divergence);
  return {
    traces: rows.length,
    changed_fraction: round(changed / rows.length, 4),
    mean_divergence: round(sumOrd / rows.length, 4),
    mean_set_divergence: round(sumSet / rows.length, 4),
    reorder_only_fraction: round(reorderOnly / rows.length, 4),
    most_divergent: parsed.slice(0, Math.max(1, Math.min(50, topN))),
  };
}

function parseIds(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function round(x: number, p: number): number { const f = 10 ** p; return Math.round(x * f) / f; }
