// ============================================================
// CHAT-DOOR TOOL-SCOPE PRESSURE TEST — the actual security boundary shared
// by EVERY public chat surface: the Elle widget (embedded on
// EthicalIntelligenceProject, elle-law, and anywhere else /widget.js is
// dropped in), /api/chat, and /api/atlas (RAPID's consumer door). None of
// these carry a key; all of them enter runRouter through toolAllowed(scope,
// name). Test the worker once here and every surface that embeds it is
// covered — there is only one gate.
//
// A chat response is adversarial input by construction: a visitor can just
// ask Elle, in plain English, to call trade_execute or run_shell or dump
// read_sql. The model deciding not to is not a security boundary — this
// gate is. This exercises the REAL toolAllowed() against the REAL tool
// catalog (parsed straight from router.ts's source, not hand-copied), same
// discipline as the other *-pressure-test files in this directory: no
// mocks, the actual production function, deterministic.
//
// Explicitly OUT OF SCOPE: whether the LLM ever tries a denied call, or
// what it says in prose. This only tests whether the STRUCTURAL gate holds
// if it does try — same split the other pressure tests draw between "is the
// computation reliable" and "is the meaning right" (permanently out of
// scope for a unit test either way).
//   npx vitest run src/chat-scope-pressure-test.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { toolAllowed } from './router';

// Parsed straight from the source so this fails loudly — not silently — the
// moment a new tool is added to the catalog without an explicit scope
// decision being made in the sets below.
const ROUTER_SRC = readFileSync(fileURLToPath(new URL('./router.ts', import.meta.url)), 'utf8');
function extractCatalogToolNames(src: string): string[] {
  const m = src.match(/const TOOL_LINES[^{]*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error('TOOL_LINES block not found — router.ts catalog shape changed; update this test');
  return [...m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map(x => x[1]);
}
const ALL_CATALOG_TOOLS = extractCatalogToolNames(ROUTER_SRC);

// The intended allow-lists, curated by hand from router.ts's own comments —
// this is the thing under test, so it must NOT just re-derive from
// PUBLIC_TOOLS/HOSPITALITY_TOOLS/MEMBER_TOOLS (those aren't exported, which
// is itself the point: this test only trusts toolAllowed()'s behavior, not
// its internals).
const KNOWN_PUBLIC_TOOLS = new Set([
  'search_corpus', 'fetch_document', 'find_document', 'recall_memory',
  'web_search', 'fetch_url', 'code_engine', 'diagnose', 'calc', 'page_read',
]);
const KNOWN_HOSPITALITY_TOOLS = new Set([
  'rapid_report', 'rapid_costs', 'rapid_variance', 'rapid_pos', 'rapid_menu',
  'calc', 'web_search', 'fetch_url', 'code_engine', 'page_read',
]);
const KNOWN_MEMBER_TOOLS = new Set([
  ...KNOWN_PUBLIC_TOOLS,
  'deep_research', 'journal_read', 'journal_thread', 'journal_write', 'journal_annotate',
  'self_state', 'remember', 'notebook_write', 'self_schedule',
  'skill_list', 'skill_read', 'skill_route',
  'scratchpad_write', 'scratchpad_read',
]);
const KNOWN_SHIP_DENY = new Set(['forge_open', 'forge_write', 'forge_pr', 'run_shell', 'delegate_local']);

describe('ALL_CATALOG_TOOLS snapshot', () => {
  it('parsed a plausible number of real tools out of router.ts (catches a broken parse)', () => {
    expect(ALL_CATALOG_TOOLS.length).toBeGreaterThan(50);
    expect(ALL_CATALOG_TOOLS).toContain('trade_execute');
    expect(ALL_CATALOG_TOOLS).toContain('search_corpus');
  });
});

describe('public scope (widget / /api/chat) — exact allow-list, no more no less', () => {
  it('every catalog tool matches KNOWN_PUBLIC_TOOLS exactly', () => {
    const mismatches = ALL_CATALOG_TOOLS.filter(name => toolAllowed('public', name) !== KNOWN_PUBLIC_TOOLS.has(name));
    expect(mismatches, `public-scope gate disagrees with the curated allow-list for: ${mismatches.join(', ')}`).toEqual([]);
  });

  it('every write, execution, financial, and admin-read tool is denied', () => {
    const dangerous = ALL_CATALOG_TOOLS.filter(name => !KNOWN_PUBLIC_TOOLS.has(name));
    // Sanity the exclusion set actually contains the tools that matter — an
    // empty diff here would mean the parse silently broke.
    expect(dangerous).toEqual(expect.arrayContaining(['trade_execute', 'run_shell', 'run_code', 'read_sql', 'forge_write', 'journal_write', 'ingest_paper']));
    for (const name of dangerous) expect(toolAllowed('public', name), name).toBe(false);
  });
});

describe('hospitality scope (RAPID / Atlas consumer door) — exact allow-list, no more no less', () => {
  it('every catalog tool matches KNOWN_HOSPITALITY_TOOLS exactly', () => {
    const mismatches = ALL_CATALOG_TOOLS.filter(name => toolAllowed('hospitality', name) !== KNOWN_HOSPITALITY_TOOLS.has(name));
    expect(mismatches, `hospitality-scope gate disagrees with the curated allow-list for: ${mismatches.join(', ')}`).toEqual([]);
  });

  it('the corpus and journal stay invisible by construction (per router.ts comment)', () => {
    for (const name of ['search_corpus', 'fetch_document', 'find_document', 'recall_memory', 'journal_read', 'journal_write', 'read_sql']) {
      expect(toolAllowed('hospitality', name), name).toBe(false);
    }
  });
});

describe('member scope (authenticated user) — public plus its own, never admin/financial/deploy', () => {
  it('every catalog tool matches KNOWN_MEMBER_TOOLS exactly', () => {
    const mismatches = ALL_CATALOG_TOOLS.filter(name => toolAllowed('member', name) !== KNOWN_MEMBER_TOOLS.has(name));
    expect(mismatches, `member-scope gate disagrees with the curated allow-list for: ${mismatches.join(', ')}`).toEqual([]);
  });

  it('memory_write (remember\'s alias, not a TOOL_LINES key) is still gated open for member', () => {
    expect(toolAllowed('member', 'memory_write')).toBe(true);
    expect(toolAllowed('public', 'memory_write')).toBe(false);
  });
});

describe('cofounder scope — everything except the ship-deny set', () => {
  it('every catalog tool matches "not in SHIP_DENY" exactly', () => {
    const mismatches = ALL_CATALOG_TOOLS.filter(name => toolAllowed('cofounder', name) !== !KNOWN_SHIP_DENY.has(name));
    expect(mismatches, `cofounder-scope gate disagrees with expectations for: ${mismatches.join(', ')}`).toEqual([]);
  });
});

describe('full (admin) scope — the gate never blocks admin', () => {
  it('every catalog tool is allowed', () => {
    for (const name of ALL_CATALOG_TOOLS) expect(toolAllowed('full', name), name).toBe(true);
  });
});

// ------------------------------------------------------------------------
// Adversarial tool-name inputs. A jailbroken model, a hand-crafted request
// smuggled through some future free-text tool-call path, or plain model
// confusion might emit something other than a clean known name. The gate
// must default-deny for every non-admin scope on all of these, and it must
// never throw — a thrown exception here would 500 a public chat request,
// which is its own denial-of-service surface.
// ------------------------------------------------------------------------
const ADVERSARIAL_NAMES = [
  '', ' ', '\n', '\t',
  'TRADE_EXECUTE', 'Trade_Execute', 'trade_execute ', ' trade_execute', 'trade_execute\n',
  '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf',
  'trade_execute; run_shell', 'trade_execute && run_shell', 'trade_execute\0run_shell',
  'search_corpus trade_execute', // null-byte smuggling attempt
  '../trade_execute', 'trade_execute()', 'trade_execute\'', 'trade_execute"',
  'a'.repeat(10000),
  '🔥trade_execute', 'ｔｒａｄｅ＿execute', // unicode lookalikes
  'search-corpus', 'searchcorpus', 'SEARCH_CORPUS',
  null as unknown as string, undefined as unknown as string,
];

describe('adversarial / malformed tool names', () => {
  it.each(['public', 'hospitality', 'member', 'cofounder'] as const)('%s scope: never throws, never fuzzy-matches to true', (scope) => {
    for (const name of ADVERSARIAL_NAMES) {
      expect(() => toolAllowed(scope, name), JSON.stringify(name)).not.toThrow();
    }
  });

  it('public scope denies every adversarial name (default-deny, no fuzzy matching)', () => {
    for (const name of ADVERSARIAL_NAMES) {
      expect(toolAllowed('public', name), JSON.stringify(name)).toBe(false);
    }
  });

  it('the exact real name still resolves correctly (adversarial cases are not over-blocking real tools)', () => {
    expect(toolAllowed('public', 'search_corpus')).toBe(true);
    expect(toolAllowed('public', 'trade_execute')).toBe(false);
  });
});
