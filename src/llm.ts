// ============================================================
// ELLE LLM ROUTER — src/llm.ts
//
// Provider routing:
//   conversation    → OpenRouter (Nemotron Ultra free)
//   reasoning       → Gemini 2.5 Flash (thinking mode, no search)
//   research        → Gemini 2.5 Flash (thinking + Google Search grounding)
//   code            → Qwen3-Coder free (1M ctx, /think prefix)
//   fast/tutor      → OpenRouter Llama 3.3 70B free
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
// Self-hosted last resort — used ONLY when every hosted free tier above is
// rate-limited/exhausted at once (see callLLM):
//   LLM_OLLAMA_URL         = https://<your-ollama-host>   (e.g. a CF Tunnel)
//   LLM_OLLAMA_KEY         = <bearer>                      (optional, if gated)
//   LLM_MODEL_OLLAMA       = llama3.3:70b                  (70B instruct)
//
// NOTE: model ids are validated/remapped through normalizeModel() below, so a
// stale or invalid id in a Worker secret (e.g. a Nemotron id OpenRouter 404s on)
// is corrected at call time instead of taking the whole conversation path down.
// ============================================================

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
}

// ── Model name helpers ────────────────────────────────────────
// Defaults are the live, currently-valid ids for each tier.
const DEFAULT_PRIMARY   = 'nvidia/llama-3.1-nemotron-ultra-253b-v1:free';
const DEFAULT_FAST      = 'meta-llama/llama-3.3-70b-instruct:free';
const DEFAULT_CODE      = 'qwen/qwen3-coder:free';
const DEFAULT_REASONING = 'gemini-2.5-flash';
const DEFAULT_OLLAMA    = 'llama3.3:70b'; // 70B instruct; override per host with LLM_MODEL_OLLAMA

// Known-dead / legacy model ids that a stale Worker secret may still carry.
// They are remapped to the live id at call time so a bad secret can never take
// the conversation path down — the single biggest cause of "load or request
// failure" in the chat + dev console.
const MODEL_ALIASES: Record<string, string> = {
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
};

// ── OpenRouter (general conversation, code, fast) ─────────────
// OpenAI-compatible. One key covers all free models.
export async function callOpenRouter(
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv
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
      'X-Title': 'Elle — Observer Foundation',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...finalMessages],
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as {
    choices: Array<{ message: { content: string; reasoning?: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);

  const choice = data.choices?.[0]?.message;
  let content = choice?.content || '';
  let thinking: string | undefined;

  // Extract <think>...</think> block if present (Qwen3/reasoning models)
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  // Some models return reasoning in a separate field
  if (!thinking && choice?.reasoning) thinking = choice.reasoning;

  return { content, thinking, model, provider: 'openrouter' };
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
  opts: { thinking?: boolean; search?: boolean } = {}
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
      temperature: 0.7,
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

  const content = responseParts.map(p => p.text || '').join('');
  const thinking = thinkingParts.length > 0
    ? thinkingParts.map(p => p.text || '').join('')
    : undefined;

  // Extract grounded search results
  const searchResults = candidate?.groundingMetadata?.searchEntryPoint?.renderedContent;

  return {
    content,
    thinking,
    search_results: searchResults,
    model,
    provider: 'gemini',
  };
}

// ── Grok (xAI) — thinking + web search fallback ───────────────
export async function callGrok(
  model: string,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv,
  opts: { thinking?: boolean; search?: boolean } = {}
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
      temperature: opts.thinking ? 1 : 0.7,
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
    content: msg?.content || '',
    thinking: msg?.reasoning_content,
    model,
    provider: 'grok',
  };
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
  env: LLMEnv
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
      options: { temperature: 0.7, num_predict: maxTokens },
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);

  let content = data.message?.content || '';
  let thinking: string | undefined;
  // Reasoning models (e.g. a distilled R1 70B) wrap CoT in <think>…</think>.
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  return { content, thinking, model, provider: 'ollama' };
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
  env: LLMEnv
): Promise<LLMResponse> {
  try {
    return await routeLLM(task, system, messages, maxTokens, env);
  } catch (e) {
    const msg = (e as Error).message;
    if (env.LLM_OLLAMA_URL) {
      console.error(`All hosted providers failed for ${task}; falling back to Ollama:`, msg);
      return callOllama(MODEL.ollama(env), system, messages, maxTokens, env);
    }
    throw e;
  }
}

async function routeLLM(
  task: LLMTask,
  system: string,
  messages: LLMMessage[],
  maxTokens: number,
  env: LLMEnv
): Promise<LLMResponse> {
  switch (task) {
    // Research: Gemini with thinking + Google Search grounding
    case 'research': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: true, search: true });
        } catch (e) {
          console.error('Gemini research failed, falling back:', (e as Error).message);
        }
      }
      // Fallback: Grok with search
      if (env.LLM_GROK_KEY) {
        try {
          return await callGrok('grok-3-mini', system, messages, maxTokens, env, { thinking: true, search: true });
        } catch (e) {
          console.error('Grok research failed, falling back:', (e as Error).message);
        }
      }
      // Last resort: OpenRouter without search
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env);
    }

    // Reasoning: Gemini thinking mode, no search
    case 'reasoning': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: true, search: false });
        } catch (e) {
          console.error('Gemini reasoning failed, falling back:', (e as Error).message);
        }
      }
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env);
    }

    // Code: Qwen3-Coder → Gemini → Nemotron primary. Each tier is independently
    // wrapped, so a 429/quota error on any one provider falls through to the next
    // instead of throwing out of the whole chain.
    case 'code': {
      try {
        return await callOpenRouter(MODEL.code(env), system, messages, maxTokens, env);
      } catch (e) {
        console.error('OpenRouter code (qwen) failed, falling back:', (e as Error).message);
      }
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: false, search: false });
        } catch (e) {
          console.error('Gemini code fallback failed, falling back to Grok:', (e as Error).message);
        }
      }
      if (env.LLM_GROK_KEY) {
        try {
          return await callGrok('grok-3-mini', system, messages, maxTokens, env, { thinking: false, search: false });
        } catch (e) {
          console.error('Grok code fallback failed, falling back to OpenRouter primary:', (e as Error).message);
        }
      }
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env);
    }

    // Fast: Llama 3.3 70B — tutor, thread summaries
    case 'fast': {
      return callOpenRouter(MODEL.fast(env), system, messages, maxTokens, env);
    }

    // Trading: Gemini thinking (no search — uses Alpaca data directly)
    case 'trading': {
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: true, search: false });
        } catch (e) {
          console.error('Gemini trading failed, falling back:', (e as Error).message);
        }
      }
      return callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env);
    }

    // Conversation: Nemotron Ultra free — primary voice of Elle.
    // Falls back to Gemini (free, much larger daily quota) when OpenRouter
    // is rate-limited (free tier = 50/day), so Elle stays queryable.
    case 'conversation':
    default: {
      try {
        return await callOpenRouter(MODEL.primary(env), system, messages, maxTokens, env);
      } catch (e) {
        console.error('OpenRouter conversation failed, falling back to Gemini:', (e as Error).message);
      }
      if (env.LLM_GEMINI_KEY) {
        try {
          return await callGemini(MODEL.reasoning(env), system, messages, maxTokens, env, { thinking: false, search: false });
        } catch (e) {
          console.error('Gemini conversation fallback failed, falling back to Grok:', (e as Error).message);
        }
      }
      if (env.LLM_GROK_KEY) {
        try {
          return await callGrok('grok-3-mini', system, messages, maxTokens, env, { thinking: false, search: false });
        } catch (e) {
          console.error('Grok conversation fallback failed, falling back to Llama:', (e as Error).message);
        }
      }
      // Last resort: Llama 3.3 70B — a separate free pool from Nemotron, so Elle
      // stays queryable even when the primary, Gemini, and Grok are all unavailable.
      return callOpenRouter(MODEL.fast(env), system, messages, maxTokens, env);
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
function firstJsonObjectFrom(text: string): Record<string, unknown> | null {
  const s = text.replace(/```json|```/g, '');
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

export function sanitizeAnswer(raw: string): string {
  let s = (raw || '').trim();
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
  return s;
}
