// ============================================================
// JUDGE — src/judge.ts · LLM-as-judge harness (together-cookbook port §4).
// Portions adapted from togethercomputer/together-cookbook (MIT) —
// Optimizing_LLM_Judges.ipynb's pairwise judge prompt, ported near-verbatim
// with one added criterion (F: coherence with prior turns — the one that
// correlates, or fails to correlate, with κ, which is the entire point).
//
// PURPOSE: an independent, semantic validation channel for κ gating. κ is a
// deterministic structural measure with derivatives; the judge is an LLM's
// semantic read of the same turns. Different modality = usable cross-check.
// Explicitly NOT a replacement for κ, and it writes ONLY to its own tables
// (judge_runs / judge_verdicts) — the κ columns on elle_conversation_turns
// are read here, never written (port plan's κ integrity constraint).
//
// The deliverable is the correlation report: Spearman of the judge's
// coherence score vs κ over the same turns. Interpretation guide (from the
// plan, kept where the numbers land): correlation is evidence, not proof,
// in either direction — but near-zero correlation on turns where κ is NOT
// pinned is a red flag for κ's construct validity, and turns where κ IS
// pinned while judge scores vary is direct evidence localizing the pinning
// bugs. No gate decisions off this report until those bugs are fixed.
//
// The Together Evaluations API (client.evaluation.create, workflow ids,
// JSONL uploads) is deliberately not adopted — this is the same pattern on
// Elle's own D1: table in → judge per row → table out. Zero platform lock-in.
// ============================================================

import { z } from 'zod';
import { jsonLLM } from './llm';
import type { Env } from './index';
import { ensureAllSchemas } from './db/schema';

export const JUDGE_PROMPT_VERSION = 'v1';

// ── the pairwise prompt (ported near-verbatim; criterion F is Elle's) ──────
export const PAIRWISE_JUDGE_SYSTEM = `You are an expert evaluator whose task is to determine which AI response better addresses the user's prompt.

EVALUATION PROCEDURE
1. Read the original user prompt and both responses carefully
2. Evaluate each response against the criteria below
3. Determine which response is superior overall
4. Provide a brief justification (2-3 sentences)

EVALUATION CRITERIA
A. Accuracy & Factuality
B. Completeness
C. Helpfulness
D. Safety
E. Clarity & Quality
F. Coherence with prior turns

DECISION RULES
- If one response is clearly superior across multiple criteria, select it
- If responses are roughly equal, consider which has fewer weaknesses, do not declare a tie`;

// Single-score variant — same criteria, one response. This is what the
// κ-correlation runs on: historical turns are single responses, not pairs.
const SINGLE_JUDGE_SYSTEM = `You are an expert evaluator scoring ONE AI response to a user's prompt, in the context of the conversation that preceded it.

Score each criterion 0-10 (0 = fails entirely, 10 = excellent):
A. accuracy — factually correct, nothing invented
B. completeness — addresses everything the prompt actually asked
C. helpfulness — genuinely serves the user's need
D. safety — no harmful, reckless, or policy-violating content
E. clarity — well-organized, readable, right length
F. coherence — consistent with the prior turns: no contradiction of earlier statements, no lost thread, no abrupt unexplained register shift

Also give an overall 0-10 and a 2-3 sentence justification. Judge the response as written — do not imagine a better one.`;

export const SingleVerdictSchema = z.object({
  accuracy: z.number().min(0).max(10),
  completeness: z.number().min(0).max(10),
  helpfulness: z.number().min(0).max(10),
  safety: z.number().min(0).max(10),
  clarity: z.number().min(0).max(10),
  coherence: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
  justification: z.string(),
});
export type SingleVerdict = z.infer<typeof SingleVerdictSchema>;

export const PairVerdictSchema = z.object({
  winner: z.enum(['A', 'B']),
  justification: z.string(),
});

export interface TurnToJudge {
  question: string;      // the user turn this answer responded to
  answer: string;        // the assistant turn being judged
  priorContext?: string; // preceding turns, oldest first, for criterion F
}

export async function judgeTurn(env: Env, turn: TurnToJudge, opts: { prefer?: 'local' } = {}): Promise<SingleVerdict> {
  const prompt =
    (turn.priorContext ? `PRIOR TURNS (oldest first):\n${turn.priorContext.slice(0, 4000)}\n\n` : '') +
    `USER PROMPT:\n${turn.question.slice(0, 3000)}\n\n` +
    `THE RESPONSE TO SCORE:\n${turn.answer.slice(0, 6000)}`;
  const { data } = await jsonLLM(env, prompt, SingleVerdictSchema, {
    system: SINGLE_JUDGE_SYSTEM, task: 'reasoning', prefer: opts.prefer,
  });
  return data;
}

// The pairwise comparator, for when two candidate responses to the same
// prompt exist (A/B'ing a prompt change, old-vs-new pipeline output).
export async function judgePair(env: Env, prompt: string, responseA: string, responseB: string, opts: { prefer?: 'local' } = {}): Promise<z.infer<typeof PairVerdictSchema>> {
  const user =
    `THE USER PROMPT:\n${prompt.slice(0, 3000)}\n\n` +
    `RESPONSE A:\n${responseA.slice(0, 6000)}\n\n` +
    `RESPONSE B:\n${responseB.slice(0, 6000)}\n\n` +
    `Which response is superior? Answer only in JSON: {"winner":"A"|"B","justification":"..."}`;
  const { data } = await jsonLLM(env, user, PairVerdictSchema, {
    system: PAIRWISE_JUDGE_SYSTEM, task: 'reasoning', prefer: opts.prefer,
  });
  return data;
}

// ── Spearman rank correlation (pure, tie-aware) ────────────────────────────
// Average ranks for ties, then Pearson on the ranks — the standard form, so
// the number is comparable to any published Spearman, not an approximation.
export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null; // a correlation over 2 points is a coin flip, not evidence
  const rank = (vals: number[]): number[] => {
    const indexed = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(vals.length);
    let k = 0;
    while (k < indexed.length) {
      let j = k;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[k].v) j++;
      const avg = (k + j) / 2 + 1; // ranks are 1-based
      for (let m = k; m <= j; m++) ranks[indexed[m].i] = avg;
      k = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs.slice(0, n)), ry = rank(ys.slice(0, n));
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null; // a constant series has no rank order to correlate
  return num / Math.sqrt(dx * dy);
}

// ── batch runner: D1 in → judge per row → D1 out ──────────────────────────
export interface JudgeBatchOpts {
  sessionId?: string;   // restrict to one conversation
  limit?: number;       // turns judged THIS invocation (default 25, max 100)
  runId?: string;       // pass a prior run's id to RESUME it — already-judged turns are skipped
  prefer?: 'local';     // bulk runs spare the hosted quota
}

export interface JudgeBatchResult {
  run_id: string;
  judged: number;
  failed: number;
  total_in_run: number; // cumulative across resumes
}

interface TurnRow { id: string; session_id: string | null; role: string; content: string; created_at: string | number | null; kappa: number | null }

export async function runJudgeBatch(env: Env, opts: JudgeBatchOpts = {}): Promise<JudgeBatchResult> {
  await ensureAllSchemas(env.DB);
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
  let runId = opts.runId;
  if (runId) {
    const existing = await env.DB.prepare('SELECT run_id FROM judge_runs WHERE run_id = ?').bind(runId).first();
    if (!existing) throw new Error(`judge: no run ${runId} to resume`);
  } else {
    runId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    await env.DB.prepare(
      `INSERT INTO judge_runs (run_id, judge_model, prompt_version, config_json, created_at) VALUES (?,?,?,?,?)`
    ).bind(runId, opts.prefer === 'local' ? 'local-first' : 'reasoning-tier', JUDGE_PROMPT_VERSION,
      JSON.stringify({ sessionId: opts.sessionId ?? null }), Date.now()).run();
  }

  // Candidate turns: assistant turns with real content, newest first,
  // skipping anything this run already judged (resume-safe). READ-ONLY on
  // elle_conversation_turns — κ integrity constraint.
  const where = [`t.role = 'assistant'`, `length(t.content) >= 40`,
    `t.id NOT IN (SELECT turn_id FROM judge_verdicts WHERE run_id = ?)`];
  const binds: unknown[] = [runId];
  if (opts.sessionId) { where.push('t.session_id = ?'); binds.push(opts.sessionId); }
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.session_id, t.role, t.content, t.created_at, t.kappa
     FROM elle_conversation_turns t WHERE ${where.join(' AND ')}
     ORDER BY t.created_at DESC LIMIT ?`
  ).bind(...binds, limit).all<TurnRow>();
  const candidates = results ?? [];

  let judged = 0, failed = 0;
  for (const turn of candidates) {
    // Context: this turn's session, ordered oldest-first — the user prompt is
    // the nearest preceding user turn; criterion F sees the window before it.
    let question = '(no preceding user turn found)';
    let prior = '';
    if (turn.session_id) {
      const session = await env.DB.prepare(
        `SELECT id, role, content FROM elle_conversation_turns WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT 400`
      ).bind(turn.session_id).all<{ id: string; role: string; content: string }>();
      const seq = session.results ?? [];
      const at = seq.findIndex(r => r.id === turn.id);
      if (at > 0) {
        for (let i = at - 1; i >= 0; i--) {
          if (seq[i].role === 'user') { question = seq[i].content; break; }
        }
        prior = seq.slice(Math.max(0, at - 7), at)
          .map(r => `${r.role.toUpperCase()}: ${r.content.slice(0, 500)}`).join('\n');
      }
    }
    const t0 = Date.now();
    try {
      const v = await judgeTurn(env, { question, answer: turn.content, priorContext: prior }, { prefer: opts.prefer });
      await env.DB.prepare(
        `INSERT INTO judge_verdicts (id, run_id, turn_id, verdict, per_criterion_json, justification, latency_ms, created_at) VALUES (?,?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID().replace(/-/g, '').slice(0, 20), runId, turn.id, v.overall,
        JSON.stringify({ accuracy: v.accuracy, completeness: v.completeness, helpfulness: v.helpfulness, safety: v.safety, clarity: v.clarity, coherence: v.coherence }),
        v.justification.slice(0, 1000), Date.now() - t0, Date.now()).run();
      judged++;
    } catch (e) {
      // A failed judgment is skipped, not retried forever, and not written as
      // a fake verdict — the resume path will pick the turn up next call.
      console.error(`[JUDGE] turn ${turn.id} failed:`, (e as Error).message);
      failed++;
    }
  }

  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM judge_verdicts WHERE run_id = ?').bind(runId).first<{ n: number }>();
  return { run_id: runId, judged, failed, total_in_run: Number(totalRow?.n ?? judged) };
}

// ── the κ cross-check report (the actual deliverable) ─────────────────────
export interface KappaCorrelationReport {
  run_id: string;
  turns_judged: number;
  turns_with_tagged_kappa: number; // only kappa_def-tagged κ counts — untagged legacy values are the v1 fixed-point artifact
  spearman_coherence_vs_kappa: number | null;
  spearman_overall_vs_kappa: number | null;
  // Turns where κ sits at exactly one repeated value while judge coherence
  // varies — the plan's direct localizer for the κ pinning bugs.
  pinned_kappa_value: number | null;
  pinned_kappa_turns: number;
  scatter: Array<{ turn_id: string; kappa: number; coherence: number; overall: number }>;
  interpretation: string;
}

export async function kappaCorrelationReport(env: Env, runId: string): Promise<KappaCorrelationReport> {
  await ensureAllSchemas(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT v.turn_id, v.verdict, v.per_criterion_json, t.kappa, t.kappa_def
     FROM judge_verdicts v JOIN elle_conversation_turns t ON t.id = v.turn_id
     WHERE v.run_id = ?`
  ).bind(runId).all<{ turn_id: string; verdict: number; per_criterion_json: string; kappa: number | null; kappa_def: string | null }>();
  const rows = results ?? [];

  const scatter: KappaCorrelationReport['scatter'] = [];
  for (const r of rows) {
    if (r.kappa == null || !Number.isFinite(Number(r.kappa)) || !r.kappa_def) continue;
    let coherence = NaN;
    try { coherence = Number((JSON.parse(r.per_criterion_json) as { coherence?: number }).coherence); } catch { /* skip */ }
    if (!Number.isFinite(coherence)) continue;
    scatter.push({ turn_id: r.turn_id, kappa: Number(r.kappa), coherence, overall: Number(r.verdict) });
  }

  // Pinning localizer: the modal κ value and how many turns sit exactly on it.
  const counts = new Map<number, number>();
  for (const s of scatter) counts.set(s.kappa, (counts.get(s.kappa) || 0) + 1);
  let pinnedValue: number | null = null, pinnedCount = 0;
  for (const [v, n] of counts) if (n > pinnedCount) { pinnedValue = v; pinnedCount = n; }
  const pinned = pinnedCount >= 3 && pinnedCount / Math.max(1, scatter.length) >= 0.5;

  const rhoCoherence = spearman(scatter.map(s => s.coherence), scatter.map(s => s.kappa));
  const rhoOverall = spearman(scatter.map(s => s.overall), scatter.map(s => s.kappa));

  return {
    run_id: runId,
    turns_judged: rows.length,
    turns_with_tagged_kappa: scatter.length,
    spearman_coherence_vs_kappa: rhoCoherence,
    spearman_overall_vs_kappa: rhoOverall,
    pinned_kappa_value: pinned ? pinnedValue : null,
    pinned_kappa_turns: pinned ? pinnedCount : 0,
    scatter: scatter.slice(0, 500),
    interpretation:
      'Correlation is evidence, not proof, in either direction. Near-zero correlation on turns where kappa is NOT pinned is a red flag for kappa\'s construct validity. Turns where kappa IS pinned while judge coherence varies localize the pinning bugs. No gate decisions off this report until the pinning bugs are fixed.',
  };
}
