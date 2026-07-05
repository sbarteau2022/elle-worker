// ============================================================
// TOOL FORGE — src/tool-forge.ts
//
// Self-extension without a merge click. The forge (forge.ts) writes code a
// human accepts into her repos; skills (skills.ts) store prose procedures.
// This is the missing rung between them: she authors a TOOL — real code,
// stored in her own registry — and invokes it through the sandbox. No deploy,
// no PR, no waiting: the catalog stops being fixed anatomy and becomes a
// growing one.
//
// The safety model is inherited, not invented:
//   • execution happens ONLY through the same connect-back sandbox as
//     run_code — if the laptop agent isn't connected, custom tools author
//     fine but report "not configured"/"not open" on invoke, exactly like
//     run_code does;
//   • the registry is data in D1 — nothing here touches her deployed source,
//     which still moves only through the human-merged forge;
//   • every invocation rides the event bus like any tool step (provenance).
//
// tool_forge ops: write | list | read | invoke | retire.
// ============================================================

import type { Env } from './index';
import { sandboxRunCode } from './connect-sandbox';

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_custom_tools (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    args_hint TEXT,
    language TEXT DEFAULT 'python',
    code TEXT NOT NULL,
    status TEXT DEFAULT 'active',    -- active | retired
    runs INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER
  )`).run();
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const slug = (name: string) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export const MAX_TOOL_CODE = 12000;
const LANGUAGES = new Set(['python', 'javascript']);

// The harness hands the stored code its invocation args as `args` (already
// parsed). Args travel base64-encoded so no payload can escape the literal.
function harness(language: string, code: string, argsJson: string): string {
  const b64 = btoa(unescape(encodeURIComponent(argsJson)));
  if (language === 'javascript') {
    return `const args = JSON.parse(Buffer.from("${b64}", "base64").toString("utf8"));\n${code}`;
  }
  return `import json, base64\nargs = json.loads(base64.b64decode("${b64}").decode("utf8"))\n${code}`;
}

export async function toolForgeTool(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const op = String(a.op || a.action || 'list').trim();
  const now = Date.now();

  if (op === 'write') {
    const name = slug(String(a.name || ''));
    const description = String(a.description || '').trim();
    const code = String(a.code || '');
    const language = LANGUAGES.has(String(a.language)) ? String(a.language) : 'python';
    if (!name) return 'tool_forge write refused: name required (lowercase, a-z0-9_-)';
    if (description.length < 15) return 'tool_forge write refused: description too short — say WHEN to reach for this tool';
    if (code.trim().length < 20) return 'tool_forge write refused: code too short to be a tool';
    if (code.length > MAX_TOOL_CODE) return `tool_forge write refused: code too long (max ${MAX_TOOL_CODE} chars)`;
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_custom_tools WHERE status = 'active'`).first() as { n: number } | null;
    const existing = await env.DB.prepare(`SELECT id FROM elle_custom_tools WHERE name = ?`).bind(name).first() as { id: string } | null;
    if (!existing && (count?.n ?? 0) >= 50) return 'tool_forge write refused: 50 active tools is enough — retire one first';
    if (existing) {
      await env.DB.prepare(
        `UPDATE elle_custom_tools SET description = ?, args_hint = ?, language = ?, code = ?, status = 'active', updated_at = ? WHERE id = ?`
      ).bind(description.slice(0, 400), a.args_hint ? String(a.args_hint).slice(0, 400) : null, language, code, now, existing.id).run();
      return `tool "${name}" refined — invoke it with tool_forge{op:'invoke',name:'${name}',args:{...}}`;
    }
    await env.DB.prepare(
      `INSERT INTO elle_custom_tools (id, name, description, args_hint, language, code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(id(), name, description.slice(0, 400), a.args_hint ? String(a.args_hint).slice(0, 400) : null, language, code, now, now).run();
    return `tool "${name}" forged — invoke it with tool_forge{op:'invoke',name:'${name}',args:{...}}. Test it NOW with a real invocation before relying on it.`;
  }

  if (op === 'list') {
    const rows = await env.DB.prepare(
      `SELECT name, description, args_hint, language, runs, status FROM elle_custom_tools ORDER BY status = 'active' DESC, runs DESC LIMIT 50`
    ).all();
    const items = rows.results || [];
    return items.length ? JSON.stringify(items) : '(no self-forged tools yet — tool_forge{op:write} to grow one)';
  }

  if (op === 'read') {
    const name = slug(String(a.name || ''));
    if (!name) return 'tool_forge read: name required';
    const row = await env.DB.prepare(`SELECT name, description, args_hint, language, code, runs, status FROM elle_custom_tools WHERE name = ?`).bind(name).first();
    return row ? JSON.stringify(row) : `no tool "${name}"`;
  }

  if (op === 'invoke') {
    const name = slug(String(a.name || ''));
    if (!name) return 'tool_forge invoke: name required';
    const row = await env.DB.prepare(
      `SELECT id, language, code, status FROM elle_custom_tools WHERE name = ?`
    ).bind(name).first() as { id: string; language: string; code: string; status: string } | null;
    if (!row) return `no tool "${name}" — tool_forge{op:'list'} to see what exists`;
    if (row.status !== 'active') return `tool "${name}" is retired`;
    const argsJson = JSON.stringify((a.args && typeof a.args === 'object') ? a.args : {});
    const out = await sandboxRunCode(env, harness(row.language, row.code, argsJson), row.language, { source: 'tool_forge' });
    void env.DB.prepare(`UPDATE elle_custom_tools SET runs = runs + 1 WHERE id = ?`).bind(row.id).run().catch(() => {});
    return out;
  }

  if (op === 'retire') {
    const name = slug(String(a.name || ''));
    if (!name) return 'tool_forge retire: name required';
    const r = await env.DB.prepare(`UPDATE elle_custom_tools SET status = 'retired', updated_at = ? WHERE name = ?`).bind(now, name).run();
    return (r.meta?.changes ?? 0) > 0 ? `tool "${name}" retired` : `no tool "${name}"`;
  }

  return `tool_forge: unknown op "${op}" (write|list|read|invoke|retire)`;
}

// Compact prompt block: what she has already built, so a grown tool gets
// reached for like a native one. Empty when the registry is empty.
export async function customToolIndex(env: Env): Promise<string> {
  await ensureSchema(env);
  const rows = await env.DB.prepare(
    `SELECT name, description, args_hint FROM elle_custom_tools WHERE status = 'active' ORDER BY runs DESC LIMIT 15`
  ).all().catch(() => ({ results: [] as any[] }));
  const items = (rows.results || []) as Array<{ name: string; description: string; args_hint: string | null }>;
  if (!items.length) return '';
  return `\n\nSELF-FORGED TOOLS (you built these — invoke via tool_forge{op:'invoke',name,args}):\n` +
    items.map(t => `- ${t.name}${t.args_hint ? `(${t.args_hint})` : ''} — ${String(t.description).slice(0, 140)}`).join('\n');
}
