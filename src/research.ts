// ============================================================
// ELLE RESEARCH — src/research.ts
// Runs as a Cloudflare Worker cron: 0 * * * * (hourly)
// Uses callLLM('research') — Gemini 2.5 Flash + Google Search grounding
// Stores findings directly to D1 corpus via ingest pipeline
// ============================================================

import { callLLM, type LLMResponse } from './llm';
import type { Env } from './index';
import { generateWithOverlapGate } from './journal';

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

  // Prior research papers (most recent first) — the deterministic hour-based
  // rotation above WILL land on the same topic again within days, so nothing
  // upstream of this point prevents a repeat; the guard has to live here.
  // Priors feed the overlap gate below (reject/regenerate a near-verbatim
  // repeat) and steer the prompt away from an angle already published.
  const priorRows = await env.DB.prepare(
    `SELECT title, full_text FROM corpus_papers WHERE series = 'research' ORDER BY ingested_at DESC LIMIT 8`
  ).all().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const priorPapers = (priorRows.results || []) as { title?: string; full_text?: string }[];
  const priors = priorPapers.map(p => String(p.full_text || '')).filter(Boolean);
  const priorTitles = priorPapers.map(p => String(p.title || '')).filter(Boolean);
  const avoidance = priorTitles.length
    ? `\n\nYou have already published these research entries recently — find a genuinely new angle, primary source, or development. Do not restate them:\n${priorTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  try {
    const attempts = new Map<string, LLMResponse>();
    const generate = async (temperature: number): Promise<string> => {
      const r = await callLLM(
        'research',
        system,
        [{ role: 'user', content: `Research this now using live web search:\n\n${topic.topic}\n\nI want primary sources, recent developments, and what the Observer framework reveals about the suppressed content.${avoidance}` }],
        3000,
        env,
        { temperature }
      );
      const content = r.content || '';
      attempts.set(content, r);
      return content;
    };

    const gate = await generateWithOverlapGate(priors, generate, {}, (event, data) =>
      console.log(`[RESEARCH overlap] ${event} ${JSON.stringify(data)}`));

    if (!gate.content) return;
    const result = attempts.get(gate.content)!;
    console.log(`[RESEARCH] overlap=${gate.overlap} attempts=${gate.attempts}${gate.forced ? ' (forced — best of exhausted retries)' : ''}`);

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