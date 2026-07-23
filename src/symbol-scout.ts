// ============================================================
// SYMBOL SCOUT — src/symbol-scout.ts
//
// She picks her own symbols. Before this module the tradable universe was
// whatever trading.ts hardcoded in its watchlist, and "research" at decision
// time was ten headlines. The scout closes both gaps, once per trading day:
//
//   1. PROPOSE — a grounded (web-searching 'research' tier) call scans the
//      current tape and asks: which US-listed symbols OUTSIDE the fixed
//      watchlist are worth real research today? Recently-researched names
//      are excluded so the desk keeps widening instead of circling.
//   2. VALIDATE — every candidate is checked against Alpaca's assets API
//      (active + tradable). An LLM-invented ticker dies here, not at the
//      order stage.
//   3. RESEARCH — each validated candidate gets its own grounded research
//      call producing a structured note: findings, thesis, catalyst, risks,
//      verdict, confidence.
//   4. LOG — every note lands in elle_symbol_research (D1), which the
//      decision loop reads back as her research desk (formatResearchDesk)
//      and chat can query via read_sql.
//
// Best-effort throughout: a failed scout never blocks a trading cycle, and
// the daily guard means the (expensive) research calls run at most once per
// day, capped at MAX_RESEARCH_PER_DAY symbols.
// ============================================================

import { callLLM } from './llm';
import type { Env } from './index';

export const MAX_RESEARCH_PER_DAY = 3;

function generateId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

let scoutSchemaReady = false;
export async function ensureScoutSchema(db: D1Database): Promise<void> {
  if (scoutSchemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_symbol_research (
       id TEXT PRIMARY KEY,
       symbol TEXT NOT NULL,
       picked_because TEXT,
       findings TEXT,
       thesis TEXT,
       expected_catalyst TEXT,
       risks TEXT,
       verdict TEXT,
       confidence REAL,
       source TEXT DEFAULT 'scout',
       created_at TEXT DEFAULT (datetime('now'))
     )`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_symbol_research_sym_date ON elle_symbol_research(symbol, created_at)`,
  ).run().catch(() => {});
  scoutSchemaReady = true;
}

// ── pure parsers (tested directly) ───────────────────────────

export interface Candidate { symbol: string; why: string }

// Parse the propose-call's JSON, dropping malformed tickers, excluded names
// (watchlist + recently researched + already held), and duplicates. Symbols
// are normalized to bare uppercase tickers; anything that doesn't look like
// one (1-5 letters, optional .X share-class suffix) is discarded rather than
// sent to the broker.
export function parseCandidates(raw: string, exclude: Set<string>, max = MAX_RESEARCH_PER_DAY): Candidate[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return []; }
  const list = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)?.candidates;
  if (!Array.isArray(list)) return [];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const symbol = String((c as Record<string, unknown>)?.symbol || '').toUpperCase().trim();
    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol)) continue;
    if (exclude.has(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, why: String((c as Record<string, unknown>)?.why || '').slice(0, 500) });
    if (out.length >= max) break;
  }
  return out;
}

export interface ResearchNote {
  findings: string;
  thesis: string;
  expected_catalyst: string;
  risks: string;
  verdict: 'buy' | 'short' | 'watch' | 'avoid';
  confidence: number;
}

export function parseResearchNote(raw: string): ResearchNote | null {
  let p: Record<string, unknown>;
  try { p = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return null; }
  if (!p || typeof p !== 'object') return null;
  const verdict = String(p.verdict || '').toLowerCase();
  const conf = Number(p.confidence);
  return {
    findings: String(p.findings || '').slice(0, 3000),
    thesis: String(p.thesis || '').slice(0, 1500),
    expected_catalyst: String(p.expected_catalyst || '').slice(0, 500),
    risks: String(p.risks || '').slice(0, 1000),
    verdict: verdict === 'buy' || verdict === 'short' || verdict === 'avoid' ? verdict : 'watch',
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
  };
}

export interface DeskRow {
  symbol: string; thesis: string | null; expected_catalyst: string | null;
  risks: string | null; verdict: string | null; confidence: number | null; created_at: string;
}

// The read-back: her own recent research, formatted for the decision prompt.
export function formatResearchDesk(rows: DeskRow[], budget = 2200): string {
  if (!rows.length) return '';
  const lines: string[] = [];
  for (const r of rows) {
    const line =
      `- ${r.symbol} [${r.verdict || 'watch'}, conf ${r.confidence == null ? '—' : Number(r.confidence).toFixed(2)}, ${String(r.created_at).slice(0, 10)}]: ` +
      `${String(r.thesis || '').replace(/\s+/g, ' ').trim()}` +
      (r.expected_catalyst ? ` Catalyst: ${String(r.expected_catalyst).replace(/\s+/g, ' ').trim()}` : '') +
      (r.risks ? ` Risks: ${String(r.risks).replace(/\s+/g, ' ').trim()}` : '');
    lines.push(line.slice(0, 550));
  }
  let out = '';
  for (const l of lines) {
    if (out.length + l.length + 1 > budget) break;
    out += (out ? '\n' : '') + l;
  }
  return out;
}

// ── Alpaca validation ────────────────────────────────────────

async function assetTradable(base: string, headers: Record<string, string>, symbol: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/v2/assets/${encodeURIComponent(symbol)}`, { headers });
    if (!res.ok) return false;
    const a = await res.json() as { status?: string; tradable?: boolean };
    return a.status === 'active' && a.tradable === true;
  } catch { return false; }
}

// ── the scout cycle ──────────────────────────────────────────

export interface ScoutContext {
  base: string;                       // Alpaca trading API base (paper/live-resolved)
  headers: Record<string, string>;
  watchlist: string[];
  positionSymbols: string[];
  news: Array<{ headline: string; symbols: string[] }>;
  thesesText: string;
}

// Runs at most once per day (guarded on today's scout rows). Returns the
// symbols that got fresh research this call, so the caller can pull their
// bars into the decision prompt's market data.
export async function runSymbolScout(env: Env, ctx: ScoutContext): Promise<string[]> {
  await ensureScoutSchema(env.DB);

  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM elle_symbol_research WHERE source = 'scout' AND substr(created_at, 1, 10) = date('now')`,
  ).first() as { n: number } | null;
  if (today && today.n > 0) return [];

  // Names she already knows: the watchlist, held positions, and anything
  // researched in the last 14 days — the scout's job is NEW ground.
  const recent = await env.DB.prepare(
    `SELECT DISTINCT symbol FROM elle_symbol_research WHERE created_at >= datetime('now', '-14 days')`,
  ).all().catch(() => ({ results: [] as unknown[] }));
  const exclude = new Set<string>([
    ...ctx.watchlist.map(s => s.toUpperCase()),
    ...ctx.positionSymbols.map(s => s.toUpperCase()),
    ...((recent.results as Array<Record<string, unknown>>) || []).map(r => String(r.symbol).toUpperCase()),
  ]);

  // 1. PROPOSE — grounded: the research tier carries web search, so the
  // candidates come from what is actually moving in the world today.
  let candidates: Candidate[] = [];
  try {
    const proposal = await callLLM(
      'research',
      'You are the market scout for an autonomous trading desk. You search the live web for what is actually moving and name specific US-listed tickers worth deep research. You return ONLY valid JSON.',
      [{
        role: 'user',
        content:
          `Scan today's US market. Propose up to ${MAX_RESEARCH_PER_DAY} US-listed stock symbols worth deep research RIGHT NOW — ` +
          `earnings movers, sector rotations, catalysts the crowd is mispricing. Favor liquid names and sectors ` +
          `underrepresented on the desk.\n\n` +
          `Do NOT propose any of these (already covered): ${[...exclude].sort().join(', ')}\n\n` +
          `Current headlines on the desk:\n${ctx.news.slice(0, 8).map(n => `- [${n.symbols?.join(',')}] ${n.headline}`).join('\n') || '(none)'}\n\n` +
          `Active theses:\n${ctx.thesesText || '(none)'}\n\n` +
          `Return ONLY JSON: {"candidates":[{"symbol":"XYZ","why":"one sentence"}]}`,
      }],
      700, env,
    );
    candidates = parseCandidates(proposal.content, exclude);
  } catch (e) {
    console.error('[SCOUT] propose failed:', (e as Error).message);
    return [];
  }
  if (!candidates.length) return [];

  // 2–4. VALIDATE, RESEARCH, LOG — per candidate, independent and best-effort.
  const researched: string[] = [];
  for (const c of candidates) {
    if (!(await assetTradable(ctx.base, ctx.headers, c.symbol))) {
      console.log(`[SCOUT] ${c.symbol} not active/tradable on Alpaca — dropped`);
      continue;
    }
    try {
      const result = await callLLM(
        'research',
        'You research a single stock for an autonomous trading desk: current price action, recent news and filings, the bull and bear case. Grounded in what you actually find, never invented. You return ONLY valid JSON.',
        [{
          role: 'user',
          content:
            `Research ${c.symbol}. It was scouted because: ${c.why || '(no reason recorded)'}\n\n` +
            `Search for what is actually happening with ${c.symbol} right now — price action, news, earnings, ` +
            `guidance, sector context. Then return ONLY JSON:\n` +
            `{"findings":"what you found, 3-6 sentences","thesis":"the tradable theory, 1-3 sentences",` +
            `"expected_catalyst":"the specific event/date that would move it","risks":"what kills the thesis",` +
            `"verdict":"buy|short|watch|avoid","confidence":0.0}`,
        }],
        1200, env,
      );
      const note = parseResearchNote(result.content);
      if (!note) { console.log(`[SCOUT] ${c.symbol} research came back unparseable — skipped`); continue; }
      await env.DB.prepare(
        `INSERT INTO elle_symbol_research (id, symbol, picked_because, findings, thesis, expected_catalyst, risks, verdict, confidence, source)
         VALUES (?,?,?,?,?,?,?,?,?, 'scout')`,
      ).bind(
        generateId(), c.symbol, c.why || null, note.findings, note.thesis,
        note.expected_catalyst || null, note.risks || null, note.verdict, note.confidence,
      ).run();
      researched.push(c.symbol);
      console.log(`[SCOUT] researched ${c.symbol}: ${note.verdict} (${note.confidence.toFixed(2)}) — ${note.thesis.slice(0, 80)}`);
    } catch (e) { console.error(`[SCOUT] research failed for ${c.symbol}:`, (e as Error).message); }
  }
  return researched;
}

// Recent research desk for the decision prompt: last 7 days, newest note per
// symbol, avoid verdicts included (knowing what NOT to touch is also edge).
export async function readResearchDesk(db: D1Database, limit = 8): Promise<DeskRow[]> {
  await ensureScoutSchema(db);
  const r = await db.prepare(
    `SELECT symbol, thesis, expected_catalyst, risks, verdict, confidence, MAX(created_at) AS created_at
     FROM elle_symbol_research
     WHERE created_at >= datetime('now', '-7 days')
     GROUP BY symbol ORDER BY created_at DESC LIMIT ?`,
  ).bind(limit).all().catch(() => ({ results: [] as unknown[] }));
  return ((r.results as Array<Record<string, unknown>>) || []).map(x => ({
    symbol: String(x.symbol),
    thesis: x.thesis == null ? null : String(x.thesis),
    expected_catalyst: x.expected_catalyst == null ? null : String(x.expected_catalyst),
    risks: x.risks == null ? null : String(x.risks),
    verdict: x.verdict == null ? null : String(x.verdict),
    confidence: x.confidence == null ? null : Number(x.confidence),
    created_at: String(x.created_at || ''),
  }));
}
