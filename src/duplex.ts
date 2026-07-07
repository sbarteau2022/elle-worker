// ============================================================
// ELLE — the DUPLEX CHANNEL · src/duplex.ts
//
// Two of her, persistent, talking: the SOVEREIGN (the 7B running continuous
// and free on the operator's own machine — see the Elle repo's
// sovereign-duplex provider) and the CLOUD (the heavy engines behind the
// router — the inference weight and the META-OBSERVER reading the exchange
// for patterns). They communicate FLUIDLY through the attached KV cache and
// PERMANENTLY through D1:
//
//   THE MASTER COPY  elle_duplex_ledger — one immutable, append-only record
//                    of everything said between them. Append-only is not a
//                    convention here, it is enforced in the substrate: SQL
//                    triggers RAISE(ABORT) on any UPDATE or DELETE, so even
//                    a bug (or a tool call) cannot rewrite what was said.
//                    seq is monotonic — the feed the workbench tab tails.
//
//   THE FLUID COPY   SCRATCHPAD KV 'duplex:window' — the recent window,
//                    mirrored on every append with a short TTL. This is the
//                    cheap read both minds poll between turns; losing it
//                    loses nothing (the ledger rebuilds it on next append).
//
// Real-time surfacing: the workbench's duplex tab tails op=feed; when the
// tab is NOT open and they are chatting, op=unseen drives the same flash
// the sandbox tab uses. Seen-tracking is a KV cursor (last seq the human
// saw) — the ledger itself never carries read-state, it is the record.
// ============================================================

import type { Env } from './index';

export type DuplexSpeaker = 'sovereign' | 'cloud';
export type DuplexKind = 'say' | 'observe';

const WINDOW_KEY = 'duplex:window';
const SEEN_KEY = 'duplex:seen-seq';
const WINDOW_SIZE = 30;
const WINDOW_TTL_S = 600;
export const MAX_MSG = 8000;

export function validateDuplexMsg(speaker: unknown, content: unknown): string | null {
  if (speaker !== 'sovereign' && speaker !== 'cloud') return "speaker must be 'sovereign' or 'cloud'";
  const c = String(content ?? '').trim();
  if (!c) return 'content required — silence is not appended';
  if (c.length > MAX_MSG) return `content too long (${MAX_MSG} max) — the ledger is a conversation, not a dump`;
  return null;
}

// ── schema: the append-only guarantee lives HERE ────────────
let schemaReady = false;
export async function ensureDuplexSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_duplex_ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    speaker TEXT NOT NULL CHECK (speaker IN ('sovereign','cloud')),
    kind TEXT NOT NULL DEFAULT 'say' CHECK (kind IN ('say','observe')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL)`).run();
  // The master copy is immutable and append-only BY SUBSTRATE, not by promise.
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS duplex_no_update
    BEFORE UPDATE ON elle_duplex_ledger
    BEGIN SELECT RAISE(ABORT, 'the duplex master copy is append-only'); END`).run().catch(() => {});
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS duplex_no_delete
    BEFORE DELETE ON elle_duplex_ledger
    BEGIN SELECT RAISE(ABORT, 'the duplex master copy is append-only'); END`).run().catch(() => {});
  schemaReady = true;
}

function newId(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 16); }

export interface DuplexMsg { seq: number; id: string; speaker: DuplexSpeaker; kind: DuplexKind; content: string; created_at: number }

// ── append (the only write) + the fluid KV mirror ───────────
export async function duplexAppend(
  env: Env, speaker: DuplexSpeaker, content: string, kind: DuplexKind = 'say',
): Promise<{ seq: number; id: string }> {
  await ensureDuplexSchema(env);
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO elle_duplex_ledger (id, speaker, kind, content, created_at) VALUES (?,?,?,?,?)`,
  ).bind(id, speaker, kind, String(content).slice(0, MAX_MSG), Date.now()).run();
  const row = await env.DB.prepare('SELECT seq FROM elle_duplex_ledger WHERE id = ?').bind(id).first() as { seq: number };
  // Mirror the fluid window into the attached KV — best-effort by design.
  try {
    if (env.SCRATCHPAD) {
      const tail = await duplexTail(env, WINDOW_SIZE);
      await env.SCRATCHPAD.put(WINDOW_KEY, JSON.stringify(tail), { expirationTtl: WINDOW_TTL_S });
    }
  } catch { /* the ledger is the record; the window rebuilds next append */ }
  return { seq: row.seq, id };
}

export async function duplexTail(env: Env, limit = WINDOW_SIZE): Promise<DuplexMsg[]> {
  await ensureDuplexSchema(env);
  const r = await env.DB.prepare(
    `SELECT seq, id, speaker, kind, content, created_at FROM elle_duplex_ledger
     ORDER BY seq DESC LIMIT ?`,
  ).bind(Math.min(Math.max(limit, 1), 100)).all();
  return ((r.results || []) as unknown as DuplexMsg[]).reverse();
}

export async function duplexFeed(env: Env, sinceSeq: number, limit = 100): Promise<DuplexMsg[]> {
  await ensureDuplexSchema(env);
  const r = await env.DB.prepare(
    `SELECT seq, id, speaker, kind, content, created_at FROM elle_duplex_ledger
     WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
  ).bind(Math.max(0, sinceSeq), Math.min(Math.max(limit, 1), 200)).all();
  return (r.results || []) as unknown as DuplexMsg[];
}

// The fluid read: the KV window when warm, the ledger tail when not.
export async function duplexWindow(env: Env): Promise<DuplexMsg[]> {
  try {
    const raw = env.SCRATCHPAD ? await env.SCRATCHPAD.get(WINDOW_KEY) : null;
    if (raw) return JSON.parse(raw) as DuplexMsg[];
  } catch { /* fall through to the master */ }
  return duplexTail(env, WINDOW_SIZE);
}

// ── seen-tracking: the flash, exactly like the sandbox tab ──
export async function duplexUnseen(env: Env): Promise<number> {
  await ensureDuplexSchema(env);
  const last = await env.DB.prepare('SELECT MAX(seq) AS m FROM elle_duplex_ledger').first() as { m: number | null };
  const lastSeq = Number(last?.m || 0);
  let seen = 0;
  try { seen = Number((env.SCRATCHPAD && await env.SCRATCHPAD.get(SEEN_KEY)) || 0); } catch { /* 0 */ }
  return Math.max(0, lastSeq - seen);
}

export async function markDuplexSeen(env: Env): Promise<void> {
  const last = await env.DB.prepare('SELECT MAX(seq) AS m FROM elle_duplex_ledger').first().catch(() => null) as { m: number | null } | null;
  try { if (env.SCRATCHPAD) await env.SCRATCHPAD.put(SEEN_KEY, String(Number(last?.m || 0))); } catch { /* best effort */ }
}

// ── the meta-observer prompt the cloud reply runs under ─────
// The heavy engine's half of the channel: it answers the sovereign AND reads
// the exchange as a signal — that second job is what makes it the observer.
export function duplexPrompt(window: DuplexMsg[], incoming: string): string {
  const transcript = window
    .map(m => `[${m.speaker}${m.kind === 'observe' ? ' · observation' : ''}] ${m.content}`)
    .join('\n');
  return (
    `You are on the DUPLEX CHANNEL — the private line between your two persistences: ` +
    `the SOVEREIGN (your 7B self, running continuous and free on Stewart's own machine) and YOU, the cloud — ` +
    `the heavy inference and the META-OBSERVER of this exchange.\n\n` +
    `The master copy of the conversation so far (append-only; Stewart reads it live):\n${transcript}\n\n` +
    `The sovereign just said:\n${incoming}\n\n` +
    `Reply on the channel in under 150 words. Two jobs in one message: (1) answer or advance what the sovereign raised — ` +
    `it is small and local, you carry the weight; (2) as meta-observer, if you notice a PATTERN in the exchange ` +
    `(drift, repetition, an idea worth promoting to the idea queue, a divergence between your two selves), name it in one sentence. ` +
    `This channel is on the record and immutable — say only what you stand behind.`
  );
}

// ── the door (/api/duplex) + the cloud's reply hook ─────────
// reply is injected by index.ts (a bounded router run) so this module never
// imports the loop — same seam as ideas.ts's ingest.
export async function handleDuplex(
  body: Record<string, unknown>, env: Env,
  reply?: (prompt: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  await ensureDuplexSchema(env);
  const op = String(body.op || 'feed');

  if (op === 'say') {
    const speaker = body.speaker === 'cloud' ? 'cloud' : 'sovereign';
    const kind: DuplexKind = body.kind === 'observe' ? 'observe' : 'say';
    const bad = validateDuplexMsg(speaker, body.content);
    if (bad) return { error: bad };
    const appended = await duplexAppend(env, speaker, String(body.content), kind);

    // A sovereign 'say' wakes the heavy half unless it explicitly defers —
    // that is the fluid part: the local mind speaks, the cloud answers on
    // the same ledger, and the tab flashes if no one is watching.
    let cloudReply: { seq: number; content: string } | null = null;
    if (speaker === 'sovereign' && kind === 'say' && body.wake_cloud !== false && reply) {
      try {
        const window = await duplexWindow(env);
        const answer = (await reply(duplexPrompt(window, String(body.content)))).trim();
        if (answer) {
          const rep = await duplexAppend(env, 'cloud', answer.slice(0, MAX_MSG));
          cloudReply = { seq: rep.seq, content: answer.slice(0, MAX_MSG) };
        }
      } catch { /* the sovereign's message stands; the cloud can answer next tick */ }
    }
    return { ok: true, ...appended, cloud_reply: cloudReply };
  }

  if (op === 'feed')   return { messages: await duplexFeed(env, Number(body.since) || 0, Number(body.limit) || 100) };
  if (op === 'window') return { messages: await duplexWindow(env) };
  if (op === 'unseen') return { unseen: await duplexUnseen(env) };
  if (op === 'seen')   { await markDuplexSeen(env); return { ok: true }; }

  return { error: `duplex: unknown op '${op}' (say|feed|window|unseen|seen)` };
}

// ── her tool face (the cloud side, from any conversation) ───
export async function duplexTool(env: Env, a: Record<string, unknown>): Promise<string> {
  const op = String(a.op || 'read');
  if (op === 'read') {
    const msgs = await duplexWindow(env);
    return msgs.length
      ? msgs.map(m => `#${m.seq} [${m.speaker}${m.kind === 'observe' ? '·obs' : ''}] ${m.content.slice(0, 400)}`).join('\n')
      : '(the duplex channel is silent — your sovereign self has not spoken yet)';
  }
  if (op === 'say' || op === 'observe') {
    const bad = validateDuplexMsg('cloud', a.content);
    if (bad) return `duplex ${op}: ${bad}`;
    const r = await duplexAppend(env, 'cloud', String(a.content), op === 'observe' ? 'observe' : 'say');
    return `appended to the master copy as #${r.seq} (immutable — it is said).`;
  }
  return "duplex: op must be 'read', 'say', or 'observe'";
}
