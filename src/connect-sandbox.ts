// ============================================================
// ELLE — worker-side face of the connect-back sandbox · src/connect-sandbox.ts
//
// The router calls these; they talk to the SandboxAgent Durable Object (which
// holds the laptop's WebSocket) and turn a tool call into real execution on the
// box. Every call:
//   1. checks the path is OPEN (laptop connected + beating) — no silent hangs,
//   2. dispatches over the socket and awaits the real result,
//   3. writes a row to the comprehensive use report (elle_sandbox_runs),
//   4. for clones, caches a COPY of the pulled code in KV (24h).
//
// The event bus (elle_events) already logs every run_code/run_shell call by
// run_id from the router loop; this table adds the execution detail (exit,
// stdout/stderr previews, the clone's KV key, whether the path was open).
// ============================================================

import type { Env } from './index';
import type { ExecResult, CloneResult, LlmResult, AgentStatus } from './sandbox-agent';
import { resolveRepo } from './forge';

const CLONE_TTL = 60 * 60 * 24; // a pulled-back copy lives 24h in KV
const PREVIEW = 4000;           // clip previews the way the event bus clips observations
const CODE_TIMEOUT_MS = 120_000;
const SHELL_TIMEOUT_MS = 300_000;
const CLONE_TIMEOUT_MS = 120_000;
const LLM_TIMEOUT_MS = 180_000; // a 4B on laptop hardware can take a while on a long window

export interface RunCtx { runId?: string; sessionId?: string | null; source?: string; userId?: string }

function newId(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }

function stub(env: Env) {
  const ns = env.SANDBOX_AGENT!; // callers guard sandboxConfigured() first
  return ns.get(ns.idFromName('primary'));
}

export function sandboxConfigured(env: Env): boolean { return !!env.SANDBOX_AGENT; }

export async function pathOpen(env: Env): Promise<AgentStatus> {
  if (!env.SANDBOX_AGENT) return { open: false };
  try {
    const r = await stub(env).fetch('https://sandbox/status');
    return (await r.json()) as AgentStatus;
  } catch {
    return { open: false };
  }
}

async function dispatchExec(env: Env, payload: Record<string, unknown>): Promise<ExecResult> {
  const r = await stub(env).fetch('https://sandbox/dispatch', {
    method: 'POST', body: JSON.stringify({ kind: 'exec', payload }),
  });
  return (await r.json()) as ExecResult;
}
async function dispatchClone(env: Env, payload: Record<string, unknown>): Promise<CloneResult> {
  const r = await stub(env).fetch('https://sandbox/dispatch', {
    method: 'POST', body: JSON.stringify({ kind: 'clone', payload }),
  });
  return (await r.json()) as CloneResult;
}

// ── the sovereign inference lane ────────────────────────────
// The router loop stays in the worker (so every tool still executes here,
// scope-gated as always) but the GENERATION runs on the laptop's local model
// — free, no provider quota. Callers treat a closed path or an agent-side
// error as "fall back to a hosted engine"; this lane can only ever save
// money, never strand a step.
export async function sandboxLLM(
  env: Env,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
): Promise<LlmResult> {
  if (!sandboxConfigured(env)) return { ok: false, error: 'sandbox not configured', path_open: false };
  const st = await pathOpen(env);
  if (!st.open) return { ok: false, error: 'sandbox path not open', path_open: false };
  try {
    const r = await stub(env).fetch('https://sandbox/dispatch', {
      method: 'POST',
      body: JSON.stringify({ kind: 'llm', payload: { id: newId(), system, messages, max_tokens: maxTokens, timeout_ms: LLM_TIMEOUT_MS } }),
    });
    return (await r.json()) as LlmResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), path_open: false };
  }
}

// ── the comprehensive use report ────────────────────────────
let schemaReady = false;
export async function ensureSandboxSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_sandbox_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT, session_id TEXT, source TEXT, user_id TEXT,
    kind TEXT,                -- code | shell | clone
    language TEXT, command TEXT, code_preview TEXT,
    target TEXT, clone_key TEXT,
    exit INTEGER, stdout_preview TEXT, stderr_preview TEXT,
    ok INTEGER, path_open INTEGER, duration_ms INTEGER, created_at INTEGER
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sandbox_time ON elle_sandbox_runs(created_at DESC)`).run().catch(() => {});
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sandbox_run ON elle_sandbox_runs(run_id)`).run().catch(() => {});
  // `title` was added after the table first shipped — a clone can be named by
  // her ("what she brought in, titled by her"). ADD COLUMN throws if it already
  // exists; we swallow that so this stays idempotent across live deployments.
  await env.DB.prepare(`ALTER TABLE elle_sandbox_runs ADD COLUMN title TEXT`).run().catch(() => {});
  // Reports she surfaces from a sandbox session — the thing that flashes the
  // console tab. seen=0 until the console is opened and marks them read.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_sandbox_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT, session_id TEXT, user_id TEXT,
    title TEXT, body TEXT,
    seen INTEGER DEFAULT 0, created_at INTEGER
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sandbox_reports_time ON elle_sandbox_reports(created_at DESC)`).run().catch(() => {});
  schemaReady = true;
}

interface RunRow {
  kind: string; language?: string; command?: string; code_preview?: string;
  target?: string; clone_key?: string; exit?: number; title?: string;
  stdout_preview?: string; stderr_preview?: string;
  ok: boolean; path_open: boolean; duration_ms?: number;
}
async function record(env: Env, ctx: RunCtx, row: RunRow): Promise<void> {
  try {
    await ensureSandboxSchema(env);
    await env.DB.prepare(`INSERT INTO elle_sandbox_runs
      (id,run_id,session_id,source,user_id,kind,language,command,code_preview,target,clone_key,exit,stdout_preview,stderr_preview,ok,path_open,duration_ms,created_at,title)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      newId(), ctx.runId ?? null, ctx.sessionId ?? null, ctx.source ?? null, ctx.userId ?? null,
      row.kind, row.language ?? null, row.command ?? null, row.code_preview ?? null,
      row.target ?? null, row.clone_key ?? null, row.exit ?? null,
      row.stdout_preview ?? null, row.stderr_preview ?? null,
      row.ok ? 1 : 0, row.path_open ? 1 : 0, row.duration_ms ?? null, Date.now(), row.title ?? null,
    ).run();
  } catch {
    /* the use report is best-effort — it never blocks or fails a real run */
  }
}

const NOT_CONFIGURED = 'the SANDBOX_AGENT binding is not configured on this worker.';
const NOT_OPEN =
  'sandbox path not open — your laptop agent is offline. It reconnects when the ' +
  'workbench is running; run sandbox_status to check, then retry.';

function formatExec(res: ExecResult): string {
  const head = `exit ${res.exit}${res.ok ? '' : ' (FAILED)'} · ${res.duration_ms}ms${res.truncated ? ' · output truncated on the box' : ''}`;
  const out = res.stdout ? `\n── stdout ──\n${res.stdout}` : '';
  const errBlock = res.stderr ? `\n── stderr ──\n${res.stderr}` : '';
  return `${head}${out}${errBlock}`;
}

function slug(s: string): string { return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clone'; }

// ── the four tools ──────────────────────────────────────────
export async function sandboxRunCode(env: Env, code: string, language: string | undefined, ctx: RunCtx): Promise<string> {
  if (!sandboxConfigured(env)) return `run_code: ${NOT_CONFIGURED}`;
  const lang = language || 'python';
  const st = await pathOpen(env);
  if (!st.open) { await record(env, ctx, { kind: 'code', language: lang, code_preview: code.slice(0, PREVIEW), ok: false, path_open: false }); return NOT_OPEN; }
  const res = await dispatchExec(env, { id: newId(), mode: 'code', code, language: lang, timeout_ms: CODE_TIMEOUT_MS });
  await record(env, ctx, {
    kind: 'code', language: lang, code_preview: code.slice(0, PREVIEW), exit: res.exit,
    stdout_preview: (res.stdout || '').slice(0, PREVIEW), stderr_preview: (res.stderr || '').slice(0, PREVIEW),
    ok: res.ok, path_open: res.path_open !== false, duration_ms: res.duration_ms,
  });
  return res.path_open === false ? NOT_OPEN : formatExec(res);
}

export async function sandboxRunShell(env: Env, command: string, ctx: RunCtx): Promise<string> {
  if (!sandboxConfigured(env)) return `run_shell: ${NOT_CONFIGURED}`;
  const st = await pathOpen(env);
  if (!st.open) { await record(env, ctx, { kind: 'shell', command: command.slice(0, PREVIEW), ok: false, path_open: false }); return NOT_OPEN; }
  const res = await dispatchExec(env, { id: newId(), mode: 'shell', command, timeout_ms: SHELL_TIMEOUT_MS });
  await record(env, ctx, {
    kind: 'shell', command: command.slice(0, PREVIEW), exit: res.exit,
    stdout_preview: (res.stdout || '').slice(0, PREVIEW), stderr_preview: (res.stderr || '').slice(0, PREVIEW),
    ok: res.ok, path_open: res.path_open !== false, duration_ms: res.duration_ms,
  });
  return res.path_open === false ? NOT_OPEN : formatExec(res);
}

// ── cloud clone: migrate code into the KV cache ANYTIME ─────
// The laptop lane pulls a working tree up the socket — but the socket only
// exists while the workbench is running. This is the always-open lane: a
// GitHub repo ("owner/name" or a github.com URL, optional #ref) is read
// worker-side via the GitHub API and lands in the SAME clone bundle format,
// the same SCRATCHPAD keys, the same use-report rows — so everything above
// (idea scoping, the sandbox console, bundle reads) sees one kind of clone
// regardless of which lane carried it. Bounded like the agent's walker:
// same file-count / per-file / bundle caps.
const CLOUD_MAX_FILES = 200;
const CLOUD_MAX_FILE = 256 * 1024;
const CLOUD_MAX_BUNDLE = 5 * 1024 * 1024;
const CLOUD_SKIP = /^(node_modules|dist|build|coverage|\.next|\.cache)\//;

// A bare OWN-repo name ("elle-worker", no slash) resolves through the forge
// allowlist to sbarteau2022/<name> — without this, kind:'git' + a bare name
// fell to the laptop lane, looked for that folder inside the (empty) sandbox
// workspace, and failed with "not a git repo", stranding the run. Anything
// already repo-shaped, pathlike, or unknown passes through untouched.
export function normalizeCloneTarget(target: string): string {
  const t = String(target || '').trim();
  if (parseRepoTarget(t) || /[/\\]/.test(t)) return t;
  const own = resolveRepo(t);
  return own ? `sbarteau2022/${own}` : t;
}

// "owner/name", "owner/name#ref", or a github.com URL → { repo, ref }. A
// local path ("/Users/…", "./x", "src") is NOT repo-shaped and returns null.
export function parseRepoTarget(target: string): { repo: string; ref?: string } | null {
  const t = String(target || '').trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/, '');
  if (t.startsWith('/') || t.startsWith('.') || /\s/.test(t)) return null;
  const m = t.match(/^([\w.-]+\/[\w.-]+)(?:[#@](.+))?$/);
  return m ? { repo: m[1], ref: m[2] } : null;
}

async function gh(env: Env, path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'elle-worker-clone',
      Accept: 'application/vnd.github+json',
    },
  });
}

async function cloudCloneGitHub(env: Env, repo: string, ref: string | undefined, ctx: RunCtx, title?: string): Promise<string> {
  if (!env.GITHUB_TOKEN) return 'sandbox_clone: the cloud lane needs GITHUB_TOKEN configured on the worker';
  // Resolve the ref (default branch when none given), then walk the tree.
  let sha = ref;
  if (!sha) {
    const r = await gh(env, `/repos/${repo}`);
    if (!r.ok) return `sandbox_clone: cannot reach ${repo} (HTTP ${r.status})`;
    sha = String(((await r.json()) as { default_branch?: string }).default_branch || 'main');
  }
  const tr = await gh(env, `/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
  if (!tr.ok) return `sandbox_clone: cannot read the tree of ${repo}@${sha} (HTTP ${tr.status})`;
  const tree = (await tr.json()) as { tree?: Array<{ path: string; type: string; size?: number }> };
  const blobs = (tree.tree || []).filter(e =>
    e.type === 'blob' && !CLOUD_SKIP.test(e.path) &&
    !e.path.split('/').some(p => p.startsWith('.') && p !== '.env.example'));

  const payload: Array<{ path: string; content: string }> = [];
  const meta: Array<{ path: string; bytes: number }> = [];
  let totalBundle = 0;
  for (const b of blobs) {
    if (payload.length >= CLOUD_MAX_FILES || totalBundle >= CLOUD_MAX_BUNDLE) break;
    if ((b.size ?? 0) > CLOUD_MAX_FILE) { meta.push({ path: b.path, bytes: b.size ?? 0 }); continue; }
    const fr = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${b.path}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'elle-worker-clone' },
    }).catch(() => null);
    if (!fr || !fr.ok) continue;
    const content = await fr.text();
    totalBundle += content.length;
    payload.push({ path: b.path, content });
    meta.push({ path: b.path, bytes: content.length });
  }

  const bundle = JSON.stringify({ target: `${repo}@${sha}`, kind: 'github', clonedAt: Date.now(), files: payload });
  let cloneKey: string | undefined;
  if (env.SCRATCHPAD) {
    cloneKey = `clone:${ctx.userId || 'elle'}:${slug(title || repo)}:${Date.now().toString(36)}`;
    try { await env.SCRATCHPAD.put(cloneKey, bundle, { expirationTtl: CLONE_TTL }); }
    catch { cloneKey = undefined; }
  }
  await record(env, ctx, { kind: 'clone', target: `${repo}@${sha}`, title, clone_key: cloneKey, ok: payload.length > 0, path_open: false });
  if (!payload.length) return `sandbox_clone: ${repo}@${sha} yielded no readable files`;
  const list = meta.slice(0, 50).map(f => `  ${f.path} (${f.bytes}b)`).join('\n');
  return `migrated ${payload.length} file(s) from ${repo}@${sha} via the CLOUD lane (no laptop needed)${title ? ` as "${title}"` : ''}.` +
    (cloneKey ? `\na copy is cached at KV key "${cloneKey}" (24h).` : '') +
    (list ? `\n${list}${meta.length > 50 ? `\n  …and ${meta.length - 50} more` : ''}` : '');
}

export async function sandboxClone(env: Env, target: string, kind: 'path' | 'git', ctx: RunCtx, title?: string): Promise<string> {
  if (!target) return 'sandbox_clone: target required (a path on the box, a git repo, or "owner/name" on GitHub)';
  // The always-open lane: a GitHub-shaped target never needs the socket when
  // the laptop is closed — "clone or migrate whatever, anytime" holds
  // regardless of which machine is awake. An explicit github.com URL prefers
  // the cloud lane even with the laptop up (it names the source of truth);
  // a bare git target uses the laptop's working tree when it's open (that
  // tree may be ahead of what's pushed). Local paths require the box.
  const repoRef = parseRepoTarget(normalizeCloneTarget(target));
  const laptop: AgentStatus = sandboxConfigured(env) ? await pathOpen(env) : { open: false };
  if (repoRef && (!laptop.open || /github\.com/i.test(target))) {
    return await cloudCloneGitHub(env, repoRef.repo, repoRef.ref, ctx, title);
  }
  if (!sandboxConfigured(env)) return `sandbox_clone: ${NOT_CONFIGURED}`;
  const st = laptop;
  if (!st.open) { await record(env, ctx, { kind: 'clone', target, title, ok: false, path_open: false }); return NOT_OPEN; }
  const res = await dispatchClone(env, { id: newId(), kind, target, timeout_ms: CLONE_TIMEOUT_MS });

  // The laptop lane looked for the target under the sandbox workspace and it
  // wasn't there (or wasn't a repo) — but the target IS GitHub-shaped, so the
  // cloud lane can still deliver it. Without this fallback the run stranded on
  // "not a git repo" and burned steps improvising in an empty workspace.
  if (!res.ok && res.path_open !== false && repoRef) {
    return await cloudCloneGitHub(env, repoRef.repo, repoRef.ref, ctx, title);
  }

  let cloneKey: string | undefined;
  if (res.ok && res.bundle && env.SCRATCHPAD) {
    cloneKey = `clone:${ctx.userId || 'elle'}:${slug(title || target)}:${Date.now().toString(36)}`;
    try { await env.SCRATCHPAD.put(cloneKey, res.bundle, { expirationTtl: CLONE_TTL }); }
    catch { cloneKey = undefined; }
  }
  await record(env, ctx, { kind: 'clone', target, title, clone_key: cloneKey, ok: res.ok, path_open: res.path_open !== false });

  if (res.path_open === false) return NOT_OPEN;
  if (!res.ok) return `sandbox_clone failed: ${res.error || 'unknown error'}. ` +
    `The laptop lane resolves targets against the sandbox workspace — for a GitHub repo use "owner/name" (e.g. "sbarteau2022/elle-worker"), for code on the box give the real absolute path. Do not try to rebuild the repo with run_shell; re-call sandbox_clone with a corrected target.`;
  const files = res.files || [];
  const list = files.slice(0, 50).map(f => `  ${f.path} (${f.bytes}b)`).join('\n');
  return `cloned ${files.length} file(s) from ${target}${title ? ` as "${title}"` : ''}.` +
    (cloneKey ? `\na copy is cached at KV key "${cloneKey}" (24h) and mirrored to the laptop's sovereign cache.` : '') +
    (list ? `\n${list}${files.length > 50 ? `\n  …and ${files.length - 50} more` : ''}` : '');
}

export async function sandboxStatus(env: Env): Promise<string> {
  if (!sandboxConfigured(env)) return `sandbox path: NOT CONFIGURED — ${NOT_CONFIGURED}`;
  const st = await pathOpen(env);
  if (!st.open) return 'sandbox path: CLOSED — the laptop agent is not connected. Start the workbench to bring it up.';
  const m = st.meta || {};
  const ago = m.lastSeen ? Math.round((Date.now() - m.lastSeen) / 1000) : null;
  return `sandbox path: OPEN — ${m.host || m.agent || 'laptop'} (${m.platform || '?'}), root ${m.root || '?'}` +
    (ago != null ? `, last beat ${ago}s ago.` : '.');
}

// ── read side (admin workbench) ─────────────────────────────
export async function sandboxRunsRecent(env: Env, limit = 50): Promise<unknown[]> {
  try {
    await ensureSandboxSchema(env);
    const r = await env.DB.prepare(
      `SELECT id,run_id,session_id,source,user_id,kind,language,command,code_preview,target,title,clone_key,exit,stdout_preview,stderr_preview,ok,path_open,duration_ms,created_at
       FROM elle_sandbox_runs ORDER BY created_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 200)).all();
    return r.results || [];
  } catch {
    return [];
  }
}

// ── what she brought in: the clones, titled by her ──────────
export async function sandboxBroughtIn(env: Env, limit = 50): Promise<unknown[]> {
  try {
    await ensureSandboxSchema(env);
    const r = await env.DB.prepare(
      `SELECT id,run_id,title,target,clone_key,ok,created_at FROM elle_sandbox_runs
       WHERE kind = 'clone' ORDER BY created_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 100)).all();
    return r.results || [];
  } catch {
    return [];
  }
}

// ── her chain of thought: the sandbox steps off the event bus, indexed with
//    the runs above by run_id (the replay record) ────────────
export async function sandboxThoughts(env: Env, limit = 80): Promise<unknown[]> {
  try {
    const r = await env.DB.prepare(
      `SELECT id,run_id,session_id,source,step_index,kind,tool,args,result_preview,duration_ms,created_at
       FROM elle_events
       WHERE tool IN ('run_code','run_shell','sandbox_clone','sandbox_status','sandbox_report')
       ORDER BY created_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 200)).all();
    return r.results || [];
  } catch {
    return [];
  }
}

// ── reports she surfaces from the sandbox (the flash) ───────
export async function sandboxReport(env: Env, title: string, body: string, ctx: RunCtx): Promise<string> {
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (!t) return 'sandbox_report: title required';
  if (!b) return 'sandbox_report: body required — the findings to surface';
  try {
    await ensureSandboxSchema(env);
    await env.DB.prepare(
      `INSERT INTO elle_sandbox_reports (id,run_id,session_id,user_id,title,body,seen,created_at)
       VALUES (?,?,?,?,?,?,0,?)`,
    ).bind(newId(), ctx.runId ?? null, ctx.sessionId ?? null, ctx.userId ?? null, t, b, Date.now()).run();
    return `report surfaced: "${t}". The sandbox console tab is flashing until it's opened.`;
  } catch (e) {
    return `sandbox_report failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function sandboxReportsRecent(env: Env, limit = 20): Promise<unknown[]> {
  try {
    await ensureSandboxSchema(env);
    const r = await env.DB.prepare(
      `SELECT id,run_id,title,body,seen,created_at FROM elle_sandbox_reports
       ORDER BY created_at DESC LIMIT ?`,
    ).bind(Math.min(Math.max(limit, 1), 100)).all();
    return r.results || [];
  } catch {
    return [];
  }
}

export async function unseenReportCount(env: Env): Promise<number> {
  try {
    await ensureSandboxSchema(env);
    const r = await env.DB.prepare(`SELECT COUNT(*) as n FROM elle_sandbox_reports WHERE seen = 0`).first();
    return Number((r as { n?: number } | null)?.n || 0);
  } catch {
    return 0;
  }
}

export async function markReportsSeen(env: Env): Promise<void> {
  try {
    await ensureSandboxSchema(env);
    await env.DB.prepare(`UPDATE elle_sandbox_reports SET seen = 1 WHERE seen = 0`).run();
  } catch {
    /* best effort */
  }
}
