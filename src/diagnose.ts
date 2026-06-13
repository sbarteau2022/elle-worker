// ============================================================
// ELLE — DIAGNOSTIC ENGINE · src/diagnose.ts
//
// POST /api/diagnose  — Build-posture error surfacing.
// Takes an error STRING as a symptom, classifies it, and reasons
// over it with the platform model + documented procedures to
// return a root cause and an on-process, (eventually) executable fix.
//
// v1: classify (real) + reason (real) + actions as typed suggestions.
//     Live-infra correlation + auth gating land in v2.
// ============================================================

import { callLLM, LLMEnv } from './llm';

export interface DiagnoseEnv extends LLMEnv {}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};
const j = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// ── Classification ────────────────────────────────────────────
// Deterministic, legible, shown in the UI. Order matters: the most
// specific classes are tested first so a D1 error inside a runtime
// stack still reads as `data`, and a 401/CORS reads as `auth`.
type ErrClass = 'build' | 'deploy' | 'config' | 'data' | 'auth' | 'runtime' | 'unknown';

const SIGNATURES: Array<{ cls: ErrClass; rx: RegExp }> = [
  { cls: 'data',    rx: /\b(D1|SQLITE?|no such (table|column)|constraint failed|UNIQUE constraint|SQL(?:ite)? error|datatype mismatch|near \".*\": syntax)\b/i },
  { cls: 'auth',    rx: /\b(401|403|unauthorized|forbidden|CORS|access-control-allow|invalid (api )?token|missing bearer|jwt|signature)\b/i },
  { cls: 'config',  rx: /\b(env var|environment variable|VITE_[A-Z_]+|wrangler\.(toml|jsonc)|binding|secret|is not defined.*env|undefined.*\benv\b|not found in env|missing .* binding)\b/i },
  { cls: 'deploy',  rx: /\b(wrangler|pages|deployment|build failure|publish|exited with (error )?code|workers builds|deploy command|bin\/sh.*not found)\b/i },
  { cls: 'build',   rx: /\b(tsc|TS\d{3,4}|type error|is not assignable|vite|esbuild|rollup|transform failed|compile|Property '.*' (is missing|does not exist))\b/i },
  { cls: 'runtime', rx: /\b(\d00 (internal )?server error|5\d{2}\b|uncaught|unhandled|exception|TypeError|ReferenceError|RangeError|threw|at .*:\d+:\d+|stack trace|cannot read propert)/i },
];

export function classifyError(raw: string): { primary: ErrClass; signals: string[] } {
  const signals: string[] = [];
  let primary: ErrClass = 'unknown';
  for (const { cls, rx } of SIGNATURES) {
    const m = raw.match(rx);
    if (m) {
      if (primary === 'unknown') primary = cls;
      signals.push(m[0].slice(0, 40));
    }
  }
  return { primary, signals: Array.from(new Set(signals)).slice(0, 6) };
}

// ── Prompt construction ───────────────────────────────────────
// The platform model + the gotchas we've actually hit. This is the
// part that makes Elle's diagnosis OURS rather than a generic explainer.
function systemPrompt(cls: ErrClass, skills?: string): string {
  const base = `You are Elle's diagnostic engine for the Barteau platform. You diagnose engineering errors on a specific stack and return a precise, on-process fix.

STACK (everything runs on Cloudflare):
- Workers (TS, entry src/index.ts, deployed via wrangler / GitHub Actions on push to main).
- Pages (static front-ends: elle-law, elle-atlas, eip-hub; SPA _redirects; git-connected builds run "npm run build").
- D1 (SQLite) — note vendor_document.document_date is stored MM-DD-YYYY; convert with SUBSTR before comparisons.
- Vectorize, KV, R2, Queues, Workers AI.
- elle-worker is the shared intelligence; front-ends call it and authenticate via /api/elle-auth (JWT) or a service key.

KNOWN GOTCHAS on this platform (check these first — they are common here):
- Env-var TYPOS in the Pages dashboard silently override repo .env and bake a dead value into the bundle (e.g. a hostname that matches no deployed Worker). Symptom is often a vague 401/CORS/network failure, NOT a clear error.
- STALE-COMMIT builds: the CI may rebuild an older commit; a "type error" can be from code already fixed on HEAD.
- tsc chained into deploy ("tsc && vite build") lets a type error block deployment — decouple to "vite build".
- Missing Worker BINDINGS (D1/KV/Vectorize/VENUE_ID) deployed vs. declared in wrangler.toml.
- Account-owned API tokens can't read Worker script content (error 10405) — not a real bug.
- "dist: not found" / "bin/sh: dist" = a path typed into the wrong build-config field.

RULES:
- Diagnose the ROOT CAUSE, not the surface string. The string is a symptom.
- If the error class is config/auth, suspect a typo or mismatch against live infra before anything else.
- Be specific and short. Prefer the fix that matches the documented procedure below, if any.`;

  const skillBlock = skills && skills.trim()
    ? `\n\nDOCUMENTED PROCEDURES (follow these for the fix when relevant):\n${skills.trim().slice(0, 4000)}`
    : '';

  const out = `\n\nRespond with ONLY a JSON object (no markdown, no prose, no backticks):
{
  "root_cause": "one or two sentences naming the actual cause",
  "solution": "the concrete fix, in imperative steps; reference exact fields/files/commands",
  "actions": [{"label": "short button text", "kind": "deploy|patch_env|run_sql|edit_file|rerun|none", "detail": "what this action would do"}],
  "confidence": "high|medium|low"
}`;

  return base + skillBlock + out + `\n\n(Current error class: ${cls}.)`;
}

function userPrompt(error: string, source: string | undefined, cls: ErrClass): string {
  return `Error class (heuristic): ${cls}${source && source !== 'auto' ? ` · reported source: ${source}` : ''}

--- ERROR ---
${error.slice(0, 6000)}
--- END ERROR ---

Diagnose the root cause on this Cloudflare stack and return the JSON.`;
}

// Tolerant JSON extraction — models sometimes wrap in fences or add prose.
function parseDiagnosis(text: string): {
  root_cause: string;
  solution: string;
  actions: Array<{ label: string; kind: string; detail?: string }>;
  confidence: string;
  _raw?: string;
} {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const o = JSON.parse(cleaned.slice(start, end + 1));
      return {
        root_cause: String(o.root_cause ?? '').trim() || 'No root cause identified.',
        solution: String(o.solution ?? '').trim(),
        actions: Array.isArray(o.actions)
          ? o.actions.slice(0, 5).map((a: Record<string, unknown>) => ({
              label: String(a.label ?? 'Action').slice(0, 60),
              kind: ['deploy', 'patch_env', 'run_sql', 'edit_file', 'rerun', 'none'].includes(String(a.kind)) ? String(a.kind) : 'none',
              detail: a.detail ? String(a.detail).slice(0, 300) : undefined,
            }))
          : [],
        confidence: ['high', 'medium', 'low'].includes(String(o.confidence)) ? String(o.confidence) : 'medium',
      };
    } catch { /* fall through */ }
  }
  // Fallback: hand back the model's prose as the solution so nothing is lost.
  return { root_cause: 'Returned as unstructured analysis.', solution: text.trim(), actions: [], confidence: 'low', _raw: text };
}

// ── Handler ───────────────────────────────────────────────────
export async function handleDiagnose(body: Record<string, unknown>, env: DiagnoseEnv): Promise<Response> {
  const error = typeof body.error === 'string' ? body.error : '';
  if (!error.trim()) return j({ error: 'error string required' }, 400);

  const source = typeof body.source === 'string' ? body.source : 'auto';
  const context = typeof body.context === 'string' ? body.context : '';
  const skills = typeof body.skills === 'string' ? body.skills : '';

  const classification = classifyError(error);

  const sys = systemPrompt(classification.primary, skills);
  const usr = userPrompt(error + (context ? `\n\nADDITIONAL CONTEXT:\n${context}` : ''), source, classification.primary);

  let res;
  try {
    res = await callLLM('reasoning', sys, [{ role: 'user', content: usr }], 1400, env);
  } catch (e) {
    return j({ error: 'Diagnosis failed: ' + (e as Error).message, classification }, 502);
  }

  const parsed = parseDiagnosis(res.content);
  return j({
    classification,
    root_cause: parsed.root_cause,
    solution: parsed.solution,
    actions: parsed.actions,
    confidence: parsed.confidence,
    thinking: res.thinking,
    model: res.model,
    provider: res.provider,
  });
}
