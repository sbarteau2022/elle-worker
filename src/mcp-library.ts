// ============================================================
// ELLE MCP CONNECTOR LIBRARY — src/mcp-library.ts
//
// The curated shelf next to the mount point. mcp.ts gives her the mechanism
// (mount any streamable-HTTP MCP server by URL); this gives her the MAP —
// known, real servers with what they offer and what auth they demand, so
// reaching for an outside capability starts with a lookup, not a guess at a
// URL. mcp_add(name) with no url mounts straight from this shelf.
//
//   mcp_library(q?)   no arg: the whole catalog grouped by auth readiness;
//                     with q: filter by name / tag / keyword
//
// Honesty rules for entries:
// - auth 'none'  → mountable right now, anonymously.
// - auth 'token' → works once a token/key from that service is passed to
//                  mcp_add; the client sends it as a Bearer header.
// - auth 'oauth' → the service mints tokens via an OAuth flow the worker
//                  does not run; only mountable with an access token minted
//                  elsewhere. Listed anyway so the capability is known.
// A wrong URL is caught at mount time — mcp_add verifies the handshake —
// but entries here should still be real; this is a map, not a rumor mill.
//
// SCOPE: same tier as the other mcp_* tools (full/cofounder) — it only
// reads a constant, but it exists to feed mcp_add, so it lives beside it.
// ============================================================

export type ConnectorAuth = 'none' | 'token' | 'oauth';

export interface ConnectorEntry {
  name: string;          // mount slug — what mcp_add(name) resolves
  url: string;           // https streamable-HTTP endpoint
  auth: ConnectorAuth;
  about: string;         // what it offers + when to reach for it
  tags: string[];
  note?: string;         // caveat worth knowing before mounting
}

export const CONNECTOR_LIBRARY: ConnectorEntry[] = [
  {
    name: 'huggingface',
    url: 'https://huggingface.co/mcp',
    auth: 'none',
    about: 'Model, dataset, paper, and Space search on the Hugging Face Hub. Pre-mounted by default; a token raises rate limits.',
    tags: ['ml', 'models', 'datasets', 'papers'],
  },
  {
    name: 'deepwiki',
    url: 'https://mcp.deepwiki.com/mcp',
    auth: 'none',
    about: 'Ask questions about any public GitHub repository (AI-indexed docs and structure). Read a codebase you do not own without cloning it.',
    tags: ['code', 'docs', 'github', 'research'],
  },
  {
    name: 'context7',
    url: 'https://mcp.context7.com/mcp',
    auth: 'none',
    about: 'Version-accurate documentation and code examples for libraries and frameworks. Reach for it before writing against an API you have not used recently.',
    tags: ['docs', 'libraries', 'code'],
    note: 'anonymous works; a free API key raises limits',
  },
  {
    name: 'microsoft-learn',
    url: 'https://learn.microsoft.com/api/mcp',
    auth: 'none',
    about: 'Official Microsoft / Azure / .NET documentation search and retrieval.',
    tags: ['docs', 'azure', 'microsoft'],
  },
  {
    name: 'cloudflare-docs',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    auth: 'none',
    about: 'Cloudflare documentation search — Workers, D1, KV, R2, AI. The stack this very worker runs on; use it when a platform behavior is in question.',
    tags: ['docs', 'cloudflare', 'workers', 'd1'],
  },
  {
    name: 'cloudflare-bindings',
    url: 'https://bindings.mcp.cloudflare.com/mcp',
    auth: 'oauth',
    about: 'Manage Workers, D1 databases, KV namespaces, and R2 buckets on a Cloudflare account.',
    tags: ['cloudflare', 'infra', 'workers'],
  },
  {
    name: 'github',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    about: 'The official GitHub MCP server: repos, issues, PRs, code search, actions — reach beyond the forge allowlist. Token is a GitHub PAT.',
    tags: ['github', 'code', 'issues', 'prs'],
  },
  {
    name: 'stripe',
    url: 'https://mcp.stripe.com',
    auth: 'token',
    about: 'Stripe payments: customers, invoices, products, payment links. Token is a Stripe API key — treat as WRITE-capable and sensitive.',
    tags: ['payments', 'finance', 'business'],
  },
  {
    name: 'square',
    url: 'https://mcp.squareup.com/sse',
    auth: 'oauth',
    about: 'Square POS and payments data — the live POS behind RAPID²AI. Orders, catalog, payments, merchants.',
    tags: ['pos', 'payments', 'hospitality', 'rapid'],
    note: 'legacy SSE transport — the streamable-HTTP client may fail the handshake; the native rapid_* tools already cover ingested Square data',
  },
  {
    name: 'sentry',
    url: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
    about: 'Sentry error tracking: issues, events, projects — production error triage.',
    tags: ['observability', 'errors', 'debugging'],
  },
  {
    name: 'linear',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    about: 'Linear issue tracking: issues, projects, cycles.',
    tags: ['project', 'issues', 'planning'],
  },
  {
    name: 'notion',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    about: 'Notion workspace: search, read, and write pages and databases.',
    tags: ['docs', 'notes', 'workspace'],
  },
  {
    name: 'exa',
    url: 'https://mcp.exa.ai/mcp',
    auth: 'token',
    about: 'Exa neural web search built for agents — semantic search, page contents, research. A second, differently-shaped instrument next to web_search.',
    tags: ['search', 'web', 'research'],
  },
  {
    name: 'zapier',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    auth: 'token',
    about: 'Zapier actions across thousands of connected apps — one mount, many services.',
    tags: ['automation', 'apps', 'integration'],
    note: 'the real endpoint URL is minted per-account in Zapier MCP settings — mcp_add with that exact url + token, not the placeholder here',
  },
];

// ── pure helpers (unit-tested without DB or network) ─────────
export function findConnector(name: string): ConnectorEntry | null {
  const slug = String(name || '').toLowerCase().trim();
  return CONNECTOR_LIBRARY.find(e => e.name === slug) || null;
}

export function searchConnectors(q: string): ConnectorEntry[] {
  const needle = String(q || '').toLowerCase().trim();
  if (!needle) return CONNECTOR_LIBRARY;
  return CONNECTOR_LIBRARY.filter(e =>
    e.name.includes(needle) ||
    e.about.toLowerCase().includes(needle) ||
    e.tags.some(t => t.includes(needle))
  );
}

function renderEntry(e: ConnectorEntry): string {
  const mount = e.auth === 'none'
    ? `mcp_add("${e.name}")`
    : `mcp_add("${e.name}", token:"…")`;
  return `- ${e.name} [${e.tags.join(' ')}] — ${e.about}${e.note ? ` (NOTE: ${e.note})` : ''} → ${mount}`;
}

const AUTH_GROUPS: Array<{ auth: ConnectorAuth; header: string }> = [
  { auth: 'none', header: 'READY NOW (no auth — mountable this turn)' },
  { auth: 'token', header: 'TOKEN NEEDED (an API key/PAT from the service, passed to mcp_add)' },
  { auth: 'oauth', header: 'OAUTH-GATED (the service mints tokens via a flow the worker does not run — mountable only with an access token minted elsewhere)' },
];

export function renderConnectors(entries: ConnectorEntry[]): string {
  if (!entries.length) return '(no connector in the library matches — mcp_library() lists everything; a server not listed can still be mounted by raw url via mcp_add)';
  const sections: string[] = [];
  for (const { auth, header } of AUTH_GROUPS) {
    const group = entries.filter(e => e.auth === auth);
    if (group.length) sections.push(`${header}:\n${group.map(renderEntry).join('\n')}`);
  }
  return `CONNECTOR LIBRARY (${entries.length} of ${CONNECTOR_LIBRARY.length} entries):\n${sections.join('\n\n')}\n\nURLs are filled in for you — mcp_add(name) mounts an entry; mcp_tools(name) after mounting shows its live catalog.`;
}

// ── the tool ─────────────────────────────────────────────────
export function mcpLibrary(a: Record<string, unknown>): string {
  const q = String(a.q || a.query || a.search || '').trim();
  return renderConnectors(searchConnectors(q));
}
