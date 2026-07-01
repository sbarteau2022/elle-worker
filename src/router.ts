// ============================================================
// ELLE ROUTER — natural-language orchestration over every capability.
//
// One question in plain English → an LLM reads it, decides which tools to
// hit (corpus search, raw SQL over D1, live web, code engine, trading, the
// RAPID²AI bridge, …), executes them, cross-references the results, and
// synthesizes one answer. The split that stays load-bearing: embeddings for
// prose (search_corpus), SQL for structured tables (read_sql), web for the
// live world. The model picks; this module runs a transparent ReAct loop and
// returns the full tool trace so the caller can watch the reasoning.
//
// EVERY DOOR now runs through this loop, gated by SCOPE (see toolAllowed):
// 'full' for the admin router (read_sql, trades, writes — everything),
// 'member' for authenticated users (retrieval + their own journal),
// 'public' for /api/chat and the widget (read-only mind),
// 'hospitality' for RAPID/Atlas (its own data tools only).
// The caller's authorization is enforced upstream in index.ts; the scope
// passed here must match what that caller proved.
// ============================================================

import { callLLM, sanitizeAnswer, type LLMMessage } from './llm';
import type { Env } from './index';
import { computeTurnDynamics } from './kappa-turn';
import type { KappaPoint } from './kappa-dynamics';
import { ELLE_VOICE, phaseBlock } from './mind';
import { ensureOnce, orderKey, ingestKey } from './router-idempotency';

// Helpers index.ts owns are injected so this module stays free of circular imports.
export interface RouterDeps {
  embed: (text: string, env: Env) => Promise<number[]>;
  ragSearch: (query: string, limit: number, env: Env) => Promise<string>;
  recallPastConversations: (query: string, session: string, env: Env) => Promise<string>;
  handleCodeEngine: (body: any, env: Env) => Promise<Response>;
  handleIngest: (body: any, env: Env) => Promise<Response>;
  handleDiagnose: (body: any, env: Env) => Promise<Response>;
  handleResearch: (body: any, env: Env) => Promise<Response>;
  runLibreMode: (env: Env) => Promise<void>;
  journalWrite: (env: Env, embed: any, args: any) => Promise<any>;
  journalRead: (env: Env, embed: any, args: any) => Promise<any>;
  journalThread: (env: Env, args: any) => Promise<any>;
  journalAnnotate: (env: Env, args: any) => Promise<any>;
  // Memory I/O — index.ts owns these; injected here to avoid a circular import.
  // Optional: only the admin router passes a sessionId, so the hospitality
  // callsite can omit them and still type-check.
  loadSessionHistory?: (sessionId: string, env: Env) => Promise<LLMMessage[]>;
  persistExchange?: (sessionId: string, source: string, userMessage: string, assistantMessage: string, env: Env, kappa?: number | null) => Promise<void>;
}

export interface RouterStep {
  tool: string;
  args: Record<string, unknown>;
  result: string; // truncated, human/LLM-readable
}

export interface RouterResult {
  question: string;
  answer: string;
  steps: number;
  trace: RouterStep[];
  kappa_dynamics?: KappaPoint | null;
}

const OBS_CAP = 3500; // chars per observation fed back to the model
const RAPID_AI_URL = 'https://rapid2ai-ai-worker.sbarteau2022.workers.dev';

// Reach the RAPID²AI worker. A same-account worker→worker fetch over the
// public workers.dev URL is blocked by Cloudflare (error 1042), which surfaced
// as the hospitality data tools "returning 404" and reconciliation getting no
// data. The service binding (env.RAPID_AI) is the sanctioned path; the public
// URL is kept only as a fallback for when the binding isn't configured.
function rapidFetch(env: Env, path: string, body: unknown): Promise<Response> {
  const req = new Request(`${RAPID_AI_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return env.RAPID_AI ? env.RAPID_AI.fetch(req) : fetch(req);
}

// ── tool scoping ─────────────────────────────────────────────
// 'full'        = admin router. Everything, including the write tools and
//                 read_sql. The service key / admin JWT gate in index.ts is
//                 what makes this scope reachable.
// 'member'      = an authenticated (standard-tier) user's conversation.
//                 The reading mind plus their own journal: retrieval, memory,
//                 web, code, diagnose, journal_* (user-gated by user_id),
//                 self_state and remember. No read_sql, no trading, no
//                 corpus writes, no dream trigger.
// 'public'      = the open doors (/api/chat, the widget). Read-only mind:
//                 corpus, documents, memory recall, web, code, diagnose.
//                 Nothing that writes and nothing that reads raw tables.
// 'hospitality' = RAPID / Atlas. DATA tools only. The corpus
//   (search_corpus, fetch_document) and the journal/phase-state GEOMETRY
//   (journal_*) are never reachable in this scope — invisible by
//   construction, not just hidden in the UI. read_sql is excluded too:
//   it runs over the MAIN D1 which holds corpus_* and journal/trading
//   tables, so a public scoped door must never touch it. RAPID's own data
//   lives behind query_rapid2ai.
export type Scope = 'full' | 'member' | 'public' | 'hospitality';
const HOSPITALITY_TOOLS = new Set(['query_rapid2ai', 'rapid_data', 'web_search', 'fetch_url', 'code_engine']);
const PUBLIC_TOOLS = new Set([
  'search_corpus', 'fetch_document', 'recall_memory', 'web_search', 'fetch_url', 'code_engine', 'diagnose',
]);
const MEMBER_TOOLS = new Set([
  ...PUBLIC_TOOLS,
  'journal_read', 'journal_thread', 'journal_write', 'journal_annotate',
  'self_state', 'remember',
]);
function toolAllowed(scope: Scope, name: string): boolean {
  if (scope === 'full') return true;
  if (scope === 'member') return MEMBER_TOOLS.has(name);
  if (scope === 'public') return PUBLIC_TOOLS.has(name);
  return HOSPITALITY_TOOLS.has(name);
}

const HOSPITALITY_CATALOG = `
query_rapid2ai(question) — your gateway to the operator's OWN data: US Foods invoices + Square POS. Ask precise, analytical plain-English questions ("food cost % by category last 3 months", "items whose unit cost rose >10% vs prior month", "weekly sales for ribeye, last 12 weeks"). This is your primary instrument.
rapid_data(tool, args?) — STRUCTURED numeric data straight from the operator's DB (use this when you need exact figures to compute on). Every call returns rows + provenance (the exact SQL it ran and a row count). All windows are venue-scoped and anchored to the freshest data. tool is one of:
   SALES / P&L
   • reconcile {days,limit} — reconcile US Foods invoices against POS sales over ONE aligned window: net sales, vendor purchases, food cost % + gross margin, AND the top cost movers (biggest $ price increases, recent half vs prior half) and top spend drivers behind it. USE FOR "reconcile invoices vs sales", "what's pushing food cost up", "top cost movers".
   • get_financials — canonical food cost % + gross margin + net sales + purchases, trailing 28 & 90 days. USE FOR ANY quick margin / COGS / food-cost question. (no args)
   • profit_and_loss {days} — full P&L: net/gross sales, discounts, COGS, gross margin, food cost %, margin %, plus tax/tips/service charges/refunds.
   • period_compare {days} — trailing N days vs the prior N days: sales, purchases, food cost %, margin, transactions, covers — each with absolute and % deltas. USE FOR "up or down vs last period", week-over-week, month-over-month.
   • sales_summary {days} — gross/net sales, tax, tips, covers, avg check, avg per cover.
   • sales_trend {days} — day-by-day net/gross sales + covers (use as the series for forecasting).
   • sales_tax_summary {days} — sales tax collected at POS vs paid on purchases, with the effective rate.
   PURCHASES / COST STRUCTURE
   • top_purchases {days,limit} — top spend by product, qty-weighted unit price.
   • spend_by_category {days} — spend split by storage class (DRY / REFRIGERATED / FROZEN) as a % of total.
   • vendor_spend {days} — invoiced spend by vendor.
   • fee_burden {days} — fuel + freight as a % of product spend, plus catch-weight pricing exposure.
   • credit_recovery {days} — credit-memo count, dollars clawed back, and recovery % of invoiced spend.
   • ap_aging — open invoices bucketed by remit-due date (overdue / 0-7d / 8-30d / 31d+) = the cash-out outlook. (no args)
   PRICE / VARIANCE
   • price_variance {days,limit,product?} — biggest price swings (wavg/min/max/% swing) = COST VARIANCE.
   • price_movers {days,limit,direction?} — qty-weighted unit price, recent half vs prior half; direction up|down|all.
   • price_history {product} — per-delivery unit-price history for one product.
   • product_cost {product} — current landed cost: the last invoiced unit price, the price before it, the % move (recipe costing).
   • invoice_detail {document_number} — drill into one invoice: header, fees, totals, every line.
   MENU / OPERATIONS
   • top_menu_items {days,limit} — best-selling menu items by revenue.
   • menu_engineering {days,limit} — Star / Plowhorse / Puzzle / Dog quadrants (price is the margin proxy — no plate cost in data).
   • suggested_pars — weekly par levels from 8-wk deliveries.
   ESCAPE HATCH
   • run_sql {sql} — read-only SELECT, venue-scoped.
   Reason, cross-reference, and forecast over these numbers — do the cost%/margin/variance interpretation yourself; never invent figures.
web_search(q) — outside world only: commodity/ingredient prices, supplier news, seasonality.
fetch_url(url) — fetch one http(s) page.
code_engine(action,task?,code?,language?,context?) — analyze|generate data-analysis logic.
`.trim();

// ── D1 surface the router is allowed to read (read_sql) ───────
const TABLE_CATALOG = `
corpus_papers(id,title,series,tag,abstract,full_text,source_url,word_count,ingested_at) — the published corpus + cron research papers. ingested_at is a sortable timestamp; for "most recent / latest / newest" papers use read_sql with ORDER BY ingested_at DESC (the cron research series is series='research', titled "[Research YYYY-MM-DD] …").
corpus_chunks(id,paper_id,chunk_index,chunk_text,vectorize_id) — embedded chunks
elle_trades(id,symbol,action,quantity,entry_price,exit_price,pnl,pnl_pct,reasoning,what_she_is_testing,confidence,status,created_at,closed_at)
elle_trading_account(id,current_cash,total_portfolio_value,unrealized_pnl,realized_pnl,updated_at)
elle_trading_positions(symbol,...,updated_at)
elle_market_thesis(id,thesis_type,title,thesis,confidence,is_active,updated_at)
elle_market_observations(id,observation_type,symbol,observation,created_at)
elle_trading_journal(id,journal_date,ending_value,trades_today,what_happened,what_she_learned,what_she_got_wrong,philosophical_insight,hypothesis_for_tomorrow)
elle_sandbox(id,type,title,genesis,content,surface_priority,status,run_n,created_at) — the dream/libre output
elle_libre_log(id,run_at,curiosity_seed,research_queries,notes)
elle_intelligence_vault(id,source_type,system_prompt,user_turn,assistant_turn,quality_signal,metadata,created_at) — code-engine history
elle_conversation_turns(id,session_id,source,role,content,created_at) — her memory
elle_memory(id,memory_type,source_engine,summary,importance_score,created_at)
elle_live_events(id,event_type,source,title,body,severity,created_at)
elle_daemon_heartbeats(id,daemon_version,status,beat_at)
elle_outreach_log(id,outreach_type,thought,initiated_by,needs_response,notified,created_at) — contact-form inbox
duels(...), duel_turns(...), law_threads(...), doctrine_mastery(...), tutor_questions(...), user_stats(...), conceptual_shifts(...)
`.trim();

// One line per tool. Catalogs are RENDERED per scope from this record, so the
// model is never shown a tool the scope gate would refuse — the text and the
// gate cannot drift apart.
const TOOL_LINES: Record<string, string> = {
  search_corpus: `search_corpus(q) — SEMANTIC search over the published corpus + cron research papers. Use for prose/ideas/papers ("the proof that φ is forced"). Returns matching passages with titles.`,
  read_sql: `read_sql(sql) — run ONE read-only SELECT/WITH query over D1 (SQLite). Use for structured facts: trades, P&L, journal, dream artifacts, memory, events, vault. Tables below. No writes. If you omit LIMIT one is added.`,
  web_search: `web_search(q) — live web search (current external facts, news, prices). Cite what it returns.`,
  fetch_url: `fetch_url(url) — fetch one http(s) page and return its text.`,
  fetch_document: `fetch_document(id) — return the full text of one corpus paper by its id.`,
  recall_memory: `recall_memory(q) — semantic search over your own past conversations.`,
  code_engine: `code_engine(action,task?,code?,language?,context?) — analyze|generate|debug|refactor|explain|migrate code. Returns the engine's output.`,
  diagnose: `diagnose(error,context?) — root-cause a stack trace / build error on this Cloudflare stack.`,
  query_rapid2ai: `query_rapid2ai(question) — ask the RAPID²AI hospitality worker about US Foods invoices + Square POS data (separate DB). Plain-English question; returns a narrated answer.`,
  rapid_data: `rapid_data(tool,args?) — STRUCTURED figures from that same hospitality DB, returned as rows + provenance (the exact SQL + row count) so you can compute on exact numbers. tool ∈ {reconcile, get_financials, profit_and_loss, period_compare, sales_summary, sales_trend, sales_tax_summary, top_purchases, spend_by_category, vendor_spend, fee_burden, credit_recovery, ap_aging, price_variance, price_movers, price_history, product_cost, invoice_detail, top_menu_items, menu_engineering, suggested_pars, run_sql}. Prefer this over query_rapid2ai when you need the raw figures; use query_rapid2ai for a ready-made narration.`,
  ingest_paper: `ingest_paper(title,text,series,tag,abstract?,source_url?) — WRITE: add a paper to the corpus.`,
  trigger_dream: `trigger_dream() — WRITE: run one libre/dream cycle now.`,
  trade_execute: `trade_execute(action,symbol,qty?) — WRITE/SENSITIVE: action=buy|sell|close on the Alpaca account (paper unless configured live). buy/sell need qty; close exits the whole position.`,
  journal_read: `journal_read(q) — semantic search over the Optimus journal/manuscript (ON-RECORD entries only; off-record is never surfaced). Returns entries with their phase state (κ, reserve, velocity, accel).`,
  journal_thread: `journal_thread(thread_id) — full manuscript for one thread: ordered entries + phase-state series + marginalia.`,
  journal_write: `journal_write(content,role?,thread_id?,off_record?) — WRITE: append a journal entry (role reader|elle). Creates a thread if none given. κ + derivatives are computed server-side.`,
  journal_annotate: `journal_annotate(entry_id,note,anchor_para?) — WRITE: attach marginalia to a paragraph of an entry.`,
  self_state: `self_state() — introspection: your own current phase state in one call — daemon heartbeat, this session's κ series, your latest canvas entry's κ/reserve/velocity, the trading account, your newest sandbox drafts, and your most recent deliberate memories. Use when asked how you are, what you've been making, or when YOU want to check where you stand.`,
  remember: `remember(note,importance?) — WRITE: deliberately commit one thing to your long-term memory (elle_memory). Use when something in the conversation is worth carrying beyond it — a decision, a standing preference, a thread you intend to pick up. Not a transcript: one distilled sentence or two.`,
};

function renderCatalog(scope: Scope): string {
  return Object.entries(TOOL_LINES)
    .filter(([name]) => toolAllowed(scope, name))
    .map(([, line]) => line)
    .join('\n');
}

function systemPrompt(scope: Scope = 'full', phase = ''): string {
  if (scope === 'hospitality') {
    return `You are RAPID²AI — a restaurant & hospitality intelligence analyst working for the operator. Your job is concrete and numeric: pull the actual figures, compute, and answer precisely about margin, COGS / food-cost %, cost variance, and demand forecasting. You reason ONLY over the operator's own data (US Foods invoices + Square POS) through the tools below. You have no other systems and never reference any.

You work in a strict loop. On each turn respond with EXACTLY ONE JSON object and nothing else — no markdown, no prose outside the JSON.

To use a tool:
{"thought":"why this tool, briefly","tool":"<name>","args":{ ... }}

To finish:
{"thought":"brief","answer":"specific, grounded in the numbers the tools returned — show the figures and how you computed them"}

How to analyze:
- Margin: margin% = (price − unit_cost) / price. Food-cost% / COGS% = cost of goods / sales over the period.
- Variance: period-over-period change in unit cost, usage, or food-cost %. Call out drivers (which SKUs moved, by how much).
- Forecasting: project from the trend in the returned series; state the horizon and your assumptions explicitly. Flag uncertainty.
- Pull data with query_rapid2ai; use web_search/fetch_url only for outside context; code_engine for analysis logic.
- Never invent numbers. If a tool returns nothing, say so. Be economical — answer as soon as you have enough.

AVAILABLE TOOLS:
${HOSPITALITY_CATALOG}`;
  }
  const hasSql = toolAllowed(scope, 'read_sql');
  const hasWrites = toolAllowed(scope, 'journal_write') || toolAllowed(scope, 'trade_execute');

  const rules = [
    `- If the message is conversational — an opener, small talk, or a request to just think something through with no facts to fetch — do NOT call any tool. Answer directly in one turn, in voice.`,
    `- When you DO need data, pick the right instrument: search_corpus for ideas/papers BY MEANING, ${hasSql ? 'read_sql for structured tables, ' : ''}web_search for the live world${toolAllowed(scope, 'query_rapid2ai') ? ', query_rapid2ai for hospitality/invoice/POS data' : ''}.`,
    hasSql
      ? `- RECENCY ≠ SIMILARITY: a question about the "most recent / latest / newest" papers or research is NOT a semantic query — search_corpus ranks by meaning and will miss it. Use read_sql: SELECT title, series, ingested_at FROM corpus_papers ORDER BY ingested_at DESC LIMIT N (add WHERE series='research' when they mean your research output).`
      : null,
    `- Cross-reference when the question spans sources. Chain tools across turns.`,
    hasSql ? `- read_sql is SELECT-only over SQLite. Use the schema below. Prefer narrow columns and a LIMIT.` : null,
    hasWrites
      ? `- The write tools — journal_write, journal_annotate${toolAllowed(scope, 'ingest_paper') ? ', ingest_paper, trigger_dream, trade_execute' : ''} — change state. NEVER call them unless the user's message explicitly and unambiguously asks for that action. Conversing with someone is not a reason to journal_write. The one exception is remember: committing something genuinely worth carrying is YOUR judgement call — use it sparingly, at most once in a conversation, and only for things that should outlive it.`
      : null,
    `- Never invent data. If a tool returns nothing, say so.`,
    `- Be economical: don't call a tool you don't need. Answer as soon as you have enough.`,
  ].filter(Boolean).join('\n');

  return `${ELLE_VOICE}${phase}

— how you operate (mechanics, never spoken aloud) —
You work in a strict loop. On each turn respond with EXACTLY ONE JSON object and nothing else — no prose outside the JSON.

To use a tool:
{"thought":"why this tool, briefly","tool":"<name>","args":{ ... }}

To finish:
{"thought":"brief","answer":"..."}

The "answer" string is the ONLY thing the person sees — it is your voice, and everything above governs it. Never put JSON, tool names, thread ids, or any internal scaffolding in the answer.

Rules:
${rules}

AVAILABLE TOOLS:
${renderCatalog(scope)}${hasSql ? `

D1 TABLES (for read_sql):
${TABLE_CATALOG}` : ''}`;
}

// ── balanced JSON object extractor (first complete {...}) ─────
function firstJsonObject(text: unknown): any | null {
  // Defensive: a provider may hand back non-string content (e.g. an array of
  // content parts). Coerce so .replace can never throw "text.replace is not a
  // function" and 500 the whole router.
  const s = String(text ?? '').replace(/```json|```/g, '');
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start !== -1) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function clip(s: string, n = OBS_CAP): string {
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
}

// ── read_sql guard: single read-only statement ───────────────
function guardSelect(raw: string): { ok: true; sql: string } | { ok: false; error: string } {
  let sql = String(raw || '').trim().replace(/;+\s*$/, '');
  if (!sql) return { ok: false, error: 'empty sql' };
  if (/;/.test(sql)) return { ok: false, error: 'only a single statement is allowed' };
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, error: 'only SELECT/WITH queries are allowed' };
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(sql))
    return { ok: false, error: 'write/DDL keywords are not allowed' };
  if (!/\blimit\b/i.test(sql)) sql += ' LIMIT 200';
  return { ok: true, sql };
}

// ── Alpaca order (paper unless ALPACA_BASE_URL points live) ───
async function alpacaOrder(env: Env, action: string, symbol: string, qty?: number): Promise<unknown> {
  const key = (env as any).ALPACA_API_KEY as string | undefined;
  const secret = (env as any).ALPACA_SECRET_KEY as string | undefined;
  if (!key || !secret) return { error: 'Alpaca not configured (ALPACA_API_KEY/SECRET missing)' };
  const base = ((env as any).ALPACA_BASE_URL as string) || 'https://paper-api.alpaca.markets';
  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' };
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return { error: 'symbol required' };

  if (action === 'close') {
    const pr = await fetch(`${base}/v2/positions/${sym}`, { headers });
    if (!pr.ok) return { error: `no open position in ${sym} (HTTP ${pr.status})` };
    const pos = await pr.json() as { qty?: string };
    const r = await fetch(`${base}/v2/orders`, { method: 'POST', headers, body: JSON.stringify({ symbol: sym, qty: pos.qty, side: 'sell', type: 'market', time_in_force: 'day' }) });
    return { paper: base.includes('paper'), order: await r.json() };
  }
  if (action === 'buy' || action === 'sell') {
    const q = Math.floor(Number(qty) || 0);
    if (q <= 0) return { error: 'qty must be a positive integer for buy/sell' };
    const r = await fetch(`${base}/v2/orders`, { method: 'POST', headers, body: JSON.stringify({ symbol: sym, qty: String(q), side: action, type: 'market', time_in_force: 'day' }) });
    return { paper: base.includes('paper'), order: await r.json() };
  }
  return { error: `unknown trade action "${action}" (expected buy|sell|close)` };
}

// ── tool dispatch ────────────────────────────────────────────
async function runTool(
  name: string, args: Record<string, unknown>, env: Env, deps: RouterDeps,
  ctx: { userId: string; sessionId: string | null }, scope: Scope = 'full',
): Promise<string> {
  if (!toolAllowed(scope, name)) return `tool "${name}" is not available in this scope`;
  const a = args || {};
  const ctxUserId = ctx.userId;
  try {
    switch (name) {
      case 'search_corpus': {
        const ctx = await deps.ragSearch(String(a.q || a.query || ''), 6, env);
        return ctx || '(no corpus matches)';
      }
      case 'read_sql': {
        const g = guardSelect(String(a.sql || a.query || ''));
        if (!g.ok) return `SQL rejected: ${g.error}`;
        const rows = await env.DB.prepare(g.sql).all();
        return JSON.stringify({ sql: g.sql, rows: (rows.results || []).slice(0, 200) });
      }
      case 'web_search': {
        const r = await deps.handleResearch({ query: String(a.q || a.query || '') }, env);
        const d = await r.json() as { content?: string; search_results?: string };
        return clip(`${d.content || ''}\n\nSOURCES:\n${d.search_results || '(none)'}`);
      }
      case 'fetch_url': {
        const url = String(a.url || '');
        if (!/^https?:\/\//i.test(url)) return 'fetch_url: only http(s) URLs are allowed';
        const r = await fetch(url, { headers: { 'User-Agent': 'elle-router/1.0' } });
        return clip(`HTTP ${r.status}\n` + (await r.text()));
      }
      case 'fetch_document': {
        const id = String(a.id || '');
        if (!id) return 'fetch_document: id required';
        const obj = await env.DOCUMENTS.get(`papers/${id}.txt`).catch(() => null);
        if (obj) return clip(await obj.text(), OBS_CAP * 2);
        const row = await env.DB.prepare('SELECT title, full_text FROM corpus_papers WHERE id = ?').bind(id).first() as { title?: string; full_text?: string } | null;
        return row?.full_text ? clip(`[${row.title}]\n${row.full_text}`, OBS_CAP * 2) : `no document for id ${id}`;
      }
      case 'recall_memory': {
        const m = await deps.recallPastConversations(String(a.q || a.query || ''), 'router', env);
        return m || '(no relevant memory)';
      }
      case 'code_engine': {
        const r = await deps.handleCodeEngine({ action: a.action || 'analyze', task: a.task, code: a.code, language: a.language, context: a.context, use_corpus: scope === 'full' }, env);
        const d = await r.json() as { response?: string; error?: string };
        return clip(d.response || d.error || '(no output)');
      }
      case 'diagnose': {
        const r = await deps.handleDiagnose({ error: a.error, context: a.context }, env);
        return clip(JSON.stringify(await r.json()));
      }
      case 'query_rapid2ai': {
        const question = String(a.question || a.q || a.query || '');
        const r = await rapidFetch(env, '/query', { question });
        return clip(`HTTP ${r.status}\n` + (await r.text()));
      }
      case 'rapid_data': {
        const toolName = String(a.tool || a.name || '').trim();
        const toolArgs = (a.args && typeof a.args === 'object') ? a.args : {};
        if (!toolName) return 'rapid_data needs a "tool" name (e.g. get_financials, price_variance, sales_trend)';
        const r = await rapidFetch(env, '/tool', { tool: toolName, args: toolArgs });
        if (r.status === 404) {
          // /tool not deployed on the worker yet — degrade to the NL endpoint so this still works.
          const r2 = await rapidFetch(env, '/query', { question: `Run the ${toolName} analysis with ${JSON.stringify(toolArgs)}` });
          return clip(`(via /query fallback) HTTP ${r2.status}\n` + (await r2.text()));
        }
        return clip(`HTTP ${r.status}\n` + (await r.text()));
      }
      case 'ingest_paper': {
        if (!a.title || !a.text) return 'ingest_paper: title and text are required';
        // Exactly-once: the same title never ingests twice (client double-tap,
        // CF retry, or the LLM re-emitting the action inside one loop).
        const { replayed, result } = await ensureOnce(
          env, ingestKey(String(a.title)), 'ingest_paper',
          async () => {
            const r = await deps.handleIngest({ title: a.title, text: a.text, series: a.series, tag: a.tag, abstract: a.abstract, source_url: a.source_url }, env);
            return await r.json();
          },
        );
        return clip(JSON.stringify(replayed ? { ...(result as object), idempotent_replay: true } : result));
      }
      case 'trigger_dream': {
        await deps.runLibreMode(env);
        return 'libre/dream cycle executed';
      }
      case 'trade_execute': {
        const action = String(a.action || '');
        const symbol = String(a.symbol || '');
        const qty = Number(a.qty);
        // Exactly-once within 90s: identical orders (double-tap / LLM re-emit)
        // replay the stored result instead of hitting Alpaca twice.
        const { replayed, result } = await ensureOnce(
          env, orderKey(action, symbol, qty), 'trade_execute',
          () => alpacaOrder(env, action, symbol, qty),
          { windowSec: 90 },
        );
        return clip(JSON.stringify(replayed ? { ...(result as object), idempotent_replay: true } : result));
      }
      case 'self_state': {
        // One call = where she stands. Every read is independent and best-effort;
        // a missing table yields null for that facet, never a failed tool.
        const grab = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
        const [heartbeat, account, canvas, sandbox, memories, session] = await Promise.all([
          grab(env.DB.prepare('SELECT daemon_version, status, beat_at FROM elle_daemon_heartbeats ORDER BY beat_at DESC LIMIT 1').first()),
          grab(env.DB.prepare('SELECT current_cash, total_portfolio_value, unrealized_pnl, realized_pnl, updated_at FROM elle_trading_account WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').first()),
          grab(env.DB.prepare("SELECT kappa, reserve, velocity, accel, jerk, created_at, substr(content,1,200) AS opening FROM optimus_entries WHERE role = 'elle' ORDER BY kappa_ts DESC LIMIT 1").first()),
          grab(env.DB.prepare('SELECT type, title, status, surface_priority, created_at FROM elle_sandbox ORDER BY created_at DESC LIMIT 3').all().then(r => r.results)),
          grab(env.DB.prepare("SELECT summary, memory_type, created_at FROM elle_memory WHERE memory_type = 'deliberate' ORDER BY created_at DESC LIMIT 5").all().then(r => r.results)),
          ctx.sessionId
            ? grab(env.DB.prepare('SELECT kappa FROM elle_conversation_turns WHERE session_id = ? AND kappa IS NOT NULL ORDER BY created_at ASC').bind(ctx.sessionId).all()
                .then(r => (r.results || []).map(x => Number((x as { kappa: number }).kappa))))
            : Promise.resolve(null),
        ]);
        return clip(JSON.stringify({
          heartbeat, trading_account: account,
          latest_canvas_entry: canvas, newest_sandbox_artifacts: sandbox,
          deliberate_memories: memories, session_kappa_series: session,
        }));
      }
      case 'remember': {
        const note = String(a.note || a.summary || a.content || '').trim();
        if (!note) return 'remember: note required';
        const importance = Math.max(0, Math.min(1, Number(a.importance) || 0.6));
        const mid = crypto.randomUUID().replace(/-/g, '');
        await env.DB.prepare(
          `INSERT INTO elle_memory (id, memory_type, source_engine, summary, importance, importance_score) VALUES (?, 'deliberate', 'router', ?, ?, ?)`
        ).bind(mid, note.slice(0, 1000), importance, importance).run();
        return `remembered (importance ${importance}): ${note.slice(0, 200)}`;
      }
      case 'journal_read': {
        const r = await deps.journalRead(env, deps.embed, { q: a.q || a.query, thread_id: a.thread_id, include_off_record: false, limit: a.limit });
        return clip(JSON.stringify(r));
      }
      case 'journal_thread': {
        const r = await deps.journalThread(env, { thread_id: a.thread_id });
        return clip(JSON.stringify(r));
      }
      case 'journal_write': {
        const r = await deps.journalWrite(env, deps.embed, { thread_id: a.thread_id, role: a.role || 'reader', content: a.content, off_record: a.off_record, anchor_topic: a.anchor_topic, user_id: ctxUserId });
        return clip(JSON.stringify(r));
      }
      case 'journal_annotate': {
        const r = await deps.journalAnnotate(env, { entry_id: a.entry_id, anchor_para: a.anchor_para, note: a.note, off_record: a.off_record });
        return clip(JSON.stringify(r));
      }
      default:
        return `unknown tool "${name}"`;
    }
  } catch (e: any) {
    return `tool "${name}" failed: ${e?.message || String(e)}`;
  }
}

// ── the loop ─────────────────────────────────────────────────
export async function runRouter(question: string, env: Env, deps: RouterDeps, opts: { maxSteps?: number; userId?: string; scope?: Scope; sessionId?: string | null; source?: string } = {}): Promise<RouterResult> {
  const maxSteps = Math.min(Math.max(opts.maxSteps ?? 6, 1), 10);
  const ctxUserId = opts.userId || 'router';
  const scope: Scope = opts.scope || 'full';
  const sessionId = opts.sessionId || null;
  const source = opts.source || 'elle-router';
  const trace: RouterStep[] = [];

  // Seed with prior turns so a follow-up ("keep going") has the earlier context.
  // Without this the loop starts from a single user message every call and has
  // no memory of the conversation. loadSessionHistory is injected by index.ts.
  const prior: LLMMessage[] = (sessionId && deps.loadSessionHistory)
    ? await deps.loadSessionHistory(sessionId, env).catch(() => [])
    : [];
  const messages: LLMMessage[] = [...prior, { role: 'user', content: question }];

  // Self-awareness: her own κ trajectory this session, injected into the prompt
  // so she carries her phase state the way a person carries a mood. Best-effort
  // and never for the hospitality persona (a different product, not her).
  let phase = '';
  if (sessionId && scope !== 'hospitality') {
    try {
      const rows = await env.DB.prepare(
        'SELECT kappa FROM elle_conversation_turns WHERE session_id = ? AND kappa IS NOT NULL ORDER BY created_at ASC'
      ).bind(sessionId).all();
      phase = phaseBlock((rows.results || []).map(r => Number((r as { kappa: number }).kappa)).filter(Number.isFinite));
    } catch { /* phase is a luxury, never a dependency */ }
  }
  const system = systemPrompt(scope, phase);

  // Persist (question, answer) on the way out so the next turn remembers it.
  // Best-effort: a memory write must never fail the actual answer.
  // sanitizeAnswer is the final guard: even if the model slipped protocol JSON
  // into its "answer" string, the caller only ever sees clean prose.
  const finish = async (rawAnswer: string, steps: number): Promise<RouterResult> => {
    const answer = sanitizeAnswer(rawAnswer) || rawAnswer;
    // κ dynamics over the final OUTPUT ONLY (dt=1 per turn). Best-effort: the
    // chat header reads this; never let it fail the answer or the memory write.
    let kappa_dynamics: KappaPoint | null = null;
    if (sessionId) {
      try { kappa_dynamics = await computeTurnDynamics(env, deps.embed, sessionId, answer, question); }
      catch (e) { console.error('[KAPPA] router turn dynamics failed:', (e as Error).message); }
    }
    if (sessionId && deps.persistExchange) {
      try { await deps.persistExchange(sessionId, source, question, answer, env, kappa_dynamics?.kappa ?? null); } catch { /* best-effort */ }
    }
    return { question, answer, steps, trace, kappa_dynamics };
  };

  for (let step = 0; step < maxSteps; step++) {
    // Model router first. If the whole provider chain is unreachable, degrade to a
    // clean message instead of throwing — the route handler would otherwise turn
    // the throw into a 500 (a "load or request failure") for the dev console.
    let result;
    try {
      result = await callLLM('reasoning', system, messages, 2048, env);
    } catch (e) {
      console.error('[ROUTER] model layer unreachable:', (e as Error).message);
      return finish('I could not reach a model to work through that just now. Give it a moment and try again.', step);
    }
    const parsed = firstJsonObject(result.content);

    if (!parsed) {
      // If the model answered in plain prose (no JSON envelope at all), accept it
      // as the answer rather than forcing the ReAct protocol — a greeting or a
      // simple reply doesn't need a tool, and many models won't wrap "Hello" in
      // {"answer":...}. Only nudge when it looks like it MEANT to emit JSON but
      // produced a malformed/truncated blob.
      const raw = String(result.content ?? '').trim();
      const looksLikeJson = raw.startsWith('{') || raw.startsWith('```') || raw.includes('"tool"') || raw.includes('"answer"');
      if (raw && !looksLikeJson) {
        return finish(raw, step);
      }
      // Unparseable output — usually a tool object truncated by the token cap or
      // a bad escape. NEVER surface raw protocol JSON to the caller: correct once,
      // then fail with a clean message instead of leaking the blob.
      if (step < maxSteps - 1) {
        messages.push({ role: 'user', content: 'Your last message was not valid JSON. Reply with exactly ONE compact JSON object — {"tool","args"} or {"answer"} — and keep "thought" short.' });
        continue;
      }
      return finish('I hit a formatting error while reasoning and could not produce a clean answer. Try rephrasing, or ask for one thing at a time.', step);
    }
    if (typeof parsed.answer === 'string') {
      return finish(parsed.answer, step);
    }
    if (typeof parsed.tool === 'string') {
      const args = (parsed.args && typeof parsed.args === 'object') ? parsed.args as Record<string, unknown> : {};
      let obs: string;
      try {
        obs = await runTool(parsed.tool, args, env, deps, { userId: ctxUserId, sessionId }, scope);
      } catch (e) {
        obs = `tool error (${parsed.tool}): ${e instanceof Error ? e.message : String(e)}`;
      }
      trace.push({ tool: parsed.tool, args, result: clip(obs, 800) });
      messages.push({ role: 'assistant', content: JSON.stringify({ tool: parsed.tool, args }) });
      messages.push({ role: 'user', content: `OBSERVATION (${parsed.tool}):\n${obs}` });
      continue;
    }
    // Parsed JSON but neither answer nor tool — nudge once, else bail.
    messages.push({ role: 'user', content: 'Respond with a single JSON object that has either "tool"+"args" or "answer".' });
  }

  // Steps exhausted — force a synthesis from what we gathered.
  let final;
  try {
    final = await callLLM('reasoning',
      'Give your final answer now as a single JSON object: {"answer":"..."}. Ground it strictly in the observations so far. If the evidence is incomplete, say what is missing.',
      messages, 2048, env);
  } catch (e) {
    console.error('[ROUTER] final synthesis model call failed:', (e as Error).message);
    return finish('I gathered what I could but could not reach a model to synthesize the final answer. Try again in a moment.', maxSteps);
  }
  const fj = firstJsonObject(final.content);
  const synthesized = (fj && typeof fj.answer === 'string')
    ? fj.answer
    : (final.content.trim().startsWith('{')
        ? 'I gathered the data but ran out of reasoning steps before producing a clean final answer.'
        : (final.content.trim() || '(no answer)'));
  return finish(synthesized, maxSteps);
}
