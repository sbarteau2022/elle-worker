// ============================================================
// Strategy-switched reranker (§2.2). Workers AI's @cf/baai/bge-reranker-base
// availability is UNVERIFIED (W0.3 — blocked by this sandbox's network
// policy; see docs/RETRIEVAL_CONTRACT.md). RERANK_STRATEGY defaults to 'llm'
// per the plan's own contingency for this exact case. Flip the config
// constant to 'workers-ai' once a live probe confirms the model responds —
// the workers-ai branch below is implemented and ready, just unverified
// against the real endpoint's response shape.
// ============================================================

import type { LLMEnv, LLMTask } from '../llm';
import { jsonLLM } from '../llm';
import { z } from 'zod';
import { RERANK_STRATEGY, type RerankStrategy } from './config';

export interface Passage {
  id: string;
  text: string;
}

export interface RerankedPassage {
  id: string;
  score: number;
}

export interface WorkersAIEnv {
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
}

const WORKERS_AI_RERANK_MODEL = '@cf/baai/bge-reranker-base';

// Score each passage 0-10 for relevance, per the plan's exact fallback prompt.
const LlmRerankSchema = z.object({
  scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(10) })),
});

export async function rerank(
  env: LLMEnv & WorkersAIEnv,
  query: string,
  passages: Passage[],
  topK: number,
  opts: { strategy?: RerankStrategy; task?: LLMTask } = {}
): Promise<RerankedPassage[]> {
  if (!passages.length) return [];
  const strategy = opts.strategy ?? RERANK_STRATEGY;
  const scored = strategy === 'workers-ai' ? await rerankWorkersAI(env, query, passages) : await rerankLLM(env, query, passages, opts.task);
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

async function rerankWorkersAI(env: WorkersAIEnv, query: string, passages: Passage[]): Promise<RerankedPassage[]> {
  if (!env.AI) throw new Error('rerankWorkersAI: env.AI binding not set');
  const raw = (await env.AI.run(WORKERS_AI_RERANK_MODEL, {
    query,
    contexts: passages.map(p => ({ text: p.text })),
  })) as { response?: Array<{ id?: number; index?: number; score?: number; relevance_score?: number }> };

  const results = raw?.response ?? [];
  return results.map(r => {
    const idx = r.id ?? r.index;
    const passage = typeof idx === 'number' ? passages[idx] : undefined;
    if (!passage) throw new Error(`rerankWorkersAI: response index ${idx} out of range for ${passages.length} passages`);
    return { id: passage.id, score: r.score ?? r.relevance_score ?? 0 };
  });
}

async function rerankLLM(env: LLMEnv, query: string, passages: Passage[], task: LLMTask = 'fast'): Promise<RerankedPassage[]> {
  const prompt =
    `Query: ${query}\n\n` +
    `Passages:\n${passages.map(p => `[${p.id}] ${p.text}`).join('\n\n')}\n\n` +
    `Score each passage 0-10 for relevance to the query, return JSON array.`;
  const { data } = await jsonLLM(
    env,
    prompt,
    LlmRerankSchema,
    { task, system: 'You are a precise relevance scorer. Return only the requested JSON.' }
  );
  const byId = new Map(data.scores.map(s => [s.id, s.score]));
  // Passages the model didn't score (malformed id, truncated output) get 0 —
  // they simply lose the rerank, not the whole request.
  return passages.map(p => ({ id: p.id, score: byId.get(p.id) ?? 0 }));
}
