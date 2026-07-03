// ============================================================
// ELLE — GitHub read tools · src/github-tools.ts
//
// GITHUB_TOKEN has been declared on Env since the "corpus ops" comment was
// added but nothing ever called the GitHub API with it — Elle had no way to
// read a real file from a real repo; code_engine only ever saw whatever was
// pasted into the request. These two tools close that gap: read one file at
// a specific ref, or search code across a repo. Read-only, admin-scoped
// ('full' router scope only — never exposed to the hospitality door).
// ============================================================

const GITHUB_API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'elle-worker-router/1.0',
  };
}

function parseRepo(repo: string): { owner: string; name: string } | null {
  const m = String(repo || '').trim().match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

export async function githubReadFile(
  repo: string, path: string, ref: string | undefined, token: string
): Promise<string> {
  const r = parseRepo(repo);
  if (!r) return `github_read_file: repo must be "owner/name", got "${repo}"`;
  if (!path) return 'github_read_file: path required';
  const url = `${GITHUB_API}/repos/${r.owner}/${r.name}/contents/${path.replace(/^\/+/, '')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return `github_read_file: not found — ${repo}:${path}${ref ? `@${ref}` : ''}`;
  if (!res.ok) return `github_read_file: HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 500);
  const data = await res.json() as { content?: string; encoding?: string; size?: number; type?: string };
  if (data.type === 'dir') return `github_read_file: "${path}" is a directory, not a file — use github_list_files`;
  if (!data.content) return `github_read_file: no content returned for ${repo}:${path}`;
  const text = data.encoding === 'base64' ? atob(data.content.replace(/\n/g, '')) : data.content;
  const CAP = 20000;
  return text.length > CAP ? text.slice(0, CAP) + `\n…[truncated ${text.length - CAP} chars]` : text;
}

export async function githubListFiles(
  repo: string, path: string | undefined, ref: string | undefined, token: string
): Promise<string> {
  const r = parseRepo(repo);
  if (!r) return `github_list_files: repo must be "owner/name", got "${repo}"`;
  const cleanPath = (path || '').replace(/^\/+|\/+$/g, '');
  const url = `${GITHUB_API}/repos/${r.owner}/${r.name}/contents/${cleanPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return `github_list_files: not found — ${repo}:${cleanPath || '/'}${ref ? `@${ref}` : ''}`;
  if (!res.ok) return `github_list_files: HTTP ${res.status}`;
  const data = await res.json();
  if (!Array.isArray(data)) return `github_list_files: "${cleanPath || '/'}" is a file, not a directory`;
  return (data as Array<{ name: string; type: string; size: number }>)
    .map(e => `${e.type === 'dir' ? 'd' : '-'} ${e.name}${e.type === 'file' ? ` (${e.size}b)` : ''}`)
    .join('\n') || '(empty directory)';
}

export async function githubSearchCode(repo: string, query: string, token: string): Promise<string> {
  const r = parseRepo(repo);
  if (!r) return `github_search_code: repo must be "owner/name", got "${repo}"`;
  if (!query.trim()) return 'github_search_code: query required';
  const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(`${query} repo:${r.owner}/${r.name}`)}&per_page=15`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) return `github_search_code: HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 500);
  const data = await res.json() as { total_count?: number; items?: Array<{ path: string; html_url: string }> };
  if (!data.items?.length) return `github_search_code: no matches for "${query}" in ${repo}`;
  return `${data.total_count} total match(es), showing ${data.items.length}:\n` +
    data.items.map(i => `${i.path}`).join('\n');
}
