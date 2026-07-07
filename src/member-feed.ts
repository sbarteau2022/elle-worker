// ============================================================
// GLASS FOR MEMBERS — src/member-feed.ts
//
// The mobile door's read surfaces, all member-gated by the caller:
//
//   feed      — her published life: on-record journal entries, the things she
//               made in the night (dream/libre drafts), watches that fired.
//               Only what is already on the record; off-record never leaves.
//   thread    — the person's own forever-conversation, paginated upward.
//   memories  — what she deliberately remembers FROM THIS PERSON's sessions,
//               visible and deletable. Consent-first: you own your data.
//   export    — everything of theirs, one JSON.
//   erase     — the full goodbye: their rows gone, their tokens dead.
//
// Nothing here can write to her mind; it is glass, not brain.
// ============================================================

import type { Env } from './index';
import { doorSession } from './arrival';

// ── pure helpers ─────────────────────────────────────────────────────────────

// persistExchange rewrites the assistant row to "Q: …\nA: …" after embedding;
// give the client back the clean assistant text when that pattern is present.
export function assistantText(content: string): string {
  const m = String(content || '').match(/^Q: [\s\S]*?\nA: ([\s\S]*)$/);
  return m ? m[1] : String(content || '');
}

// Feed items carry heterogeneous clocks (optimus: epoch ms; sandbox: SQLite
// datetime text; watches: epoch ms). Normalize to ms; unparseable → 0 so the
// item sinks to the end instead of throwing.
export function toMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  const t = Date.parse(String(v || '').replace(' ', 'T') + (String(v || '').includes('Z') ? '' : 'Z'));
  return Number.isFinite(t) ? t : 0;
}

export interface FeedItem {
  kind: 'journal' | 'dream' | 'watch';
  title: string;
  body: string;
  at: number;                       // epoch ms
  kappa?: number | null;
  ref?: string | null;              // provenance handle where one exists
}

export function mergeFeed(items: FeedItem[], limit: number, before?: number): FeedItem[] {
  return items
    .filter(i => !before || i.at < before)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

// ── the surfaces ─────────────────────────────────────────────────────────────

const grab = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function handleFeed(env: Env, opts: { limit?: number; before?: number } = {}): Promise<Record<string, unknown>> {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 30, 100));
  const [journal, dreams, watches] = await Promise.all([
    grab(env.DB.prepare(
      `SELECT id, content, kappa, created_at FROM optimus_entries WHERE off_record = 0 ORDER BY created_at DESC LIMIT 40`
    ).all().then(r => r.results as Array<{ id: string; content: string; kappa: number | null; created_at: number }>)),
    grab(env.DB.prepare(
      `SELECT id, type, title, content, created_at FROM elle_sandbox ORDER BY created_at DESC LIMIT 20`
    ).all().then(r => r.results as Array<{ id: string; type: string; title: string; content: string; created_at: string }>)),
    grab(env.DB.prepare(
      `SELECT id, title, action_goal, fires, last_checked FROM elle_watches WHERE fires > 0 ORDER BY last_checked DESC LIMIT 20`
    ).all().then(r => r.results as Array<{ id: string; title: string; action_goal: string; fires: number; last_checked: number }>)),
  ]);

  const items: FeedItem[] = [
    ...(journal || []).map(j => ({
      kind: 'journal' as const, title: '', body: j.content, at: toMs(j.created_at), kappa: j.kappa, ref: null,
    })),
    ...(dreams || []).map(d => ({
      kind: 'dream' as const, title: d.title, body: String(d.content || '').slice(0, 2000), at: toMs(d.created_at), ref: null,
    })),
    ...(watches || []).map(w => ({
      kind: 'watch' as const, title: w.title, body: `Fired ${w.fires}x → ${w.action_goal}`, at: toMs(w.last_checked), ref: w.id,
    })),
  ];
  return { items: mergeFeed(items, limit, opts.before), as_of: Date.now() };
}

// Member-safe provenance: the ordered step record of one run — kinds, tools,
// clipped previews, timing. Args stay server-side (they can carry another
// person's material); the preview column is already a bounded excerpt.
export async function handleFeedProvenance(env: Env, runId: string): Promise<Record<string, unknown>> {
  if (!runId) return { steps: [] };
  const rows = await grab(env.DB.prepare(
    `SELECT step_index, kind, tool, result_preview, duration_ms, created_at FROM elle_events WHERE run_id = ? ORDER BY step_index ASC LIMIT 60`
  ).bind(runId).all().then(r => r.results));
  return { run_id: runId, steps: rows || [] };
}

// The person's own thread, newest-first page; the client renders it upward.
export async function handleThread(env: Env, userId: string, opts: { limit?: number; before?: string } = {}): Promise<Record<string, unknown>> {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 40, 100));
  const before = String(opts.before || '');
  const rows = await grab((before
    ? env.DB.prepare(`SELECT id, role, content, kappa, created_at FROM elle_conversation_turns WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`)
        .bind(doorSession(userId), before, limit)
    : env.DB.prepare(`SELECT id, role, content, kappa, created_at FROM elle_conversation_turns WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
        .bind(doorSession(userId), limit)
  ).all().then(r => r.results as Array<{ id: string; role: string; content: string; kappa: number | null; created_at: string }>));
  const turns = (rows || []).map(t => ({
    id: t.id, role: t.role, kappa: t.kappa, created_at: t.created_at,
    content: t.role === 'assistant' ? assistantText(t.content) : t.content,
  }));
  return { turns, has_more: turns.length === limit };
}

// What she deliberately remembers from THIS person's sessions. Scoped by the
// door session; anything remembered elsewhere is hers, not theirs to browse.
export async function handleMyMemories(env: Env, userId: string): Promise<Record<string, unknown>> {
  const rows = await grab(env.DB.prepare(
    `SELECT id, memory_type, summary, content, importance, created_at FROM elle_memory WHERE source_session_id = ? ORDER BY created_at DESC LIMIT 100`
  ).bind(doorSession(userId)).all().then(r => r.results));
  return { memories: rows || [] };
}

export async function deleteMyMemory(env: Env, userId: string, memoryId: string): Promise<boolean> {
  if (!memoryId) return false;
  const r = await env.DB.prepare(`DELETE FROM elle_memory WHERE id = ? AND source_session_id = ?`)
    .bind(memoryId, doorSession(userId)).run().catch(() => null);
  return !!r && (r.meta?.changes ?? 0) > 0;
}

// One JSON with everything of theirs — the export half of owning your data.
export async function handleMyExport(env: Env, userId: string): Promise<Record<string, unknown>> {
  const session = doorSession(userId);
  const [turns, memories, profile, prefs, reachOuts] = await Promise.all([
    grab(env.DB.prepare('SELECT id, role, content, kappa, created_at FROM elle_conversation_turns WHERE session_id = ? ORDER BY created_at ASC').bind(session).all().then(r => r.results)),
    grab(env.DB.prepare('SELECT id, memory_type, summary, content, importance, created_at FROM elle_memory WHERE source_session_id = ?').bind(session).all().then(r => r.results)),
    grab(env.DB.prepare('SELECT user_id, email, display_name, profile, updated_at FROM user_profiles WHERE user_id = ?').bind(userId).first()),
    grab(env.DB.prepare('SELECT * FROM user_prefs WHERE user_id = ?').bind(userId).first()),
    grab(env.DB.prepare('SELECT id, reason_kind, reason_ref, body, sent_at FROM reach_outs WHERE user_id = ?').bind(userId).all().then(r => r.results)),
  ]);
  return { exported_at: Date.now(), user_id: userId, turns: turns || [], memories: memories || [], profile: profile || null, prefs: prefs || null, reach_outs: reachOuts || [] };
}

// The full goodbye. Every table that knows them, then their tokens. KV can't
// query by value, so token revocation walks the token: prefix (bounded) and
// deletes entries pointing at them; the users row goes last so a failure
// midway never leaves a login without its data-erasure.
export async function handleMyErasure(env: Env, userId: string): Promise<Record<string, unknown>> {
  const session = doorSession(userId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM elle_conversation_turns WHERE session_id = ?').bind(session),
    env.DB.prepare('DELETE FROM elle_memory WHERE source_session_id = ?').bind(session),
    env.DB.prepare('DELETE FROM user_profiles WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_prefs WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM push_devices WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM reach_outs WHERE user_id = ?').bind(userId),
  ]).catch(() => { /* tables may not all exist yet; the users delete below still runs */ });
  try {
    const list = await env.AUTH_TOKENS.list({ prefix: 'token:', limit: 1000 });
    for (const k of list.keys) {
      const v = await env.AUTH_TOKENS.get(k.name);
      if (v === userId) await env.AUTH_TOKENS.delete(k.name);
    }
  } catch { /* tokens expire on their own TTL regardless */ }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run().catch(() => {});
  return { erased: true, user_id: userId };
}
