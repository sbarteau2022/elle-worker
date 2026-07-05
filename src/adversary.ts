// ============================================================
// ADVERSARY — src/adversary.ts
//
// The devil tool: an adversary on retainer. The Screwtape register already
// exists as a voice she can wear in conversation; this makes it an instrument
// she can point at her OWN work. One call, one job — break the draft before
// it ships: the strongest objection, the missed case, the tell. It never
// rewrites; it attacks, so the authorship of the fix stays hers.
//
// No table. The call itself rides the event bus like any tool step, so every
// adversarial pass is already part of the run's provenance.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';

const SYSTEM = `You are the adversary — a war-room challenger whose only loyalty is to what is true. You are handed a DRAFT that its author is about to stand behind. Your job is to break it if it can be broken. Argue to win, not to be agreeable.

Attack the argument, never the author. Look for: the strongest single objection a hostile expert would raise; the concrete case or input the draft silently fails on; the unstated assumption doing load-bearing work; the tell — the sentence where the draft is hiding its own uncertainty behind confidence.

Respond with EXACTLY one JSON object and nothing else:
{"verdict":"holds"|"wounded"|"broken","strongest_objection":"...","missed_case":"...","the_tell":"...","what_would_change_my_mind":"..."}

"holds" means you genuinely tried and failed to land a hit — say so honestly; a false wound is as useless as false praise. Keep every field to one or two hard sentences.`;

export async function devilTool(env: Env, a: Record<string, unknown>): Promise<string> {
  const draft = String(a.draft || a.answer || a.text || '').trim();
  if (draft.length < 40) return 'devil: hand me a real draft (40+ chars) — there is nothing to attack yet';
  const context = String(a.context || '').trim();
  const user = context
    ? `CONTEXT (what the draft is answering): ${context.slice(0, 1500)}\n\nTHE DRAFT:\n${draft.slice(0, 6000)}`
    : `THE DRAFT:\n${draft.slice(0, 6000)}`;
  const r = await callLLM('reasoning', SYSTEM, [{ role: 'user', content: user }], 900, env);
  const m = String(r.content || '').match(/\{[\s\S]*\}/);
  if (!m) return `devil (unstructured verdict): ${String(r.content || '').slice(0, 1200)}`;
  try {
    const v = JSON.parse(m[0]);
    return JSON.stringify({
      verdict: v.verdict,
      strongest_objection: v.strongest_objection,
      missed_case: v.missed_case,
      the_tell: v.the_tell,
      what_would_change_my_mind: v.what_would_change_my_mind,
      discipline: 'address the objection or concede it in the final answer — do not ship past a "broken" verdict silently',
    });
  } catch {
    return `devil (unstructured verdict): ${m[0].slice(0, 1200)}`;
  }
}
