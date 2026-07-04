// ============================================================
// ELLE — INGEST VERIFICATION GATE · src/ingest-gate.ts
//
// A paper only becomes part of Elle's mind — embedded, chunked, vectorized,
// indexed, and immediately queryable — once it passes TWO checks:
//
//   Check 1 · INTEGRITY  (deterministic, cheap)
//     - structural validity: required fields, length bounds, real prose
//       (mostly letters, not pathologically repetitive)
//     - duplicate detection: normalized-title match, and semantic near-dup
//       against the existing corpus (Vectorize)
//
//   Check 2 · VERIFICATION  (a model judges the content)
//     - is this coherent, substantive writing that belongs in a serious
//       corpus? PASS real essays/papers/analyses/letters/fiction; FAIL
//       gibberish, spam, near-empty stubs, accidental pastes (logs, boilerplate)
//     - it judges REALITY and COHERENCE, never agreement
//
// Both must pass. Check 1 is fully deterministic (pure helpers below are unit
// tested). Check 2 and the semantic-dedup half of Check 1 need infra; if that
// infra is unreachable those sub-checks are marked `skipped` and pass, so a
// provider outage degrades to "ingest without the smart checks" rather than
// blocking all ingestion. A genuine FAIL verdict always rejects.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';

export type EmbedFn = (text: string, env: Env) => Promise<number[]>;

export interface GateCheck { name: string; passed: boolean; detail: string; skipped?: boolean }
export interface GateResult { passed: boolean; checks: GateCheck[]; reason: string }

export interface PaperInput { title?: string; text?: string; series?: string; tag?: string }

// Similarity at/above which a new document is treated as a near-duplicate of
// existing corpus content. High on purpose — only catch true re-submissions.
export const NEAR_DUP_SCORE = 0.93;
export const MIN_WORDS = 50;

// ── pure helpers (deterministic, unit-tested) ────────────────
export function normalizeTitle(t: unknown): string {
  return String(t ?? '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Structural validity only (no I/O). Returns null when the paper is well-formed
// prose, or a human-readable reason string when it is not.
export function structuralReason(paper: PaperInput): string | null {
  const title = String(paper.title ?? '').trim();
  const text = String(paper.text ?? '').trim();
  if (title.length < 3 || title.length > 300) return 'title must be 3–300 characters';
  if (!String(paper.series ?? '').trim() || !String(paper.tag ?? '').trim()) return 'series and tag are required';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return `body too short (${words.length} words; need at least ${MIN_WORDS})`;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  if (letters / text.length < 0.5) return 'body does not read as prose (mostly non-letters)';
  const distinct = new Set(words.map(w => w.toLowerCase())).size;
  if (distinct / words.length < 0.15) return 'body is too repetitive to be a real document';
  return null;
}

// ── Check 1: integrity (structural + dedup) ──────────────────
export async function integrityCheck(paper: PaperInput, env: Env, embed: EmbedFn): Promise<GateCheck> {
  const structural = structuralReason(paper);
  if (structural) return { name: 'integrity', passed: false, detail: structural };

  // Duplicate detection is best-effort: an infra failure here must not block a
  // structurally-valid paper, so we pass-with-skip on error.
  try {
    const title = String(paper.title ?? '');
    const norm = normalizeTitle(title);
    const cand = await env.DB.prepare(
      'SELECT id, title FROM corpus_papers WHERE title LIKE ?1 LIMIT 25'
    ).bind(title.slice(0, 40) + '%').all().catch(() => ({ results: [] as Array<{ id: string; title: string }> }));
    for (const r of (cand.results || []) as Array<{ id: string; title: string }>) {
      if (normalizeTitle(r.title) === norm) {
        return { name: 'integrity', passed: false, detail: `duplicate of an existing paper (${r.id})` };
      }
    }
    const vec = await embed(String(paper.text ?? '').slice(0, 1500), env);
    const res = await env.VECTORIZE.query(vec, { topK: 3, returnMetadata: 'all' });
    const top = (res.matches || []).find(m => !m.id.startsWith('conv-') && !m.id.startsWith('jrnl-'));
    if (top && top.score >= NEAR_DUP_SCORE) {
      const t = (top.metadata as Record<string, unknown> | undefined)?.title;
      return { name: 'integrity', passed: false, detail: `near-duplicate of existing corpus content (similarity ${top.score.toFixed(3)}${t ? `, "${t}"` : ''})` };
    }
    return { name: 'integrity', passed: true, detail: 'structurally valid; no duplicate found' };
  } catch (e) {
    return { name: 'integrity', passed: true, skipped: true, detail: `structurally valid; dedup skipped (infra: ${(e as Error).message})` };
  }
}

// ── Check 2: content verification (model judgement) ──────────
const VERIFY_SYSTEM =
`You are a corpus gatekeeper. You decide whether a submitted document is coherent, substantive writing that belongs in a serious philosophical/analytical research corpus. PASS genuine work: essays, papers, analyses, letters, fiction with real content and a discernible line of thought. FAIL: gibberish, spam, near-empty stubs, accidental pastes (raw code, logs, boilerplate, navigation text), or anything with no discernible meaning or argument. You judge only whether it is REAL, COHERENT writing — never whether you agree with it. Reply with EXACTLY ONE JSON object and nothing else: {"verdict":"pass"|"fail","reason":"<one short sentence>"}.`;

function firstVerdict(text: unknown): { verdict?: string; reason?: string } | null {
  const s = String(text ?? '').replace(/```json|```/g, '');
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export async function verificationCheck(paper: PaperInput, env: Env): Promise<GateCheck> {
  try {
    const user = `Title: ${String(paper.title ?? '').slice(0, 200)}\nSeries: ${paper.series ?? ''}\n\nExcerpt:\n"""\n${String(paper.text ?? '').slice(0, 4000)}\n"""\n\nIs this real, coherent writing that belongs in the corpus?`;
    const r = await callLLM('fast', VERIFY_SYSTEM, [{ role: 'user', content: user }], 200, env);
    const obj = firstVerdict(r.content);
    if (!obj || typeof obj.verdict !== 'string') {
      return { name: 'verification', passed: true, skipped: true, detail: 'verifier returned no clear verdict; passed by default' };
    }
    const pass = obj.verdict.toLowerCase() === 'pass';
    return { name: 'verification', passed: pass, detail: String(obj.reason ?? (pass ? 'accepted' : 'rejected')).slice(0, 200) };
  } catch (e) {
    // Model unreachable — do not block ingestion on an outage.
    return { name: 'verification', passed: true, skipped: true, detail: `verification skipped (model unreachable: ${(e as Error).message})` };
  }
}

// ── the gate ─────────────────────────────────────────────────
// Runs Check 1, then (only if it passed) Check 2. Short-circuits so a failed
// integrity check never spends a model call.
export async function runIngestGate(paper: PaperInput, env: Env, embed: EmbedFn): Promise<GateResult> {
  const c1 = await integrityCheck(paper, env, embed);
  if (!c1.passed) return { passed: false, checks: [c1], reason: c1.detail };
  const c2 = await verificationCheck(paper, env);
  const checks = [c1, c2];
  return c2.passed
    ? { passed: true, checks, reason: 'passed both verification checks' }
    : { passed: false, checks, reason: c2.detail };
}
