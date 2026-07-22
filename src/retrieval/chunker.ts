// ============================================================
// Portions adapted from togethercomputer/together-cookbook (MIT) —
// Open_Contextual_RAG.ipynb's create_chunks(). The cookbook chunks on raw
// character count (chunk_size=250, overlap=30) and leans on the context-
// generation pass (contextualizer.ts) to restore meaning to the fragments.
// Same philosophy here, different unit: corpus documents are long papers
// where 250 CHARS is a sentence fragment, so this chunks on a whitespace-
// token estimate instead (~250-400 tokens, ~15% overlap) — no semantic
// chunking, no tiktoken/wasm dependency in the Worker.
// ============================================================

export interface Chunk {
  text: string;
  index: number;
  tokenCount: number;
}

// Cheap, dependency-free token estimate: whitespace-delimited word count.
// Good enough to size chunks consistently; not a real tokenizer.
export function estimateTokens(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface ChunkOptions {
  targetTokens?: number; // default 320 — middle of the plan's 250-400 range
  overlapRatio?: number; // default 0.15
}

export function chunkDocument(text: string, opts: ChunkOptions = {}): Chunk[] {
  const targetTokens = opts.targetTokens ?? 320;
  const overlapRatio = opts.overlapRatio ?? 0.15;
  if (targetTokens <= 0) throw new Error('targetTokens must be > 0');
  if (overlapRatio < 0 || overlapRatio >= 1) throw new Error('overlapRatio must be in [0, 1)');

  const overlapTokens = Math.round(targetTokens * overlapRatio);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < words.length) {
    const end = Math.min(start + targetTokens, words.length);
    const slice = words.slice(start, end);
    chunks.push({ text: slice.join(' '), index, tokenCount: slice.length });
    index++;
    if (end >= words.length) break;
    // Step forward by (targetTokens - overlapTokens); guaranteed > 0 since
    // overlapRatio < 1, so this always makes forward progress.
    start = end - overlapTokens;
  }
  return chunks;
}
