// ============================================================
// MCP CONNECTOR LIBRARY — unit tests
// Pure-logic coverage: the catalog's own invariants, the search/lookup
// helpers mcp_add leans on, the rendered tool output, and the mcp-builder
// seed skill's validity. No DB, no network.
//   npx vitest run src/mcp-library.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_LIBRARY, findConnector, searchConnectors, renderConnectors, mcpLibrary,
} from './mcp-library';
import { SEEDS, validateSkill, MAX_SKILL_BODY } from './skills';

describe('catalog invariants', () => {
  it('every entry is well-formed: slug name, https url, known auth, prose, tags', () => {
    for (const e of CONNECTOR_LIBRARY) {
      expect(e.name, e.name).toMatch(/^[a-z0-9-]+$/);
      expect(e.url, e.name).toMatch(/^https:\/\//);
      expect(['none', 'token', 'oauth'], e.name).toContain(e.auth);
      expect(e.about.length, e.name).toBeGreaterThan(20);
      expect(e.tags.length, e.name).toBeGreaterThan(0);
    }
  });

  it('names are unique (they are the mount slugs mcp_add resolves)', () => {
    const names = CONNECTOR_LIBRARY.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('huggingface entry matches the URL mcp.ts pre-mounts, so add-by-name agrees with the seed', () => {
    expect(findConnector('huggingface')?.url).toBe('https://huggingface.co/mcp');
  });

  it('has at least a few no-auth entries — the shelf must offer something mountable this turn', () => {
    expect(CONNECTOR_LIBRARY.filter(e => e.auth === 'none').length).toBeGreaterThanOrEqual(3);
  });
});

describe('findConnector', () => {
  it('resolves by name, tolerant of case and whitespace', () => {
    expect(findConnector('deepwiki')?.url).toBe('https://mcp.deepwiki.com/mcp');
    expect(findConnector('  DeepWiki ')?.name).toBe('deepwiki');
  });

  it('unknown or empty name → null (mcp_add then demands a real url)', () => {
    expect(findConnector('not-a-connector')).toBeNull();
    expect(findConnector('')).toBeNull();
  });
});

describe('searchConnectors', () => {
  it('empty query returns the whole shelf', () => {
    expect(searchConnectors('')).toHaveLength(CONNECTOR_LIBRARY.length);
  });

  it('matches by name, by tag, and by keyword in the prose', () => {
    expect(searchConnectors('github').map(e => e.name)).toContain('github');
    expect(searchConnectors('docs').length).toBeGreaterThanOrEqual(2);
    expect(searchConnectors('POS').map(e => e.name)).toContain('square');
  });

  it('no match returns empty, not everything', () => {
    expect(searchConnectors('zzz-no-such-thing')).toHaveLength(0);
  });
});

describe('mcp_library tool output', () => {
  it('no arg: every entry appears, grouped under auth-readiness headers', () => {
    const out = mcpLibrary({});
    for (const e of CONNECTOR_LIBRARY) expect(out).toContain(`- ${e.name} `);
    expect(out).toContain('READY NOW');
    expect(out).toContain('TOKEN NEEDED');
    expect(out).toContain('OAUTH-GATED');
  });

  it('filtered: only matches appear, with the mount hint', () => {
    const out = mcpLibrary({ q: 'cloudflare' });
    expect(out).toContain('cloudflare-docs');
    expect(out).toContain('mcp_add("cloudflare-docs")');
    expect(out).not.toContain('- stripe ');
  });

  it('no match: says so and points back at the full shelf + raw-url mounting', () => {
    const out = mcpLibrary({ q: 'zzz-no-such-thing' });
    expect(out).toContain('no connector');
    expect(out).toContain('mcp_add');
  });

  it('entries carrying a caveat surface it in the listing', () => {
    expect(mcpLibrary({ q: 'square' })).toContain('NOTE:');
  });
});

describe('mcp-builder seed skill', () => {
  it('exists in the seed set and passes the library validator', () => {
    const seed = SEEDS.find(s => s.name === 'mcp-builder');
    expect(seed).toBeDefined();
    expect(validateSkill(seed!.name, seed!.description, seed!.body)).toBeNull();
    expect(seed!.body.length).toBeLessThanOrEqual(MAX_SKILL_BODY);
  });

  it('teaches the protocol core and points at the shelf-first rule', () => {
    const body = SEEDS.find(s => s.name === 'mcp-builder')!.body;
    for (const must of ['initialize', 'tools/list', 'tools/call', 'isError', 'mcp_library', 'forge']) {
      expect(body).toContain(must);
    }
  });

  it('every seed skill (not just the new one) passes the validator', () => {
    for (const s of SEEDS) expect(validateSkill(s.name, s.description, s.body), s.name).toBeNull();
  });
});
