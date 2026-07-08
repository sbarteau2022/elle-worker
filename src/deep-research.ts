// ============================================================
// ELLE — deep research: chained multi-round web research in ONE tool call
// src/deep-research.ts
//
// web_search is one Gemini-grounded search — good for a fact, thin for an
// investigation. deep_research runs several rounds (search → spot the
// biggest remaining gap → search again → …) INSIDE a single tool call, so
// the outer ReAct loop spends only ONE of its ~10 steps on it no matter how
// many rounds run underneath — depth without eating the step budget. For
// investigations too large even for that, the right move is still filing an
// `intent`: the conductor's exploration lane already runs local-first and
// continues indefinitely across ticks, which is where "uncapped" actually
// belongs — see router.ts's tool catalog entry for `intent`.
//
// Mechanical sub-steps (spotting the gap between rounds) prefer the
// sovereign LOCAL model when the sandbox path is open — free, no provider
// quota — with a SHORT per-round timeout (not sandboxLLM's general 180s
// default): a multi-round tool call has to bound its worst case tightly, or
// one slow/busy laptop stalls the whole call instead of just one turn. Any
// local failure or timeout demotes that single round to hosted; it never
// blocks. The opening search and the closing synthesis always run hosted
// (quality matters most there) — only the "what's still missing" step in
// between is a demotion candidate.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { sandboxLLM, sandboxConfigured, pathOpen } from './connect-sandbox';

export const MAX_ROUNDS = 5;
export const DEFAULT_ROUNDS = 3;
const LOCAL_GAP_TIMEOUT_MS = 15_000; // fail fast to hosted rather than stall the call
const LOCAL_GAP_MAX_TOKENS = 128;    // one line out — this step is mechanical, not deep

export interface SearchFn {
  (query: string): Promise<{ content: string; search_results?: string }>;
}

interface Round { query: string; content: string; sources?: string }

export function clipText(s: string, n = 3000): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Pure — no I/O — so it's directly unit-testable.
export function parseNextQuery(text: string): string | null {
  const t = String(text || '').trim().replace(/^["']|["']$/g, '');
  if (!t || /^done\.?$/i.test(t)) return null;
  return clipText(t, 200);
}

async function hostedText(system: string, prompt: string, env: Env, maxTokens = 800): Promise<string> {
  const r = await callLLM('research', system, [{ role: 'user', content: prompt }], maxTokens, env);
  return r.content;
}

// Between rounds: what's the single most important gap still unanswered?
// Local-first (mechanical, short), demotes to hosted on any failure/timeout.
async function nextQuery(env: Env, topic: string, rounds: Round[]): Promise<string | null> {
  const soFar = rounds
    .map((r, i) => `Round ${i + 1} — searched "${r.query}":\n${clipText(r.content, 1200)}`)
    .join('\n\n');
  const system = 'You spot research gaps. Reply with ONE search query, or exactly DONE. Nothing else.';
  const prompt =
    `Topic: ${topic}\n\n${soFar}\n\n` +
    `In one short line, what's the single most important gap still unanswered — the next thing worth ` +
    `searching for? If nothing meaningful remains, reply exactly: DONE.`;

  if (sandboxConfigured(env)) {
    const st = await pathOpen(env).catch(() => ({ open: false }));
    if (st.open) {
      const local = await sandboxLLM(
        env, system, [{ role: 'user', content: prompt }], LOCAL_GAP_MAX_TOKENS, LOCAL_GAP_TIMEOUT_MS,
      ).catch(() => null);
      if (local?.ok && local.content) return parseNextQuery(local.content);
      // any local miss (closed path, timeout, empty reply) falls through to hosted below
    }
  }
  const hosted = await hostedText(system, prompt, env, LOCAL_GAP_MAX_TOKENS).catch(() => 'DONE');
  return parseNextQuery(hosted);
}

// The tool: topic in, a cited dossier out. search() is injected (matches the
// existing deps.handleResearch seam web_search uses) rather than imported
// directly, so this module stays independent of index.ts.
export async function deepResearch(
  env: Env, topic: string, search: SearchFn, maxRounds?: number,
): Promise<string> {
  const t = String(topic || '').trim();
  if (!t) return 'deep_research: topic required';
  const cap = Math.min(Math.max(Math.trunc(maxRounds ?? DEFAULT_ROUNDS), 1), MAX_ROUNDS);

  const rounds: Round[] = [];
  let query: string | null = t;
  for (let i = 0; i < cap && query; i++) {
    const r = await search(query).catch((e) => ({
      content: `(search failed: ${e instanceof Error ? e.message : String(e)})`,
      search_results: undefined as string | undefined,
    }));
    rounds.push({ query, content: r.content, sources: r.search_results });
    if (i < cap - 1) query = await nextQuery(env, t, rounds).catch(() => null);
  }

  if (rounds.length === 1) {
    return `${rounds[0].content}\n\nSOURCES:\n${rounds[0].sources || '(none)'}`;
  }

  const dossierSystem = 'You write research dossiers: precise, cited, honest about what is still uncertain.';
  const dossierPrompt =
    `Topic: ${t}\n\n` +
    rounds.map((r, i) => `── Round ${i + 1}: "${r.query}" ──\n${r.content}\nSOURCES: ${r.sources || '(none)'}`).join('\n\n') +
    `\n\nSynthesize the above into one coherent dossier: what's established, what's still contested or ` +
    `unverified, and the sources that matter most. Do not just restate each round — integrate them.`;
  const dossier = await hostedText(dossierSystem, dossierPrompt, env, 2048)
    .catch(() => rounds.map(r => r.content).join('\n\n'));

  const trail = rounds.map(r => `"${r.query}"`).join(' → ');
  return `[deep research — ${rounds.length} round(s): ${trail}]\n\n${dossier}`;
}
