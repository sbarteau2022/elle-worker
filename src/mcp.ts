// ============================================================
// ELLE MCP CLIENT — src/mcp.ts
//
// The import path for the outside tool ecosystem. MCP (Model Context
// Protocol) is the open standard thousands of published tool servers speak —
// Hugging Face, GitHub, Stripe, filesystem bridges, EDI gateways, whatever
// ships next. Instead of hand-writing an integration per service, Elle
// mounts a server by URL and its ENTIRE tool catalog becomes callable:
//
//   mcp_add(name, url?, token?)  register a server (https only, admin scope);
//                                url may be omitted when name matches a
//                                connector-library entry (mcp-library.ts)
//   mcp_tools(server?)           no arg: list mounted servers; with arg:
//                                the server's live tool catalog with schemas
//   mcp_call(server, tool, args) invoke one tool, get text content back
//   mcp_library(q?)              browse the curated connector shelf
//
// Transport: MCP streamable HTTP (JSON-RPC 2.0 over POST; responses may be
// plain JSON or a text/event-stream — both parsed). Stateless-worker
// friendly: each call runs initialize → notifications/initialized → the
// request, carrying the Mcp-Session-Id header the server assigns.
//
// Seeded with Hugging Face's official server (https://huggingface.co/mcp):
// model/dataset/paper/Space search, anonymous-usable, token optional.
//
// SCOPE: full (admin) only — these tools reach arbitrary external services.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { findConnector, mcpLibrary } from './mcp-library';
import type { Env } from './index';

const CALL_TIMEOUT_MS = 20000;
const RESULT_CAP = 6000;
const PROTOCOL_VERSION = '2025-03-26';

// ── SSE / JSON-RPC parsing (pure; unit-tested) ───────────────
// A streamable-HTTP response is either a JSON body or an event stream whose
// `data:` lines each carry one JSON-RPC message. Return the message that has
// a result/error (the response to our request), preferring an id match.
export function parseRpcBody(text: string, contentType: string, wantId?: number): any | null {
  const t = String(text || '').trim();
  if (!t) return null;
  if (!contentType.includes('text/event-stream')) {
    try { return JSON.parse(t); } catch { return null; }
  }
  const msgs: any[] = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m || !m[1]) continue;
    try { msgs.push(JSON.parse(m[1])); } catch { /* keep-alives, partials */ }
  }
  if (wantId != null) {
    const hit = msgs.find(x => x && x.id === wantId && ('result' in x || 'error' in x));
    if (hit) return hit;
  }
  return msgs.reverse().find(x => x && ('result' in x || 'error' in x)) || msgs[0] || null;
}

// Render a tools/call result's content parts to plain text.
export function renderContent(result: any): string {
  const parts = result?.content;
  if (!Array.isArray(parts)) return typeof result === 'string' ? result : JSON.stringify(result ?? null);
  const text = parts.map((p: any) => {
    if (p?.type === 'text') return String(p.text ?? '');
    if (p?.type === 'resource') return `[resource ${p.resource?.uri || ''}] ${String(p.resource?.text ?? '')}`;
    return `[${p?.type || 'part'}]`;
  }).join('\n');
  return result?.isError ? `TOOL ERROR:\n${text}` : text;
}

// ── registry ─────────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
  // Seed: Hugging Face's official MCP server. Anonymous works for public
  // search; add a token later via mcp_add to raise limits.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO elle_mcp_servers (name, url, auth_token, enabled, added_at) VALUES ('huggingface', 'https://huggingface.co/mcp', NULL, 1, ?)`
  ).bind(Date.now()).run().catch(() => {});
}

interface McpServer { name: string; url: string; auth_token: string | null; enabled: number }

async function getServer(env: Env, name: string): Promise<McpServer | null> {
  await ensureSchema(env);
  const slug = String(name || '').toLowerCase().trim();
  return await env.DB.prepare('SELECT name, url, auth_token, enabled FROM elle_mcp_servers WHERE name = ?')
    .bind(slug).first() as McpServer | null;
}

// ── transport ────────────────────────────────────────────────
async function post(server: McpServer, payload: unknown, sessionId: string | null): Promise<{ status: number; body: string; contentType: string; session: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(server.auth_token ? { 'Authorization': `Bearer ${server.auth_token}` } : {}),
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get('Content-Type') || '',
      session: res.headers.get('Mcp-Session-Id') || sessionId,
    };
  } finally { clearTimeout(timer); }
}

// Full dance: initialize → initialized → request. Stateless per invocation.
async function rpc(server: McpServer, method: string, params: Record<string, unknown>): Promise<any> {
  const init = await post(server, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'elle', version: '1.0' },
    },
  }, null);
  if (init.status >= 400) throw new Error(`initialize failed (HTTP ${init.status}): ${init.body.slice(0, 200)}`);
  const session = init.session;
  const initMsg = parseRpcBody(init.body, init.contentType, 1);
  if (initMsg?.error) throw new Error(`initialize error: ${initMsg.error.message || JSON.stringify(initMsg.error)}`);

  // Notification — servers may 202 it; failures here are non-fatal.
  await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, session).catch(() => {});

  const res = await post(server, { jsonrpc: '2.0', id: 2, method, params }, session);
  if (res.status >= 400) throw new Error(`${method} failed (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
  const msg = parseRpcBody(res.body, res.contentType, 2);
  if (!msg) throw new Error(`${method}: unparseable response`);
  if (msg.error) throw new Error(`${method} error: ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg.result;
}

// ── the tools ────────────────────────────────────────────────
export async function mcpAdd(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const name = String(a.name || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  if (!name) return 'name required';
  // No url → mount from the connector library by name.
  const entry = findConnector(name);
  const url = String(a.url || '').trim() || entry?.url || '';
  if (!/^https:\/\//i.test(url)) return 'url must be https (or pass a name from mcp_library to mount a known connector)';
  const token = a.token ? String(a.token) : null;
  await env.DB.prepare(
    `INSERT INTO elle_mcp_servers (name, url, auth_token, enabled, added_at) VALUES (?,?,?,1,?)
     ON CONFLICT(name) DO UPDATE SET url = excluded.url, auth_token = COALESCE(excluded.auth_token, elle_mcp_servers.auth_token), enabled = 1`
  ).bind(name, url, token, Date.now()).run();
  // Prove it speaks MCP before calling it mounted.
  try {
    const server = (await getServer(env, name))!;
    const result = await rpc(server, 'tools/list', {});
    const n = Array.isArray(result?.tools) ? result.tools.length : 0;
    return `mounted "${name}" (${url}) — ${n} tools available; mcp_tools("${name}") to see them`;
  } catch (e) {
    return `registered "${name}" but the handshake failed: ${(e as Error).message}. Check the URL/token; mcp_call will keep failing until this works.`;
  }
}

export async function mcpTools(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const name = String(a.server || a.name || '').trim();
  if (!name) {
    const rows = await env.DB.prepare('SELECT name, url, enabled, (auth_token IS NOT NULL) AS has_token FROM elle_mcp_servers ORDER BY name').all();
    const items = (rows.results || []) as Array<{ name: string; url: string; enabled: number; has_token: number }>;
    return items.length
      ? 'MOUNTED SERVERS:\n' + items.map(s => `- ${s.name} → ${s.url}${s.has_token ? ' (token set)' : ''}${s.enabled ? '' : ' [disabled]'}`).join('\n')
      : '(no servers mounted — mcp_add one)';
  }
  const server = await getServer(env, name);
  if (!server || !server.enabled) return `no mounted server "${name}" — mcp_tools() lists what exists`;
  const result = await rpc(server, 'tools/list', {});
  const tools = (result?.tools || []) as Array<{ name: string; description?: string; inputSchema?: unknown }>;
  if (!tools.length) return `server "${name}" reports no tools`;
  const lines = tools.slice(0, 40).map(t => {
    const props = (t.inputSchema as any)?.properties;
    const args = props ? Object.keys(props).join(', ') : '';
    return `- ${t.name}(${args}) — ${String(t.description || '').replace(/\s+/g, ' ').slice(0, 160)}`;
  });
  return `TOOLS on ${name}:\n${lines.join('\n')}${tools.length > 40 ? `\n…and ${tools.length - 40} more` : ''}`;
}

export async function mcpCall(env: Env, a: Record<string, unknown>): Promise<string> {
  const name = String(a.server || '').trim();
  const tool = String(a.tool || '').trim();
  if (!name || !tool) return 'mcp_call needs server and tool (mcp_tools(server) for the catalog)';
  const server = await getServer(env, name);
  if (!server || !server.enabled) return `no mounted server "${name}"`;
  const args = (a.args && typeof a.args === 'object') ? a.args : {};
  const result = await rpc(server, 'tools/call', { name: tool, arguments: args });
  const text = renderContent(result);
  return text.length > RESULT_CAP ? text.slice(0, RESULT_CAP) + `\n…[truncated ${text.length - RESULT_CAP} chars]` : text;
}

export async function runMcpTool(name: string, a: Record<string, unknown>, env: Env): Promise<string> {
  try {
    switch (name) {
      case 'mcp_add':     return await mcpAdd(env, a);
      case 'mcp_tools':   return await mcpTools(env, a);
      case 'mcp_call':    return await mcpCall(env, a);
      case 'mcp_library': return mcpLibrary(a);
      default:          return `unknown mcp tool "${name}"`;
    }
  } catch (e) {
    return `mcp ${name} failed: ${(e as Error).message}`;
  }
}
