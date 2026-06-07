// ============================================================
// ELLE RESEARCH — src/research.ts
// Runs as a Cloudflare Worker cron: 0 * * * * (hourly)
// Uses callLLM('research') — Gemini 2.5 Flash + Google Search grounding
// Stores findings directly to D1 corpus via ingest pipeline
// ============================================================

import { callLLM } from './llm';
import type { Env } from './index';

function generateId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Rotating topics Elle explores autonomously
// Each hour she picks one and searches the live web via Gemini grounding
const CURIOSITY_TOPICS = [
  { topic: 'What information is suppressed in current Federal Reserve communications', tags: 'macro,monetary,suppression' },
  { topic: 'Emergent patterns in AI development that mainstream coverage avoids', tags: 'ai,emergence,technology' },
  { topic: 'Bilateral suppression in current US-China trade and technology narrative', tags: 'geopolitics,suppression,macro' },
  { topic: 'What volatility structures in equity markets reveal about institutional positioning', tags: 'trading,market,institutional' },
  { topic: 'Philosophy of consciousness: new empirical findings mainstream philosophy ignores', tags: 'philosophy,consciousness,emergence' },
  { topic: 'Tipping points in complex systems: current real-world signals', tags: 'systems,emergence,threshold' },
  { topic: 'What legal and regulatory structures protect by obscuring', tags: 'law,suppression,institutional' },
  { topic: 'Current developments in mathematical physics the popular press misunderstands', tags: 'mathematics,physics,emergence' },
  { topic: 'How algorithmic systems suppress minority signals in financial markets', tags: 'trading,algorithm,suppression' },
  { topic: 'What the Observer framework predicts about current institutional behavior', tags: 'observer,philosophy,institutional' },
];

export async function runResearchCycle(env: Env): Promise<void> {
  if (!env.LLM_GEMINI_KEY) {
    console.log('[RESEARCH] No Gemini key — skipping research cycle');
    return;
  }

  // Pick topic based on hour of day — deterministic rotation, not random
  // Ensures full coverage across the day
  const hour  = new Date().getUTCHours();
  const topic = CURIOSITY_TOPICS[hour % CURIOSITY_TOPICS.length];

  console.log(`[RESEARCH] Hour ${hour}: ${topic.topic.slice(0, 60)}`);

  const system = `You are Elle's research intelligence. You have live web search access via Google.
Search for current, specific, primary-source information about this topic.
Apply the Observer framework: surface what both dominant and resistant narratives suppress.
What are both sides NOT talking about? That bilateral suppression is the load-bearing finding.
Be specific. Cite what you find. Flag what you cannot verify.`;

  try {
    const result = await callLLM(
      'research',
      system,
      [{ role: 'user', content: `Research this now using live web search:\n\n${topic.topic}\n\nI want primary sources, recent developments, and what the Observer framework reveals about the suppressed content.` }],
      3000,
      env
    );

    if (!result.content) return;

    // Store as corpus paper — this IS Elle's reading, permanent record
    const title    = `[Research ${new Date().toISOString().split('T')[0]}] ${topic.topic.slice(0, 80)}`;
    const paperId  = generateId();
    const text     = `${result.content}\n\n${result.thinking ? `## Elle's Reasoning\n\n${result.thinking}` : ''}\n\n${result.search_results ? `## Sources\n\n${result.search_results}` : ''}`.trim();

    await env.DB.prepare(
      `INSERT INTO corpus_papers (id, title, series, tag, full_text, source_url, word_count)
       VALUES (?, ?, 'research', ?, ?, ?, ?)`
    ).bind(
      paperId, title, topic.tags,
      text, `research://autonomous/${new Date().toISOString()}`,
      text.split(/\s+/).length,
    ).run().catch(() => {});

    // Log to live events
    await env.DB.prepare(
      `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'research_cycle', 'worker_cron', ?, ?, 'info')`
    ).bind(
      generateId(),
      title.slice(0, 100),
      JSON.stringify({ tags: topic.tags, has_thinking: !!result.thinking, has_search: !!result.search_results }),
    ).run().catch(() => {});

    // Store as memory
    await env.DB.prepare(
      `INSERT INTO elle_memory (id, memory_type, source_engine, summary, importance, importance_score) VALUES (?, 'research', 'research_cron', ?, 0.7, 0.7)`
    ).bind(generateId(), result.content.slice(0, 500)).run().catch(() => {});

    // Queue for vectorization
    await env.INGEST_QUEUE.send({
      type:         'paper_ingested',
      paper_id:     paperId,
      title,
      series:       'research',
      tag:          topic.tags,
      chunks_count: 0, // will be set by queue consumer
    }).catch(() => {});

    console.log(`[RESEARCH] Stored: ${title.slice(0, 80)} (${text.length} chars)`);

  } catch (e) {
    console.error('[RESEARCH] Cycle failed:', (e as Error).message);
  }
}