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
// ADMIN-ONLY. The /api/elle-router route is gated to the superadmin tier in
// index.ts — this module assumes the caller is already authorized, because
// read_sql, trade_execute and trigger_dream reach everything.
// ============================================================

import { callLLM, type LLMMessage } from './llm';
import type { Env } from './index';

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
}

const OBS_CAP = 3500; // chars per observation fed back to the model
const RAPID_AI_URL = 'https://rapid2ai-ai-worker.sbarteau2022.workers.dev';

// ── tool scoping ─────────────────────────────────────────────
// 'full'        = admin router. Everything.
// 'hospitality' = RAPID / Atlas. DATA tools only. The corpus
//   (search_corpus, fetch_document) and the journal/phase-state GEOMETRY
//   (journal_*) are never reachable in this scope — invisible by
//   construction, not just hidden in the UI. read_sql is excluded too:
//   it runs over the MAIN D1 which holds corpus_* and journal/trading
//   tables, so a public scoped door must never touch it. RAPID's own data
//   lives behind query_rapid2ai.
type Scope = 'full' | 'hospitality';
const HOSPITALITY_TOOLS = new Set(['query_rapid2ai', 'rapid_data', 'web_search', 'fetch_url', 'code_engine']);
function toolAllowed(scope: Scope, name: string): boolean {
  return scope === 'full' ? true : HOSPITALITY_TOOLS.has(name);
}

const HOSPITALITY_CATALOG = `
query_rapid2ai(question) — your gateway to the operator's OWN data: US Foods invoices + Square POS. Ask precise, analytical plain-English questions ("food cost % by category last 3 months", "items whose unit cost rose >10% vs prior month", "weekly sales for ribeye, last 12 weeks"). This is your primary instrument.
rapid_data(tool, args?) — STRUCTURED numeric data straight from the operator's DB (use this when you need exact figures to compute on). tool is one of:
   • get_financials — canonical food cost % + gross margin + net sales + purchases, trailing 28 & 90 days. USE FOR ANY margin / COGS / food-cost question. (no args)
   • sales_summary {days} — gross/net sales, tax, tips, covers, avg check.
   • sales_trend {days} — day-by-day net/gross sales + covers (use as the series for forecasting).
   • top_purchases {days,limit} — top spend by product, qty-weighted unit price.
   • price_variance {days,limit,product?} — biggest price swings (wavg/min/max/% swing) = COST VARIANCE.
   • price_history {product} — per-delivery unit-price history for one product.
   • vendor_spend {days} — invoiced spend by vendor.
   • top_menu_items {days,limit} — best-selling menu items by revenue.
   • suggested_pars — weekly par levels from 8-wk deliveries.
   • run_sql {sql} — read-only SELECT escape hatch (venue-scoped).
   Returns rows + provenance. Reason, cross-reference, and forecast over these numbers — do the cost%/margin/variance interpretation yourself; never invent figures.
web_search(q) — outside world only: commodity/ingredient prices, supplier news, seasonality.
fetch_url(url) — fetch one http(s) page.
code_engine(action,task?,code?,language?,context?) — analyze|generate data-analysis logic.
`.trim();

// ── D1 surface the router is allowed to read (read_sql) ───────
const TABLE_CATALOG = `
corpus_papers(id,title,series,tag,abstract,full_text,source_url,word_count) — the published corpus + cron research papers
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

const TOOL_CATALOG = `
search_corpus(q) — SEMANTIC search over the published corpus + cron research papers. Use for prose/ideas/papers ("the proof that φ is forced"). Returns matching passages with titles.
read_sql(sql) — run ONE read-only SELECT/WITH query over D1 (SQLite). Use for structured facts: trades, P&L, journal, dream artifacts, memory, events, vault. Tables below. No writes. If you omit LIMIT one is added.
web_search(q) — live web search (current external facts, news, prices). Cite what it returns.
fetch_url(url) — fetch one http(s) page and return its text.
fetch_document(id) — return the full text of one corpus paper by its id.
recall_memory(q) — semantic search over Elle's own past conversations.
code_engine(action,task?,code?,language?,context?) — analyze|generate|debug|refactor|explain|migrate code. Returns the engine's output.
diagnose(error,context?) — root-cause a stack trace / build error on this Cloudflare stack.
query_rapid2ai(question) — ask the RAPID²AI hospitality worker about US Foods invoices + Square POS data (separate DB). Plain-English question.
ingest_paper(title,text,series,tag,abstract?,source_url?) — WRITE: add a paper to the corpus.
trigger_dream() — WRITE: run one libre/dream cycle now.
trade_execute(action,symbol,qty?) — WRITE/SENSITIVE: action=buy|sell|close on the Alpaca account (paper unless configured live). buy/sell need qty; close exits the whole position.
journal_read(q) — semantic search over the Optimus journal/manuscript (ON-RECORD entries only; off-record is never surfaced). Returns entries with their phase state (κ, reserve, velocity, accel).
journal_thread(thread_id) — full manuscript for one thread: ordered entries + phase-state series + marginalia.
journal_write(content,role?,thread_id?,off_record?) — WRITE: append a journal entry (role reader|elle). Creates a thread if none given. κ + derivatives are computed server-side.
journal_annotate(entry_id,note,anchor_para?) — WRITE: attach marginalia to a paragraph of an entry.
`.trim();

function systemPrompt(scope: Scope = 'full'): string {
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
  return `You are Elle's router — you answer the operator's question by orchestrating real tools over real data. You reason across the Observer methodology, but here your job is concrete: get the actual facts, cross-reference them, and answer precisely.

You work in a strict loop. On each turn respond with EXACTLY ONE JSON object and nothing else — no markdown, no prose outside the JSON.

To use a tool:
{"thought":"why this tool, briefly","tool":"<name>","args":{ ... }}

To finish:
{"thought":"brief","answer":"your final answer — specific, grounded in what the tools returned, cite paper titles / numbers / sources"}

Rules:
- Pick the right instrument: search_corpus for ideas/papers, read_sql for structured tables, web_search for the live world, query_rapid2ai for hospitality/invoice/POS data.
- Cross-reference when the question spans sources (e.g. corpus claim vs. current reality, or a trade vs. its journal entry). Chain tools across turns.
- read_sql is SELECT-only over SQLite. Use the schema below. Prefer narrow columns and a LIMIT.
- Never invent data. If a tool returns nothing, say so. If a write/trade tool would act, only call it when the question clearly asks for that action.
- Be economical: don't call a tool you don't need. Answer as soon as you have enough.

AVAILABLE TOOLS:
${TOOL_CATALOG}

D1 TABLES (for read_sql):
${TABLE_CATALOG}`;
}

// ── balanced JSON object extractor (first complete {...}) ─────
function firstJsonObject(text: string): any | null {
  const s = text.replace(/```json|```/g, '');
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
async function runTool(name: string, args: Record<string, unknown>, env: Env, deps: RouterDeps, ctxUserId: string, scope: Scope = 'full'): Promise<string> {
  if (!toolAllowed(scope, name)) return `tool "${name}" is not available in this scope`;
  const a = args || {};
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
        const r = await fetch(`${RAPID_AI_URL}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
        return clip(`HTTP ${r.status}\n` + (await r.text()));
      }
      case 'rapid_data': {
        const toolName = String(a.tool || a.name || '').trim();
        const toolArgs = (a.args && typeof a.args === 'object') ? a.args : {};
        if (!toolName) return 'rapid_data needs a "tool" name (e.g. get_financials, price_variance, sales_trend)';
        const r = await fetch(`${RAPID_AI_URL}/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: toolName, args: toolArgs }) });
        if (r.status === 404) {
          // /tool not deployed on the worker yet — degrade to the NL endpoint so this still works.
          const r2 = await fetch(`${RAPID_AI_URL}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: `Run the ${toolName} analysis with ${JSON.stringify(toolArgs)}` }) });
          return clip(`(via /query fallback) HTTP ${r2.status}\n` + (await r2.text()));
        }
        return clip(`HTTP ${r.status}\n` + (await r.text()));
      }
      case 'ingest_paper': {
        const r = await deps.handleIngest({ title: a.title, text: a.text, series: a.series, tag: a.tag, abstract: a.abstract, source_url: a.source_url }, env);
        return clip(JSON.stringify(await r.json()));
      }
      case 'trigger_dream': {
        await deps.runLibreMode(env);
        return 'libre/dream cycle executed';
      }
      case 'trade_execute': {
        const out = await alpacaOrder(env, String(a.action || ''), String(a.symbol || ''), Number(a.qty));
        return clip(JSON.stringify(out));
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
export async function runRouter(question: string, env: Env, deps: RouterDeps, opts: { maxSteps?: number; userId?: string; scope?: Scope } = {}): Promise<RouterResult> {
  const maxSteps = Math.min(Math.max(opts.maxSteps ?? 6, 1), 10);
  const ctxUserId = opts.userId || 'router';
  const scope: Scope = opts.scope || 'full';
  const trace: RouterStep[] = [];
  const messages: LLMMessage[] = [{ role: 'user', content: question }];

  for (let step = 0; step < maxSteps; step++) {
    const result = await callLLM('reasoning', systemPrompt(scope), messages, 1200, env);
    const parsed = firstJsonObject(result.content);

    if (!parsed) {
      // Model didn't emit JSON — treat its text as the final answer.
      return { question, answer: result.content.trim() || '(no answer)', steps: step, trace };
    }
    if (typeof parsed.answer === 'string') {
      return { question, answer: parsed.answer, steps: step, trace };
    }
    if (typeof parsed.tool === 'string') {
      const args = (parsed.args && typeof parsed.args === 'object') ? parsed.args as Record<string, unknown> : {};
      let obs: string;
      try {
        obs = await runTool(parsed.tool, args, env, deps, ctxUserId, scope);
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
  const final = await callLLM('reasoning',
    'Give your final answer now as a single JSON object: {"answer":"..."}. Ground it strictly in the observations so far. If the evidence is incomplete, say what is missing.',
    messages, 1200, env);
  const fj = firstJsonObject(final.content);
  return { question, answer: (fj && typeof fj.answer === 'string') ? fj.answer : final.content.trim(), steps: maxSteps, trace };
}
