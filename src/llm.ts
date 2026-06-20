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
//   LLM_MODEL_PRIMARY      = nvidia/nemotron-3-ultra-550b-a55b:free
//   LLM_MODEL_FAST         = meta-llama/llama-3.3-70b-instruct:free
//   LLM_MODEL_CODE         = qwen/qwen3-coder:free
//   LLM_MODEL_REASONING    = gemini-2.5-flash-preview-05-20
// ============================================================

export interface LLMEnv {
  LLM_OPENROUTER_KEY:  string;
  LLM_GEMINI_KEY:      string;
  LLM_GROK_KEY?:       string;
  LLM_MODEL_PRIMARY:   string;
  LLM_MODEL_FAST:      string;
  LLM_MODEL_CODE:      string;
  LLM_MODEL_REASONING: string;
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
export const MODEL = {
  primary:   (e: LLMEnv) => e.LLM_MODEL_PRIMARY   || 'nvidia/nemotron-3-ultra-550b-a55b:free',
  fast:      (e: LLMEnv) => e.LLM_MODEL_FAST       || 'meta-llama/llama-3.3-70b-instruct:free',
  code:      (e: LLMEnv) => e.LLM_MODEL_CODE       || 'qwen/qwen3-coder:free',
  reasoning: (e: LLMEnv) => e.LLM_MODEL_REASONING  || 'gemini-2.5-flash-preview-05-20',
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

// ── Master router ─────────────────────────────────────────────
// Called by all handlers. Routes to the right provider based on task.
export type LLMTask = 'conversation' | 'reasoning' | 'research' | 'code' | 'fast' | 'trading';

export async function callLLM(
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
          console.error('Gemini code fallback failed, falling back to OpenRouter primary:', (e as Error).message);
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
          console.error('Gemini conversation fallback failed, falling back to Llama:', (e as Error).message);
        }
      }
      // Last resort: Llama 3.3 70B — a separate free pool from Nemotron, so Elle
      // stays queryable even when both the primary and Gemini are rate-limited.
      return callOpenRouter(MODEL.fast(env), system, messages, maxTokens, env);
    }
  }
}