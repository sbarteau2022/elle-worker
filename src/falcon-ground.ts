// ============================================================
// THE MATERIAL GROUND — src/falcon-ground.ts
//
// The Falcon cannot fire without grounding. Tier 1 is named "Material Ground"
// but for its whole life it gathered nothing: six axes narrated market facts,
// financials, and history from the model's prior, with no retrieval and no
// citations. This module is the ground the name always promised.
//
// Before any axis fires, gatherMaterialGround runs a REAL research sweep — the
// search-grounded 'research' task (Gemini/Grok + web search), iterated to
// saturation: each pass is told what it already found and asked what is missing,
// and the loop stops when a pass surfaces no new sources. It also pulls the
// sealed-corpus look-back (corpusSourcesFor) — the historical dimension Tier 2
// reads the pattern back through.
//
// The firing gate is hard: grounding counts ONLY when the sweep returned real
// cited search results. The 'research' task's last resort is a search-LESS model
// that returns fluent prose with no sources — that path is treated as UNGROUNDED,
// so a provider outage makes the Falcon REFUSE to run (GroundingUnavailableError)
// rather than fabricate. Better silent than confabulating.
// ============================================================

import { callLLM, type LLMEnv } from './llm';
import { parseFirstJson } from './falcon';
import { extractBlanketModel, completenessFromExtraction, type BlanketModel, type BlanketEnv } from './observer-blanket';

export interface GroundEnv extends LLMEnv { DB: D1Database; }

// A single retrieved fact, tied to where it came from — the unit the axes cite.
export interface GroundFinding { claim: string; source?: string; dimension?: string }
export interface CorpusMatch { title: string; series: string; text: string; score: number }

export interface MaterialGround {
  grounded: boolean;            // true ONLY if the sweep returned real cited search results
  findings: GroundFinding[];    // deduped cited facts across the dimensions
  sources: string[];           // deduped source list (the citation set)
  corpus: CorpusMatch[];        // sealed-corpus look-back (historical dimension)
  passes: number;               // how many sweep passes ran before saturation
  provider: string;             // which research provider actually served (for diagnosis)
  searchProse: string;          // the raw grounded search text, kept for the axes
}

// Thrown when the sweep could not gather real grounding. The message names the
// provider state so an outage is diagnosable, not just a dead engine.
export class GroundingUnavailableError extends Error {
  constructor(public provider: string) {
    super(`grounding_unavailable — the Falcon cannot fire without a real research sweep, and no search-grounded provider returned sources (last provider: ${provider}). Bring Gemini or Grok search online, then retry.`);
    this.name = 'GroundingUnavailableError';
  }
}

const MAX_PASSES = 3;

const SWEEP_SYSTEM =
`You are the Material Ground sweep for a product-intelligence engine. Gather the HARD, CITED, factual ground for the given direction — never opinion, never the builder's story back to them.
Cover these dimensions: MARKET (who controls what, real share, what actually happens), FINANCIAL (capital flows, funding, unit economics, real numbers), NETWORK (actual power relationships), HISTORICAL (prior iterations of this exact configuration), IMPACT (documented effects on real people).
Cite a primary source for every claim. Flag anything you cannot verify rather than asserting it. Prefer specific numbers, named entities, and dated events over generalities.
Respond ONLY with valid JSON: {"findings":[{"claim":"a specific, checkable fact","source":"the primary source (name/outlet/filing)","dimension":"market|financial|network|historical|impact"}],"coverage_gaps":["what remains unverified or unfound"]}. No commentary.`;

// Dedupe helpers — pure, unit-testable. Sources dedupe case-insensitively on a
// trimmed key; findings dedupe on their claim text.
export function dedupeSources(sources: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const s of sources) {
    const key = String(s || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(String(s).trim());
  }
  return out;
}
function dedupeFindings(findings: GroundFinding[]): GroundFinding[] {
  const seen = new Set<string>(); const out: GroundFinding[] = [];
  for (const f of findings) {
    const key = String(f.claim || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(f);
  }
  return out;
}

// The saturation sweep. Iterates the search-grounded research task, feeding back
// what was already found and asking for what is missing, until a pass adds no
// new sources (or MAX_PASSES). Grounding is real ONLY when search_results came
// back non-empty — the search-less fallback yields grounded=false.
export async function gatherMaterialGround(env: GroundEnv, direction: string): Promise<MaterialGround> {
  const findings: GroundFinding[] = [];
  let sources: string[] = [];
  let searchProse = '';
  let provider = 'none';
  let sawRealSearch = false;
  let passes = 0;

  for (let p = 0; p < MAX_PASSES; p++) {
    const known = sources.length
      ? `\n\nAlready gathered (${sources.length} sources):\n${findings.slice(0, 20).map(f => `- ${f.claim} [${f.source || '?'}]`).join('\n')}\n\nWhat is STILL missing or unverified? Return only NEW findings.`
      : '';
    const user = `Direction: "${direction}"${known}`;
    let res;
    try {
      res = await callLLM('research', SWEEP_SYSTEM, [{ role: 'user', content: user }], 1600, env);
    } catch {
      break; // provider threw — stop; grounded stays false unless a prior pass hit
    }
    passes = p + 1;
    provider = res.provider || provider;
    // Real grounding proof: the search-grounded providers populate search_results.
    // The search-less last resort leaves it empty — that does NOT count as ground.
    if (res.search_results && res.search_results.trim()) {
      sawRealSearch = true;
      searchProse += (searchProse ? '\n\n' : '') + res.search_results.trim();
    }
    const parsed = parseFirstJson(res.content) as { findings?: GroundFinding[] } | null;
    const fresh = Array.isArray(parsed?.findings) ? parsed!.findings : [];
    const beforeSources = sources.length;
    for (const f of fresh) {
      if (!f?.claim) continue;
      findings.push({ claim: String(f.claim).slice(0, 400), source: f.source ? String(f.source).slice(0, 200) : undefined, dimension: f.dimension });
      if (f.source) sources.push(String(f.source));
    }
    findings.splice(0, findings.length, ...dedupeFindings(findings));
    sources = dedupeSources(sources);
    if (sources.length === beforeSources) break; // saturated — this pass added nothing new
  }

  // The historical dimension — the sealed corpus look-back (fail-soft to []).
  let corpus: CorpusMatch[] = [];
  try {
    const { corpusSourcesFor } = await import('./corpus-reasoning');
    const matches = await corpusSourcesFor(env as unknown as Parameters<typeof corpusSourcesFor>[0], direction, 8);
    corpus = (matches || []).map(m => ({ title: m.title, series: m.series, text: String(m.text).slice(0, 600), score: m.score }));
  } catch { /* no corpus dimension — the web sweep still decides grounding */ }

  return { grounded: sawRealSearch, findings, sources, corpus, passes, provider, searchProse };
}

// The firing gate. Hard-fails the run if the sweep did not gather real grounding.
export function assertGrounded(ground: MaterialGround): void {
  if (!ground.grounded) throw new GroundingUnavailableError(ground.provider);
}

// The reference block folded into the axis prompts — the evidence the axes must
// reason over. Instructs grounding, not invention. Kept compact to fit the
// free-tier context of the 'fast' axes.
export function groundToBlock(ground: MaterialGround): string {
  const facts = ground.findings.slice(0, 24).map((f, i) => `[${i + 1}] (${f.dimension || 'general'}) ${f.claim}${f.source ? ` — ${f.source}` : ''}`).join('\n');
  const hist = ground.corpus.slice(0, 6).map(m => `- [${m.title}] ${m.text.slice(0, 200)}`).join('\n');
  return [
    `MATERIAL GROUND — ${ground.findings.length} cited findings from ${ground.sources.length} sources (${ground.passes} sweep pass${ground.passes === 1 ? '' : 'es'}).`,
    `Ground every claim in this evidence. Where a claim is not supported here, mark it inferred — do not invent facts, numbers, or sources.`,
    ``,
    facts || '(no findings)',
    hist ? `\nHISTORICAL LOOK-BACK (sealed corpus):\n${hist}` : '',
  ].join('\n');
}

// The nested-Markov-blanket world-model (rec C): reuse the Observer's validated
// extractor via a thin adapter, so Tier 2 reads the human agents as nested
// self-optimizing silos. Feeds the material ground + Tier-1 synthesis into the
// same EXTRACTION_SYSTEM. Best-effort: returns null on trouble (never fails a
// run — grounding already gated firing; this is enrichment).
export async function extractFalconBlanket(
  env: GroundEnv, ground: MaterialGround, tier1Summary: string,
): Promise<{ model: BlanketModel; completeness: number } | null> {
  const structural = {
    material_ground: ground.findings.map(f => f.claim),
    historical: ground.corpus.map(m => m.text),
    tier1: tier1Summary.slice(0, 4000),
  };
  const model = await extractBlanketModel(env as unknown as BlanketEnv, { structural, dissent: null, prediction: null });
  if (!model) return null;
  return { model, completeness: completenessFromExtraction(model) };
}
