// ============================================================
// COUNCIL — src/council.ts
//
// Disagreement as signal. The model roster (llm.ts) is walked SERIALLY today —
// redundancy only. This uses it sideways: put the same question to three
// distinct engines in PARALLEL, then map where they converge and where they
// split. Convergence across independently-trained models is (weak) evidence;
// a split marks exactly the spot to point devil/predict at. No new providers,
// no new keys — her existing roster, used epistemically.
// ============================================================

import type { Env } from './index';
import { callLLM, type LLMTask } from './llm';

// Three tiers that map to genuinely different providers in llm.ts:
// reasoning → Gemini, code → Qwen (OpenRouter), conversation → Llama chain.
const SEATS: LLMTask[] = ['reasoning', 'code', 'conversation'];

export async function councilTool(env: Env, a: Record<string, unknown>): Promise<string> {
  const q = String(a.q || a.question || a.query || '').trim();
  if (!q) return 'council: q required — the question to put to the seats';

  const seatSystem = `Answer the question directly and factually in at most 150 words. State your key claims plainly — they will be compared against other models' answers. If you are unsure, say what you are unsure about.`;

  const settled = await Promise.allSettled(
    SEATS.map(task => callLLM(task, seatSystem, [{ role: 'user', content: q }], 600, env)),
  );
  const seats = settled.map((s, i) => ({
    seat: SEATS[i],
    ok: s.status === 'fulfilled',
    model: s.status === 'fulfilled' ? s.value.model : undefined,
    provider: s.status === 'fulfilled' ? s.value.provider : undefined,
    answer: s.status === 'fulfilled' ? String(s.value.content || '').slice(0, 1200) : `(seat unavailable: ${(s as PromiseRejectedResult).reason?.message || 'failed'})`,
  }));
  const alive = seats.filter(s => s.ok);
  if (alive.length < 2) {
    return alive.length === 1
      ? `council: only one seat answered — no disagreement to map. Its answer (${alive[0].provider}/${alive[0].model}): ${alive[0].answer}`
      : 'council: no seats reachable — the roster is down';
  }

  // A fourth, cheap call maps the disagreement — it judges the seats, it does
  // not answer the question itself.
  const mapRaw = await callLLM('fast',
    `You compare independent model answers to one question. Do NOT answer the question yourself. Respond with EXACTLY one JSON object: {"convergent":["claims all seats agree on"],"contested":[{"claim":"...","positions":"who says what, briefly"}],"confidence_note":"one sentence: where convergence earns confidence and where the split demands verification"}`,
    [{ role: 'user', content: `THE QUESTION: ${q}\n\n${alive.map(s => `SEAT ${s.seat} (${s.provider}/${s.model}):\n${s.answer}`).join('\n\n')}` }],
    700, env).catch(() => null);
  let map: unknown = null;
  if (mapRaw) {
    const m = String(mapRaw.content || '').match(/\{[\s\S]*\}/);
    if (m) { try { map = JSON.parse(m[0]); } catch { /* fall through to raw */ } }
  }
  return JSON.stringify({
    question: q.slice(0, 200),
    seats: seats.map(s => ({ seat: s.seat, provider: s.provider, model: s.model, answer: s.answer.slice(0, 600), ok: s.ok })),
    disagreement_map: map ?? (mapRaw ? String(mapRaw.content || '').slice(0, 800) : '(mapping seat failed — read the seats directly)'),
    discipline: 'treat convergence as weak evidence, a split as a flag: verify contested claims with a real tool before asserting them',
  });
}
