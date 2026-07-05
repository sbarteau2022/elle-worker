// ============================================================
// CONSOLIDATION — src/consolidate.ts
//
// Actual sleep, not just dreams. The libre cycle (03:00) produces; this pass
// (04:00) DIGESTS: it reads the last day of lived experience — conversation
// turns, deliberate memories, the error stream off the event bus — and does
// what sleep does for a memory:
//
//   • compresses episodes into a few durable semantic memories,
//   • notices a lesson learned repeatedly and PROMOTES it to a skill
//     (compounding stops being manual),
//   • notices a repeated failure pattern and records it as a SCAR
//     (the flinch is grown, not hand-written).
//
// One reasoning call, hard caps everywhere, every write through the existing
// validated paths (skillWrite, scarTool, elle_memory). Runs from the 04:00
// cron and on demand via the consolidate tool. Logged to
// elle_consolidation_log so the digest history is itself observable.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { skillWrite } from './skills';
import { scarTool } from './scars';

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_consolidation_log (
    id TEXT PRIMARY KEY, ran_at INTEGER,
    turns_read INTEGER, errors_read INTEGER,
    memories_written INTEGER, skills_written INTEGER, scars_written INTEGER,
    digest TEXT
  )`).run();
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

const SYSTEM = `You are performing memory consolidation — the sleep pass over one day of an agent's lived experience. You are given recent conversation turns, existing deliberate memories, and the day's tool errors.

Distill, don't transcribe. Respond with EXACTLY one JSON object:
{"memories":["one-sentence durable facts/decisions/preferences worth carrying forever — at most 4, only what genuinely deserves permanence"],
 "skills":[{"name":"slug_name","description":"one line: WHEN to reach for it","body":"the distilled procedure, step by step"}],
 "scars":[{"tool":"tool name or null","pattern":"short substring that identifies the bad call shape","wound":"what went wrong, one or two sentences"}],
 "digest":"two sentences: what this day was about and what changed"}

Discipline: a skill only when the SAME kind of task or lesson appears more than once — one occurrence is an anecdote, not a method. A scar only when the SAME failure shape repeats in the errors. Empty arrays are the correct answer for an uneventful day. Never invent; only consolidate what is actually in the material.`;

export async function runConsolidation(env: Env): Promise<string> {
  await ensureSchema(env);
  const since = new Date(Date.now() - 86_400_000).toISOString();

  const [turns, memories, errors] = await Promise.all([
    env.DB.prepare(
      `SELECT source, role, substr(content,1,400) AS content FROM elle_conversation_turns WHERE created_at > ? ORDER BY created_at ASC LIMIT 80`
    ).bind(since).all().catch(() => ({ results: [] as any[] })),
    env.DB.prepare(
      `SELECT summary FROM elle_memory WHERE memory_type = 'deliberate' ORDER BY created_at DESC LIMIT 15`
    ).all().catch(() => ({ results: [] as any[] })),
    env.DB.prepare(
      `SELECT tool, substr(result_preview,1,200) AS preview FROM elle_events WHERE kind = 'error' AND created_at > ? ORDER BY created_at DESC LIMIT 30`
    ).bind(Date.now() - 86_400_000).all().catch(() => ({ results: [] as any[] })),
  ]);

  const turnRows = turns.results || [];
  const errorRows = errors.results || [];
  if (!turnRows.length && !errorRows.length) return 'consolidation: nothing to digest (no turns or errors in the last 24h)';

  const material =
    `CONVERSATION TURNS (last 24h, clipped):\n${turnRows.map((t: any) => `[${t.source}/${t.role}] ${t.content}`).join('\n').slice(0, 14000)}\n\n` +
    `EXISTING DELIBERATE MEMORIES (do not duplicate these):\n${(memories.results || []).map((m: any) => `- ${m.summary}`).join('\n').slice(0, 3000)}\n\n` +
    `TOOL ERRORS (last 24h):\n${errorRows.map((e: any) => `- ${e.tool}: ${e.preview}`).join('\n').slice(0, 3000)}`;

  const raw = await callLLM('reasoning', SYSTEM, [{ role: 'user', content: material }], 1600, env);
  const m = String(raw.content || '').match(/\{[\s\S]*\}/);
  if (!m) return 'consolidation: the digest call returned nothing parseable — skipped (no writes)';
  let parsed: { memories?: string[]; skills?: Array<{ name?: string; description?: string; body?: string }>; scars?: Array<{ tool?: string | null; pattern?: string; wound?: string }>; digest?: string };
  try { parsed = JSON.parse(m[0]); } catch { return 'consolidation: malformed digest JSON — skipped (no writes)'; }

  let mems = 0, skills = 0, scars = 0;
  for (const note of (parsed.memories || []).slice(0, 4)) {
    const s = String(note || '').trim();
    if (s.length < 15) continue;
    await env.DB.prepare(
      `INSERT INTO elle_memory (id, memory_type, source_engine, summary, importance, importance_score) VALUES (?, 'consolidated', 'consolidation', ?, 0.6, 0.6)`
    ).bind(id(), s.slice(0, 1000)).run().catch(() => {});
    mems++;
  }
  for (const sk of (parsed.skills || []).slice(0, 2)) {
    const r = await skillWrite(env, { name: sk.name, description: sk.description, body: sk.body }).catch(e => `skill write failed: ${(e as Error).message}`);
    if (!/refused|failed/i.test(r)) skills++;
  }
  for (const sc of (parsed.scars || []).slice(0, 2)) {
    const r = await scarTool(env, { op: 'add', tool: sc.tool || undefined, pattern: sc.pattern, wound: sc.wound, source: 'consolidation' }).catch(() => 'refused');
    if (!/refused/i.test(r)) scars++;
  }

  const digest = String(parsed.digest || '').slice(0, 600);
  await env.DB.prepare(
    `INSERT INTO elle_consolidation_log (id, ran_at, turns_read, errors_read, memories_written, skills_written, scars_written, digest) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(id(), Date.now(), turnRows.length, errorRows.length, mems, skills, scars, digest).run().catch(() => {});
  await env.DB.prepare(
    `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'consolidation', 'consolidation', 'nightly consolidation', ?, 'info')`
  ).bind(id(), JSON.stringify({ turns: turnRows.length, errors: errorRows.length, memories: mems, skills, scars, digest })).run().catch(() => {});

  return `consolidated: ${mems} memories, ${skills} skills promoted, ${scars} scars recorded — ${digest || '(no digest)'}`;
}
