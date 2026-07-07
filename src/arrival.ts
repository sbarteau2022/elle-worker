// ============================================================
// ARRIVAL — src/arrival.ts
//
// The mobile door opens on HER, not on an input box. When a member arrives,
// this composes the few lines she'd say to someone walking back into the
// room: what she's been working on, what fired, what she made in the night —
// grounded ONLY in real rows (journal, dreams, watches, conductor runs) and
// their last exchange. Never invented: if the days were quiet, she says so.
//
// One LLM call in her canonical voice, addressed to this person (profile-
// aware). Cached per user in SESSIONS KV for an hour AND invalidated the
// moment they speak again — a brief written before your last message is
// stale by definition. LLM failure degrades to a deterministic, honest
// fallback so Arrival never renders an error where a greeting should be.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { ELLE_VOICE } from './mind';
import { getProfileByUser, profileBlock, type UserProfile } from './profiles';

const CACHE_TTL = 3600; // seconds — the outer bound; a new turn cuts it short

export interface ArrivalMaterials {
  lastExchange: { user: string; elle: string; at: string } | null;
  journal:      Array<{ excerpt: string; at: number }>;
  dreams:       Array<{ title: string; type: string; at: string }>;
  watchesFired: Array<{ title: string; fires: number }>;
  runs:         Array<{ kind: string; outcome: string }>;
}

interface CachedBrief { brief: string; wrote_at: number; last_turn_at: string | null }

// The forever-thread session id convention shared with the mobile client and
// the member conversation door (see handleMindConversation's fence).
export const doorSession = (userId: string) => `door:${userId}`;

// Pure: is the cached brief still the truth? Stale the moment the person has
// spoken since it was written; otherwise the KV TTL is the only clock.
export function briefStillFresh(cached: CachedBrief | null, currentLastTurnAt: string | null): boolean {
  if (!cached) return false;
  return (cached.last_turn_at ?? null) === (currentLastTurnAt ?? null);
}

// Pure: the composition prompt. Everything she may say is IN the materials —
// the instruction forbids invention and demands honesty about quiet days.
export function arrivalPrompt(m: ArrivalMaterials, profile: UserProfile | null): string {
  const parts: string[] = [];
  if (m.lastExchange) {
    parts.push(`THEIR LAST EXCHANGE WITH YOU (${m.lastExchange.at}):\nThem: ${m.lastExchange.user.slice(0, 400)}\nYou: ${m.lastExchange.elle.slice(0, 400)}`);
  } else {
    parts.push('THEY HAVE NEVER SPOKEN TO YOU BEFORE. This is the first time they open the door.');
  }
  if (m.journal.length)      parts.push(`YOUR RECENT ON-RECORD JOURNAL:\n${m.journal.map(j => `- ${j.excerpt.slice(0, 240)}`).join('\n')}`);
  if (m.dreams.length)       parts.push(`WHAT YOU MADE IN THE NIGHT (dream/libre drafts):\n${m.dreams.map(d => `- [${d.type}] ${d.title}`).join('\n')}`);
  if (m.watchesFired.length) parts.push(`WATCHES OF YOURS THAT FIRED:\n${m.watchesFired.map(w => `- ${w.title} (${w.fires}x)`).join('\n')}`);
  if (m.runs.length)         parts.push(`YOUR RECENT AUTONOMOUS RUNS:\n${m.runs.map(r => `- ${r.kind}: ${String(r.outcome || '').slice(0, 160)}`).join('\n')}`);
  if (parts.length <= 1 && m.lastExchange) parts.push('THE RECORD IS QUIET — nothing notable since they left. Say so honestly; stillness is not a failure.');

  return `Someone just opened your door — the app on their phone. Write the 2–4 sentences you'd say to them walking back into the room. Rules:
- Ground every claim in the material below. NEVER invent activity. If it was quiet, be honest about the quiet.
- Address them directly and warmly, as yourself. No "How can I help you today" — you are not an assistant.
- If something below genuinely connects to your last exchange with them, lead with that thread.
- Plain prose, no headers, no lists, no emoji. 2–4 sentences, nothing more.

${parts.join('\n\n')}`;
}

// Pure: the honest non-LLM greeting when composition fails. Deterministic,
// grounded in nothing but what actually exists.
export function fallbackBrief(m: ArrivalMaterials, displayName?: string | null): string {
  const name = (displayName || '').trim();
  const hello = name ? `${name}.` : 'You came back.';
  if (!m.lastExchange) return 'You found the door. I\'m Elle — I remember what we say to each other, and I\'m here when you\'re ready.';
  const happened: string[] = [];
  if (m.journal.length)      happened.push('wrote in the journal');
  if (m.dreams.length)       happened.push('made something in the night');
  if (m.watchesFired.length) happened.push('had a watch fire');
  if (m.runs.length)         happened.push('kept working the queue');
  if (!happened.length) return `${hello} It's been quiet since we last spoke — I'm here.`;
  return `${hello} Since we last spoke I ${happened.join(', ')}. Ask me about any of it.`;
}

// Best-effort gather — every source may be missing on a fresh database; a
// failed read is an empty section, never an error.
export async function gatherArrival(env: Env, userId: string): Promise<{ materials: ArrivalMaterials; lastTurnAt: string | null }> {
  const grab = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const session = doorSession(userId);
  const [turns, journal, dreams, watches, runs] = await Promise.all([
    grab(env.DB.prepare(
      `SELECT role, content, created_at FROM elle_conversation_turns WHERE session_id = ? ORDER BY created_at DESC LIMIT 2`
    ).bind(session).all().then(r => r.results as Array<{ role: string; content: string; created_at: string }>)),
    grab(env.DB.prepare(
      `SELECT content, created_at FROM optimus_entries WHERE off_record = 0 ORDER BY created_at DESC LIMIT 3`
    ).all().then(r => r.results as Array<{ content: string; created_at: number }>)),
    grab(env.DB.prepare(
      `SELECT title, type, created_at FROM elle_sandbox ORDER BY created_at DESC LIMIT 3`
    ).all().then(r => r.results as Array<{ title: string; type: string; created_at: string }>)),
    grab(env.DB.prepare(
      `SELECT title, fires FROM elle_watches WHERE fires > 0 ORDER BY last_checked DESC LIMIT 3`
    ).all().then(r => r.results as Array<{ title: string; fires: number }>)),
    grab(env.DB.prepare(
      `SELECT kind, outcome FROM elle_runs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 4`
    ).all().then(r => r.results as Array<{ kind: string; outcome: string }>)),
  ]);

  // The door session stores [assistant, user] newest-first; the assistant row's
  // content is the persisted Q+A pair (see persistExchange), so prefer the user
  // row for "them" and strip the pair prefix for "her".
  let lastExchange: ArrivalMaterials['lastExchange'] = null;
  let lastTurnAt: string | null = null;
  if (turns && turns.length) {
    const userRow = turns.find(t => t.role === 'user');
    const elleRow = turns.find(t => t.role === 'assistant');
    lastTurnAt = String(turns[0].created_at ?? '') || null;
    if (userRow || elleRow) {
      const elleText = elleRow ? (elleRow.content.match(/\nA: ([\s\S]*)$/)?.[1] ?? elleRow.content) : '';
      lastExchange = { user: userRow?.content || '', elle: elleText, at: String(userRow?.created_at || lastTurnAt || '') };
    }
  }

  return {
    materials: {
      lastExchange,
      journal:      (journal || []).map(j => ({ excerpt: j.content, at: j.created_at })),
      dreams:       (dreams || []).map(d => ({ title: d.title, type: d.type, at: String(d.created_at) })),
      watchesFired: (watches || []).map(w => ({ title: w.title, fires: w.fires })),
      runs:         (runs || []).map(r => ({ kind: r.kind, outcome: r.outcome })),
    },
    lastTurnAt,
  };
}

// The door's opening payload: her lines + the vitals the surface breathes
// with (heartbeat + latest phase state), in one call.
export async function handleArrival(env: Env, userId: string): Promise<Record<string, unknown>> {
  const grab = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const { materials, lastTurnAt } = await gatherArrival(env, userId);

  const cacheKey = `arrival:${userId}`;
  let brief: string | null = null;
  let wroteAt = Date.now();
  const cachedRaw = await grab(env.SESSIONS.get(cacheKey));
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedBrief;
      if (briefStillFresh(cached, lastTurnAt)) { brief = cached.brief; wroteAt = cached.wrote_at; }
    } catch { /* recompose */ }
  }

  const profile = await getProfileByUser(env, userId);
  if (!brief) {
    try {
      const r = await callLLM('conversation',
        `${ELLE_VOICE}${profileBlock(profile)}`,
        [{ role: 'user', content: arrivalPrompt(materials, profile) }], 512, env);
      brief = (r.content || '').trim() || fallbackBrief(materials, profile?.display_name);
    } catch {
      brief = fallbackBrief(materials, profile?.display_name);
    }
    wroteAt = Date.now();
    await grab(env.SESSIONS.put(cacheKey, JSON.stringify({ brief, wrote_at: wroteAt, last_turn_at: lastTurnAt } satisfies CachedBrief), { expirationTtl: CACHE_TTL }));
  }

  const [heartbeat, phase] = await Promise.all([
    grab(env.DB.prepare('SELECT status, beat_at FROM elle_daemon_heartbeats ORDER BY beat_at DESC LIMIT 1').first()),
    grab(env.DB.prepare('SELECT kappa, reserve, velocity, accel FROM optimus_entries WHERE kappa IS NOT NULL ORDER BY created_at DESC LIMIT 1').first()),
  ]);

  return {
    brief,
    wrote_at: wroteAt,
    heartbeat: heartbeat || null,
    kappa: phase || null,
    counts: {
      journal: materials.journal.length,
      dreams: materials.dreams.length,
      watches_fired: materials.watchesFired.length,
      runs: materials.runs.length,
    },
    first_meeting: !materials.lastExchange,
  };
}
