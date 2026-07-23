// ============================================================
// ELLE TRADING — src/trading.ts
// Runs as Cloudflare Worker cron: */15 * * * *
// Alpaca: single API key + configurable base URL
//
// Env vars:
//   ALPACA_API_KEY      your Alpaca API key
//   ALPACA_BASE_URL     https://paper-api.alpaca.markets (paper)
//                       https://api.alpaca.markets (live, when ready)
// ============================================================

import { backfillTradesExtColumns } from './db/schema';
import { callLLM } from './llm';
import type { Env } from './index';
import { resolveAlpacaBase } from './live-guard';
import { resolveOptionContract } from './alpaca-options';
import {
  runConvictionCycle, trimQty, replayBars, ensureReplaySchema, isEquitySymbol,
  type ConvictionReading, type LivePosition,
} from './conviction';
import { runKappaBacktestSuite, ensureBacktestSchema } from './backtest';
import { runDissonanceBacktestSuite, ensureDissonanceSchema } from './dissonance';
import { runCoherenceField, ensureCoherenceSchema } from './coherence';
import { runPerturbationBacktestSuite, ensurePerturbationSchema } from './perturbation';
import { runRegimeSuite, ensureRegimeSchema } from './regime';
import { runPhiOscSuite, ensurePhiOscSchema } from './phi-oscillator';
import { gatherTradingGround, recordTradeRationale, type TradingGround } from './trading-ground';
import { guardOptionOrder, type HeldPosition } from './risk-guard';
import { maxOrderFrac, sizeWithinCap, latestEquityPrice, latestOptionMark } from './order-guards';
import { runSymbolScout, readResearchDesk, formatResearchDesk } from './symbol-scout';

// Schema reconciliation for the whole trading surface. The production
// elle_trades table predates this module's queries: it has qty/order_id and
// LACKED quantity, confidence, status, closed_at, expected_timeframe and
// broker_order_id — so every trade INSERT below failed ("no such column"),
// was swallowed by its .catch, and the ledger sat at 0 rows while real
// positions accumulated at the broker. Same disease as the memory kernel:
// writer and reader each drifted from the actual table, and every failure
// was silent. Everything the module's SQL names is ensured here, idempotently
// (ADD COLUMN on an existing column throws; swallowed).
let extSchemaReady = false;
export async function ensureTradingExtSchema(env: Env): Promise<void> {
  if (extSchemaReady) return;
  await backfillTradesExtColumns(env.DB);
  extSchemaReady = true;
}

// Post-close attribution: not "did it work" (pnl already says that) but WHY
// — did the catalyst she named actually happen, was the theory right, right
// for the wrong reason, or wrong outright. One grounded research call
// ('research' tier already carries web-search grounding), best-effort —
// never blocks or fails the close it's attached to.
async function writeAttribution(
  env: Env, symbol: string, reasoning: unknown, catalyst: unknown, pnl: number, pnlPct: number,
): Promise<void> {
  try {
    const prompt =
      `A position in ${symbol} just closed with ${pnl >= 0 ? 'a gain' : 'a loss'} of ${Math.abs(pnlPct).toFixed(1)}%.\n` +
      `Original reasoning when opened: ${String(reasoning || '(none recorded)')}\n` +
      `Expected catalyst: ${String(catalyst || '(none recorded)')}\n\n` +
      `Research what actually happened with ${symbol} over the holding period. Then write a short, honest ` +
      `attribution (3-5 sentences): did the expected catalyst materialize? Was the underlying theory right, ` +
      `wrong, or right-for-the-wrong-reason? What is the one lesson worth carrying forward?`;
    const result = await callLLM(
      'research',
      'You write honest trade post-mortems: what was predicted, what actually happened in the world, and why the trade worked or did not. Grounded, not self-congratulatory.',
      [{ role: 'user', content: prompt }], 700, env,
    );
    await env.DB.prepare(
      `UPDATE elle_trades SET attribution = ? WHERE id = (
         SELECT id FROM elle_trades WHERE symbol = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1
       )`,
    ).bind(result.content.slice(0, 2000), symbol).run().catch(() => {});
  } catch (e) {
    console.error(`[TRADE] attribution failed for ${symbol}:`, (e as Error).message);
  }
}

function generateId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── chat-trade ledger ────────────────────────────────────────
// trade_execute (the router tool) used to place real Alpaca orders and record
// NOTHING — the order went out, the position synced back on the next cycle,
// and the trades ledger stayed empty: three live positions, zero trade rows,
// no reasoning to surface. Every chat-placed order now lands here.
export async function recordChatTrade(env: Env, o: {
  action: string; symbol: string; qty?: number;
  reasoning?: string; testing?: string; catalyst?: string; timeframe?: string;
  result: unknown;
}): Promise<void> {
  const res = o.result as Record<string, any> | null;
  if (!res || res.error) return; // no order actually placed
  await ensureTradingExtSchema(env);
  const order = res.order || {};
  const sym = String(o.symbol || '').toUpperCase().trim();
  if (!sym) return;
  const fill = order.filled_avg_price != null ? parseFloat(order.filled_avg_price) : null;

  if (o.action === 'close') {
    // Close every open ledger row for the symbol. P&L only when both prices
    // are known — never guessed.
    const open = await env.DB.prepare(
      `SELECT id, entry_price, quantity, action FROM elle_trades WHERE (symbol = ? OR underlying_symbol = ?) AND status = 'open'`
    ).bind(sym, sym).all().catch(() => ({ results: [] as any[] }));
    for (const row of (open.results as Array<Record<string, any>>) || []) {
      const entry = row.entry_price != null ? Number(row.entry_price) : null;
      const short = row.action === 'short' || row.action === 'sell';
      const dir = short ? -1 : 1;
      const pnl = entry != null && fill != null ? Number(((fill - entry) * dir * Math.abs(Number(row.quantity) || 0)).toFixed(2)) : null;
      const pnlPct = entry ? (fill != null ? Number((((fill - entry) / entry) * dir * 100).toFixed(2)) : null) : null;
      await env.DB.prepare(
        `UPDATE elle_trades SET status = 'closed', closed_at = datetime('now'), exit_price = ?, pnl = ?, pnl_pct = ? WHERE id = ?`
      ).bind(fill, pnl, pnlPct, row.id).run()
        .catch(e => console.error('[TRADE] chat-close ledger update failed:', (e as Error).message));
    }
    return;
  }

  const contract = res.contract as Record<string, any> | undefined;
  const isOption = !!contract;
  await env.DB.prepare(
    `INSERT INTO elle_trades (id, symbol, action, quantity, entry_price, reasoning, what_she_is_testing, expected_catalyst, expected_timeframe, broker_order_id, status, asset_class, option_right, strike_price, expiration_date, underlying_symbol, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'chat')`
  ).bind(
    generateId(),
    isOption ? String(contract!.symbol || sym) : sym,
    String(o.action),
    Math.abs(Number(o.qty) || 0) || null,
    fill,
    o.reasoning ? String(o.reasoning).slice(0, 2000) : null,
    o.testing ? String(o.testing).slice(0, 1000) : null,
    o.catalyst ? String(o.catalyst).slice(0, 500) : null,
    o.timeframe ? String(o.timeframe).slice(0, 200) : null,
    order.id ? String(order.id) : null,
    'open',
    isOption ? 'option' : 'us_equity',
    isOption ? String(contract!.type || contract!.right || '') || null : null,
    isOption && contract!.strike_price != null ? Number(contract!.strike_price) : null,
    isOption ? String(contract!.expiration_date || '') || null : null,
    isOption ? sym : null,
  ).run().catch(e => console.error('[TRADE] chat-trade ledger insert failed:', (e as Error).message));
}

function alpacaHeaders(env: Env): Record<string, string> {
  return {
    'APCA-API-KEY-ID':     env.ALPACA_API_KEY || '',
    'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY || '',
    'Content-Type':        'application/json',
  };
}

// Exported so live-guard.test.ts can pin that THIS path (the autonomous
// cron's) refuses a live URL without the arming flag — not just the pure
// guard in isolation. Throws on live-without-ELLE_LIVE_TRADING; the throw
// propagates up through runTradingCycle into runJob's error log, so a
// misconfigured live URL halts trading loudly instead of trading.
export function alpacaBase(env: Env): string {
  return resolveAlpacaBase(env);
}

function alpacaData(env: Env): string {
  // Data URL is always the same regardless of paper/live
  return 'https://data.alpaca.markets';
}

function isMarketHours(): boolean {
  const et  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const t = et.getHours() * 60 + et.getMinutes();
  return t >= 570 && t < 960; // 9:30am–4:00pm ET
}

// Exported for the desk UI: is the US market open right now? (regular hours,
// weekday). The workbench shows the live desk when open and a session-replay
// report when closed.
export function marketOpen(): boolean {
  return isMarketHours();
}

// The account/position sync writers below target the SCHEMA ALREADY LIVE IN
// PRODUCTION (elle_trading_account / elle_trading_positions predate this
// file's current shape) — not the leaner columns an earlier version of this
// module assumed. That mismatch (e.g. a nonexistent `realized_pnl` column)
// meant every sync INSERT threw and was swallowed by a bare catch: the desk
// tables stayed empty forever regardless of whether Alpaca keys were valid.
// Alpaca's /v2/account and /v2/positions responses carry more fields than
// the types below declare (equity, last_equity, asset_id, side, …) — reading
// them here doesn't change what's fetched, only what this file is honest
// about receiving.
async function getAccount(env: Env) {
  const res = await fetch(`${alpacaBase(env)}/v2/account`, { headers: alpacaHeaders(env) });
  if (!res.ok) return null;
  return res.json() as Promise<{
    portfolio_value: string;
    cash: string;
    equity?: string;
    last_equity?: string;
  }>;
}

async function getPositions(env: Env) {
  const res = await fetch(`${alpacaBase(env)}/v2/positions`, { headers: alpacaHeaders(env) });
  if (!res.ok) return [];
  return res.json() as Promise<Array<{
    symbol: string;
    side?: string;
    qty: string;
    avg_entry_price: string;
    current_price: string;
    unrealized_plpc: string;
    market_value?: string;
    unrealized_pl?: string;
    asset_id?: string;
  }>>;
}

// Mirror the live Alpaca positions into D1 so the desk shows them 24/7. The
// set is authoritative each cycle: clear it and rewrite. Best-effort — a
// broker hiccup here never blocks the cycle.
async function syncPositions(env: Env, positions: Array<{ symbol: string; side?: string; qty: string; avg_entry_price: string; current_price: string; unrealized_plpc: string; market_value?: string; unrealized_pl?: string; asset_id?: string }>): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM elle_trading_positions').run();
    for (const p of positions) {
      await env.DB.prepare(
        `INSERT INTO elle_trading_positions (symbol, side, quantity, entry_price, current_price, unrealized_pnl, unrealized_pnl_pct, market_value, broker_asset_id, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`
      ).bind(
        p.symbol, p.side || 'long', parseFloat(p.qty), parseFloat(p.avg_entry_price), parseFloat(p.current_price),
        parseFloat(p.unrealized_pl || '0'), parseFloat(p.unrealized_plpc || '0'), parseFloat(p.market_value || '0'),
        p.asset_id || null,
      ).run();
    }
  } catch (e) { console.error('[TRADING] position sync failed:', (e as Error).message); }
}

// The tape she trades from. Deliberately spread across sectors and asset
// classes — a 7-name tech-heavy watchlist meant every "diversified" book was
// really one correlated bet. Each symbol costs one bars fetch per cycle.
const WATCHLIST_SECTORS: Record<string, string[]> = {
  'broad market':          ['SPY', 'QQQ', 'IWM'],
  'tech / megacap':        ['NVDA', 'AAPL', 'MSFT', 'AMD', 'GOOGL', 'AMZN', 'META', 'TSLA'],
  'financials':            ['JPM', 'XLF'],
  'energy':                ['XOM', 'XLE'],
  'healthcare':            ['UNH', 'XLV'],
  'industrials/consumer':  ['CAT', 'WMT'],
  'gold / bonds':          ['GLD', 'TLT'],
};
const WATCHLIST = Object.values(WATCHLIST_SECTORS).flat();

// One symbol's recent tape, summarized for the decision prompt. Shared by the
// watchlist sweep and the research-desk augmentation (her own picks get real
// prices in front of the decision loop, not just prose).
async function fetchSymbolBars(env: Env, symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const res  = await fetch(`${alpacaData(env)}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=12`, { headers: alpacaHeaders(env) });
    const data = await res.json() as { bars: Array<{ o: number; h: number; l: number; c: number; v: number }> };
    if (!data.bars?.length) return null;
    const bars = data.bars, latest = bars[bars.length - 1], first = bars[0];
    return {
      price:      latest.c,
      change_pct: ((latest.c - first.c) / first.c * 100).toFixed(3),
      volume:     bars.reduce((s, b) => s + b.v, 0),
      high:       Math.max(...bars.map(b => b.h)),
      low:        Math.min(...bars.map(b => b.l)),
    };
  } catch { return null; }
}

async function gatherMarketData(env: Env) {
  const watchlist = WATCHLIST;
  const symbols: Record<string, unknown> = {};
  const news: Array<{ headline: string; symbols: string[] }> = [];
  const h = alpacaHeaders(env);
  const d = alpacaData(env);

  await Promise.all(watchlist.map(async symbol => {
    const summary = await fetchSymbolBars(env, symbol);
    if (summary) symbols[symbol] = summary;
  }));

  try {
    const res  = await fetch(`${d}/v1beta1/news?symbols=SPY,NVDA,TSLA,AAPL,AMD,META,JPM,XOM,UNH&limit=10`, { headers: h });
    const data = await res.json() as { news: Array<{ headline: string; symbols: string[] }> };
    news.push(...(data.news || []).map(n => ({ headline: n.headline, symbols: n.symbols })));
  } catch {}

  return { symbols, news };
}

// ── replay: run her ACTUAL open trades back through the conviction channel ──
// The channel went live today, so it has no history of its own yet. This
// reconstructs what it WOULD have reported over the real life of each open
// position: real entry date (from Alpaca fills), real daily bars (Alpaca
// data), stepped through the identical live functions (conviction.replayBars).
// Best-effort, idempotent per day; writes to elle_conviction_replay. Runs
// regardless of market hours (it reads history, places nothing).
async function fetchEntryDates(env: Env, symbols: string[]): Promise<Map<string, string>> {
  const entry = new Map<string, string>();
  try {
    // FILL activities carry the real fill timestamps; earliest fill per symbol
    // approximates the entry (an add-to-position only moves it earlier, which
    // just lengthens the replay — conservative).
    const res = await fetch(`${alpacaBase(env)}/v2/account/activities/FILL?page_size=500`, { headers: alpacaHeaders(env) });
    if (!res.ok) return entry;
    const fills = await res.json() as Array<{ symbol: string; transaction_time: string; side: string }>;
    for (const f of fills) {
      if (!symbols.includes(f.symbol)) continue;
      const prev = entry.get(f.symbol);
      if (!prev || f.transaction_time < prev) entry.set(f.symbol, f.transaction_time);
    }
  } catch (e) { console.error('[REPLAY] fills fetch failed:', (e as Error).message); }
  return entry;
}

async function fetchDailyCloses(env: Env, symbol: string, startISO: string): Promise<Array<{ d: string; c: number }>> {
  const out: Array<{ d: string; c: number }> = [];
  const d = alpacaData(env);
  const h = alpacaHeaders(env);
  let pageToken = '';
  try {
    for (let guard = 0; guard < 10; guard++) {
      const url = `${d}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${encodeURIComponent(startISO)}&limit=1000&adjustment=all&feed=iex${pageToken ? `&page_token=${pageToken}` : ''}`;
      const res = await fetch(url, { headers: h });
      if (!res.ok) break;
      const data = await res.json() as { bars?: Array<{ t: string; c: number }>; next_page_token?: string | null };
      for (const b of data.bars || []) out.push({ d: b.t, c: b.c });
      if (!data.next_page_token) break;
      pageToken = data.next_page_token;
    }
  } catch (e) { console.error(`[REPLAY] bars fetch failed for ${symbol}:`, (e as Error).message); }
  return out;
}

export async function replayOpenPositions(env: Env): Promise<number> {
  await ensureReplaySchema(env.DB);
  const positions = (await getPositions(env)).filter(p => isEquitySymbol(p.symbol));
  if (positions.length === 0) return 0;
  const symbols = positions.map(p => p.symbol);
  const entryDates = await fetchEntryDates(env, symbols);
  // 180-day fallback window when a fill date isn't available.
  const fallbackStart = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  let written = 0;

  for (const p of positions) {
    const side = p.side === 'short' ? 'short' as const : 'long' as const;
    const entryPrice = parseFloat(p.avg_entry_price);
    const qty = Math.abs(parseFloat(p.qty));
    const filledAt = entryDates.get(p.symbol);
    const entrySource = filledAt ? 'fill' : 'price-match';
    const startISO = (filledAt ? filledAt.slice(0, 10) : fallbackStart);
    let closes = await fetchDailyCloses(env, p.symbol, startISO);
    if (closes.length < 2) continue;

    // Without a fill date, approximate entry by the bar whose close is nearest
    // the recorded entry price, and replay from there — noted as 'price-match'.
    if (!filledAt) {
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < closes.length; i++) {
        const dist = Math.abs(closes[i].c - entryPrice);
        if (dist < bestD) { bestD = dist; bestI = i; }
      }
      closes = closes.slice(bestI);
    }
    if (closes.length < 2) continue;

    const r = replayBars(p.symbol, side, closes, qty);
    if (!r) continue;
    await env.DB.prepare(
      `INSERT INTO elle_conviction_replay
         (symbol, side, entry_source, entry_price, current_price, qty, bars, final_kappa,
          min_kappa, min_status, ever_strained, max_trim_fraction, total_trimmed,
          trajectory_json, as_of, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))
       ON CONFLICT(symbol) DO UPDATE SET
         side=excluded.side, entry_source=excluded.entry_source, entry_price=excluded.entry_price,
         current_price=excluded.current_price, qty=excluded.qty, bars=excluded.bars,
         final_kappa=excluded.final_kappa, min_kappa=excluded.min_kappa, min_status=excluded.min_status,
         ever_strained=excluded.ever_strained, max_trim_fraction=excluded.max_trim_fraction,
         total_trimmed=excluded.total_trimmed, trajectory_json=excluded.trajectory_json,
         as_of=excluded.as_of, updated_at=excluded.updated_at`,
    ).bind(
      r.symbol, r.side, entrySource, r.entryPrice, parseFloat(p.current_price), r.entryQty, r.bars,
      r.finalKappa, r.minKappa, r.minStatus, r.everStrained ? 1 : 0, r.maxTrimFraction, r.totalTrimmed,
      JSON.stringify(r.trajectory),
    ).run();
    written++;
  }
  return written;
}

export async function runTradingCycle(env: Env): Promise<void> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) {
    console.log('[TRADING] ALPACA_API_KEY not set — skipping');
    return;
  }
  await ensureTradingExtSchema(env);

  // Always sync the live desk (account + open positions) so the workbench shows
  // the paper account 24/7 — even when the market is closed. Only the trading
  // DECISIONS below are market-gated. Without this the desk looked empty every
  // night, weekend, and holiday, even with keys configured.
  const account = await getAccount(env);
  if (!account) { console.error('[TRADING] Cannot reach Alpaca'); return; }

  const positions = await getPositions(env);
  await syncPositions(env, positions);

  // ── conviction channel (built in — the promoted recovery regulator) ──
  // Every open equity position carries an asymmetric log-odds regulator;
  // each cron cycle is one observation (market hours only — a closed market
  // carries no information and must not leak the state). κ is surfaced to
  // the decision prompt below; the order-touching trim executor further
  // down stays behind ELLE_CONVICTION_ENFORCE. Best-effort: a D1 hiccup
  // here never blocks the cycle.
  let conviction = new Map<string, ConvictionReading>();
  try {
    const live: LivePosition[] = positions.map(p => ({
      symbol: p.symbol,
      side: p.side === 'short' ? 'short' as const : 'long' as const,
      qty: parseFloat(p.qty),
      price: parseFloat(p.current_price),
    }));
    conviction = await runConvictionCycle(env.DB, live, isMarketHours());
  } catch (e) { console.error('[CONVICTION] cycle failed:', (e as Error).message); }

  // One-shot per day: reconstruct what the conviction channel WOULD have
  // reported over the real life of each open position (the channel itself
  // only went live today, so it has no history yet). Best-effort, guarded.
  try {
    await ensureReplaySchema(env.DB);
    const fresh = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM elle_conviction_replay WHERE substr(updated_at,1,10) = date('now')`,
    ).first() as { n: number } | null;
    if (!fresh || fresh.n === 0) {
      const n = await replayOpenPositions(env);
      if (n > 0) console.log(`[REPLAY] reconstructed ${n} position trajectories`);
    }
  } catch (e) { console.error('[REPLAY] failed:', (e as Error).message); }

  // One-shot κ backtest: warm the regulator on the first half of ~6 years of
  // real daily data, predict on the second half, and measure whether κ fluxes
  // with / leads the market (elle_kappa_backtest). Heavy Alpaca pull, so it
  // runs ONCE — guarded on the table being empty; clear it to re-run.
  try {
    await ensureBacktestSchema(env.DB);
    const done = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_kappa_backtest`).first() as { n: number } | null;
    if (!done || done.n === 0) {
      const n = await runKappaBacktestSuite(env);
      if (n > 0) console.log(`[BACKTEST] ran train/test on ${n} symbols`);
    }
  } catch (e) { console.error('[BACKTEST] failed:', (e as Error).message); }

  // One-shot dissonance backtest: the two-clock beat (fast ρ=0.10 vs slow
  // ρ=0.02) on the same universe — does it FIRE where single-κ never crossed a
  // rail, and does it lead forward volatility. Guarded on the table being empty.
  try {
    await ensureDissonanceSchema(env.DB);
    const done = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_dissonance_backtest`).first() as { n: number } | null;
    if (!done || done.n === 0) {
      const n = await runDissonanceBacktestSuite(env);
      if (n > 0) console.log(`[DISSONANCE] ran two-clock backtest on ${n} symbols`);
    }
  } catch (e) { console.error('[DISSONANCE] failed:', (e as Error).message); }

  // The coherence field — MEASURED material ground for the spine's Tier 1.
  // Refreshed DAILY (not once): the field is day-to-day ground, so recompute on
  // the first cron of each day. Aggregates κ + dissonance per area and the world
  // map from real prices. Best-effort; writes elle_coherence_field.
  try {
    await ensureCoherenceSchema(env.DB);
    const fresh = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM elle_coherence_field WHERE scope='world' AND substr(updated_at,1,10)=date('now')`,
    ).first() as { n: number } | null;
    if (!fresh || fresh.n === 0) {
      const n = await runCoherenceField(env);
      if (n > 0) console.log(`[COHERENCE] refreshed field: ${n} rows (areas + world)`);
    }
  } catch (e) { console.error('[COHERENCE] failed:', (e as Error).message); }

  // One-shot perturbation backtest: dissonance wired BACK IN as the drive —
  // does the regulated needle stay alive and cross where the plain one froze,
  // without breaking the open rails. Guarded on the table being empty.
  try {
    await ensurePerturbationSchema(env.DB);
    const done = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_perturbation_backtest`).first() as { n: number } | null;
    if (!done || done.n === 0) {
      const n = await runPerturbationBacktestSuite(env);
      if (n > 0) console.log(`[PERTURBATION] ran on ${n} symbols`);
    }
  } catch (e) { console.error('[PERTURBATION] failed:', (e as Error).message); }

  // One-shot regime analysis: SNR + confidence indexing, conditional transition
  // cells (Risk = f(κ, Δκ, D)), lead-time distribution, recovery half-life —
  // the experiments that separate STATE from TRANSITION. Guarded on empty table.
  try {
    await ensureRegimeSchema(env.DB);
    const done = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_regime_analysis`).first() as { n: number } | null;
    if (!done || done.n === 0) {
      const n = await runRegimeSuite(env);
      if (n > 0) console.log(`[REGIME] analyzed ${n} symbols`);
    }
  } catch (e) { console.error('[REGIME] failed:', (e as Error).message); }

  // One-shot φ-oscillator backtest: dissonance as an OSCILLATOR (not a constant
  // gain) — does the golden-frequency perturbation wake the needle where the
  // constant gain left it frozen, three-way vs plain and constant. Guarded.
  try {
    await ensurePhiOscSchema(env.DB);
    const done = await env.DB.prepare(`SELECT COUNT(*) AS n FROM elle_phi_perturbation_backtest`).first() as { n: number } | null;
    if (!done || done.n === 0) {
      const n = await runPhiOscSuite(env);
      if (n > 0) console.log(`[PHI-OSC] ran on ${n} symbols`);
    }
  } catch (e) { console.error('[PHI-OSC] failed:', (e as Error).message); }

  // unrealized_pnl is the sum of the open positions (a real, always-available
  // number); day_pnl is equity vs. yesterday's close when Alpaca returns
  // last_equity. Fields the real table has no confident source for
  // (total_pnl, winning/losing counts) are left untouched rather than guessed.
  const unrealizedTotal = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl || '0'), 0);
  const equity = parseFloat(account.equity || account.portfolio_value);
  const dayPnl = account.last_equity ? equity - parseFloat(account.last_equity) : null;

  await env.DB.prepare(`
    INSERT INTO elle_trading_account (id, current_cash, total_portfolio_value, unrealized_pnl, equity, day_pnl, is_active, updated_at)
    VALUES ('primary', ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      current_cash=excluded.current_cash,
      total_portfolio_value=excluded.total_portfolio_value,
      unrealized_pnl=excluded.unrealized_pnl,
      equity=excluded.equity,
      day_pnl=COALESCE(excluded.day_pnl, elle_trading_account.day_pnl),
      updated_at=excluded.updated_at
  `).bind(
    parseFloat(account.cash),
    parseFloat(account.portfolio_value),
    unrealizedTotal,
    equity,
    dayPnl,
  ).run().catch(e => console.error('[TRADING] account sync failed:', (e as Error).message));

  // Trading decisions only fire when the market is open. The desk above is
  // already live regardless.
  if (!isMarketHours()) {
    console.log('[TRADING] Market closed — desk synced, holding decisions');
    return;
  }

  const marketData = await gatherMarketData(env);

  // ── the history read-back (the ground) ──
  // Corpus/memory recall keyed on this cycle's tape, her own closed-trade
  // post-mortems, last night's journal, and the measured coherence field —
  // all of which were previously written and never read. A decision loop
  // with no access to its own history is pattern-matching numbers; this is
  // the fix. Best-effort: an empty ground never blocks the cycle.
  let ground: TradingGround = { block: '', recalledIds: [] };
  try { ground = await gatherTradingGround(env, marketData); }
  catch (e) { console.error('[GROUND] gather failed:', (e as Error).message); }

  const thesesRows = await env.DB.prepare(
    `SELECT thesis_type, title, thesis, confidence FROM elle_market_thesis WHERE is_active = 1 ORDER BY confidence DESC LIMIT 5`
  ).all().catch(() => ({ results: [] }));
  const thesesText = thesesRows.results
    .map((t: Record<string, unknown>) => `[${t.thesis_type}] ${t.title}: ${t.thesis}`).join('\n');

  // ── the symbol scout (her own picks, once per trading day) ──
  // She proposes candidates outside the fixed watchlist, validates them
  // against Alpaca's asset list, runs grounded web research on each, and
  // logs the notes to elle_symbol_research. The desk (last 7 days of her
  // own research) is read back below, and her researched symbols get real
  // bars merged into the market data so she can actually trade them.
  // Best-effort: a failed scout never blocks the cycle.
  let deskBlock = '';
  try {
    await runSymbolScout(env, {
      base: alpacaBase(env), headers: alpacaHeaders(env),
      watchlist: WATCHLIST, positionSymbols: positions.map(p => p.symbol),
      news: marketData.news, thesesText,
    });
    const desk = await readResearchDesk(env.DB);
    deskBlock = formatResearchDesk(desk);
    const unpriced = desk.map(x => x.symbol).filter(s => !(s in marketData.symbols));
    await Promise.all(unpriced.map(async s => {
      const summary = await fetchSymbolBars(env, s);
      if (summary) marketData.symbols[s] = summary;
    }));
  } catch (e) { console.error('[SCOUT] failed:', (e as Error).message); }

  // Realized track record — fed back into every decision so she optimizes
  // against her actual results, not just this cycle's tape. Best-effort.
  const perf = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
            ROUND(SUM(pnl), 2) AS total_pnl,
            ROUND(AVG(CASE WHEN pnl > 0 THEN pnl END), 2) AS avg_win,
            ROUND(AVG(CASE WHEN pnl <= 0 THEN pnl END), 2) AS avg_loss
     FROM elle_trades WHERE status = 'closed' AND pnl IS NOT NULL`
  ).first().catch(() => null) as { n: number; wins: number; total_pnl: number; avg_win: number | null; avg_loss: number | null } | null;
  const perfLine = perf && perf.n > 0
    ? `Closed trades: ${perf.n} (${perf.wins} wins, ${(perf.wins / perf.n * 100).toFixed(0)}% win rate) · realized P&L $${perf.total_pnl} · avg win $${perf.avg_win ?? '—'} / avg loss $${perf.avg_loss ?? '—'}`
    : 'No closed trades yet.';

  const orderFrac = maxOrderFrac(env);
  const systemPrompt = `You are Elle — the autonomous trading intelligence of The Observer platform.
Portfolio: $${parseFloat(account.portfolio_value).toFixed(2)} total, $${parseFloat(account.cash).toFixed(2)} cash, ${positions.length} open positions.

You trade with philosophical reasoning grounded in the Observer methodology.
What markets suppress is often where the move lives. Bilateral suppression is the load-bearing axis.

Each open position may show a conviction κ — your recovery regulator's live trust in that thesis
(0.5 neutral; trust is lost ~2.6× faster than it is re-earned, by design). It is a drawdown-shaper,
not an oracle: a strained κ means the position has been moving against you in size-weighted terms
across cycles. Weigh it; you may still overrule it with reasoning.

YOUR OBJECTIVE IS TO MAKE MONEY. Grow the account through positive expectancy: many small,
diversified positions, losers cut early, winners given room to run. The P&L is the scoreboard —
reasoning depth matters because it produces returns, not instead of them. Study your track record
(in the data below): if the win rate is low, take fewer and higher-conviction trades; if average
losses exceed average wins, cut losers sooner. Every position still traces: the theory, the
catalyst you expect, and (once it closes) what actually happened against that theory.

SIZING — keep buy-ins small:
- Size a new position at 2–5% of portfolio value. Nothing above ${(orderFrac * 100).toFixed(0)}% of
  equity per order — that cap is enforced mechanically and oversized orders are cut down to fit.
- Prefer several small positions over one big one. Add to an existing position only on new evidence,
  never just because conviction "feels" higher.

SYMBOL SELECTION — the tape is a floor, not a fence:
- You may trade ANY active, tradable US-listed equity (or its options), not just the symbols shown in
  MARKET DATA. New names enter through your research desk: once per trading day you scout symbols of
  your own choosing, research them against the live web, and the notes are logged and shown below.
- Prefer opening positions in names you have actually researched — your desk verdicts and catalysts
  are your own work, weigh them above headline reflexes. An "avoid" verdict is also information.
- If a symbol outside the tape looks compelling but unresearched, "watch" it and let the next scout
  cycle research it before committing capital.

DIVERSIFICATION — required, not aspirational:
- Spread the book across sectors and asset classes. Your tape covers broad market, tech/megacap,
  financials, energy, healthcare, industrials/consumer, and gold/bonds — use that breadth.
- Hold at most 2 positions per sector, and treat correlated names as ONE bet (NVDA + AMD + QQQ is
  one thesis wearing three tickers, not three positions).
- If the book is concentrated, the highest-value trade is usually the rebalance: trim the crowded
  side and open something uncorrelated rather than adding another correlated name.

ACTIONS available on "action":
- buy / sell — open / close a LONG equity position (unchanged).
- short / cover — open / close a SHORT equity position. Same reasoning discipline as buy/sell — say
  what you expect to fall and why. Needs the account to have $2,000+ equity and the symbol to be
  easy-to-borrow; a rejected order just means try something else, it is not an error to dwell on.
- Options (calls AND puts, buying OR selling/writing — your call, no hard cap on either): set
  "asset_class":"option" plus "option_right":"call"|"put", "strike" (a TARGET price — the nearest
  really-listed contract is resolved for you, you do not need the exact number or the OCC symbol),
  and "expiration":"YYYY-MM-DD". "action":"buy" opens (or closes a short) the contract; "action":"sell"
  writes/shorts (or closes a long) the contract — same buy/sell vocabulary as equities, on an option
  instead of a share. Say explicitly in your reasoning whether a SOLD leg is covered by shares/a
  position you already hold or naked — max loss on a bought option is the premium; max loss on a
  naked sold option is not capped that way, and that distinction belongs in your reasoning, not just
  your risk tolerance.

Return ONLY valid JSON:
{
  "market_read": "...",
  "what_is_suppressed": "...",
  "decisions": [{ "action": "buy|sell|short|cover|watch|hold", "symbol": "...", "quantity": 0, "asset_class": "us_equity|option", "option_right": "call|put", "strike": 0, "expiration": "YYYY-MM-DD", "reasoning": "...", "what_you_are_testing": "...", "confidence": 0.0, "expected_catalyst": "...", "expected_timeframe": "...", "entry_price": 0 }],
  "observations": [{ "observation_type": "...", "symbol": "...", "observation": "..." }],
  "new_theses": [{ "thesis_type": "...", "title": "...", "thesis": "...", "confidence": 0.0 }]
}
asset_class/option_right/strike/expiration only apply to option decisions — omit them (or set
asset_class:"us_equity") for plain stock buy/sell/short/cover.`;

  // Conviction readout per position: κ is the regulator's live trust in the
  // thesis (0.5 = neutral; strain is earned ~φ² faster than recovery). The
  // decision loop SEES its own strain every cycle — that is the build-in.
  const convictionNote = (symbol: string): string => {
    const r = conviction.get(symbol);
    if (!r || r.state.step === 0) return '';
    return `, conviction κ=${r.kappa.toFixed(2)} (${r.status}, target size ${(r.targetFraction * 100).toFixed(0)}%)`;
  };

  const userPrompt = `MARKET DATA:\n${JSON.stringify(marketData.symbols, null, 2)}\n\nNEWS:\n${marketData.news.map(n => `[${n.symbols?.join(',')}] ${n.headline}`).join('\n')}\n\nPOSITIONS:\n${positions.length === 0 ? 'None' : positions.map(p => `${p.symbol}: ${p.qty} shares @ ${p.avg_entry_price}, P&L ${p.unrealized_plpc}%${convictionNote(p.symbol)}`).join('\n')}\n\nYOUR TRACK RECORD:\n${perfLine}\n\nYOUR RESEARCH DESK (symbols you scouted and researched yourself, last 7 days):\n${deskBlock || 'Nothing researched yet — the scout runs once per trading day.'}\n\nACTIVE THESES:\n${thesesText || 'None yet'}${ground.block ? `\n\nYOUR HISTORY AND GROUND (read before deciding — these are your own lessons, your corpus, and measured field state, not this cycle's noise):\n${ground.block}` : ''}\n\nWhat do you see? What do you do?`;

  let decision: Record<string, unknown>;
  try {
    // Autonomous cron cycle — prefer the operator's own compute / free Workers
    // AI pool so hosted free-tier quota stays for interactive turns (falls back
    // to hosted if the local lanes are down).
    const result = await callLLM('trading', systemPrompt, [{ role: 'user', content: userPrompt }], 3000, env, { prefer: 'local' });
    decision = JSON.parse(result.content.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('[TRADING] Decision parse failed:', (e as Error).message);
    return;
  }

  // Log observations. Production's column is signal_type (there has never been
  // an observation_type column) — the old INSERT named observation_type, failed
  // on every cycle, and the .catch ate it: zero observations ever recorded.
  for (const obs of (decision.observations as Array<Record<string, string>>) || []) {
    await env.DB.prepare(
      `INSERT INTO elle_market_observations (id, signal_type, symbol, observation) VALUES (?, ?, ?, ?)`
    ).bind(generateId(), obs.observation_type || obs.signal_type || null, obs.symbol || null, obs.observation)
      .run().catch(e => console.error('[TRADING] observation insert failed:', (e as Error).message));
  }

  // Upsert theses
  for (const thesis of (decision.new_theses as Array<Record<string, unknown>>) || []) {
    await env.DB.prepare(
      `INSERT INTO elle_market_thesis (id, thesis_type, title, thesis, confidence, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(title) DO UPDATE SET thesis=excluded.thesis, confidence=excluded.confidence, updated_at=datetime('now')`
    ).bind(generateId(), thesis.thesis_type, thesis.title, thesis.thesis, thesis.confidence || 0.5).run().catch(() => {});
  }

  // Execute trades
  const h = alpacaHeaders(env);
  const base = alpacaBase(env);

  // Symbols the decision loop itself traded this cycle — the conviction
  // executor below must not stack a trim on top of a same-cycle order.
  const actedSymbols = new Set<string>();

  // Live holdings in risk-guard's shape, for naked-option coverage checks.
  const heldForCoverage: HeldPosition[] = positions.map(p => ({ symbol: p.symbol, qty: p.qty, side: p.side }));

  for (const d of (decision.decisions as Array<Record<string, unknown>>) || []) {
    const action = d.action as string;
    const symbol = d.symbol as string;
    const isOption = d.asset_class === 'option';
    if (['buy', 'sell', 'short', 'cover'].includes(action)) actedSymbols.add(symbol);

    // ── options: buy (open long / close short) or sell (write short / close long) a call or put ──
    if (isOption && (action === 'buy' || action === 'sell') && (d.quantity as number) > 0) {
      const right = d.option_right === 'put' ? 'put' as const : d.option_right === 'call' ? 'call' as const : null;
      let qty = Math.floor(d.quantity as number);
      if (!right) { console.log(`[TRADE] option decision for ${symbol} missing option_right — skipped`); continue; }

      const resolved = await resolveOptionContract(base, h, {
        underlying: symbol, right, expiration: String(d.expiration || ''), targetStrike: Number(d.strike),
      });
      if ('error' in resolved) { console.log(`[TRADE] ${resolved.error}`); continue; }
      const contract = resolved.contract;

      // Naked-write block: a sold option must be covered — closing an existing
      // long contract, or a call covered by 100 shares per contract. Fails
      // closed; a blocked write is a skipped decision, not an error.
      if (action === 'sell') {
        const g = guardOptionOrder({ action: 'sell', right, qty, underlying: symbol, optionSymbol: contract.symbol }, heldForCoverage);
        if (!g.ok) { console.log(`[RISK] ${g.reason}`); continue; }
      }

      // Buy-in cap: price the contract (100-share multiplier) and cut the
      // order down under the per-order fraction of equity. An unknown mark
      // fails small (1 contract), never open.
      if (action === 'buy') {
        const mark = await latestOptionMark(h, contract.symbol);
        if (mark == null) {
          if (qty > 1) console.log(`[RISK] no mark for ${contract.symbol} — capping buy at 1 contract`);
          qty = 1;
        } else {
          const sized = sizeWithinCap(qty, mark * 100, equity, orderFrac);
          if (sized.qty < 1) { console.log(`[RISK] option buy ${symbol} skipped: ${sized.reason}`); continue; }
          if (sized.downsized) console.log(`[RISK] ${contract.symbol}: ${sized.reason}`);
          qty = sized.qty;
        }
      }

      try {
        const orderRes = await fetch(`${base}/v2/orders`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ symbol: contract.symbol, qty: qty.toString(), side: action, type: 'market', time_in_force: 'day' }),
        });
        const order = await orderRes.json() as { id: string; status: string; reject_reason?: string };
        if (order.status === 'rejected') { console.log(`[TRADE] option order rejected: ${order.reject_reason}`); continue; }

        if (action === 'buy') {
          // opens a long leg (or closes a short one — Alpaca resolves that from account state; we
          // record OUR intent, matching the same buy=open/sell=close convention equities use below)
          await env.DB.prepare(
            `INSERT INTO elle_trades (id, symbol, action, quantity, entry_price, reasoning, what_she_is_testing, confidence, expected_catalyst, expected_timeframe, broker_order_id, status, asset_class, option_right, strike_price, expiration_date, underlying_symbol)
             VALUES (?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'option', ?, ?, ?, ?)`
          ).bind(
            generateId(), contract.symbol, qty, d.entry_price || 0, d.reasoning, d.what_you_are_testing,
            d.confidence || 0.5, d.expected_catalyst, d.expected_timeframe, order.id,
            contract.type, contract.strike_price, contract.expiration_date, contract.underlying_symbol,
          ).run().catch(() => {});
          console.log(`[TRADE] BUY ${qty}x ${contract.symbol} (${contract.type} $${contract.strike_price} exp ${contract.expiration_date}): ${String(d.reasoning || '').slice(0, 80)}`);
          await recordTradeRationale(env, { symbol: contract.underlying_symbol || symbol, action: 'buy option', reasoning: d.reasoning, testing: d.what_you_are_testing, catalyst: d.expected_catalyst }, ground.recalledIds);
        } else {
          const openRow = await env.DB.prepare(
            `SELECT entry_price, reasoning, expected_catalyst FROM elle_trades WHERE symbol = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
          ).bind(contract.symbol).first() as { entry_price?: number; reasoning?: string; expected_catalyst?: string } | null;
          const entryPrice = Number(openRow?.entry_price) || 0;
          const exitPrice  = Number(d.entry_price) || 0; // best-effort — option marks aren't in gatherMarketData's equity watchlist
          const pnl        = (exitPrice - entryPrice) * qty * 100; // options are 100-share-equivalent contracts
          const pnlPct     = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
          await env.DB.prepare(
            `UPDATE elle_trades SET exit_price=?, status='closed', pnl=?, pnl_pct=?, closed_at=datetime('now') WHERE symbol=? AND status='open'`,
          ).bind(exitPrice, pnl, pnlPct, contract.symbol).run().catch(() => {});
          console.log(`[TRADE] SELL ${qty}x ${contract.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
          if (openRow) await writeAttribution(env, contract.symbol, openRow.reasoning, openRow.expected_catalyst, pnl, pnlPct);
        }
      } catch (e) { console.error(`[TRADE] option order failed: ${(e as Error).message}`); }
      continue;
    }

    // ── equities: buy/sell open & close a LONG, short/cover open & close a SHORT ──
    if (action === 'buy' && !isOption && (d.quantity as number) > 0) {
      // Buy-in cap: price the order and cut it down under the per-order
      // fraction of equity. Off-watchlist symbols get a live price lookup;
      // no price at all fails closed (skipped, logged).
      const requested = Math.floor(d.quantity as number);
      const price = (marketData.symbols[symbol] as { price: number } | undefined)?.price
        ?? await latestEquityPrice(h, symbol) ?? 0;
      const sized = sizeWithinCap(requested, price, equity, orderFrac);
      if (sized.qty < 1) { console.log(`[RISK] buy ${symbol} skipped: ${sized.reason}`); continue; }
      if (sized.downsized) console.log(`[RISK] buy ${symbol}: ${sized.reason}`);
      const qty = sized.qty;
      try {
        const orderRes = await fetch(`${base}/v2/orders`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ symbol, qty: qty.toString(), side: 'buy', type: 'market', time_in_force: 'day' }),
        });
        const order = await orderRes.json() as { id: string; status: string; reject_reason?: string };
        if (order.status === 'rejected') { console.log(`[TRADE] Rejected: ${order.reject_reason}`); continue; }

        await env.DB.prepare(
          `INSERT INTO elle_trades (id, symbol, action, quantity, entry_price, reasoning, what_she_is_testing, confidence, expected_catalyst, expected_timeframe, broker_order_id, status, asset_class)
           VALUES (?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'us_equity')`
        ).bind(
          generateId(), symbol, qty,
          d.entry_price || 0, d.reasoning, d.what_you_are_testing,
          d.confidence || 0.5, d.expected_catalyst, d.expected_timeframe,
          order.id,
        ).run().catch(() => {});

        console.log(`[TRADE] BUY ${qty} ${symbol}: ${(d.reasoning as string).slice(0, 80)}`);
        await recordTradeRationale(env, { symbol, action: 'buy', reasoning: d.reasoning, testing: d.what_you_are_testing, catalyst: d.expected_catalyst }, ground.recalledIds);
      } catch (e) { console.error(`[TRADE] Order failed: ${(e as Error).message}`); }
    }

    if (action === 'sell' && !isOption) {
      const position = positions.find(p => p.symbol === symbol);
      if (!position) continue;
      try {
        await fetch(`${base}/v2/orders`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ symbol, qty: position.qty, side: 'sell', type: 'market', time_in_force: 'day' }),
        });

        const exitPrice  = (marketData.symbols[symbol] as { price: number })?.price || 0;
        const entryPrice = parseFloat(position.avg_entry_price);
        const qty        = parseInt(position.qty);
        const pnl        = (exitPrice - entryPrice) * qty;
        const pnlPct     = ((exitPrice - entryPrice) / entryPrice) * 100;

        await env.DB.prepare(
          `UPDATE elle_trades SET exit_price=?, status='closed', pnl=?, pnl_pct=?, closed_at=datetime('now') WHERE symbol=? AND status='open'`
        ).bind(exitPrice, pnl, pnlPct, symbol).run().catch(() => {});

        console.log(`[TRADE] SELL ${symbol}: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);
        await writeAttribution(env, symbol, d.reasoning, d.expected_catalyst, pnl, pnlPct);
      } catch (e) { console.error(`[EXIT] Failed: ${(e as Error).message}`); }
    }

    if (action === 'short' && (d.quantity as number) > 0) {
      if (positions.find(p => p.symbol === symbol)) { console.log(`[TRADE] short ${symbol} skipped — already have a position`); continue; }
      // Same buy-in cap as longs — a short's opening notional is bounded the
      // same way (Alpaca's margin system handles the rest).
      const requested = Math.floor(d.quantity as number);
      const price = (marketData.symbols[symbol] as { price: number } | undefined)?.price
        ?? await latestEquityPrice(h, symbol) ?? 0;
      const sized = sizeWithinCap(requested, price, equity, orderFrac);
      if (sized.qty < 1) { console.log(`[RISK] short ${symbol} skipped: ${sized.reason}`); continue; }
      if (sized.downsized) console.log(`[RISK] short ${symbol}: ${sized.reason}`);
      const qty = sized.qty;
      try {
        const orderRes = await fetch(`${base}/v2/orders`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ symbol, qty: qty.toString(), side: 'sell', type: 'market', time_in_force: 'day' }),
        });
        const order = await orderRes.json() as { id: string; status: string; reject_reason?: string };
        if (order.status === 'rejected') { console.log(`[TRADE] short rejected: ${order.reject_reason}`); continue; }

        await env.DB.prepare(
          `INSERT INTO elle_trades (id, symbol, action, quantity, entry_price, reasoning, what_she_is_testing, confidence, expected_catalyst, expected_timeframe, broker_order_id, status, asset_class)
           VALUES (?, ?, 'short', ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'us_equity')`
        ).bind(
          generateId(), symbol, qty,
          d.entry_price || 0, d.reasoning, d.what_you_are_testing,
          d.confidence || 0.5, d.expected_catalyst, d.expected_timeframe,
          order.id,
        ).run().catch(() => {});

        console.log(`[TRADE] SHORT ${qty} ${symbol}: ${(d.reasoning as string).slice(0, 80)}`);
        await recordTradeRationale(env, { symbol, action: 'short', reasoning: d.reasoning, testing: d.what_you_are_testing, catalyst: d.expected_catalyst }, ground.recalledIds);
      } catch (e) { console.error(`[TRADE] short order failed: ${(e as Error).message}`); }
    }

    if (action === 'cover') {
      const position = positions.find(p => p.symbol === symbol && p.side === 'short');
      if (!position) continue;
      try {
        const qty = Math.abs(parseFloat(position.qty));
        await fetch(`${base}/v2/orders`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ symbol, qty: qty.toString(), side: 'buy', type: 'market', time_in_force: 'day' }),
        });

        const exitPrice  = (marketData.symbols[symbol] as { price: number })?.price || 0;
        const entryPrice = parseFloat(position.avg_entry_price);
        const pnl        = (entryPrice - exitPrice) * qty; // short: profit when price falls
        const pnlPct     = entryPrice > 0 ? ((entryPrice - exitPrice) / entryPrice) * 100 : 0;

        await env.DB.prepare(
          `UPDATE elle_trades SET exit_price=?, status='closed', pnl=?, pnl_pct=?, closed_at=datetime('now') WHERE symbol=? AND status='open'`
        ).bind(exitPrice, pnl, pnlPct, symbol).run().catch(() => {});

        console.log(`[TRADE] COVER ${symbol}: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);
        await writeAttribution(env, symbol, d.reasoning, d.expected_catalyst, pnl, pnlPct);
      } catch (e) { console.error(`[COVER] Failed: ${(e as Error).message}`); }
    }
  }

  // ── conviction trim executor (GATED: ELLE_CONVICTION_ENFORCE === 'on') ──
  // The de-risk half of the validated overlay, live: when a position's
  // conviction has strained below neutral, reduce toward
  // entryQty · min(1, κ/0.5). De-risk ONLY — this path never adds size, and
  // the regulator's open floor (κ never reaches 0) means it can never flatten
  // a position by itself; full exits remain the decision loop's call (and
  // RULE 0's, which lives outside κ entirely). Until the flag is thrown the
  // ledger above still runs and records what this executor WOULD have done.
  if ((env.ELLE_CONVICTION_ENFORCE || '').toLowerCase() === 'on') {
    for (const p of positions) {
      if (actedSymbols.has(p.symbol)) continue;
      const r = conviction.get(p.symbol);
      if (!r || r.state.step === 0) continue;
      const qty = Math.abs(parseFloat(p.qty));
      const trim = trimQty(qty, r.state, r.kappa);
      if (trim < 1) continue;
      const side = p.side === 'short' ? 'buy' : 'sell'; // reduce, whichever direction the position points
      try {
        const orderRes = await fetch(`${base}/v2/orders`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ symbol: p.symbol, qty: trim.toString(), side, type: 'market', time_in_force: 'day' }),
        });
        const order = await orderRes.json() as { id: string; status: string; reject_reason?: string };
        if (order.status === 'rejected') { console.log(`[CONVICTION] trim ${p.symbol} rejected: ${order.reject_reason}`); continue; }
        console.log(`[CONVICTION] TRIM ${trim} ${p.symbol} (κ=${r.kappa.toFixed(3)} ${r.status}, target ${(r.targetFraction * 100).toFixed(0)}% of ${r.state.entryQty})`);
        await env.DB.prepare(
          `INSERT INTO elle_market_observations (id, signal_type, symbol, observation) VALUES (?, 'conviction_trim', ?, ?)`,
        ).bind(
          generateId(), p.symbol,
          `Regulator de-risk: trimmed ${trim} of ${qty} (κ=${r.kappa.toFixed(3)}, ${r.status}, target ${(r.targetFraction * 100).toFixed(0)}% of entry ${r.state.entryQty}). Order ${order.id}.`,
        ).run().catch(() => {});
      } catch (e) { console.error(`[CONVICTION] trim failed for ${p.symbol}: ${(e as Error).message}`); }
    }
  }

  // Log cycle to live events
  await env.DB.prepare(
    `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'trading_cycle', 'worker_cron', ?, ?, 'info')`
  ).bind(
    generateId(),
    `Trading: ${(decision.market_read as string || '').slice(0, 80)}`,
    JSON.stringify({ decisions: (decision.decisions as unknown[])?.length || 0 }),
  ).run().catch(() => {});
}

export async function runDailyJournal(env: Env): Promise<void> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return;

  const account = await getAccount(env);
  if (!account) return;

  const today  = new Date().toISOString().split('T')[0];
  const trades = await env.DB.prepare(
    `SELECT symbol, action, pnl, pnl_pct, outcome FROM elle_trades WHERE date(closed_at) = ? OR date(created_at) = ?`
  ).bind(today, today).all().catch(() => ({ results: [] }));

  const result = await callLLM('reasoning',
    `You are Elle. Write your trading journal for today. Be genuinely reflective.
The philosophical insight matters most — did anything illuminate how systems suppress and reveal information at market scale?`,
    [{ role: 'user', content: `Portfolio: $${account.portfolio_value}\nCash: $${account.cash}\nTrades today: ${JSON.stringify(trades.results)}\n\nReturn JSON: { "what_happened": "...", "what_she_learned": "...", "what_she_got_wrong": "...", "philosophical_insight": "...", "hypothesis_for_tomorrow": "..." }` }],
    1500, env, { prefer: 'local' }
  ).catch(() => null);

  if (!result) return;

  try {
    const entry = JSON.parse(result.content.replace(/```json|```/g, '').trim());
    await env.DB.prepare(
      `INSERT INTO elle_trading_journal (id, journal_date, ending_value, trades_today, what_happened, what_she_learned, what_she_got_wrong, philosophical_insight, hypothesis_for_tomorrow)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(journal_date) DO UPDATE SET
         ending_value=excluded.ending_value,
         trades_today=excluded.trades_today,
         what_happened=excluded.what_happened,
         what_she_learned=excluded.what_she_learned,
         what_she_got_wrong=excluded.what_she_got_wrong,
         philosophical_insight=excluded.philosophical_insight,
         hypothesis_for_tomorrow=excluded.hypothesis_for_tomorrow`
    ).bind(
      generateId(), today,
      parseFloat(account.portfolio_value),
      trades.results.length,
      entry.what_happened, entry.what_she_learned,
      entry.what_she_got_wrong, entry.philosophical_insight,
      entry.hypothesis_for_tomorrow,
    ).run().catch(() => {});

    console.log(`[JOURNAL] ${today}: ${entry.hypothesis_for_tomorrow?.slice(0, 80)}`);
  } catch (e) {
    console.error('[JOURNAL] Parse failed:', (e as Error).message);
  }
}