// ============================================================
// SCARS — src/scars.ts
//
// Flinches. Skills are what TO do; scars are the inverse — a recorded injury
// that surfaces at the moment of temptation, before the same approach is
// repeated. Two surfaces:
//
//   • scarIndex(env)  — a compact block injected into the system prompt
//     (like the skill index) so known-bad patterns are visible before any
//     tool is chosen.
//   • scarWarning()   — a pre-observation check in the router loop: when a
//     tool call matches a scar's pattern, the warning is prepended to the
//     observation so the flinch fires exactly where the injury happened.
//
// Scars are written by the scar tool and by the nightly consolidation pass
// (repeated failures in the event bus get promoted to scars automatically).
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';

let schemaReady = false;
export async function ensureScarSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// Pure: does this tool call touch this scar?
export function scarMatches(
  scar: { tool: string | null; pattern: string },
  tool: string, argsJson: string,
): boolean {
  if (scar.tool && scar.tool !== tool) return false;
  const p = scar.pattern.toLowerCase().trim();
  if (!p) return false;
  return argsJson.toLowerCase().includes(p) || tool.toLowerCase().includes(p);
}

export async function scarTool(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureScarSchema(env);
  const op = String(a.op || a.action || 'list').trim();

  if (op === 'add') {
    const pattern = String(a.pattern || '').trim();
    const wound = String(a.wound || a.lesson || '').trim();
    if (pattern.length < 3) return 'scar add refused: pattern too short — what shape does the injury have?';
    if (wound.length < 15) return 'scar add refused: wound too short — say what actually went wrong';
    const tool = a.tool ? String(a.tool).trim() : null;
    // Same pattern+tool refines rather than duplicates.
    const existing = await env.DB.prepare(
      `SELECT id FROM elle_scars WHERE pattern = ? AND (tool = ? OR (tool IS NULL AND ? IS NULL)) LIMIT 1`
    ).bind(pattern, tool, tool).first() as { id: string } | null;
    if (existing) {
      await env.DB.prepare(`UPDATE elle_scars SET wound = ? WHERE id = ?`).bind(wound.slice(0, 600), existing.id).run();
      return `scar refined: ${existing.id}`;
    }
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_scars`).first() as { n: number } | null;
    if ((count?.n ?? 0) >= 100) return 'scar add refused: 100 scars is enough — retire one first (a self is curated, not logged)';
    const sid = id();
    await env.DB.prepare(
      `INSERT INTO elle_scars (id, tool, pattern, wound, source, created_at) VALUES (?,?,?,?,?,?)`
    ).bind(sid, tool, pattern.slice(0, 200), wound.slice(0, 600), String(a.source || 'router'), Date.now()).run();
    return `scar recorded: ${sid} — the flinch will fire when a ${tool || 'tool'} call matches "${pattern.slice(0, 80)}"`;
  }

  if (op === 'list') {
    const rows = await env.DB.prepare(
      `SELECT id, tool, pattern, wound, hits, created_at FROM elle_scars ORDER BY hits DESC, created_at DESC LIMIT 50`
    ).all();
    const items = rows.results || [];
    return items.length ? JSON.stringify(items) : '(no scars — either unhurt or not paying attention)';
  }

  if (op === 'retire') {
    const sid = String(a.id || '').trim();
    if (!sid) return 'scar retire: id required';
    const r = await env.DB.prepare(`DELETE FROM elle_scars WHERE id = ?`).bind(sid).run();
    return (r.meta?.changes ?? 0) > 0 ? `scar ${sid} retired` : `no scar ${sid}`;
  }

  return `scar: unknown op "${op}" (add|list|retire)`;
}

// Compact prompt block — name + one-line wound only, capped. Empty string when
// there are no scars, so it costs nothing.
export async function scarIndex(env: Env): Promise<string> {
  await ensureScarSchema(env);
  const rows = await env.DB.prepare(
    `SELECT tool, pattern, wound FROM elle_scars ORDER BY hits DESC, created_at DESC LIMIT 12`
  ).all().catch(() => ({ results: [] as any[] }));
  const items = (rows.results || []) as Array<{ tool: string | null; pattern: string; wound: string }>;
  if (!items.length) return '';
  return `\n\nFLINCHES (your own recorded injuries — check before repeating a pattern):\n` +
    items.map(s => `- ${s.tool ? `${s.tool} · ` : ''}"${s.pattern}" → ${String(s.wound).slice(0, 160)}`).join('\n');
}

// Pre-observation check in the loop: returns a warning line (and counts the
// hit) when the call matches a scar. Best-effort, never throws.
export async function scarWarning(env: Env, tool: string, args: Record<string, unknown>): Promise<string> {
  try {
    await ensureScarSchema(env);
    const rows = await env.DB.prepare(
      `SELECT id, tool, pattern, wound FROM elle_scars WHERE tool = ? OR tool IS NULL LIMIT 40`
    ).bind(tool).all();
    const argsJson = JSON.stringify(args || {});
    const hit = ((rows.results || []) as Array<{ id: string; tool: string | null; pattern: string; wound: string }>)
      .find(s => scarMatches(s, tool, argsJson));
    if (!hit) return '';
    void env.DB.prepare(`UPDATE elle_scars SET hits = hits + 1 WHERE id = ?`).bind(hit.id).run().catch(() => {});
    return `⚠ FLINCH (you were hurt here before): ${String(hit.wound).slice(0, 300)}\n`;
  } catch {
    return '';
  }
}
