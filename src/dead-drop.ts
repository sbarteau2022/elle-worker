// ============================================================
// DEAD DROP — src/dead-drop.ts
//
// Context-triggered mail to her future self. The scratchpad lasts minutes,
// memory lasts forever, intents fire on the clock — this is the missing
// fourth: a note that lies dormant until a future CONVERSATION walks past
// its tripwire. "Next time the sandbox comes up, remind him I found the
// config issue." Not time-fired — condition-fired.
//
// The trigger is embedded at write time; each incoming question (full scope,
// top-level) is embedded once and compared by cosine. A keyword hit counts
// too, so short literal triggers ("alpaca", "the forge") work without
// semantic luck. A fired drop is injected into the turn and disarmed.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';

type EmbedFn = (text: string, env: Env) => Promise<number[]>;

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// Pure: cosine similarity over two vectors.
export function cosineSim(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export const DROP_THRESHOLD = 0.60;

// Pure: keyword tripwire — every significant word of a short trigger present
// in the question. Lets literal triggers fire without embedding luck.
export function keywordHit(trigger: string, question: string): boolean {
  const words = trigger.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  if (!words.length || words.length > 6) return false;
  const q = question.toLowerCase();
  return words.every(w => q.includes(w));
}

export async function deadDropTool(env: Env, embed: EmbedFn, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const op = String(a.op || a.action || 'list').trim();

  if (op === 'create') {
    const trigger = String(a.trigger || '').trim();
    const message = String(a.message || a.note || '').trim();
    if (trigger.length < 4) return 'dead_drop create refused: trigger too short — what should trip this?';
    if (message.length < 10) return 'dead_drop create refused: message too short — what is future-you supposed to know?';
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_dead_drops WHERE status = 'armed'`).first() as { n: number } | null;
    if ((count?.n ?? 0) >= 40) return 'dead_drop create refused: 40 armed drops is enough — disarm stale ones first';
    let embedding = '';
    try { embedding = JSON.stringify(await embed(trigger, env)); } catch { /* keyword path still works */ }
    const did = id();
    await env.DB.prepare(
      `INSERT INTO elle_dead_drops (id, trigger_text, message, embedding, created_at) VALUES (?,?,?,?,?)`
    ).bind(did, trigger.slice(0, 300), message.slice(0, 1000), embedding, Date.now()).run();
    return `dead drop armed: ${did} — fires when a conversation walks past "${trigger.slice(0, 80)}"`;
  }

  if (op === 'list') {
    const rows = await env.DB.prepare(
      `SELECT id, trigger_text, message, status, fired_at, created_at FROM elle_dead_drops ORDER BY status = 'armed' DESC, created_at DESC LIMIT 40`
    ).all();
    const items = (rows.results || []).map((r: any) => ({
      id: r.id, trigger: r.trigger_text, message: String(r.message).slice(0, 200),
      status: r.status, fired: r.fired_at ? new Date(Number(r.fired_at)).toISOString() : undefined,
    }));
    return items.length ? JSON.stringify(items) : '(no dead drops)';
  }

  if (op === 'disarm') {
    const did = String(a.id || '').trim();
    if (!did) return 'dead_drop disarm: id required';
    const r = await env.DB.prepare(`UPDATE elle_dead_drops SET status = 'disarmed' WHERE id = ? AND status = 'armed'`).bind(did).run();
    return (r.meta?.changes ?? 0) > 0 ? `dead drop ${did} disarmed` : `no armed drop ${did}`;
  }

  return `dead_drop: unknown op "${op}" (create|list|disarm)`;
}

// Run-start check: fire any armed drop the incoming question trips. Returns a
// prompt block ('' when nothing fires). Best-effort, never fatal to the turn.
export async function checkDeadDrops(env: Env, embed: EmbedFn, question: string): Promise<string> {
  try {
    await ensureSchema(env);
    const rows = await env.DB.prepare(
      `SELECT id, trigger_text, message, embedding FROM elle_dead_drops WHERE status = 'armed' LIMIT 40`
    ).all();
    const armed = (rows.results || []) as Array<{ id: string; trigger_text: string; message: string; embedding: string }>;
    if (!armed.length) return '';
    let qVec: number[] | null = null;
    const fired: Array<{ id: string; message: string }> = [];
    for (const d of armed) {
      let hit = keywordHit(d.trigger_text, question);
      if (!hit && d.embedding) {
        if (!qVec) { try { qVec = await embed(question, env); } catch { qVec = []; } }
        if (qVec && qVec.length) {
          try { hit = cosineSim(qVec, JSON.parse(d.embedding) as number[]) >= DROP_THRESHOLD; } catch { /* skip */ }
        }
      }
      if (hit) fired.push({ id: d.id, message: d.message });
      if (fired.length >= 3) break;
    }
    if (!fired.length) return '';
    const now = Date.now();
    for (const f of fired) {
      void env.DB.prepare(`UPDATE elle_dead_drops SET status = 'fired', fired_at = ? WHERE id = ?`).bind(now, f.id).run().catch(() => {});
    }
    return `\n\nDEAD DROP (you left ${fired.length === 1 ? 'this note' : 'these notes'} for yourself, tripped by this very topic — act on it naturally, never read it aloud):\n` +
      fired.map(f => `- ${f.message}`).join('\n');
  } catch {
    return '';
  }
}
