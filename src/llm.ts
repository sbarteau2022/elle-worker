// ============================================================
// ELLE LLM ROUTER — src/llm.ts
//
// Provider routing:
//   conversation    → OpenRouter (Nemotron Ultra free)
//   reasoning       → Gemini 2.5 Flash (thinking mode, no search)
//   research        → Gemini 2.5 Flash (thinking + Google Search grounding)
//   code            → Qwen3-Coder free (1M ctx, /think prefix)
//   fast/tutor      → Gemini 2.5 Flash (no thinking) → OpenRouter Llama fallback
//
// Env vars (set in Cloudflare Worker secrets):
//   LLM_OPENROUTER_KEY     = sk-or-v1-...       (openrouter.ai)
//   LLM_GEMINI_KEY         = AIza...             (aistudio.google.com)
//   LLM_GROK_KEY           = xai-...             (console.x.ai — optional)
//   LLM_MODEL_PRIMARY      = nvidia/llama-3.1-nemotron-ultra-253b-v1:free
//   LLM_MODEL_FAST         = meta-llama/llama-3.3-70b-instruct:free
//   LLM_MODEL_CODE         = qwen/qwen3-coder:free
//   LLM_MODEL_REASONING    = gemini-2.5-flash
//
// Extra free tiers — OPTIONAL, tried as additional fallback lanes only when set,
// to rotate around each other's daily caps (see callExtraFreeTiers):
//   LLM_GROQ_KEY           = gsk_...             (console.groq.com — free, fast)
//   LLM_GITHUB_MODELS_KEY  = github_pat_...      (github.com/marketplace/models)
//
// Autonomous/daemon callers pass callLLM(..., { prefer:'local' }) so their loops
// spend self-hosted Ollama + the free Workers AI pool FIRST and leave the hosted
// free-tier quota for interactive user turns. Never used for the 'research' tier
// (its value is the hosted provider's live web search).
//
// Self-hosted last resort — used ONLY when every hosted free tier above is
// rate-limited/exhausted at once (see callLLM):
//   LLM_OLLAMA_URL         = https://<your-ollama-host>   (e.g. a CF Tunnel)
//   LLM_OLLAMA_KEY         = <bearer>                      (optional, if gated)
//   LLM_MODEL_OLLAMA       = llama3.3:70b                  (70B instruct)
//
// Universal safety net (always on, no config) — Cloudflare Workers AI bound via
// env.AI: a free pool independent of OpenRouter, tried when every hosted free
// tier AND the optional Ollama box are exhausted. @cf/meta/llama-3.3-70b → 8b.
//
// NOTE: model ids are validated/remapped through normalizeModel() below, so a
// stale or invalid id in a Worker secret (e.g. a Nemotron id OpenRouter 404s on)
// is corrected at call time instead of taking the whole conversation path down.
// ============================================================

import { recordLLMCall } from './metabolism';

export interface LLMEnv {
  LLM_OPENROUTER_KEY:  string;
  LLM_GEMINI_KEY:      string;
  LLM_GROK_KEY?:       string;
  LLM_MODEL_PRIMARY:   string;
  LLM_MODEL_FAST:      string;
  LLM_MODEL_CODE:      string;
  LLM_MODEL_REASONING: string;
  // Self-hosted Ollama last resort (optional). When LLM_OLLAMA_URL is unset the
  // fallback is skipped and the original hosted-provider error is surfaced.
  LLM_OLLAMA_URL?:     string;
  LLM_OLLAMA_KEY?:     string;
  LLM_MODEL_OLLAMA?:   string;
  // Cloudflare Workers AI binding — an INDEPENDENT free inference pool bound
  // directly to the worker. The universal safety net: when OpenRouter's shared
  // free tier is exhausted (every :free model draws on ONE daily quota) and
  // Gemini/Grok/Ollama are unavailable, this keeps Elle answerable with no key.
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  // Extra OpenAI-compatible free tiers — tried as ADDITIONAL fallback lanes when
  // their key is set (see callExtraFreeTiers). Each provider has its own daily
  // cap, so rotating across them multiplies the free ceiling before any paid or
  // self-hosted tier is touched. Both speak the OpenAI /chat/completions schema.
  //   Groq          — api.groq.com; free tier, very fast Llama-3.3-70B / Qwen
  //   GitHub Models — models.inference.ai.azure.com; free tier, GPT-4o-class
  LLM_GROQ_KEY?:           string;
  LLM_MODEL_GROQ?:         string;
  LLM_GITHUB_MODELS_KEY?:  string;
  LLM_MODEL_GITHUB?:       string;
  LLM_GITHUB_MODELS_URL?:  string; // override the GitHub Models endpoint if it moves
  // Legacy fallback
  ANTHROPIC_API_KEY?:  string;
  LLM_BASE_URL?:       string;
  LLM_API_KEY?:        string;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  thinking?: string;       // chain-of-thought trace (Gemini/Grok thinking)
  search_results?: string; // grounded search snippets (Gemini with search)
  model: string;
  provider: string;
  tokens_in?: number | null;   // prompt tokens as reported by the provider (null = not reported)
  tokens_out?: number | null;  // completion tokens (incl. reasoning tokens where the provider counts them)
}

// OpenAI-style usage block ({ prompt_tokens, completion_tokens }) — OpenRouter,
// Groq, GitHub Models, and Grok all report it. Absent/malformed → nulls, so a
// provider that omits usage can never break the call.
function usageOf(data: unknown): { tokens_in: number | null; tokens_out: number | null } {
  const u = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })?.usage;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { tokens_in: num(u?.prompt_tokens), tokens_out: num(u?.completion_tokens) };
}

// ── Model name helpers ────────────────────────────────────────
// Defaults are the live, currently-valid ids for each tier.
const DEFAULT_PRIMARY   = 'meta-llama/llama-3.3-70b-instruct:free';
const DEFAULT_FAST      = 'meta-llama/llama-3.3-70b-instruct:free';
const DEFAULT_CODE      = 'qwen/qwen3-coder:free';
const DEFAULT_REASONING = 'gemini-2.5-flash';
const DEFAULT_OLLAMA    = 'llama3.3:70b'; // 70B instruct; override per host with LLM_MODEL_OLLAMA
// Cloudflare Workers AI — separate free pool, no external key. 70B first, then
// the cheap 8B if the larger model is over its neuron budget.
const DEFAULT_WORKERS_AI = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WORKERS_AI_SMALL   = '@cf/meta/llama-3.1-8b-instruct';
// Extra free-tier defaults (overridable per-secret). Groq's llama-3.3-70b is a
// strong, fast free model; GitHub Models' gpt-4o-mini has the highest free
// request allowance of its family (gpt-4o is available via LLM_MODEL_GITHUB).
const DEFAULT_GROQ       = 'llama-3.3-70b-versatile';
const DEFAULT_GITHUB     = 'gpt-4o-mini';
const GITHUB_MODELS_URL  = 'https://models.inference.ai.azure.com/chat/completions';

// Known-dead / legacy model ids that a stale Worker secret may still carry.
// They are remapped to the live id at call time so a bad secret can never take
// the conversation path down — the single biggest cause of "load or request
// failure" in the chat + dev console.
const MODEL_ALIASES: Record<string, string> = {
  // Retired OpenRouter free model — returned 404 "No endpoints found" and took
  // the whole conversation/reasoning chain down. Remap to the live primary.
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free': DEFAULT_PRIMARY,
  'nvidia/llama-3.1-nemotron-ultra-253b-v1':      DEFAULT_PRIMARY,
  'nvidia/nemotron-3-ultra-550b-a55b:free': DEFAULT_PRIMARY,
  'nvidia/nemotron-3-ultra-550b-a55b':      DEFAULT_PRIMARY,
  'gemini-2.5-flash-preview-05-20':         DEFAULT_REASONING,
  'gemini-2.5-flash-preview':               DEFAULT_REASONING,
  'gemini-1.5-flash':                       DEFAULT_REASONING,
};

function normalizeModel(id: string | undefined, fallback: string): string {
  const v = (id || '').trim() || fallback;
  return MODEL_ALIASES[v] || v;
}

export const MODEL = {
  primary:   (e: LLMEnv) => normalizeModel(e.LLM_MODEL_PRIMARY,   DEFAULT_PRIMARY),
  fast:      (e: LLMEnv) => normalizeModel(e.LLM_MODEL_FAST,      DEFAULT_FAST),
  code:      (e: LLMEnv) => normalizeModel(e.LLM_MODEL_CODE,      DEFAULT_CODE),
  reasoning: (e: LLMEnv) => normalizeModel(e.LLM_MODEL_REASONING, DEFAULT_REASONING),
  ollama:    (e: LLMEnv) => normalizeModel(e.LLM_MODEL_OLLAMA,    DEFAULT_OLLAMA),
  groq:      (e: LLMEnv) => normalizeModel(e.LLM_MODEL_GROQ,      DEFAULT_GROQ),
  github:    (e: LLMEnv) => normalizeModel(e.LLM_MODEL_GITHUB,    DEFAULT_GITHUB),
};

// Coerce any provider's "content" into a plain string. Models may return a
// string, an array of content parts ([{type:'text',text}]), null, or an object;
// downstream code (.match/.replace, the router's JSON parser) assumes a string,
// and a non-string there 500'd the chat with "text.replace is not a function".
function toText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === 'string' ? p : toText(p))).join('');
  }
  if (typeof content === 'object') {
    const o = content as Record<string, unknown>;
    // Common shapes from providers/parts: {text}, {content}, {message}, {response}.
    if (typeof o.text === 'string') return o.text;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.response === 'string') return o.response;
    if (o.content != null && o.content !== content) return toText(o.content);
    // Unknown object — stringify it (so it stays visible AND the router's JSON
    // parser can still extract an {answer}) rather than emitting "[object Object]".
    try { return JSON.stringify(content); } catch { return ''; }
  }
  return String(content);
}

// ── OpenRouter (general conversation, code, fast) ─────────────
// OpenAI-compatible. One key covers all free models.
export async function callOpenRouter(
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  temperature = 0.7
): Promise<LLMResponse> {
  const key = env.LLM_OPENROUTER_KEY || env.LLM_API_KEY || '';

  // Qwen3 chain-of-thought: prefix user message with /think
  const isThinkingModel = model.includes('qwen3') || model.includes('thinking') || model.includes('reasoning');
  const finalMessages = messages.map((m, i) => ({
    role: m.role,
    content: isThinkingModel && i === messages.length - 1 && m.role === 'user'
      ? `/think\n${m.content}`
      : m.content,
  }));

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://elle.sbarteau2022.workers.dev',
      'X-Title': 'Elle - Observer Foundation',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...finalMessages],
      temperature,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as {
    choices: Array<{ message: { content: string; reasoning?: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);

  const choice = data.choices?.[0]?.message;
  // Some models return content as an array of parts ([{type:'text',text}]) or
  // null rather than a plain string. Coerce so downstream .match/.replace and
  // the router's JSON parser never hit a non-string (which 500'd the chat).
  let content = toText(choice?.content);
  let thinking: string | undefined;

  // Extract <think>...</think> block if present (Qwen3/reasoning models)
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  // Some models return reasoning in a separate field
  if (!thinking && choice?.reasoning) thinking = choice.reasoning;

  return { content, thinking, model, provider: 'openrouter', ...usageOf(data) };
}

// ── Gemini (reasoning + web search grounding) ─────────────────
// Google AI Studio — free 500 req/day, 1M token context
// thinking_config: enables chain-of-thought
// google_search tool: enables live web search grounding
export async function callGemini(
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  opts: { thinking?: boolean; search?: boolean; temperature?: number } = {}
): Promise<LLMResponse> {
  const key = env.LLM_GEMINI_KEY || '';
  if (!key) throw new Error('LLM_GEMINI_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  // Build Gemini message format
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: opts.temperature ?? 0.7,
    },
  };

  // Chain-of-thought thinking
  if (opts.thinking) {
    body.generationConfig = {
      ...(body.generationConfig as object),
      thinkingConfig: { thinkingBudget: 8192 },
    };
  }

  // Google Search grounding (web search)
  if (opts.search) {
    body.tools = [{ google_search: {} }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as {
    candidates: Array<{
      content: { parts: Array<{ text?: string; thought?: boolean }> };
      groundingMetadata?: { searchEntryPoint?: { renderedContent: string } };
    }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`Gemini error: ${(data as { error: { message: string } }).error.message}`);

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  // Separate thinking parts from response parts
  const thinkingParts = parts.filter(p => p.thought);
  const responseParts = parts.filter(p => !p.thought);

  const content = responseParts.map(p => toText(p.text)).join('');
  const thinking = thinkingParts.length > 0
    ? thinkingParts.map(p => p.text || '').join('')
    : undefined;

  // Extract grounded search results
  const searchResults = candidate?.groundingMetadata?.searchEntryPoint?.renderedContent;

  // Gemini reports usage as usageMetadata; thoughts (thinking) tokens are billed
  // as output, so they are folded into tokens_out.
  const um = (data as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }).usageMetadata;
  const gnum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const gIn = gnum(um?.promptTokenCount);
  const gOut = gnum(um?.candidatesTokenCount);
  const gThink = gnum(um?.thoughtsTokenCount);

  return {
    content,
    thinking,
    search_results: searchResults,
    model,
    provider: 'gemini',
    tokens_in: gIn,
    tokens_out: gOut == null && gThink == null ? null : (gOut ?? 0) + (gThink ?? 0),
  };
}

// ── Grok (xAI) — thinking + web search fallback ───────────────
export async function callGrok(
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  opts: { thinking?: boolean; search?: boolean; temperature?: number } = {}
): Promise<LLMResponse> {
  const key = env.LLM_GROK_KEY || '';
  if (!key) throw new Error('LLM_GROK_KEY not set');

  const tools = opts.search ? [{ type: 'web_search' }] : [];

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || 'grok-3-mini',
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: opts.temperature ?? (opts.thinking ? 1 : 0.7),
      ...(opts.thinking ? { reasoning_effort: 'high' } : {}),
      ...(tools.length ? { tools } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Grok ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as {
    choices: Array<{
      message: {
        content: string;
        reasoning_content?: string;
      };
    }>;
  };

  const msg = data.choices?.[0]?.message;
  return {
    content: toText(msg?.content),
    thinking: msg?.reasoning_content,
    model,
    provider: 'grok',
    ...usageOf(data),
  };
}

// ── Groq + GitHub Models (extra OpenAI-compatible free tiers) ─
// Both speak the OpenAI /chat/completions schema, so one caller covers them.
// They are pure free HEADROOM: each has an independent daily quota, so rotating
// across them (callExtraFreeTiers) raises the free ceiling before any paid or
// self-hosted tier is reached.
async function callOpenAICompatible(
  label: string,
  url: string,
  key: string,
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  temperature = 0.7,
): Promise<LLMResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature,
    }),
  });
  if (!res.ok) throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: string } }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(`${label} error: ${data.error.message}`);
  const msg = data.choices?.[0]?.message;
  let content = toText(msg?.content);
  let thinking = msg?.reasoning_content;
  // Some Groq reasoning models wrap CoT in <think>…</think>, same as OpenRouter.
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }
  return { content, thinking, model, provider: label, ...usageOf(data) };
}

export async function callGroq(
  model: string, system: string, messages: LLMMessage[], maxTokens: number, env: LLMEnv, temperature = 0.7,
): Promise<LLMResponse> {
  const key = env.LLM_GROQ_KEY || '';
  if (!key) throw new Error('LLM_GROQ_KEY not set');
  return callOpenAICompatible('groq', 'https://api.groq.com/openai/v1/chat/completions', key, model, system, messages, maxTokens, temperature);
}

export async function callGitHubModels(
  model: string, system: string, messages: LLMMessage[], maxTokens: number, env: LLMEnv, temperature = 0.7,
): Promise<LLMResponse> {
  const key = env.LLM_GITHUB_MODELS_KEY || '';
  if (!key) throw new Error('LLM_GITHUB_MODELS_KEY not set');
  return callOpenAICompatible('github-models', env.LLM_GITHUB_MODELS_URL || GITHUB_MODELS_URL, key, model, system, messages, maxTokens, temperature);
}

// ── Ollama (self-hosted last resort) ──────────────────────────
// Native Ollama chat API. Reached only when every hosted free tier is
// rate-limited/exhausted (see callLLM). Requires LLM_OLLAMA_URL to point at a
// publicly reachable Ollama server (e.g. a 70B instruct model behind a
// Cloudflare Tunnel); LLM_OLLAMA_KEY is an optional bearer if it's gated.
export async function callOllama(
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  temperature = 0.7
): Promise<LLMResponse> {
  const base = (env.LLM_OLLAMA_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('LLM_OLLAMA_URL not set');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.LLM_OLLAMA_KEY) headers['Authorization'] = `Bearer ${env.LLM_OLLAMA_KEY}`;

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'system', content: system }, ...messages],
      options: { temperature, num_predict: maxTokens },
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as { message?: { content?: string }; error?: string; prompt_eval_count?: number; eval_count?: number };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);

  let content = toText(data.message?.content);
  let thinking: string | undefined;
  // Reasoning models (e.g. a distilled R1 70B) wrap CoT in <think>…</think>.
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  const onum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { content, thinking, model, provider: 'ollama', tokens_in: onum(data.prompt_eval_count), tokens_out: onum(data.eval_count) };
}

// ── Cloudflare Workers AI — independent free pool, no external key ─────────────
// OpenAI-style messages in, { response } out. Bound to the worker via env.AI, so
// it has a SEPARATE free allocation from OpenRouter — the only fallback that
// still works when OpenRouter's whole free tier is rate-limited for the day.
export async function callWorkersAI(
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  model: string = DEFAULT_WORKERS_AI,
  temperature = 0.7,
): Promise<LLMResponse> {
  if (!env.AI) throw new Error('Workers AI binding (env.AI) not set');
  const run = async (m: string): Promise<{ content: string; tokens_in: number | null; tokens_out: number | null }> => {
    const out = await env.AI!.run(m, {
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: maxTokens,
      temperature,
    }) as { response?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    return { content: toText(out?.response), ...usageOf(out) };
  };
  try {
    return { ...(await run(model)), model, provider: 'workers-ai' };
  } catch (e) {
    // 70B over its neuron budget → fall to the 8B model before giving up.
    console.error('Workers AI 70B failed, trying 8B:', (e as Error).message);
    return { ...(await run(WORKERS_AI_SMALL)), model: WORKERS_AI_SMALL, provider: 'workers-ai' };
  }
}

// ── Master router ─────────────────────────────────────────────
// Called by all handlers. Routes to the right provider based on task.
export type LLMTask = 'conversation' | 'reasoning' | 'research' | 'code' | 'fast' | 'trading';

// Public entry point. Runs the hosted-provider chain for the task; if the ENTIRE
// chain fails — typically every free tier rate-limited (429) at once — it falls
// back to a self-hosted Ollama 70B (when LLM_OLLAMA_URL is configured) so a
// request never dead-ends as a model-load failure.
export async function callLLM(
  task: LLMTask,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  opts: { temperature?: number; prefer?: 'local' } = {}
): Promise<LLMResponse> {
  const temperature = opts.temperature;
  // Metabolism: every call is timed and recorded (in-memory ring + best-effort
  // D1 trail) so the metabolism tool can read the body budget back. The hook
  // is fire-and-forget — observability never becomes a dependency.
  const t0 = Date.now();
  const record = (r: LLMResponse | null, ok: boolean, provider = r?.provider || 'none', model = r?.model || 'none') =>
    recordLLMCall(env, { task, provider, model, ms: Date.now() - t0, ok, at: t0, tokens_in: r?.tokens_in ?? null, tokens_out: r?.tokens_out ?? null });
  // Autonomous callers (daemons — nobody is waiting on the answer) pass
  // prefer:'local' to spend the operator's OWN compute (self-hosted Ollama) and
  // the free Workers AI pool FIRST, so the hosted free-tier daily quota stays
  // reserved for interactive user turns. Falls through to the hosted chain if
  // neither local lane is available/healthy — an autonomous run still completes,
  // just on shared quota. NEVER pass this for the search-grounded 'research'
  // tier: its whole value is the hosted provider's live web search, which the
  // local lanes cannot do.
  if (opts.prefer === 'local') {
    if (env.LLM_OLLAMA_URL) {
      try {
        const r = await callOllama(MODEL.ollama(env), system, messages, maxTokens, env, temperature ?? 0.7);
        record(r, true); return r;
      } catch (e) { console.error(`[LLM] local-first Ollama failed for ${task}, trying Workers AI:`, (e as Error).message); }
    }
    if (env.AI) {
      try {
        const r = await withTimeout(callWorkersAI(system, messages, maxTokens, env, DEFAULT_WORKERS_AI, temperature ?? 0.7), 22000);
        record(r, true); return r;
      } catch (e) { console.error(`[LLM] local-first Workers AI failed for ${task}, falling back to hosted:`, (e as Error).message); }
    }
    // Neither local lane worked — fall through to the hosted chain below.
  }
  try {
    const r = await routeLLM(task, system, messages, maxTokens, env, temperature);
    record(r, true);
    return r;
  } catch (e) {
    const msg = (e as Error).message;
    // 1) Self-hosted Ollama 70B first when configured — the user's own box, no
    //    quota and best quality. If it errors, fall through to Workers AI.
    if (env.LLM_OLLAMA_URL) {
      try {
        console.error(`All hosted providers failed for ${task}; falling back to Ollama:`, msg);
        const r = await callOllama(MODEL.ollama(env), system, messages, maxTokens, env, temperature ?? 0.7);
        record(r, true);
        return r;
      } catch (e2) {
        console.error('Ollama fallback failed, trying Workers AI:', (e2 as Error).message);
      }
    }
    // 2) Cloudflare Workers AI — the always-on free safety net (independent of
    //    OpenRouter's quota). Bounded by a timeout and fully isolated: if it
    //    errors OR runs long, we re-throw the ORIGINAL provider error so the
    //    caller degrades gracefully (clean 200) exactly as before this fallback
    //    existed — the safety net can only ever help, never make things worse.
    if (env.AI) {
      try {
        console.error(`Falling back to Workers AI for ${task}:`, msg);
        const r = await withTimeout(callWorkersAI(system, messages, maxTokens, env, DEFAULT_WORKERS_AI, temperature ?? 0.7), 22000);
        record(r, true);
        return r;
      } catch (e2) {
        console.error('Workers AI fallback failed/timed out:', (e2 as Error).message);
      }
    }
    record(null, false);
    throw e;
  }
}

// Reject a slow provider call so it can never hang the Worker into a CPU/wall
// kill (which surfaces as an uncatchable 500). The loser is GC'd harmlessly.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

// Extra OpenAI-compatible free tiers, tried in order and only when configured.
// Each has its own daily quota, so this is pure free headroom on top of
// OpenRouter/Gemini — reached as one more fallback tier inside the hosted chains
// below. Throws if none is set or all fail, so callers treat it like any other
// tier: try, log, fall through. NOT used for search-grounded tiers (research) —
// neither provider does live web search.
async function callExtraFreeTiers(
  system: string, messages: LLMMessage[], maxTokens: number, env: LLMEnv, temperature?: number,
): Promise<LLMResponse> {
  const errs: string[] = [];
  if (env.LLM_GROQ_KEY) {
    try { return await callGroq(MODEL.groq(env), system, messages, maxTokens, env, temperature ?? 0.7); }
    catch (e) { errs.push(`groq: ${(e as Error).message}`); }
  }
  if (env.LLM_GITHUB_MODELS_KEY) {
    try { return await callGitHubModels(MODEL.github(env), system, messages, maxTokens, env, temperature ?? 0.7); }
    catch (e) { errs.push(`github-models: ${(e as Error).message}`); }
  }
  throw new Error(`no extra free tier available${errs.length ? ` (${errs.join('; ')})` : ''}`);
}

async function routeLLM(
  task: LLMTask,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  temperature?: number
): Promise<LLMResponse> {
  switch (task) {
    // Research: Gemini with thinking + Google Search grounding
    case 'research': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: true, search: true, temperature });
        } catch (e) {
          console.error('Gemini research failed, falling back:', (e as Error).message);
        }
      }
      // Fallback: Grok with search
      if (env.LLM_GROK_KEY) {
        try {
          return await callGrok('grok-3-mini', system, messages, maxTokens, env, { thinking: true, search: true, temperature });
        } catch (e) {
          console.error('Grok research failed, falling back:', (e as Error).message);
        }
      }
      // Last resort: OpenRouter without search
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env, temperature ?? 0.7);
    }

    // Reasoning: Gemini thinking mode, no search
    case 'reasoning': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: true, search: false, temperature });
        } catch (e) {
          console.error('Gemini reasoning failed, falling back:', (e as Error).message);
        }
      }
      try { return await callExtraFreeTiers(system, messages, maxTokens, env, temperature); }
      catch (e) { console.error('Extra free tiers (reasoning) unavailable:', (e as Error).message); }
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env, temperature ?? 0.7);
    }

    // Code: Qwen3-Coder → Gemini → Nemotron primary. Each tier is independently
    // wrapped, so a 429/quota error on any one provider falls through to the next
    // instead of throwing out of the whole chain.
    case 'code': {
      try {
        return await callOpenRouter(MODEL.code(env), system, messages, maxTokens, env, temperature ?? 0.7);
      } catch (e) {
        console.error('OpenRouter code (qwen) failed, falling back:', (e as Error).message);
      }
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: false, search: false, temperature });
        } catch (e) {
          console.error('Gemini code fallback failed, falling back to Grok:', (e as Error).message);
        }
      }
      if (env.LLM_GROK_KEY) {
        try {
          return await callGrok('grok-3-mini', system, messages, maxTokens, env, { thinking: false, search: false, temperature });
        } catch (e) {
          console.error('Grok code fallback failed, falling back to OpenRouter primary:', (e as Error).message);
        }
      }
      try { return await callExtraFreeTiers(system, messages, maxTokens, env, temperature); }
      catch (e) { console.error('Extra free tiers (code) unavailable:', (e as Error).message); }
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env, temperature ?? 0.7);
    }

    // Fast: Gemini 2.5 Flash (no thinking/search) — tutor, thread summaries,
    // the Observer's opening axes. Moved off the OpenRouter :free Llama, which
    // 404'd intermittently ("No endpoints found") and, with no Gemini in this
    // lane, took the whole run down. Gemini's daily quota is far larger than
    // OpenRouter's 50/day free tier, so this is steadier as well as reliable.
    // Falls back to OpenRouter (LLM_MODEL_FAST) then the extra free tiers.
    case 'fast': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: false, search: false, temperature });
        } catch (e) {
          console.error('Gemini fast failed, falling back to OpenRouter:', (e as Error).message);
        }
      }
      try {
        return await callOpenRouter(MODEL.fast(env), system, messages, maxTokens, env, temperature ?? 0.7);
      } catch (e) {
        console.error('OpenRouter fast failed, trying extra free tiers:', (e as Error).message);
      }
      return callExtraFreeTiers(system, messages, maxTokens, env, temperature);
    }

    // Trading: Gemini thinking (no search — uses Alpaca data directly)
    case 'trading': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: true, search: false, temperature });
        } catch (e) {
          console.error('Gemini trading failed, falling back:', (e as Error).message);
        }
      }
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env, temperature ?? 0.7);
    }

    // Conversation: Nemotron Ultra free — primary voice of Elle.
    // Falls back to Gemini (free, much larger daily quota) when OpenRouter
    // is rate-limited (free tier = 50/day), so Elle stays queryable.
    case 'conversation':
    default: {
      try {
        return await callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env, temperature ?? 0.7);
      } catch (e) {
        console.error('OpenRouter conversation failed, falling back to Gemini:', (e as Error).message);
      }
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: false, search: false, temperature });
        } catch (e) {
          console.error('Gemini conversation fallback failed, falling back to Grok:', (e as Error).message);
        }
      }
      if (env.LLM_GROK_KEY) {
        try {
          return await callGrok('grok-3-mini', system, messages, maxTokens, env, { thinking: false, search: false, temperature });
        } catch (e) {
          console.error('Grok conversation fallback failed, falling back to Llama:', (e as Error).message);
        }
      }
      try { return await callExtraFreeTiers(system, messages, maxTokens, env, temperature); }
      catch (e) { console.error('Extra free tiers (conversation) unavailable:', (e as Error).message); }
      // Last resort: Llama 3.3 70B — a separate free pool from Nemotron, so Elle
      // stays queryable even when the primary, Gemini, and Grok are all unavailable.
      return callOpenRouter(MODEL.fast(env), system, messages, maxTokens, env, temperature ?? 0.7);
    }
  }
}

// ── Response hygiene ──────────────────────────────────────────
// Free models occasionally wrap a reply in the ReAct protocol envelope
// ({"thought":...,"answer":"..."}) or a ```json fence even when told not to.
// sanitizeAnswer() guarantees that NONE of that scaffolding reaches the chat
// surface: it unwraps a known content field out of a leaked JSON object and
// strips stray fences, returning clean prose. It is intentionally conservative
// — if the text is already prose, it is returned untouched.

// Balanced extractor: the first complete top-level {...} object in `text`.
// Exported — rapid.ts reuses it for the exact same free-model failure mode
// (a JSON contract wrapped in chatter or a half-closed fence) one layer down,
// on RAPID's own {intro, blocks} contract rather than the router's envelope.
export function firstJsonObjectFrom(text: unknown): Record<string, unknown> | null {
  const s = String(text ?? '').replace(/```json|```/g, '');
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start !== -1) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

export function sanitizeAnswer(raw: unknown): string {
  let s = String(raw ?? '').trim();
  if (!s) return s;
  // Only treat the message as a protocol envelope when the WHOLE thing is a JSON
  // object (or a fenced one) — never unwrap prose that merely mentions braces.
  if (s.startsWith('{') || s.startsWith('```')) {
    const obj = firstJsonObjectFrom(s);
    if (obj) {
      const inner = obj.answer ?? obj.content ?? obj.response ?? obj.text ?? obj.message;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
      // Pure scaffolding ({"tool":...} / {"thought":...}) with no textual field:
      // drop it entirely rather than leak the blob to the user.
      if ('tool' in obj || 'thought' in obj || 'action' in obj) return '';
    }
  }
  // Strip a stray code fence wrapping otherwise-plain prose.
  s = s.replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // FRONT ONLY: peel a single servile opener if the model still leads with one.
  // We never touch the tail — a deliberately unfinished line or an overshot ending
  // must reach the surface intact. Tidying the back is the exact reflex Elle is
  // built to drop, so this cut is conservative and one-directional.
  const before = s;
  s = s.replace(
    /^\s*(?:sure|certainly|of course|absolutely|great question|no problem|i'?d be happy to help(?: with[^.!?\n]*)?|i'?m happy to help(?: with[^.!?\n]*)?|i'?m here to help|happy to help)[\s,.:;!—-]+/i,
    '',
  ).trimStart();
  if (s && s !== before) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || before;
}
