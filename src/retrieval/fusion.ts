// ============================================================
// Portions adapted from togethercomputer/together-cookbook (MIT) —
// Open_Contextual_RAG.ipynb's reciprocal rank fusion step, ported directly:
// for each ranked list, for rank,item in enumerate(list, 1): score[item] +=
// 1/(rank+K); sort desc. K=60, same as the notebook.
// ============================================================

import { RRF_K } from './config';

export interface RankedId {
  id: string;
}

export interface FusedResult {
  id: string;
  score: number;
}

// Combines any number of independently-ranked lists (e.g. dense + BM25) into
// one fused ranking. Rank starts at 1 within each list; an id absent from a
// list contributes nothing from that list (not a zero-score entry).
export function reciprocalRankFusion(rankedLists: RankedId[][], k: number = RRF_K): FusedResult[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((item, i) => {
      const rank = i + 1;
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (rank + k));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
