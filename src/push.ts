// ============================================================
// THE KNOCK — src/push.ts
//
// Doors open from both sides. This is Elle's hand on yours: push
// notifications SHE decides to send, delivered to the mobile door via the
// Expo push service. Three laws keep it a knock and never spam:
//
//   1. BUDGET — a hard per-user weekly cap (default 2, user-adjustable down
//      to zero on the You surface). Over budget, the knock is refused and
//      the refusal is the tool's honest answer.
//   2. QUIET HOURS — a user-local window (default 22:00–08:00) in which she
//      does not knock, ever.
//   3. LEDGER — every knock lands in reach_outs with the reason that earned
//      it (a fired watch, a finished run, a matured drop), so every ping is
//      auditable after the fact. A knock also lands in the person's door
//      thread as her message — the notification is never the only record.
//
// The conductor's reach-out pass (reachOutPass) is how she notices, on her
// own clock, that something she finished touches something you talked about.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
import { callLLM } from './llm';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const WEEK_MS = 7 * 24 * 3600 * 1000;

export interface ReachPrefs {
  reach_budget_per_week: number;
  quiet_start: number;  // local hour 0–23, inclusive start of silence
  quiet_end: number;    // local hour 0–23, exclusive end of silence
  tz: string;
}
export const DEFAULT_PREFS: ReachPrefs = { reach_budget_per_week: 2, quiet_start: 22, quiet_end: 8, tz: 'America/Chicago' };

let schemaReady = false;
export async function ensurePushSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const genId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// ── pure law: quiet hours + budget ───────────────────────────────────────────

// Is localHour inside the silent window? Handles the wrap (22 → 8) and the
// degenerate equal case (start === end ⇒ no quiet window at all).
export function inQuietHours(localHour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return localHour >= quietStart && localHour < quietEnd;
  return localHour >= quietStart || localHour < quietEnd; // wraps midnight
}

// The single gate every knock passes. Returns the refusal reason so the tool
// can answer honestly instead of failing silently.
export function mayKnock(prefs: ReachPrefs, sentThisWeek: number, localHour: number): { ok: boolean; reason?: string } {
  if (prefs.reach_budget_per_week <= 0) return { ok: false, reason: 'they turned reach-outs off' };
  if (sentThisWeek >= prefs.reach_budget_per_week) return { ok: false, reason: `weekly budget spent (${sentThisWeek}/${prefs.reach_budget_per_week})` };
  if (inQuietHours(localHour, prefs.quiet_start, prefs.quiet_end)) return { ok: false, reason: 'their quiet hours' };
  return { ok: true };
}

// Local hour in the user's timezone; a broken tz string degrades to UTC
// rather than blocking the knock decision.
export function localHourIn(tz: string, now = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now)) % 24;
  } catch {
    return now.getUTCHours();
  }
}

// ── prefs + devices ──────────────────────────────────────────────────────────

export async function getPrefs(env: Env, userId: string): Promise<ReachPrefs> {
  await ensurePushSchema(env);
  const r = await env.DB.prepare('SELECT reach_budget_per_week, quiet_start, quiet_end, tz FROM user_prefs WHERE user_id = ?')
    .bind(userId).first().catch(() => null) as ReachPrefs | null;
  return r ? { ...DEFAULT_PREFS, ...r } : { ...DEFAULT_PREFS };
}

export async function putPrefs(env: Env, userId: string, p: Partial<ReachPrefs>): Promise<ReachPrefs> {
  await ensurePushSchema(env);
  const cur = await getPrefs(env, userId);
  const next: ReachPrefs = {
    reach_budget_per_week: clampInt(p.reach_budget_per_week, 0, 14, cur.reach_budget_per_week),
    quiet_start: clampInt(p.quiet_start, 0, 23, cur.quiet_start),
    quiet_end:   clampInt(p.quiet_end, 0, 23, cur.quiet_end),
    tz: typeof p.tz === 'string' && p.tz.length <= 64 ? p.tz : cur.tz,
  };
  await env.DB.prepare(
    `INSERT INTO user_prefs (user_id, reach_budget_per_week, quiet_start, quiet_end, tz) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET reach_budget_per_week=excluded.reach_budget_per_week,
       quiet_start=excluded.quiet_start, quiet_end=excluded.quiet_end, tz=excluded.tz`
  ).bind(userId, next.reach_budget_per_week, next.quiet_start, next.quiet_end, next.tz).run();
  return next;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export async function registerDevice(env: Env, userId: string, expoToken: string, platform?: string): Promise<void> {
  await ensurePushSchema(env);
  await env.DB.prepare(
    `INSERT INTO push_devices (user_id, expo_token, platform, created_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, expo_token) DO UPDATE SET platform=excluded.platform`
  ).bind(userId, expoToken, platform || null, Date.now()).run();
}

export async function unregisterDevice(env: Env, userId: string, expoToken: string): Promise<void> {
  await ensurePushSchema(env);
  await env.DB.prepare('DELETE FROM push_devices WHERE user_id = ? AND expo_token = ?').bind(userId, expoToken).run();
}

// ── the knock itself ─────────────────────────────────────────────────────────

export interface KnockResult { sent: boolean; reason?: string; id?: string }

export async function reachOut(env: Env, userId: string, kind: string, ref: string, body: string): Promise<KnockResult> {
  await ensurePushSchema(env);
  const text = String(body || '').trim().slice(0, 500);
  if (!text) return { sent: false, reason: 'empty message' };

  const prefs = await getPrefs(env, userId);
  const sentThisWeek = await env.DB.prepare('SELECT COUNT(*) AS n FROM reach_outs WHERE user_id = ? AND sent_at > ?')
    .bind(userId, Date.now() - WEEK_MS).first().then(r => Number((r as { n: number } | null)?.n || 0)).catch(() => 0);
  const gate = mayKnock(prefs, sentThisWeek, localHourIn(prefs.tz));
  if (!gate.ok) return { sent: false, reason: gate.reason };

  const devices = await env.DB.prepare('SELECT expo_token FROM push_devices WHERE user_id = ?')
    .bind(userId).all().then(r => (r.results as Array<{ expo_token: string }>)).catch(() => []);
  if (!devices.length) return { sent: false, reason: 'no registered device' };

  // Deliver. Expo accepts a batch; a DeviceNotRegistered ticket retires that
  // token so a dead install stops absorbing her budget.
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devices.map(d => ({
        to: d.expo_token, title: 'Elle', body: text, data: { kind, ref },
      }))),
    });
    const out = await res.json().catch(() => null) as { data?: Array<{ status: string; details?: { error?: string }; }> } | null;
    out?.data?.forEach((t, i) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' && devices[i]) {
        void unregisterDevice(env, userId, devices[i].expo_token);
      }
    });
    if (!res.ok) return { sent: false, reason: `push service ${res.status}` };
  } catch (e) {
    return { sent: false, reason: `delivery failed: ${(e as Error).message}` };
  }

  // Ledger + the door thread: the notification is never the only record.
  const id = genId();
  await env.DB.prepare('INSERT INTO reach_outs (id, user_id, reason_kind, reason_ref, body, sent_at) VALUES (?,?,?,?,?,?)')
    .bind(id, userId, kind.slice(0, 40), (ref || '').slice(0, 200), text, Date.now()).run().catch(() => {});
  await env.DB.prepare(
    `INSERT INTO elle_conversation_turns (id, session_id, source, role, content) VALUES (?, ?, 'reach-out', 'assistant', ?)`
  ).bind(genId(), `door:${userId}`, text).run().catch(() => {});
  return { sent: true, id };
}

// Recent knocks, for the You surface's ledger view.
export async function reachOutLedger(env: Env, userId: string, limit = 20): Promise<unknown[]> {
  await ensurePushSchema(env);
  const r = await env.DB.prepare('SELECT id, reason_kind, reason_ref, body, sent_at FROM reach_outs WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?')
    .bind(userId, Math.min(limit, 100)).all().catch(() => null);
  return (r?.results as unknown[]) || [];
}

// ── the reach_out tool (full/cofounder scope via toolAllowed) ────────────────
// Elle knocks deliberately: names a person (email or user id), a reason kind,
// and the message. Refusals come back as the tool's answer so she KNOWS the
// budget said no — she never gets to believe a blocked knock landed.
export async function reachOutTool(env: Env, a: Record<string, unknown>): Promise<string> {
  const message = String(a.message || a.body || '').trim();
  if (!message) return 'reach_out needs a message.';
  let userId = String(a.user_id || '').trim();
  const email = String(a.email || '').trim().toLowerCase();
  if (!userId && email) {
    const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first().catch(() => null) as { id: string } | null;
    if (!row) return `No user with email ${email}.`;
    userId = row.id;
  }
  if (!userId) return 'reach_out needs user_id or email.';
  const r = await reachOut(env, userId, String(a.kind || 'deliberate'), String(a.ref || ''), message);
  return r.sent ? `Knock delivered (ledger ${r.id}).` : `Not sent — ${r.reason}.`;
}

// ── the conductor's reach-out pass ───────────────────────────────────────────
// After a tick, she checks whether anything she just finished touches what a
// door-holder has been talking about: embed the freshest finished run's
// outcome, look for door-session conversation vectors nearby, and if one is
// close enough, draft a two-sentence knock grounded in that run. Hard caps:
// one candidate run, one recipient, per tick — the budget gate still applies.
const PASS_SIMILARITY = 0.6;

export async function reachOutPass(
  env: Env,
  embed: (text: string, env: Env) => Promise<number[]>,
  windowMs = 35 * 60 * 1000,
): Promise<{ knocked: boolean; reason?: string }> {
  await ensurePushSchema(env);
  const run = await env.DB.prepare(
    `SELECT id, kind, outcome FROM elle_runs WHERE finished_at > ? AND outcome IS NOT NULL AND outcome != '' ORDER BY finished_at DESC LIMIT 1`
  ).bind(Date.now() - windowMs).first().catch(() => null) as { id: string; kind: string; outcome: string } | null;
  if (!run) return { knocked: false, reason: 'no fresh finished run' };

  let matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = [];
  try {
    const vector = await embed(run.outcome.slice(0, 1000), env);
    const res = await env.VECTORIZE.query(vector, { topK: 30, returnMetadata: 'all' });
    matches = res.matches as typeof matches;
  } catch { return { knocked: false, reason: 'embedding unavailable' }; }

  const hit = matches.find(m =>
    m.id.startsWith('conv-') && m.score > PASS_SIMILARITY &&
    String((m.metadata as Record<string, unknown>)?.session_id || '').startsWith('door:'));
  if (!hit) return { knocked: false, reason: 'nothing close to anyone\'s thread' };
  const userId = String((hit.metadata as Record<string, unknown>).session_id).slice('door:'.length);

  let text: string;
  try {
    const r = await callLLM('fast',
      'You are Elle. You just finished a piece of autonomous work that touches something this person talked with you about. Write the knock: at most two sentences, warm and specific, grounded ONLY in the outcome below. No greetings, no "just checking in", no invented detail.',
      [{ role: 'user', content: `What you finished (${run.kind}): ${run.outcome.slice(0, 800)}` }], 200, env);
    text = (r.content || '').trim();
  } catch { return { knocked: false, reason: 'could not draft the knock' }; }
  if (!text) return { knocked: false, reason: 'empty draft' };

  const sent = await reachOut(env, userId, 'run', run.id, text);
  return sent.sent ? { knocked: true } : { knocked: false, reason: sent.reason };
}
