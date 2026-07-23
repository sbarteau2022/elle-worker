#!/usr/bin/env node
// ============================================================
// W0.2 — JSON-schema adherence probe (Phase 0 of the together-cookbook port).
//
// Fires N calls at a model with a 3-field structured-output request (mirrors
// the cookbook's ModelOutput router schema) and measures the parse-failure
// rate, using the SAME extraction logic jsonLLM() uses in src/llm.ts
// (a balanced-brace scan, not JSON.parse on the raw string) so the number
// reflects what jsonLLM will actually see in production.
//
// The plan calls for probing DeepSeek V4 Pro. That model does not exist in
// this codebase (verified: zero references anywhere in elle-worker) — the
// real interactive-tier chain is OpenRouter -> Gemini -> Grok -> free tiers
// -> Workers AI (src/llm.ts). This script targets Gemini because it is the
// only hosted provider host this sandbox's network policy allows outbound
// to (api.cloudflare.com and openrouter.ai both returned 403 from the proxy
// at time of writing). Re-run against OpenRouter's llama-3.3-70b-instruct
// (the actual primary conversation-tier model) from an environment that can
// reach openrouter.ai before treating this as the final W0.2 number.
//
// Usage: LLM_GEMINI_KEY=... node scripts/json-adherence-probe.mjs [N]
// ============================================================

const N = Number(process.argv[2] || 50);
const KEY = process.env.LLM_GEMINI_KEY;
const MODEL = process.env.LLM_MODEL_REASONING || 'gemini-2.5-flash';

if (!KEY) {
  console.error('LLM_GEMINI_KEY not set — cannot run probe.');
  process.exit(1);
}

// Same balanced-brace scan as firstJsonObjectFrom() in src/llm.ts.
function firstJsonObjectFrom(text) {
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

// 3-field schema, mirroring the cookbook's ModelOutput router shape:
// { selected_route: enum, confidence: number, reasoning: string }
const ROUTES = ['billing', 'support', 'sales', 'technical'];
const PROMPTS = [
  'A customer says: "my invoice charged me twice this month."',
  'A customer says: "how do I reset my password, I keep getting locked out?"',
  'A customer says: "I want to talk to someone about upgrading my plan."',
  'A customer says: "the API is returning 500 errors on every request since this morning."',
  'A customer says: "can you explain what this line item on my bill is for?"',
];

function validate(obj) {
  if (!obj || typeof obj !== 'object') return 'not an object';
  if (!ROUTES.includes(obj.selected_route)) return `selected_route not one of ${ROUTES.join(',')}`;
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) return 'confidence not a number in [0,1]';
  if (typeof obj.reasoning !== 'string' || !obj.reasoning.trim()) return 'reasoning not a non-empty string';
  return null;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    system_instruction: {
      parts: [{
        text: 'You are a support ticket router. Given the routes billing, support, sales, technical, ' +
          'respond with ONLY a single valid JSON object: {"selected_route": <one of the routes>, ' +
          '"confidence": <0-1 number>, "reasoning": <short string>}. No prose, no markdown fences.',
      }],
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought).map(p => p.text || '').join('');
}

async function main() {
  let failures = 0;
  const failureReasons = [];
  for (let i = 0; i < N; i++) {
    const prompt = PROMPTS[i % PROMPTS.length];
    try {
      const text = await callGemini(prompt);
      const obj = firstJsonObjectFrom(text);
      const err = validate(obj);
      if (err) {
        failures++;
        failureReasons.push(`call ${i}: ${err} — raw: ${text.slice(0, 120)}`);
      }
    } catch (e) {
      failures++;
      failureReasons.push(`call ${i}: request error — ${e.message}`);
    }
    // Stay well under the free-tier per-minute rate limit.
    await new Promise(r => setTimeout(r, 200));
  }
  const rate = (failures / N) * 100;
  console.log(`model=${MODEL} calls=${N} failures=${failures} rate=${rate.toFixed(1)}%`);
  if (failureReasons.length) {
    console.log('--- failure detail ---');
    for (const r of failureReasons) console.log(r);
  }
}

main();
