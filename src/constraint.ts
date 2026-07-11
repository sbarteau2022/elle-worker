// ============================================================
// CONSTRAINT ANALYZER — src/constraint.ts
//
// Not another way to answer a question — a way to find what is PREVENTING
// progress. Theory-of-constraints for cognition: a system is usually limited
// by ONE dominant binding constraint at a time; name it, don't list ten, and
// give the smallest move that relieves or tests it.
//
//   in:  objective, resources, recent_failures, environment
//   out: bottleneck, confidence, missing_information[], suggested_next_action
//
// Every analysis is logged (elle_constraint_log) so the constraint history is
// observable — you can watch what kept blocking a line of work over time. This
// pairs with the conductor: an autonomous run that stalls can ask what its
// binding constraint is instead of thrashing.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
import { callLLM } from './llm';

export interface ConstraintInput {
  objective?: string;
  resources?: string;
  recent_failures?: string;
  environment?: string;
}

export interface ConstraintResult {
  bottleneck: string;
  confidence: number;              // 0..1
  missing_information: string[];
  suggested_next_action: string;
}

const SYSTEM =
`You are a constraint analyzer. You do NOT answer the question or do the task. You identify the single thing most preventing progress toward the objective — the binding constraint — and the smallest move that relieves or tests it. Think like a bottleneck/theory-of-constraints analyst: a system is limited by ONE dominant constraint at a time. Find that one; do not enumerate ten. Be concrete and honest about your confidence, and name what you'd need to know to be sure.

Return EXACTLY ONE JSON object and nothing else:
{"bottleneck":"<the single binding constraint, one sentence>","confidence":<number 0 to 1>,"missing_information":["<what you'd need to be sure>", "..."],"suggested_next_action":"<the smallest concrete move that relieves or tests the constraint>"}`;

// Balanced first-{...} extractor + coercion into a well-formed result. Pure,
// unit-tested. Returns null only when there is no usable object at all.
export function parseConstraint(text: unknown): ConstraintResult | null {
  const s = String(text ?? '').replace(/```json|```/g, '');
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  const bottleneck = String(obj.bottleneck ?? '').trim();
  if (!bottleneck) return null;
  let conf = Number(obj.confidence);
  if (!Number.isFinite(conf)) conf = 0.5;
  conf = Math.max(0, Math.min(1, conf));
  const missing = Array.isArray(obj.missing_information)
    ? obj.missing_information.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    bottleneck,
    confidence: Number(conf.toFixed(2)),
    missing_information: missing,
    suggested_next_action: String(obj.suggested_next_action ?? '').trim() || '(none suggested)',
  };
}

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

export async function analyzeConstraint(env: Env, a: ConstraintInput): Promise<string> {
  const objective = String(a.objective ?? '').trim();
  if (!objective) return 'constraint_analyzer: objective required (what are you trying to achieve?)';
  const user =
`OBJECTIVE: ${objective}
RESOURCES: ${String(a.resources ?? '').trim() || '(unspecified)'}
RECENT FAILURES: ${String(a.recent_failures ?? '').trim() || '(none reported)'}
ENVIRONMENT: ${String(a.environment ?? '').trim() || '(unspecified)'}

What is the single binding constraint, and the smallest next action?`;

  let raw: string;
  try {
    const r = await callLLM('reasoning', SYSTEM, [{ role: 'user', content: user }], 700, env);
    raw = r.content;
  } catch (e) {
    return `constraint_analyzer: could not reach a model (${(e as Error).message})`;
  }
  const parsed = parseConstraint(raw);
  if (!parsed) return `constraint_analyzer: no clear analysis. Raw: ${String(raw).slice(0, 400)}`;

  // Log for observability — best-effort, never fails the tool.
  try {
    await ensureSchema(env);
    await env.DB.prepare(
      `INSERT INTO elle_constraint_log (id, objective, bottleneck, confidence, missing_information, suggested_next_action, created_at) VALUES (?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      objective.slice(0, 500), parsed.bottleneck.slice(0, 500), parsed.confidence,
      JSON.stringify(parsed.missing_information), parsed.suggested_next_action.slice(0, 500), Date.now(),
    ).run();
  } catch { /* observability is a bonus, not a dependency */ }

  return JSON.stringify(parsed);
}
