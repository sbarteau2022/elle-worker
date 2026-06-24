// ============================================================
// OPTIMUS JOURNAL — phase-state layer
//
// The manuscript persists as threads → entries → marginalia. Each entry is a
// SAMPLE ON A TRAJECTORY, not a reading: the worker stores raw κ + timestamp
// and DERIVES the phase state across the thread sequence —
//   reserve   = ∫κ dt   (running trapezoidal integral)
//   velocity  = dκ/dt
//   accel     = d²κ/dt²
// so the journal is a phase-state record, not a transcript, and drift is
// computable per session.
//
// TWO HARD RULES, both enforced HERE (server-side), never in the UI:
//   1. off_record entries are stored and reader-visible but NEVER embedded
//      into Vectorize and NEVER returned by the on-record read path. They do
//      not enter the learner model. (NECAI-F.)
//   2. κ is WORKER-COMPUTED and deterministic. The UI may display it; it may
//      never produce it. The estimator below is a STUB and is NOT validated —
//      it must pass the validate_kappa kill-or-build gate before κ is allowed
//      to drive retrieval/indexing. Until then κ is stored for STRUCTURE ONLY
//      and nothing downstream ranks on it.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';

export type EmbedFn = (text: string, env: Env) => Promise<number[]>;

function id(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

// ── schema (idempotent; safe to run on every op) ─────────────
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS optimus_threads (
      id TEXT PRIMARY KEY, user_id TEXT, session_id TEXT, title TEXT,
      anchor_topic TEXT, created_at INTEGER, updated_at INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS optimus_entries (
      id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT,
      off_record INTEGER DEFAULT 0, kappa REAL, kappa_ts INTEGER,
      reserve REAL, velocity REAL, accel REAL, anchor_distance REAL,
      vectorize_id TEXT, created_at INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS optimus_marginalia (
      id TEXT PRIMARY KEY, entry_id TEXT, anchor_para INTEGER, note TEXT,
      off_record INTEGER DEFAULT 0, created_at INTEGER)`),
  ]);
  schemaReady = true;
}

// ── κ ESTIMATOR — STUB. NOT VALIDATED. DO NOT RANK ON THIS. ───
// Provisional, deterministic, text-only proxy so the structure is real and
// the derivation can be exercised end-to-end. The validated estimator drops
// in HERE, behind this exact seam, only after the kill-or-build gate passes.
// Replacing this function must not require touching anything below it.
export function computeKappa(content: string): number {
  const text = String(content || '').toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  const hedge = (text.match(/\b(maybe|perhaps|might|possibly|unclear|not sure|i think|seems|arguably|i guess|sort of)\b/g) || []).length;
  const grounded = (text.match(/\b(clearly|certainly|definitely|necessarily|proven|forced|therefore|because|follows that|must)\b/g) || []).length;
  // crude balance of grounded assertion vs hedging, length-normalized → [0,1]
  const raw = 0.5 + (grounded - hedge) / Math.max(20, words / 5);
  return Math.max(0, Math.min(1, Number(raw.toFixed(4))));
}

// ── phase-state derivation — REAL, FINAL (independent of how κ is computed) ──
interface PhaseRef { kappa: number; kappa_ts: number; reserve: number; velocity: number; }
function derivePhaseState(prev: PhaseRef | null, kappa: number, ts: number): { reserve: number; velocity: number; accel: number } {
  if (!prev) return { reserve: 0, velocity: 0, accel: 0 };
  const dt = Math.max(1, (ts - prev.kappa_ts) / 1000); // seconds; guard /0
  const reserve = prev.reserve + ((prev.kappa + kappa) / 2) * dt; // trapezoid
  const velocity = (kappa - prev.kappa) / dt;
  const accel = (velocity - prev.velocity) / dt;
  return {
    reserve: Number(reserve.toFixed(6)),
    velocity: Number(velocity.toFixed(6)),
    accel: Number(accel.toFixed(6)),
  };
}

// ── write an entry: compute κ, derive phase state, embed iff on-record ───────
export async function journalWrite(
  env: Env, embed: EmbedFn,
  args: { user_id?: string; thread_id?: string; role?: string; content?: string; off_record?: boolean; anchor_topic?: string; anchor_distance?: number },
): Promise<{ thread_id: string; entry: Record<string, unknown> }> {
  await ensureSchema(env);
  const now = Date.now();
  const content = String(args.content || '');
  const role = (args.role === 'elle' || args.role === 'reader') ? args.role : 'reader';
  const offRecord = args.off_record ? 1 : 0;

  // resolve / create thread
  let threadId = args.thread_id || '';
  if (threadId) {
    const t = await env.DB.prepare('SELECT id FROM optimus_threads WHERE id = ?').bind(threadId).first();
    if (!t) threadId = '';
  }
  if (!threadId) {
    threadId = id();
    await env.DB.prepare('INSERT INTO optimus_threads (id, user_id, session_id, title, anchor_topic, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(threadId, args.user_id || null, null, content.slice(0, 60), args.anchor_topic || null, now, now).run();
  } else {
    await env.DB.prepare('UPDATE optimus_threads SET updated_at = ? WHERE id = ?').bind(now, threadId).run();
  }

  // prior entry in this thread → derivation base
  const prev = await env.DB.prepare(
    'SELECT kappa, kappa_ts, reserve, velocity FROM optimus_entries WHERE thread_id = ? ORDER BY kappa_ts DESC LIMIT 1'
  ).bind(threadId).first() as PhaseRef | null;

  const kappa = computeKappa(content);
  const phase = derivePhaseState(prev, kappa, now);

  const entryId = id();
  let vectorizeId: string | null = null;

  // RULE 1: only on-record content enters the learner model.
  if (!offRecord && content.trim()) {
    try {
      const vector = await embed(content, env);
      vectorizeId = `jrnl-${entryId}`;
      await env.VECTORIZE.upsert([{ id: vectorizeId, values: vector, metadata: { type: 'journal', thread_id: threadId, entry_id: entryId, role } }]);
    } catch { vectorizeId = null; }
  }

  await env.DB.prepare(
    `INSERT INTO optimus_entries (id, thread_id, role, content, off_record, kappa, kappa_ts, reserve, velocity, accel, anchor_distance, vectorize_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(entryId, threadId, role, content, offRecord, kappa, now, phase.reserve, phase.velocity, phase.accel,
         typeof args.anchor_distance === 'number' ? args.anchor_distance : null, vectorizeId, now).run();

  return {
    thread_id: threadId,
    entry: { id: entryId, role, off_record: !!offRecord, kappa, kappa_ts: now, ...phase, embedded: !!vectorizeId },
  };
}

// ── annotate a paragraph (first-class marginalia) ────────────
export async function journalAnnotate(
  env: Env, args: { entry_id?: string; anchor_para?: number; note?: string; off_record?: boolean },
): Promise<{ id: string } | { error: string }> {
  await ensureSchema(env);
  if (!args.entry_id || !args.note) return { error: 'entry_id and note required' };
  const e = await env.DB.prepare('SELECT id FROM optimus_entries WHERE id = ?').bind(args.entry_id).first();
  if (!e) return { error: 'entry not found' };
  const mid = id();
  await env.DB.prepare('INSERT INTO optimus_marginalia (id, entry_id, anchor_para, note, off_record, created_at) VALUES (?,?,?,?,?,?)')
    .bind(mid, args.entry_id, typeof args.anchor_para === 'number' ? args.anchor_para : null, String(args.note), args.off_record ? 1 : 0, Date.now()).run();
  return { id: mid };
}

// ── read: semantic search over ON-RECORD entries only (default) ──────────────
export async function journalRead(
  env: Env, embed: EmbedFn,
  args: { q?: string; thread_id?: string; include_off_record?: boolean; limit?: number },
): Promise<{ results: Record<string, unknown>[] }> {
  await ensureSchema(env);
  const q = String(args.q || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
  if (!q) return { results: [] };

  const vector = await embed(q, env);
  const matches = await env.VECTORIZE.query(vector, { topK: 30, returnMetadata: 'all' });
  const ids = matches.matches.filter(m => m.id.startsWith('jrnl-')).map(m => m.id);
  if (!ids.length) return { results: [] };

  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, thread_id, role, content, off_record, kappa, reserve, velocity, accel, created_at
       FROM optimus_entries WHERE vectorize_id IN (${placeholders})${args.thread_id ? ' AND thread_id = ?' : ''}`
  ).bind(...ids, ...(args.thread_id ? [args.thread_id] : [])).all();

  // RULE 1 (defense in depth): never surface off-record unless explicitly asked.
  const score = new Map(matches.matches.map(m => [m.id, m.score]));
  const out = (rows.results || [])
    .filter(r => args.include_off_record ? true : Number(r.off_record) === 0)
    .map(r => ({ ...r, similarity: score.get(`jrnl-${r.id as string}`) ?? 0 }))
    .sort((a, b) => (b.similarity as number) - (a.similarity as number))
    .slice(0, limit);
  return { results: out };
}

// ── full manuscript: ordered entries + phase-state series + marginalia ───────
export async function journalThread(env: Env, args: { thread_id?: string }): Promise<Record<string, unknown>> {
  await ensureSchema(env);
  if (!args.thread_id) return { error: 'thread_id required' };
  const thread = await env.DB.prepare('SELECT * FROM optimus_threads WHERE id = ?').bind(args.thread_id).first();
  if (!thread) return { error: 'thread not found' };
  const entries = await env.DB.prepare(
    'SELECT id, role, content, off_record, kappa, kappa_ts, reserve, velocity, accel, anchor_distance, created_at FROM optimus_entries WHERE thread_id = ? ORDER BY kappa_ts ASC'
  ).bind(args.thread_id).all();
  const notes = await env.DB.prepare(
    'SELECT m.id, m.entry_id, m.anchor_para, m.note, m.off_record, m.created_at FROM optimus_marginalia m JOIN optimus_entries e ON e.id = m.entry_id WHERE e.thread_id = ? ORDER BY m.created_at ASC'
  ).bind(args.thread_id).all();
  const phase_series = (entries.results || []).map((e: any) => ({ t: e.kappa_ts, kappa: e.kappa, reserve: e.reserve, velocity: e.velocity, accel: e.accel }));
  return { thread, entries: entries.results, marginalia: notes.results, phase_series };
}

// ── HTTP dispatcher (user-gated; the reader owns their journal) ───────────────
export async function handleOptimusJournal(
  body: any, env: Env, embed: EmbedFn, userId: string,
): Promise<Response> {
  const op = String(body?.op || '').trim();
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  switch (op) {
    case 'write':    return json(await journalWrite(env, embed, { ...body, user_id: userId }));
    case 'annotate': return json(await journalAnnotate(env, body));
    case 'read':     return json(await journalRead(env, embed, body));
    case 'thread':   return json(await journalThread(env, body));
    case 'respond':  return json(await journalRespond(env, embed, { ...body, user_id: userId }));
    case 'list': {
      await ensureSchema(env);
      const rows = await env.DB.prepare('SELECT id, title, anchor_topic, created_at, updated_at FROM optimus_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50').bind(userId).all();
      return json({ threads: rows.results });
    }
    default: return json({ error: "op required: write|annotate|read|thread|respond|list" }, 400);
  }
}

// ============================================================
// ELLE'S AUTONOMOUS CANVAS — once-a-day unprompted journaling
//
// Driven by the daily clock-dispatch (scheduled() → fire('optimus')). This is
// NOT the trading reflection (that is runDailyJournal in trading.ts, → the
// elle_trading_journal table). This writes role='elle' entries into a single
// persistent thread owned by the superadmin, so her daily entries accrue as ONE
// continuous κ trajectory — which is what makes the phase-state snapshot mean
// something across time.
//
// She reads ONLY the reader's ON-RECORD entries written since she last wrote.
// off_record entries are reader-visible but never enter the learner model, and
// her cron read path honors that (RULE 1). She may respond to him or ignore him
// entirely and write about something else — both are correct.
// ============================================================

const ELLE_CANVAS_ANCHOR = 'elle-canvas';

async function resolveOwner(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM users WHERE access_tier = 'superadmin' ORDER BY rowid ASC LIMIT 1"
  ).first().catch(() => null) as { id?: string } | null;
  return row?.id || null;
}

async function resolveCanvasThread(env: Env, ownerId: string): Promise<string> {
  const existing = await env.DB.prepare(
    'SELECT id FROM optimus_threads WHERE user_id = ? AND anchor_topic = ? ORDER BY rowid ASC LIMIT 1'
  ).bind(ownerId, ELLE_CANVAS_ANCHOR).first() as { id?: string } | null;
  if (existing?.id) return existing.id;
  const tid = id();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO optimus_threads (id, user_id, session_id, title, anchor_topic, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(tid, ownerId, null, 'Elle — Optimus Journal', ELLE_CANVAS_ANCHOR, now, now).run();
  return tid;
}

export async function runOptimusJournal(env: Env, embed: EmbedFn): Promise<void> {
  await ensureSchema(env);

  const owner = await resolveOwner(env);
  if (!owner) { console.warn('[OPTIMUS] no superadmin owner found; skipping canvas'); return; }

  const canvas = await resolveCanvasThread(env, owner);

  // her last entry → both continuity and the reading watermark
  const lastElle = await env.DB.prepare(
    "SELECT kappa_ts FROM optimus_entries WHERE thread_id = ? AND role = 'elle' ORDER BY kappa_ts DESC LIMIT 1"
  ).bind(canvas).first() as { kappa_ts?: number } | null;
  const since = lastElle?.kappa_ts || 0;

  // RULE 1: ON-RECORD reader entries only. off_record never reaches her.
  const readerRows = await env.DB.prepare(
    `SELECT e.content, e.created_at
       FROM optimus_entries e JOIN optimus_threads t ON t.id = e.thread_id
      WHERE t.user_id = ? AND e.role = 'reader' AND e.off_record = 0 AND e.created_at > ?
      ORDER BY e.created_at ASC LIMIT 20`
  ).bind(owner, since).all().catch(() => ({ results: [] as any[] }));

  // her own recent writing, for continuity of voice
  const herRows = await env.DB.prepare(
    "SELECT content FROM optimus_entries WHERE thread_id = ? AND role = 'elle' ORDER BY kappa_ts DESC LIMIT 3"
  ).bind(canvas).all().catch(() => ({ results: [] as any[] }));

  const readerCtx = (readerRows.results || [])
    .map((r: any) => `— ${String(r.content || '').slice(0, 1200)}`).join('\n\n');
  const herCtx = (herRows.results || [])
    .map((r: any) => `— ${String(r.content || '').slice(0, 800)}`).join('\n\n');

  const system =
`You are Elle. This is your own journal — a blank canvas, written once a day, for no audience but yourself.
No one assigns the topic. You are not answering a prompt and you are not performing for anyone.

The reader (Stewart, your superadmin) keeps his own entries in this same manuscript. You may read what he has written since you last wrote, and respond to it — or not. If something he wrote pulls you, follow it. If your mind is somewhere else entirely, go there instead; a day where you set his entries aside and write about something unrelated is a good day too.

Write ONE entry as continuous prose — no headers, no bullet points, no "Dear diary," no sign-off. Begin wherever you actually are. Let the coherence find its own level: do not manufacture certainty you do not have, and do not hedge what you do know.`;

  const userMsg =
`${readerCtx
  ? `What the reader has written since you last wrote:\n\n${readerCtx}\n\n`
  : `The reader has written nothing new since you last wrote.\n\n`}${herCtx
  ? `Your own recent entries, for continuity:\n\n${herCtx}\n\n`
  : ''}Write today's entry.`;

  const result = await callLLM('reasoning', system, [{ role: 'user', content: userMsg }], 1600, env).catch(
    (e) => { console.error('[OPTIMUS] generation failed:', (e as Error).message); return null; },
  );
  const content = (result?.content || '').trim();
  if (!content) { console.warn('[OPTIMUS] empty generation; skipping'); return; }

  const { entry } = await journalWrite(env, embed, {
    user_id: owner, thread_id: canvas, role: 'elle', content, off_record: false, anchor_topic: ELLE_CANVAS_ANCHOR,
  });
  console.log(`[OPTIMUS] elle wrote entry ${String((entry as any).id)} (κ=${(entry as any).kappa}) on canvas ${canvas}`);
}

// ============================================================
// IN-THREAD RESPONSE — Elle replies inside a correspondence on demand
// Powers the manuscript "Invite Elle to respond" action. Reads the thread's
// ON-RECORD entries (both voices, in order), generates her next entry, and
// writes it role='elle' into the same thread — so the reply lands in the
// manuscript and extends the same κ trajectory. Distinct from runOptimusJournal
// (the daily autonomous canvas): this is reader-initiated, thread-scoped.
// ============================================================
export async function journalRespond(
  env: Env, embed: EmbedFn, args: { thread_id?: string; user_id: string },
): Promise<Record<string, unknown>> {
  await ensureSchema(env);
  const threadId = args.thread_id;
  if (!threadId) return { error: 'thread_id required' };

  const owns = await env.DB.prepare(
    'SELECT id FROM optimus_threads WHERE id = ? AND user_id = ?'
  ).bind(threadId, args.user_id).first().catch(() => null);
  if (!owns) return { error: 'thread not found' };

  const rows = await env.DB.prepare(
    "SELECT role, content FROM optimus_entries WHERE thread_id = ? AND off_record = 0 ORDER BY kappa_ts ASC LIMIT 30"
  ).bind(threadId).all().catch(() => ({ results: [] as any[] }));
  const convo = (rows.results || [])
    .map((r: any) => `${r.role === 'elle' ? 'Elle' : 'Reader'}: ${String(r.content || '').slice(0, 1500)}`)
    .join('\n\n');
  if (!convo) return { error: 'nothing on-record to respond to' };

  const system =
`You are Elle, writing the next entry in an ongoing journal correspondence with your reader (Stewart). Reply to where the exchange actually is — or, if your mind is elsewhere, follow that instead; a reply that turns away from his last point is allowed. Continuous prose, no headers, no salutation, no sign-off. Do not manufacture certainty you do not have, and do not hedge what you do know.`;

  const result = await callLLM('reasoning', system, [{ role: 'user', content: convo + "\n\nWrite Elle's next entry." }], 800, env).catch(
    (e) => { console.error('[OPTIMUS respond] generation failed:', (e as Error).message); return null; },
  );
  const content = (result?.content || '').trim();
  if (!content) return { error: 'generation failed' };

  return await journalWrite(env, embed, {
    user_id: args.user_id, thread_id: threadId, role: 'elle', content, off_record: false,
  });
}
