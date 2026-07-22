// ============================================================
// Portions adapted from togethercomputer/together-cookbook (MIT) —
// Open_Contextual_RAG.ipynb's context-generation step. The prompt below is
// ported VERBATIM (the plan calls it load-bearing) — do not "improve" the
// wording. Output: contextual_text stored/embedded = context_text + ' ' +
// original chunk_text (context PREPENDED), same as the notebook.
//
// Meant to run inside ONE queue-consumer invocation per document (§2.2 —
// batch the chunk loop, not one queue message per chunk, to respect
// free-tier rate limits). Checkpointing is per-chunk via embedding_status:
// the caller SELECTs chunks WHERE embedding_status != 'contextualized' for
// a paper before calling this, so a killed invocation resumes rather than
// restarts — this function itself doesn't re-check status, it processes
// whatever chunk list it's given.
// ============================================================

import type { LLMEnv, LLMTask } from '../llm';
import { runLLM } from '../llm';
import { estimateTokens } from './chunker';
import { backfillCorpusChunksContext } from '../db/schema';

const contextGenPrompt = (wholeDocument: string, chunkContent: string): string =>
  `Given the document below, we want to explain what the chunk captures in the document.\n\n` +
  `${wholeDocument}\n\n` +
  `Here is the chunk we want to explain:\n\n` +
  `${chunkContent}\n\n` +
  `Answer ONLY with a succinct explaination of the meaning of the chunk in the context of the whole document above.`;

// §2.2: the notebook stuffs the WHOLE document into every call (~1,660
// tokens/prompt on a short essay). Corpus papers are far longer — past this
// threshold, pass a token-windowed excerpt around the chunk instead.
const WINDOWED_DOC_TOKEN_THRESHOLD = 30_000;

export interface CorpusPaperRow {
  id: string;
  title: string;
  full_text: string;
}

export interface CorpusChunkRow {
  id: string;
  chunk_text: string;
}

export interface ContextualizeEnv extends LLMEnv {
  DB: D1Database;
}

export interface ContextualizeResult {
  succeeded: number;
  failed: number;
}

export async function contextualizeDocument(
  env: ContextualizeEnv,
  paper: CorpusPaperRow,
  chunks: CorpusChunkRow[],
  opts: { task?: LLMTask; maxRetries?: number } = {}
): Promise<ContextualizeResult> {
  await backfillCorpusChunksContext(env.DB);
  const task = opts.task ?? 'reasoning'; // background job → Gemini free tier per §2.2
  const maxRetries = opts.maxRetries ?? 3;
  const docTokens = estimateTokens(paper.full_text);

  let succeeded = 0;
  let failed = 0;

  for (const chunk of chunks) {
    const windowed = docTokens > WINDOWED_DOC_TOKEN_THRESHOLD;
    const documentText = windowed ? windowedContext(paper.full_text, chunk.chunk_text) : paper.full_text;
    const contextSource = windowed ? 'windowed' : 'full';

    const contextText = await generateWithRetry(env, documentText, chunk.chunk_text, task, maxRetries);

    if (contextText === null) {
      failed++;
      await env.DB.prepare(`UPDATE corpus_chunks SET embedding_status = 'failed' WHERE id = ?`)
        .bind(chunk.id)
        .run()
        .catch(() => {});
      continue;
    }

    const contextualText = `${contextText} ${chunk.chunk_text}`;
    await env.DB.prepare(
      `UPDATE corpus_chunks
       SET context_text = ?, contextual_text = ?, context_source = ?, embedding_status = 'contextualized', contextualized_at = ?
       WHERE id = ?`
    )
      .bind(contextText, contextualText, contextSource, Date.now(), chunk.id)
      .run();
    succeeded++;
  }

  return { succeeded, failed };
}

async function generateWithRetry(
  env: LLMEnv,
  documentText: string,
  chunkText: string,
  task: LLMTask,
  maxRetries: number
): Promise<string | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const text = await runLLM(env, contextGenPrompt(documentText, chunkText), { task, maxTokens: 300, temperature: 0.3 });
      const trimmed = text.trim();
      if (trimmed) return trimmed;
      lastErr = new Error('empty context generation response');
    } catch (e) {
      lastErr = e;
    }
    if (attempt < maxRetries) await sleep(2 ** attempt * 500);
  }
  console.error('[contextualizer] generation failed after retries:', (lastErr as Error)?.message ?? lastErr);
  return null;
}

// "Surrounding section" per §2.2: a fixed token window of full_text around
// where the chunk's own text occurs. A real running-summary pass would need
// the chunk's precise document position, which corpus_chunks doesn't track
// today (start_char/end_char are hardcoded placeholders — see
// docs/RETRIEVAL_CONTRACT.md) — this is a documented fallback, not that.
function windowedContext(fullText: string, chunkText: string, windowTokens = 4000): string {
  const CHARS_PER_TOKEN = 6; // generous estimate for English prose
  const charWindow = windowTokens * CHARS_PER_TOKEN;
  const idx = fullText.indexOf(chunkText);
  if (idx === -1) return fullText.slice(0, charWindow);
  const start = Math.max(0, idx - charWindow / 2);
  const end = Math.min(fullText.length, idx + chunkText.length + charWindow / 2);
  return fullText.slice(start, end);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
