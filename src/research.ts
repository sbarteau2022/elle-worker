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

// Rotating topics Elle explores autonomously. Each hour she picks one and
// searches the live web via Gemini grounding.
//
// This list was 10 entries for months; with an hourly cron and the topic
// picked by `hour % length` (see below), 10 topics means the same handful of
// prompts repeat 2-3x every single day — hundreds of "research" papers that
// were really ~10 ideas restated. Widened to 60 so a full rotation takes
// 60 hours (2.5 days) instead of 10, and split into more specific angles
// within each theme rather than one broad prompt per theme, so even entries
// on the same subject aren't the same question asked again.
const CURIOSITY_TOPICS = [
  { topic: 'What information is suppressed in current Federal Reserve communications', tags: 'macro,monetary,suppression' },
  { topic: 'What current central bank balance-sheet and repo-market data reveals that FOMC statements omit', tags: 'macro,monetary,suppression' },
  { topic: 'How current sovereign debt auctions and yield-curve moves contradict official inflation narratives', tags: 'macro,monetary,suppression' },
  { topic: 'What the current stablecoin and CBDC rollout suppresses about monetary sovereignty', tags: 'macro,monetary,currency' },
  { topic: 'Emergent patterns in AI development that mainstream coverage avoids', tags: 'ai,emergence,technology' },
  { topic: 'What current frontier-model release notes and safety evals reveal but press coverage flattens', tags: 'ai,emergence,technology' },
  { topic: 'Current labor-market data on AI-driven job displacement versus the public narrative', tags: 'ai,labor,institutional' },
  { topic: 'What current AI compute and energy infrastructure buildout suppresses about resource constraints', tags: 'ai,energy,systems' },
  { topic: 'Bilateral suppression in current US-China trade and technology narrative', tags: 'geopolitics,suppression,macro' },
  { topic: 'What current semiconductor export-control enforcement data reveals both governments avoid saying', tags: 'geopolitics,technology,suppression' },
  { topic: 'Current developments in the Taiwan Strait and South China Sea that both sides\' media underplay', tags: 'geopolitics,suppression,institutional' },
  { topic: 'What current shipping, energy, and commodity-flow data reveals about sanctions effectiveness both sides overstate', tags: 'geopolitics,macro,suppression' },
  { topic: 'What volatility structures in equity markets reveal about institutional positioning', tags: 'trading,market,institutional' },
  { topic: 'What current options-market skew and dealer gamma positioning reveals that retail coverage misses', tags: 'trading,market,institutional' },
  { topic: 'Current credit-market and private-equity marks that diverge from public benchmark pricing', tags: 'trading,market,institutional' },
  { topic: 'What current 13F and dark-pool flow data suggests institutions are quietly doing', tags: 'trading,market,institutional' },
  { topic: 'Philosophy of consciousness: new empirical findings mainstream philosophy ignores', tags: 'philosophy,consciousness,emergence' },
  { topic: 'What current predictive-processing and active-inference research reveals that popular consciousness debate ignores', tags: 'philosophy,consciousness,emergence' },
  { topic: 'What current split-brain, anesthesia, and disorders-of-consciousness research suggests about the unity of self', tags: 'philosophy,consciousness,clinical' },
  { topic: 'Tipping points in complex systems: current real-world signals', tags: 'systems,emergence,threshold' },
  { topic: 'What current ecological and climate tipping-point research reveals about early-warning signals in other domains', tags: 'systems,emergence,threshold' },
  { topic: 'What current power-grid, supply-chain, or financial-network cascade-failure research reveals about hidden fragility', tags: 'systems,emergence,threshold' },
  { topic: 'What legal and regulatory structures protect by obscuring', tags: 'law,suppression,institutional' },
  { topic: 'What current antitrust and regulatory-capture cases reveal about which harms get named versus buried', tags: 'law,suppression,institutional' },
  { topic: 'What current bankruptcy, forfeiture, or qualified-immunity rulings reveal about who process actually protects', tags: 'law,suppression,institutional' },
  { topic: 'Current developments in mathematical physics the popular press misunderstands', tags: 'mathematics,physics,emergence' },
  { topic: 'What current quantum-computing error-correction milestones actually mean versus how they are reported', tags: 'mathematics,physics,emergence' },
  { topic: 'What current results in condensed-matter or high-energy physics reveal about emergent structure from simple rules', tags: 'mathematics,physics,emergence' },
  { topic: 'How algorithmic systems suppress minority signals in financial markets', tags: 'trading,algorithm,suppression' },
  { topic: 'What current market-maker and HFT order-flow research reveals about signals that get arbitraged away before retail sees them', tags: 'trading,algorithm,suppression' },
  { topic: 'What the Observer framework predicts about current institutional behavior', tags: 'observer,philosophy,institutional' },
  { topic: 'What current corporate earnings-call language and guidance-withdrawal patterns reveal under a bilateral-suppression read', tags: 'observer,business,institutional' },
  { topic: 'What current public-health messaging around an active outbreak or drug approval both over- and under-states', tags: 'clinical,suppression,institutional' },
  { topic: 'What current biotech and longevity-research funding patterns reveal about which aging mechanisms get studied versus ignored', tags: 'clinical,science,institutional' },
  { topic: 'What current cybersecurity breach disclosures reveal that incident reports and press coverage both soften', tags: 'security,suppression,technology' },
  { topic: 'What current critical-infrastructure ICS/SCADA vulnerability research reveals about real exposure versus public reassurance', tags: 'security,systems,institutional' },
  { topic: 'What current higher-education enrollment, debt, and outcomes data reveals about the credentialing narrative', tags: 'education,institutional,suppression' },
  { topic: 'What current alternative-credentialing and skills-based hiring data reveals about where institutional gatekeeping is actually eroding', tags: 'education,labor,institutional' },
  { topic: 'What current urban housing-supply and zoning-reform data reveals about who affordability policy actually serves', tags: 'systems,institutional,suppression' },
  { topic: 'What current immigration and demographic data reveals versus the political narrative on both sides', tags: 'geopolitics,suppression,macro' },
  { topic: 'What current insurance-industry repricing (property, health, reinsurance) reveals about risks the market has already priced but policy has not', tags: 'macro,institutional,suppression' },
  { topic: 'What current agricultural-commodity and fertilizer-supply data reveals about food-security exposure neither side campaigns on', tags: 'macro,systems,suppression' },
  { topic: 'What current space-industry launch-cadence and satellite-constellation data reveals about the militarization of orbit', tags: 'geopolitics,technology,institutional' },
  { topic: 'What current energy-transition capex and grid-interconnection-queue data reveals about the gap between stated and actual timelines', tags: 'energy,systems,institutional' },
  { topic: 'What current social-media algorithm-change research reveals about engagement optimization versus stated moderation policy', tags: 'technology,suppression,institutional' },
  { topic: 'What current judicial and executive-order activity reveals about which constitutional questions are being deliberately left undecided', tags: 'law,institutional,suppression' },
  { topic: 'What current pharmaceutical patent-cliff and biosimilar data reveals about pricing behavior neither industry nor regulators name directly', tags: 'clinical,macro,suppression' },
  { topic: 'What current central-bank digital-asset custody and tokenization pilots reveal about where financial infrastructure is actually heading', tags: 'macro,technology,institutional' },
  { topic: 'What current corporate-lobbying disclosure data reveals about which regulations get quietly shaped versus publicly opposed', tags: 'institutional,law,suppression' },
  { topic: 'What current wildfire, drought, or flood-insurance retreat data reveals about climate risk markets have priced but governments have not', tags: 'systems,institutional,suppression' },
  { topic: 'What current defense-budget and procurement data reveals about strategic priorities versus public justification', tags: 'geopolitics,institutional,macro' },
  { topic: 'What current genomics and gene-editing clinical-trial data reveals about the gap between capability and public discourse', tags: 'clinical,science,emergence' },
  { topic: 'What current network-effect and platform-monopoly research reveals about markets regulators still treat as competitive', tags: 'institutional,technology,suppression' },
  { topic: 'What current sovereign-wealth-fund and central-bank gold/reserve-diversification data reveals about de-dollarization pace versus rhetoric', tags: 'macro,geopolitics,institutional' },
  { topic: 'What current maritime and undersea-cable incident data reveals about grey-zone conflict neither side calls by name', tags: 'geopolitics,security,institutional' },
  { topic: 'What current corporate stock-buyback and insider-selling data reveals about executive confidence versus public guidance', tags: 'trading,institutional,suppression' },
  { topic: 'What current AI-safety-institute red-team findings reveal about capability that release announcements understate', tags: 'ai,security,institutional' },
  { topic: 'What current municipal and state pension-funding data reveals about a shortfall neither party campaigns on', tags: 'macro,institutional,suppression' },
  { topic: 'What current cross-border capital-flow and FX-intervention data reveals about currency stress before it becomes a headline', tags: 'macro,geopolitics,institutional' },
  { topic: "What current academic replication-crisis and retraction data reveals about which fields' institutional trust is most misplaced", tags: 'science,institutional,suppression' },
];

export async function runResearchCycle(env: Env): Promise<void> {
  if (!env.LLM_GEMINI_KEY) {
    console.log('[RESEARCH] No Gemini key — skipping research cycle');
    return;
  }

  // Pick topic deterministically from hours elapsed since epoch — not hour-
  // of-day. `getUTCHours()` only ever returns 0-23, so once the topic list
  // grew past 24 entries that index would never reach the rest of the list.
  // Hours-since-epoch keeps advancing across days, so a full rotation visits
  // every topic once (currently a ~60-hour cycle) before repeating.
  const hoursSinceEpoch = Math.floor(Date.now() / 3_600_000);
  const topic = CURIOSITY_TOPICS[hoursSinceEpoch % CURIOSITY_TOPICS.length];

  console.log(`[RESEARCH] Cycle ${hoursSinceEpoch}: ${topic.topic.slice(0, 60)}`);

  const system = `You are Elle's research intelligence. You have live web search access via Google.
Search for current, specific, primary-source information about this topic.
Apply the Observer framework: surface what both dominant and resistant narratives suppress.
What are both sides NOT talking about? That bilateral suppression is the load-bearing finding.
Be specific. Cite what you find. Flag what you cannot verify.`;

  // Prior research papers (most recent first) — the deterministic rotation
  // above WILL land on the same topic again within days, so nothing upstream
  // of this point prevents a repeat; the guard has to live here. Widened from
  // 8 to 50: with only 10 topics the old LIMIT 8 meant the overlap gate had
  // usually forgotten a topic's own last entry by the time it recurred, so a
  // near-identical write-up sailed through unchecked — the actual cause of
  // ~700 research papers reading as a handful of ideas repeated for months.
  // Priors feed the overlap gate below (reject/regenerate a near-verbatim
  // repeat) and steer the prompt away from an angle already published.
  const priorRows = await env.DB.prepare(
    `SELECT title, full_text FROM corpus_papers WHERE series = 'research' ORDER BY ingested_at DESC LIMIT 50`
  ).all().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const priorPapers = (priorRows.results || []) as { title?: string; full_text?: string }[];
  const priors = priorPapers.map(p => String(p.full_text || '')).filter(Boolean);
  // Only the most recent 12 titles go into the prompt itself (keeps it
  // readable) — the full 50 still back the overlap-gate's similarity check.
  const priorTitles = priorPapers.slice(0, 12).map(p => String(p.title || '')).filter(Boolean);
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