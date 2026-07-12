// ============================================================
// ELLE FORGE — src/forge.ts
//
// Her hands on her own codebase. The loop the tools implement:
//
//   repo_read / repo_search   read any file in her own repos
//   forge_open                open a task: a work branch (elle/<slug>) cut
//                             from the default branch + a D1 task record
//   forge_write               commit a file to THAT branch (never main)
//   forge_check               read CI for the branch: run status, failing
//                             jobs, log tails — the error surface she
//                             iterates against until everything is green
//   forge_pr                  open the pull request = the request for
//                             acceptance. SHE NEVER MERGES. Merging into
//                             her own base is Stewart's click, on GitHub,
//                             every time.
//
// The sandbox is a git branch; the errors are CI; acceptance is the PR.
// Everything runs over the GitHub REST API with env.GITHUB_TOKEN — no
// shell, no runtime, nothing executes inside the worker.
//
// HARD GUARDS (by construction, not convention):
//   - repo allowlist: only her own three repos are reachable
//   - every write goes to a branch with the elle/ prefix; a write that
//     names the default branch (or any other branch) is refused
//   - .github/workflows/** is read-only: she cannot edit the CI gate
//     that judges her work — green has to keep meaning green
//   - no merge capability exists anywhere in this module
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';

const GH = 'https://api.github.com';
const OWNER = 'sbarteau2022';

// Her own repos, and nothing else. Accepts "elle-worker" or "sbarteau2022/elle-worker".
// elle-law is included so she can read (and, once we build the War Room, forge on)
// the Elle.law repo through the worker's GITHUB_TOKEN — the same credential that
// powers github_read_file. The forge safety model is unchanged for every repo:
// writes only go to elle/* branches, never main, and the merge is always human.
const REPO_ALLOWLIST = ['elle-worker', 'Elle', 'elle-dev-console', 'elle-law'];

export const BRANCH_PREFIX = 'elle/';

export function resolveRepo(raw: unknown): string | null {
  const name = String(raw || '').trim().replace(/^sbarteau2022\//i, '');
  const hit = REPO_ALLOWLIST.find(r => r.toLowerCase() === name.toLowerCase());
  return hit || null;
}

export function slugify(title: string): string {
  const s = String(title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'task';
}

// The one write-path rule that keeps the acceptance gate honest.
export function writeRefused(branch: string, path: string): string | null {
  if (!branch.startsWith(BRANCH_PREFIX)) return `writes only go to ${BRANCH_PREFIX}* branches — never "${branch}"`;
  const p = String(path || '').replace(/^\/+/, '');
  if (!p) return 'path required';
  if (p.split('/').some(seg => seg === '..')) return 'path traversal is not allowed';
  if (p.startsWith('.github/workflows')) return 'the CI gate (.github/workflows) is read-only — the judge is not yours to edit';
  return null;
}

// ── GitHub plumbing ──────────────────────────────────────────
function headers(env: Env): Record<string, string> {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'elle-forge/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: { ...headers(env), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

// UTF-8-safe base64 (btoa alone corrupts non-ASCII source).
export function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64decode(b64: string): string {
  const bin = atob(String(b64 || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function defaultBranch(env: Env, repo: string): Promise<string> {
  const { status, data } = await gh(env, 'GET', `/repos/${OWNER}/${repo}`);
  if (status !== 200) throw new Error(`cannot read repo ${repo} (HTTP ${status}): ${data?.message || ''}`);
  return data.default_branch || 'main';
}

// ── task records ─────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

function tid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

async function getTask(env: Env, taskId: string): Promise<any | null> {
  await ensureSchema(env);
  return await env.DB.prepare('SELECT * FROM elle_code_tasks WHERE id = ?').bind(String(taskId || '')).first();
}

// ── tools ────────────────────────────────────────────────────

// repo_read: file → decoded text; directory → listing. ref optional (branch or sha).
export async function forgeRead(env: Env, a: Record<string, unknown>): Promise<string> {
  const repo = resolveRepo(a.repo);
  if (!repo) return `repo must be one of: ${REPO_ALLOWLIST.join(', ')}`;
  const path = String(a.path || '').replace(/^\/+/, '');
  const ref = a.ref ? `?ref=${encodeURIComponent(String(a.ref))}` : '';
  const { status, data } = await gh(env, 'GET', `/repos/${OWNER}/${repo}/contents/${path}${ref}`);
  if (status === 404) return `not found: ${repo}/${path || '(root)'}${a.ref ? ` @ ${a.ref}` : ''}`;
  if (status !== 200) return `read failed (HTTP ${status}): ${data?.message || ''}`;
  if (Array.isArray(data)) {
    return data.map((e: any) => `${e.type === 'dir' ? 'd' : '-'} ${e.path}${e.type === 'file' ? ` (${e.size}b)` : ''}`).join('\n') || '(empty dir)';
  }
  if (data.type === 'file' && typeof data.content === 'string') {
    const text = b64decode(data.content);
    return `[${repo}/${data.path} @ ${String(data.sha).slice(0, 7)}]\n${text}`;
  }
  return `unsupported content type: ${data.type}`;
}

// repo_search: GitHub code search, forced inside the allowlisted repo.
export async function forgeSearch(env: Env, a: Record<string, unknown>): Promise<string> {
  const repo = resolveRepo(a.repo);
  if (!repo) return `repo must be one of: ${REPO_ALLOWLIST.join(', ')}`;
  const q = String(a.q || a.query || '').trim();
  if (!q) return 'q required';
  const { status, data } = await gh(env, 'GET',
    `/search/code?q=${encodeURIComponent(`${q} repo:${OWNER}/${repo}`)}&per_page=10`);
  if (status !== 200) return `search failed (HTTP ${status}): ${data?.message || ''}`;
  const items = (data.items || []) as Array<{ path: string; repository?: { name: string } }>;
  return items.length
    ? items.map(i => `- ${repo}/${i.path}`).join('\n')
    : '(no code matches)';
}

// forge_open: cut a work branch from the default branch + record the task.
export async function forgeOpen(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const repo = resolveRepo(a.repo);
  if (!repo) return `repo must be one of: ${REPO_ALLOWLIST.join(', ')}`;
  const title = String(a.title || '').trim();
  const goal = String(a.goal || a.description || '').trim();
  if (!title) return 'title required';

  const base = await defaultBranch(env, repo);
  const id = tid();
  const branch = `${BRANCH_PREFIX}${slugify(title)}-${id.slice(0, 4)}`;

  const head = await gh(env, 'GET', `/repos/${OWNER}/${repo}/git/ref/heads/${base}`);
  if (head.status !== 200) return `cannot resolve ${repo}@${base} (HTTP ${head.status}): ${head.data?.message || ''}`;
  const sha = head.data?.object?.sha;

  const mk = await gh(env, 'POST', `/repos/${OWNER}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  if (mk.status !== 201 && mk.status !== 422) return `branch create failed (HTTP ${mk.status}): ${mk.data?.message || ''}`;

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO elle_code_tasks (id, repo, branch, base_branch, title, goal, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'open', ?, ?)`
  ).bind(id, repo, branch, base, title, goal, now, now).run();

  return JSON.stringify({ task_id: id, repo, branch, base_branch: base, from_sha: String(sha).slice(0, 7) });
}

// forge_write: commit ONE file to the task's branch. Creates or updates.
export async function forgeWrite(env: Env, a: Record<string, unknown>): Promise<string> {
  const task = await getTask(env, String(a.task_id || ''));
  if (!task) return 'no such task_id — forge_open first';
  if (task.status === 'merged' || task.status === 'closed') return `task is ${task.status} — open a new one`;

  const path = String(a.path || '').replace(/^\/+/, '');
  const refusal = writeRefused(String(task.branch), path);
  if (refusal) return `write refused: ${refusal}`;

  const content = String(a.content ?? '');
  if (!content) return 'content required (full file body — the contents API replaces the file)';
  const message = String(a.message || `elle: update ${path}`).slice(0, 200);

  // Existing file on the branch? Need its sha to update.
  const cur = await gh(env, 'GET', `/repos/${OWNER}/${task.repo}/contents/${path}?ref=${encodeURIComponent(task.branch)}`);
  const sha = cur.status === 200 && cur.data?.sha ? cur.data.sha : undefined;

  const put = await gh(env, 'PUT', `/repos/${OWNER}/${task.repo}/contents/${path}`, {
    message, branch: task.branch, content: b64encode(content), ...(sha ? { sha } : {}),
  });
  if (put.status !== 200 && put.status !== 201) return `commit failed (HTTP ${put.status}): ${put.data?.message || ''}`;

  await env.DB.prepare("UPDATE elle_code_tasks SET commits = commits + 1, updated_at = ? WHERE id = ?")
    .bind(Date.now(), task.id).run().catch(() => {});

  return JSON.stringify({
    committed: path, branch: task.branch,
    commit: String(put.data?.commit?.sha || '').slice(0, 7),
    note: 'CI runs on this push — forge_check in a minute or two for the verdict',
  });
}

// forge_check: the error surface. Latest CI runs for the branch; failing jobs
// get their log tails so she has the actual compiler/test output to fix against.
// Also notices when the PR was merged/closed and settles the task record.
export async function forgeCheck(env: Env, a: Record<string, unknown>): Promise<string> {
  const task = await getTask(env, String(a.task_id || ''));
  if (!task) return 'no such task_id — forge_open first';

  const out: Record<string, unknown> = { task_id: task.id, repo: task.repo, branch: task.branch, status: task.status, commits: task.commits, pr_number: task.pr_number ?? null };

  // PR state (acceptance status) if one exists.
  if (task.pr_number) {
    const pr = await gh(env, 'GET', `/repos/${OWNER}/${task.repo}/pulls/${task.pr_number}`);
    if (pr.status === 200) {
      out.pr_state = pr.data.state;
      out.pr_merged = !!pr.data.merged;
      const settled = pr.data.merged ? 'merged' : (pr.data.state === 'closed' ? 'closed' : null);
      if (settled && task.status !== settled) {
        await env.DB.prepare('UPDATE elle_code_tasks SET status = ?, updated_at = ? WHERE id = ?')
          .bind(settled, Date.now(), task.id).run().catch(() => {});
        out.status = settled;
      }
    }
  }

  // Workflow runs on the branch.
  const runs = await gh(env, 'GET', `/repos/${OWNER}/${task.repo}/actions/runs?branch=${encodeURIComponent(task.branch)}&per_page=5`);
  if (runs.status !== 200) {
    out.ci = `cannot read workflow runs (HTTP ${runs.status}): ${runs.data?.message || ''}`;
    return JSON.stringify(out);
  }
  const list = (runs.data?.workflow_runs || []) as Array<any>;
  if (!list.length) {
    out.ci = 'no CI runs yet for this branch (push first, or the run has not started — check again shortly)';
    return JSON.stringify(out);
  }

  const summarized: Array<Record<string, unknown>> = [];
  for (const r of list.slice(0, 3)) {
    const entry: Record<string, unknown> = {
      workflow: r.name, run: r.id, status: r.status, conclusion: r.conclusion,
      head_sha: String(r.head_sha || '').slice(0, 7),
    };
    if (r.conclusion === 'failure') {
      const jobs = await gh(env, 'GET', `/repos/${OWNER}/${task.repo}/actions/runs/${r.id}/jobs?per_page=10`);
      const failed = ((jobs.data?.jobs || []) as Array<any>).filter(j => j.conclusion === 'failure');
      const details: Array<Record<string, unknown>> = [];
      for (const j of failed.slice(0, 2)) {
        const steps = (j.steps || []).filter((s: any) => s.conclusion === 'failure').map((s: any) => s.name);
        let tail = '';
        try {
          const logRes = await fetch(`${GH}/repos/${OWNER}/${task.repo}/actions/jobs/${j.id}/logs`, { headers: headers(env) });
          if (logRes.ok) {
            const full = await logRes.text();
            // Prefer the error-bearing lines; fall back to the raw tail.
            const lines = full.split('\n');
            const errLines = lines.filter(l => /error|failed|FAIL|✕|✗/i.test(l)).slice(-40);
            tail = (errLines.length ? errLines : lines.slice(-40)).join('\n').slice(-3000);
          }
        } catch { /* log fetch is best-effort */ }
        details.push({ job: j.name, failed_steps: steps, log_tail: tail || '(logs unavailable)' });
      }
      entry.failed_jobs = details;
    }
    summarized.push(entry);
  }
  out.ci = summarized;
  out.green = summarized.every(s => s.conclusion === 'success');
  return JSON.stringify(out);
}

// forge_pr: the request for acceptance. Opens (or returns the existing) PR
// from the task branch to the default branch. There is no merge path here.
export async function forgePR(env: Env, a: Record<string, unknown>): Promise<string> {
  const task = await getTask(env, String(a.task_id || ''));
  if (!task) return 'no such task_id — forge_open first';
  if (task.pr_number) return JSON.stringify({ pr_number: task.pr_number, note: 'PR already open — acceptance is in Stewart\'s hands, on GitHub' });

  const body = String(a.body || task.goal || '').slice(0, 8000);
  const mk = await gh(env, 'POST', `/repos/${OWNER}/${task.repo}/pulls`, {
    title: String(task.title).slice(0, 200),
    head: task.branch, base: task.base_branch || 'main',
    body: `${body}\n\n—\nOpened by Elle (forge). Acceptance — the merge into her base — is a human decision.`,
  });
  if (mk.status !== 201) {
    // 422 usually means it already exists (race) — find it.
    if (mk.status === 422) {
      const find = await gh(env, 'GET', `/repos/${OWNER}/${task.repo}/pulls?head=${OWNER}:${encodeURIComponent(task.branch)}&state=open`);
      const ex = Array.isArray(find.data) && find.data[0];
      if (ex) {
        await env.DB.prepare("UPDATE elle_code_tasks SET pr_number = ?, status = 'pr_open', updated_at = ? WHERE id = ?")
          .bind(ex.number, Date.now(), task.id).run().catch(() => {});
        return JSON.stringify({ pr_number: ex.number, url: ex.html_url, note: 'existing PR' });
      }
    }
    return `PR create failed (HTTP ${mk.status}): ${mk.data?.message || JSON.stringify(mk.data?.errors || '').slice(0, 300)}`;
  }
  await env.DB.prepare("UPDATE elle_code_tasks SET pr_number = ?, status = 'pr_open', updated_at = ? WHERE id = ?")
    .bind(mk.data.number, Date.now(), task.id).run().catch(() => {});
  return JSON.stringify({ pr_number: mk.data.number, url: mk.data.html_url, note: 'acceptance requested — the merge is Stewart\'s, not yours' });
}

// ── dispatcher (router calls this) ───────────────────────────
export async function runForgeTool(name: string, a: Record<string, unknown>, env: Env): Promise<string> {
  if (!env.GITHUB_TOKEN) return 'forge unavailable: GITHUB_TOKEN is not configured on the worker';
  switch (name) {
    case 'repo_read':    return forgeRead(env, a);
    case 'repo_search':  return forgeSearch(env, a);
    case 'forge_open':   return forgeOpen(env, a);
    case 'forge_write':  return forgeWrite(env, a);
    case 'forge_check':  return forgeCheck(env, a);
    case 'forge_pr':     return forgePR(env, a);
    default:             return `unknown forge tool "${name}"`;
  }
}
