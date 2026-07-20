// ============================================================
// ELLE — the FORGE LOOP · src/forge-loop.ts
//
// The rewrite of "take a tool into the sandbox and iterate it out." The old
// path filed an intent and hoped the conductor picked it up on a 10-minute
// clock; it drifted into inventing fictional products and never touched the
// box. This is the replacement: ONE command that runs the whole thing LIVE,
// in the turn, streamed to the split Forge panel.
//
//   forge(spec) — a tool is a NAME + PURPOSE + explicit GOALS (each goal is a
//   boolean assertion checked against the code in the real sandbox). The loop:
//
//     1. WRITE      — the code engine drafts/revises the implementation
//     2. CHECK      — every goal is compiled into a harness and RUN on the box
//                     (sandboxExecCode); pass/fail is the real exit code
//     3. REFINE     — failures feed the next WRITE; repeat until all goals pass
//                     or the iteration budget is spent
//     4. REVIEW     — a hosted heavy model (callLLM 'reasoning') judges the
//                     passing tool: approve, or revise-with-notes → back to 1
//     5. MERGE      — on approve, open a PR baking the tool into worker source
//                     (forged/<name>/…); acceptance stays a human merge on
//                     GitHub → CI deploys it globally on Cloudflare
//
// Every stage emits a ForgeEvent to the caller's onEvent (the SSE door) so the
// panel can render the code + goal results on the LEFT and the reasoning +
// review on the RIGHT, live. The durable record rides elle_events by run_id,
// exactly like the router loop, so a forge is replayable too.
//
// The pure pieces — spec validation, harness compilation, response parsing,
// pass detection, lifecycle — are exported and unit-tested with no bindings.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
import { callLLM } from './llm';
import { sandboxExecCode, sandboxConfigured, pathOpen } from './connect-sandbox';
import { forgeOpen, forgeWrite, forgePR, forgeCheck } from './forge';
import { emitEvent } from './events';

// ── the spec ────────────────────────────────────────────────
export type ForgeLang = 'python' | 'javascript';

export interface ForgeGoal {
  id: string;
  describe: string;   // what this goal means, in words
  assert: string;     // a boolean expression in `language`, evaluated against the impl
}

export interface ForgeSpec {
  name: string;
  description: string;
  language: ForgeLang;
  goals: ForgeGoal[];
}

// ── the wire: what streams to the panel ─────────────────────
export type ForgeEvent =
  | { kind: 'forge_start'; forge_id: string; run_id: string; name: string; language: ForgeLang; goals: number }
  | { kind: 'iterate'; iter: number; thought: string; code: string }
  | { kind: 'goal_result'; iter: number; goal_id: string; describe: string; pass: boolean; exit: number; stdout: string; stderr: string; duration_ms: number }
  | { kind: 'iter_summary'; iter: number; passed: number; total: number }
  | { kind: 'review'; verdict: 'approve' | 'revise'; notes: string }
  | { kind: 'merge'; ok: boolean; pr_number?: number; url?: string; note: string }
  | { kind: 'forge_done'; forge_id: string; status: ForgeStatus; iterations: number; note: string }
  | { kind: 'forge_error'; message: string };

export type ForgeStatus =
  | 'forging'      // the write→check→refine loop is running
  | 'passing'      // all goals passed locally, awaiting/《in》review
  | 'reviewing'    // the heavy model is judging
  | 'approved'     // review said ship it
  | 'pr_open'      // a PR was opened to bake it into source
  | 'rejected'     // review said no and the budget is spent
  | 'failed';      // goals never all passed within the budget

// ── bounds ──────────────────────────────────────────────────
export const MAX_ITERATIONS = 6;   // write→check cycles before we stop
export const MAX_GOALS = 12;
export const GOAL_TIMEOUT_MS = 90_000;
const CODE_MAX = 16_000;           // per-implementation cap
const PREVIEW = 2_000;

// ── validation (pure) ───────────────────────────────────────
export function validateForgeSpec(spec: Partial<ForgeSpec> | null | undefined): string | null {
  if (!spec) return 'a forge spec is required';
  const name = String(spec.name ?? '').trim();
  if (name.length < 3) return 'name too short — name the tool (a-z0-9_-)';
  if (name.length > 60) return 'name too long (60 max)';
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) return 'name must be alphanumeric with _ or - (no spaces)';
  const description = String(spec.description ?? '').trim();
  if (description.length < 15) return 'description too short — say what the tool is FOR (15+ chars)';
  const lang = String(spec.language ?? 'python');
  if (lang !== 'python' && lang !== 'javascript') return "language must be 'python' or 'javascript'";
  const goals = Array.isArray(spec.goals) ? spec.goals : [];
  if (goals.length < 1) return 'at least one acceptance goal is required — a forge without goals cannot converge';
  if (goals.length > MAX_GOALS) return `too many goals (max ${MAX_GOALS})`;
  for (const [i, g] of goals.entries()) {
    if (!g || typeof g !== 'object') return `goal ${i + 1} is malformed`;
    if (!String(g.assert ?? '').trim()) return `goal ${i + 1} needs an assert — a boolean expression the sandbox can check`;
    if (!String(g.describe ?? '').trim()) return `goal ${i + 1} needs a describe — what it means in words`;
  }
  return null;
}

export function normalizeSpec(spec: ForgeSpec): ForgeSpec {
  const goals = spec.goals.slice(0, MAX_GOALS).map((g, i) => ({
    id: String(g.id || `g${i + 1}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24) || `g${i + 1}`,
    describe: String(g.describe).trim().slice(0, 400),
    assert: String(g.assert).trim().slice(0, 1_000),
  }));
  return {
    name: String(spec.name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60),
    description: String(spec.description).trim().slice(0, 2_000),
    language: spec.language === 'javascript' ? 'javascript' : 'python',
    goals,
  };
}

// ── harness compilation (pure) ──────────────────────────────
// impl + one goal → a self-contained program that evaluates the goal's assert
// and exits 0 on PASS, 1 on FAIL, 2 on error. Pass/fail is the exit code, so
// judging a goal never depends on parsing prose.
export function buildHarness(language: ForgeLang, impl: string, goal: ForgeGoal): string {
  const body = String(impl || '').slice(0, CODE_MAX);
  if (language === 'javascript') {
    return `${body}

// ── forge goal check: ${goal.id} ──
;(async () => {
  try {
    const __ok = !!(await (async () => (${goal.assert}))());
    console.log("GOAL ${goal.id} " + (__ok ? "PASS" : "FAIL"));
    if (typeof process !== "undefined" && process.exit) process.exit(__ok ? 0 : 1);
  } catch (__e) {
    console.log("GOAL ${goal.id} ERROR " + (__e && __e.message ? __e.message : __e));
    if (typeof process !== "undefined" && process.exit) process.exit(2);
  }
})();
`;
  }
  // python
  return `${body}

# ── forge goal check: ${goal.id} ──
import sys as _forge_sys
try:
    _forge_ok = bool(${goal.assert})
    print("GOAL ${goal.id} " + ("PASS" if _forge_ok else "FAIL"))
    _forge_sys.exit(0 if _forge_ok else 1)
except Exception as _forge_e:
    print("GOAL ${goal.id} ERROR " + str(_forge_e))
    _forge_sys.exit(2)
`;
}

// ── write-response parsing (pure) ───────────────────────────
// The code engine returns {thought, code}; be forgiving about fences and
// extra prose. Returns null when no usable object/code is present.
export function parseWriteResponse(text: unknown): { thought: string; code: string } | null {
  const s = String(text ?? '').replace(/```json|```javascript|```python|```js|```py|```/gi, '');
  const obj = firstJsonObject(s);
  if (obj && typeof obj.code === 'string' && obj.code.trim()) {
    return { thought: String(obj.thought ?? '').trim().slice(0, 800), code: obj.code };
  }
  // A model that ignored the JSON contract but emitted a code block: salvage it.
  const fence = String(text ?? '').match(/```(?:javascript|python|js|py)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].trim()) return { thought: '', code: fence[1] };
  return null;
}

export function parseReviewResponse(text: unknown): { verdict: 'approve' | 'revise'; notes: string } {
  const obj = firstJsonObject(String(text ?? '').replace(/```json|```/gi, ''));
  const raw = String(obj?.verdict ?? '').toLowerCase();
  const verdict = raw.startsWith('approve') || raw === 'approved' || raw === 'ship' ? 'approve' : 'revise';
  const notes = String(obj?.notes ?? obj?.reason ?? '').trim().slice(0, 2_000)
    || (verdict === 'approve' ? 'approved' : 'revision requested (no notes given)');
  return { verdict, notes };
}

export interface GoalResult { goal_id: string; describe: string; pass: boolean; exit: number; stdout: string; stderr: string; duration_ms: number }
export function allGoalsPass(results: GoalResult[], total: number): boolean {
  return results.length === total && results.every(r => r.pass);
}

// A balanced-brace extractor: the first complete {...} object, tolerant of
// prose around it. Kept local so this module has no cross-import on the router.
function firstJsonObject(text: string): Record<string, unknown> | null {
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { start = -1; } } }
  }
  return null;
}

// ── schema ──────────────────────────────────────────────────
// Extends the existing elle_custom_tools registry rather than a new table, so
// what the forge produces and what tool_forge{op:invoke} runs are one thing.
// ADD COLUMN is swallowed so this is idempotent across live deployments.
let schemaReady = false;
export async function ensureForgeSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const now = () => Date.now();
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// ── the forged-tool ledger (read side, for the panel) ───────
export async function forgeRegistry(env: Env, limit = 50): Promise<unknown[]> {
  try {
    await ensureForgeSchema(env);
    const r = await env.DB.prepare(
      `SELECT id, name, description, language, forge_status, status, iterations, review_notes,
              pr_number, pr_url, runs, last_run_id, goals, created_at, updated_at
         FROM elle_custom_tools ORDER BY updated_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 100)).all();
    return (r.results || []).map((row) => {
      const t = row as Record<string, unknown>;
      let goals: unknown = [];
      try { goals = t.goals ? JSON.parse(String(t.goals)) : []; } catch { goals = []; }
      return { ...t, goals };
    });
  } catch { return []; }
}

async function persistForge(
  env: Env, spec: ForgeSpec, code: string, status: ForgeStatus,
  extra: { review_notes?: string; iterations?: number; pr_number?: number; pr_url?: string; run_id?: string } = {},
): Promise<void> {
  try {
    await ensureForgeSchema(env);
    const t = now();
    const existing = await env.DB.prepare(`SELECT id FROM elle_custom_tools WHERE name = ?`).bind(spec.name).first() as { id: string } | null;
    const goalsJson = JSON.stringify(spec.goals);
    if (existing) {
      await env.DB.prepare(
        `UPDATE elle_custom_tools SET description = ?, language = ?, code = ?, goals = ?, forge_status = ?, status = ?,
           review_notes = COALESCE(?, review_notes), iterations = COALESCE(?, iterations),
           pr_number = COALESCE(?, pr_number), pr_url = COALESCE(?, pr_url), last_run_id = COALESCE(?, last_run_id), updated_at = ? WHERE id = ?`
      ).bind(
        spec.description, spec.language, code.slice(0, CODE_MAX), goalsJson, status,
        status === 'approved' || status === 'pr_open' ? 'active' : 'draft',
        extra.review_notes ?? null, extra.iterations ?? null, extra.pr_number ?? null, extra.pr_url ?? null, extra.run_id ?? null, t, existing.id,
      ).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO elle_custom_tools (id, name, description, language, code, goals, forge_status, status, iterations, review_notes, pr_number, pr_url, last_run_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        newId(), spec.name, spec.description, spec.language, code.slice(0, CODE_MAX), goalsJson, status,
        status === 'approved' || status === 'pr_open' ? 'active' : 'draft',
        extra.iterations ?? 0, extra.review_notes ?? null, extra.pr_number ?? null, extra.pr_url ?? null, extra.run_id ?? null, t, t,
      ).run();
    }
  } catch { /* the registry write is best-effort; the loop's result still streams */ }
}

// ── the write step ──────────────────────────────────────────
function writeSystem(spec: ForgeSpec): string {
  const goalList = spec.goals.map(g => `  - ${g.id}: ${g.describe}\n      assert (${spec.language}): ${g.assert}`).join('\n');
  return `You are forging a SMALL, self-contained ${spec.language} tool named "${spec.name}".

PURPOSE: ${spec.description}

It must satisfy EVERY acceptance goal below. Each goal is checked by evaluating its boolean \`assert\` expression against your code in a real sandbox — so your code must define, at top level, whatever names the asserts reference (functions, values, classes).

ACCEPTANCE GOALS:
${goalList}

Return EXACTLY ONE JSON object and nothing else — no prose, no markdown fences:
{"thought": "one line on your approach or what you changed", "code": "<the full ${spec.language} implementation>"}

Rules:
- The \`code\` is ONLY the implementation. Do NOT write the assertions or any test harness — the sandbox appends those.
- Keep it self-contained: standard library only unless a goal's assert implies otherwise.
- Make every referenced name importable/callable at module top level.`;
}

function writeUser(prevCode: string, failures: GoalResult[], reviewNotes: string): string {
  if (!prevCode) return 'Write the first implementation now.';
  const parts: string[] = ['Your previous implementation:', '```', prevCode.slice(0, CODE_MAX), '```'];
  if (failures.length) {
    parts.push('', 'It FAILED these goals in the sandbox — fix them:');
    for (const f of failures) {
      parts.push(`- ${f.goal_id} (${f.describe}): exit ${f.exit}` + (f.stderr ? `\n    stderr: ${f.stderr.slice(0, 500)}` : '') + (f.stdout ? `\n    stdout: ${f.stdout.slice(0, 500)}` : ''));
    }
  }
  if (reviewNotes) parts.push('', `The reviewer asked for revisions: ${reviewNotes}`);
  parts.push('', 'Return the corrected full implementation as the same JSON object.');
  return parts.join('\n');
}

// ── the orchestrator ────────────────────────────────────────
export interface ForgeResult {
  forge_id: string; run_id: string; name: string;
  status: ForgeStatus; iterations: number;
  code: string; review_notes?: string; pr_number?: number; pr_url?: string;
  // Set on every non-passing outcome. The streaming door already tells the
  // caller why via forge_error/forge_done SSE events, but the plain-JSON
  // path (fb.stream falsy — this is what the tool_forge/idea{op:forge}
  // router tool actually calls) only ever saw this struct: a bare
  // status:'failed' with no reason, indistinguishable from "nothing
  // happened." That was the mechanism behind "she's not making any tools" —
  // the sandbox being unconfigured/closed produced a silent no-op from the
  // caller's point of view even though the SSE panel would have shown it.
  message?: string;
}

export async function runForge(
  env: Env, rawSpec: ForgeSpec,
  opts: { userId?: string; sessionId?: string | null; onEvent?: (ev: ForgeEvent) => void } = {},
): Promise<ForgeResult> {
  const spec = normalizeSpec(rawSpec);
  const forgeId = newId();
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const ping = (ev: ForgeEvent) => { if (opts.onEvent) { try { opts.onEvent(ev); } catch { /* listener's problem */ } } };
  const sctx = { runId, sessionId: opts.sessionId ?? null, source: 'forge', userId: opts.userId };
  const bus = (kind: string, tool: string, args: unknown, preview: string, step: number) =>
    void emitEvent(env, { run_id: runId, session_id: opts.sessionId ?? null, source: 'forge', scope: 'full', step_index: step, kind: kind as never, tool, args: args as never, result_preview: preview });

  ping({ kind: 'forge_start', forge_id: forgeId, run_id: runId, name: spec.name, language: spec.language, goals: spec.goals.length });
  bus('run_start', 'forge', { name: spec.name, goals: spec.goals.length }, `forge "${spec.name}" — ${spec.goals.length} goal(s)`, -1);

  if (!sandboxConfigured(env)) {
    const message = 'the SANDBOX_AGENT_KEY secret is not configured on this worker';
    ping({ kind: 'forge_error', message });
    await persistForge(env, spec, '', 'failed', { iterations: 0, run_id: runId });
    return { forge_id: forgeId, run_id: runId, name: spec.name, status: 'failed', iterations: 0, code: '', message };
  }
  const path = await pathOpen(env);
  if (!path.open) {
    const message = 'sandbox path not open — start the workbench (and Docker/Ollama on it) so the laptop agent connects, then forge';
    ping({ kind: 'forge_error', message });
    await persistForge(env, spec, '', 'failed', { iterations: 0, run_id: runId });
    return { forge_id: forgeId, run_id: runId, name: spec.name, status: 'failed', iterations: 0, code: '', message };
  }

  let code = '';
  let iter = 0;
  let reviewNotes = '';
  let lastFailures: GoalResult[] = [];
  let status: ForgeStatus = 'forging';

  while (iter < MAX_ITERATIONS) {
    iter++;
    // 1. WRITE
    let written: { thought: string; code: string } | null = null;
    try {
      const resp = await callLLM('code', writeSystem(spec), [{ role: 'user', content: writeUser(code, lastFailures, reviewNotes) }], 3_000, env);
      written = parseWriteResponse(resp.content);
    } catch (e) {
      ping({ kind: 'forge_error', message: `write step failed: ${(e as Error).message}` });
    }
    if (!written) {
      // One bad generation isn't fatal while budget remains; nudge and retry.
      if (iter < MAX_ITERATIONS) { lastFailures = []; reviewNotes = 'Your last response was not valid JSON with a "code" field. Return exactly {"thought":"...","code":"..."}.'; continue; }
      status = 'failed'; break;
    }
    reviewNotes = '';
    code = written.code.slice(0, CODE_MAX);
    ping({ kind: 'iterate', iter, thought: written.thought, code });
    bus('tool_call', 'forge_write', { iter }, written.thought || `iteration ${iter}`, iter);

    // 2. CHECK — every goal on the real box
    const results: GoalResult[] = [];
    for (const g of spec.goals) {
      const harness = buildHarness(spec.language, code, g);
      const res = await sandboxExecCode(env, harness, spec.language, sctx, GOAL_TIMEOUT_MS);
      const gr: GoalResult = {
        goal_id: g.id, describe: g.describe, pass: res.exit === 0,
        exit: res.exit, stdout: (res.stdout || '').slice(0, PREVIEW), stderr: (res.stderr || '').slice(0, PREVIEW),
        duration_ms: res.duration_ms,
      };
      results.push(gr);
      ping({ kind: 'goal_result', iter, goal_id: g.id, describe: g.describe, pass: gr.pass, exit: gr.exit, stdout: gr.stdout, stderr: gr.stderr, duration_ms: gr.duration_ms });
      bus('tool_call', 'run_code', { goal: g.id }, `${g.id} ${gr.pass ? 'PASS' : 'FAIL'} (exit ${gr.exit})`, iter);
      // A closed path mid-run is terminal — nothing further can execute.
      if (res.path_open === false) {
        await persistForge(env, spec, code, 'failed', { iterations: iter, run_id: runId });
        const message = 'sandbox path closed mid-forge — the box went offline mid-run';
        ping({ kind: 'forge_error', message });
        ping({ kind: 'forge_done', forge_id: forgeId, status: 'failed', iterations: iter, note: message });
        return { forge_id: forgeId, run_id: runId, name: spec.name, status: 'failed', iterations: iter, code, message };
      }
    }
    const passed = results.filter(r => r.pass).length;
    ping({ kind: 'iter_summary', iter, passed, total: spec.goals.length });

    if (allGoalsPass(results, spec.goals.length)) {
      status = 'passing';
      await persistForge(env, spec, code, 'passing', { iterations: iter, run_id: runId });
      break;
    }
    lastFailures = results.filter(r => !r.pass);
    await persistForge(env, spec, code, 'forging', { iterations: iter, run_id: runId });
  }

  if (status !== 'passing') {
    await persistForge(env, spec, code, 'failed', { iterations: iter, run_id: runId });
    const message = `goals did not all pass within ${MAX_ITERATIONS} iterations`;
    ping({ kind: 'forge_done', forge_id: forgeId, status: 'failed', iterations: iter, note: message });
    return { forge_id: forgeId, run_id: runId, name: spec.name, status: 'failed', iterations: iter, code, message };
  }

  // 3. REVIEW — hosted heavy model. A single revise sends us back into the loop
  // once more (budget-permitting); a second pass approves or rejects honestly.
  status = 'reviewing';
  await persistForge(env, spec, code, 'reviewing', { iterations: iter, run_id: runId });
  const review = await reviewForge(env, spec, code).catch((e) => ({ verdict: 'approve' as const, notes: `review unavailable (${(e as Error).message}); auto-approving passing tool` }));
  ping({ kind: 'review', verdict: review.verdict, notes: review.notes });
  bus('tool_call', 'forge_review', { verdict: review.verdict }, review.notes, iter + 1);

  if (review.verdict === 'revise' && iter < MAX_ITERATIONS) {
    // Fold the review into one more write→check cycle, then accept the result.
    reviewNotes = review.notes;
    lastFailures = [];
    const second = await refineOnce(env, spec, code, reviewNotes, sctx, iter, ping, bus, runId);
    iter = second.iter;
    if (second.passing) { code = second.code; status = 'passing'; }
    else {
      await persistForge(env, spec, second.code || code, 'rejected', { iterations: iter, review_notes: review.notes, run_id: runId });
      const message = 'revision from review did not pass the goals';
      ping({ kind: 'forge_done', forge_id: forgeId, status: 'rejected', iterations: iter, note: message });
      return { forge_id: forgeId, run_id: runId, name: spec.name, status: 'rejected', iterations: iter, code: second.code || code, review_notes: review.notes, message };
    }
  }

  status = 'approved';
  await persistForge(env, spec, code, 'approved', { iterations: iter, review_notes: review.notes, run_id: runId });

  // 4. MERGE — open the PR that bakes it into worker source. Additive files
  // only (forged/<name>/…), so CI stays green and the merge is a clean human
  // decision that deploys the tool globally on Cloudflare.
  const merge: { ok: boolean; pr_number?: number; url?: string; note: string } =
    await mergeForge(env, spec, code, review.notes).catch((e) => ({ ok: false, note: `merge failed: ${(e as Error).message}` }));
  ping({ kind: 'merge', ok: merge.ok, pr_number: merge.pr_number, url: merge.url, note: merge.note });
  bus('tool_call', 'forge_pr', { pr: merge.pr_number }, merge.note, iter + 2);
  if (merge.ok) {
    status = 'pr_open';
    await persistForge(env, spec, code, 'pr_open', { iterations: iter, review_notes: review.notes, pr_number: merge.pr_number, pr_url: merge.url, run_id: runId });
  }

  ping({ kind: 'forge_done', forge_id: forgeId, status, iterations: iter, note: merge.ok ? `PR #${merge.pr_number} opened — merge on GitHub to deploy globally` : 'approved; PR not opened' });
  return { forge_id: forgeId, run_id: runId, name: spec.name, status, iterations: iter, code, review_notes: review.notes, pr_number: merge.pr_number, pr_url: merge.url };
}

// One extra write→check cycle folding in review notes; used when review asks
// for a revision. Returns whether the goals pass afterward.
async function refineOnce(
  env: Env, spec: ForgeSpec, prevCode: string, notes: string,
  sctx: { runId?: string; sessionId?: string | null; source?: string; userId?: string }, prevIter: number,
  ping: (ev: ForgeEvent) => void, bus: (k: string, t: string, a: unknown, p: string, s: number) => void, runId: string,
): Promise<{ iter: number; passing: boolean; code: string }> {
  const iter = prevIter + 1;
  let code = prevCode;
  const resp = await callLLM('code', writeSystem(spec), [{ role: 'user', content: writeUser(prevCode, [], notes) }], 3_000, env).catch(() => null);
  const written = resp ? parseWriteResponse(resp.content) : null;
  if (written) { code = written.code.slice(0, CODE_MAX); ping({ kind: 'iterate', iter, thought: written.thought, code }); bus('tool_call', 'forge_write', { iter, revision: true }, written.thought, iter); }
  const results: GoalResult[] = [];
  for (const g of spec.goals) {
    const res = await sandboxExecCode(env, buildHarness(spec.language, code, g), spec.language, sctx, GOAL_TIMEOUT_MS);
    const gr: GoalResult = { goal_id: g.id, describe: g.describe, pass: res.exit === 0, exit: res.exit, stdout: (res.stdout || '').slice(0, PREVIEW), stderr: (res.stderr || '').slice(0, PREVIEW), duration_ms: res.duration_ms };
    results.push(gr);
    ping({ kind: 'goal_result', iter, goal_id: g.id, describe: g.describe, pass: gr.pass, exit: gr.exit, stdout: gr.stdout, stderr: gr.stderr, duration_ms: gr.duration_ms });
  }
  ping({ kind: 'iter_summary', iter, passed: results.filter(r => r.pass).length, total: spec.goals.length });
  return { iter, passing: allGoalsPass(results, spec.goals.length), code };
}

// ── the review (hosted heavy) ───────────────────────────────
export async function reviewForge(env: Env, spec: ForgeSpec, code: string): Promise<{ verdict: 'approve' | 'revise'; notes: string }> {
  const system = `You are a SENIOR engineer reviewing a small tool that has ALREADY passed every automated acceptance check in a sandbox. Your job is judgment the checks can't make: correctness beyond the asserts, safety, clarity, and whether it genuinely fulfils its stated purpose.

Return EXACTLY ONE JSON object: {"verdict": "approve" | "revise", "notes": "..."}
- "approve": ship it. Notes can be brief.
- "revise": something real is wrong or missing (a bug the goals didn't catch, an unsafe operation, a purpose only half-met). Notes MUST be concrete and actionable — they feed one more automated revision.
Do not revise for style alone. Passing tools should usually approve.`;
  const user = `NAME: ${spec.name}
PURPOSE: ${spec.description}
LANGUAGE: ${spec.language}
GOALS (all passed):
${spec.goals.map(g => `- ${g.id}: ${g.describe}`).join('\n')}

IMPLEMENTATION:
\`\`\`${spec.language}
${code.slice(0, CODE_MAX)}
\`\`\``;
  const resp = await callLLM('reasoning', system, [{ role: 'user', content: user }], 1_500, env);
  return parseReviewResponse(resp.content);
}

// ── the merge (PR into worker source) ───────────────────────
export function forgedFiles(spec: ForgeSpec, code: string, reviewNotes: string): Array<{ path: string; content: string }> {
  const ext = spec.language === 'javascript' ? 'js' : 'py';
  const manifest = {
    name: spec.name,
    description: spec.description,
    language: spec.language,
    goals: spec.goals,
    review_notes: reviewNotes,
    forged_at: new Date().toISOString(),
  };
  return [
    { path: `forged/${spec.name}/tool.${ext}`, content: code.endsWith('\n') ? code : code + '\n' },
    { path: `forged/${spec.name}/manifest.json`, content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: `forged/${spec.name}/README.md`, content:
`# ${spec.name}

${spec.description}

Forged by Elle and passed ${spec.goals.length} sandbox acceptance goal(s), then reviewed.

## Goals
${spec.goals.map(g => `- **${g.id}** — ${g.describe}\n  - \`assert:\` \`${g.assert}\``).join('\n')}

## Review
${reviewNotes || '(approved)'}
` },
  ];
}

// Pure: turn forge_check's JSON string into a ship/no-ship verdict. Exported
// so the classification logic (green vs failed vs still-pending) is unit
// testable without a live GitHub API.
export type CiVerdict = { state: 'green' | 'failed' | 'pending'; summary: string };
export function classifyForgeCi(raw: string): CiVerdict {
  let d: { green?: boolean; ci?: unknown } = {};
  try { d = JSON.parse(raw); } catch { return { state: 'pending', summary: raw.slice(0, 300) || 'forge_check returned no readable status' }; }
  if (d.green === true) return { state: 'green', summary: 'all CI runs green' };
  if (Array.isArray(d.ci)) {
    const failed = d.ci.filter((r: any) => r?.conclusion === 'failure');
    if (failed.length) return { state: 'failed', summary: JSON.stringify(failed).slice(0, 500) };
    return { state: 'pending', summary: JSON.stringify(d.ci).slice(0, 300) };
  }
  return { state: 'pending', summary: typeof d.ci === 'string' ? d.ci : 'CI has not reported in yet' };
}

export async function mergeForge(
  env: Env, spec: ForgeSpec, code: string, reviewNotes: string,
): Promise<{ ok: boolean; pr_number?: number; url?: string; note: string }> {
  if (!env.GITHUB_TOKEN) return { ok: false, note: 'merge skipped: GITHUB_TOKEN not configured — the tool is approved and lives in the registry' };
  const opened = await forgeOpen(env, { repo: 'elle-worker', title: `forge: ${spec.name}`, goal: spec.description });
  let taskId: string | undefined;
  try { taskId = String((JSON.parse(opened) as { task_id?: string }).task_id || '') || undefined; } catch { /* refusal text */ }
  if (!taskId) return { ok: false, note: `could not open a forge task: ${opened.slice(0, 200)}` };

  for (const f of forgedFiles(spec, code, reviewNotes)) {
    const w = await forgeWrite(env, { task_id: taskId, path: f.path, content: f.content, message: `forge: ${spec.name} — ${f.path.split('/').pop()}` });
    try { const d = JSON.parse(w); if (!d.committed) return { ok: false, note: `commit failed for ${f.path}: ${w.slice(0, 200)}` }; }
    catch { return { ok: false, note: `commit failed for ${f.path}: ${w.slice(0, 200)}` }; }
  }

  // Never open a PR blind. CI needs a minute or two to even start (forge_write
  // says as much), so this is a best-effort look, not a poll/wait loop — if it's
  // not green yet, the task stays 'open' with commits on it and no PR, which is
  // exactly the shape the conductor's hourly forge sweep already knows how to
  // finish (forge_check → forge_pr once green, conductor.ts). That sweep is the
  // real gate; this just stops the automated path from ever shipping a PR on
  // code CI has already flagged red, or before CI has looked at it at all.
  const checked = await forgeCheck(env, { task_id: taskId }).catch((e) => JSON.stringify({ ci: `forge_check failed: ${(e as Error).message}` }));
  const verdict = classifyForgeCi(checked);
  if (verdict.state === 'failed') {
    return { ok: false, note: `CI failed on the forged branch — not opening a PR: ${verdict.summary}` };
  }
  if (verdict.state !== 'green') {
    return { ok: false, note: `commits pushed; CI ${verdict.summary} — no PR opened yet, the next conductor forge sweep opens it once checks are green` };
  }

  const prBody = `**Forged tool: \`${spec.name}\`**

${spec.description}

Passed ${spec.goals.length} sandbox acceptance goal(s) and a heavy-model review before this PR was opened. Merging bakes it into worker source and deploys it globally on Cloudflare.

### Acceptance goals
${spec.goals.map(g => `- \`${g.id}\` — ${g.describe}`).join('\n')}

### Review notes
${reviewNotes || '(approved)'}

Acceptance — the merge — is a human decision.`;
  const pr = await forgePR(env, { task_id: taskId, body: prBody });
  try {
    const d = JSON.parse(pr) as { pr_number?: number; url?: string };
    if (d.pr_number) return { ok: true, pr_number: d.pr_number, url: d.url, note: `PR #${d.pr_number} opened` };
  } catch { /* fall through */ }
  return { ok: false, note: `PR open failed: ${pr.slice(0, 200)}` };
}
