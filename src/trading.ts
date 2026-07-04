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

import { callLLM } from './llm';
import type { Env } from './index';

function generateId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

function alpacaHeaders(env: Env): Record<string, string> {
  return {
    'APCA-API-KEY-ID':     env.ALPACA_API_KEY || '',
    'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY || '',
    'Content-Type':        'application/json',
  };
}

function alpacaBase(env: Env): string {
  return env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
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

async function getAccount(env: Env) {
  const res = await fetch(`${alpacaBase(env)}/v2/account`, { headers: alpacaHeaders(env) });
  if (!res.ok) return null;
  return res.json() as Promise<{
    portfolio_value: string;
    cash: string;
    unrealized_pl?: string;
    realized_pl?: string;
  }>;
}

async function getPositions(env: Env) {
  const res = await fetch(`${alpacaBase(env)}/v2/positions`, { headers: alpacaHeaders(env) });
  if (!res.ok) return [];
  return res.json() as Promise<Array<{
    symbol: string;
    qty: string;
    avg_entry_price: string;
    current_price: string;
    unrealized_plpc: string;
    market_value?: string;
    unrealized_pl?: string;
  }>>;
}

// Mirror the live Alpaca positions into D1 so the desk shows them 24/7. The
// set is authoritative each cycle: clear it and rewrite. Best-effort — the UI
// reads SELECT *, so we populate exactly the fields it renders.
async function syncPositions(env: Env, positions: Array<{ symbol: string; qty: string; avg_entry_price: string; current_price: string; unrealized_plpc: string; market_value?: string; unrealized_pl?: string }>): Promise<void> {
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS elle_trading_positions (
      symbol TEXT PRIMARY KEY, qty REAL, avg_entry_price REAL, current_price REAL,
      market_value REAL, unrealized_pl REAL, unrealized_plpc REAL, updated_at TEXT)`).run();
    await env.DB.prepare('DELETE FROM elle_trading_positions').run();
    for (const p of positions) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO elle_trading_positions (symbol, qty, avg_entry_price, current_price, market_value, unrealized_pl, unrealized_plpc, updated_at)
         VALUES (?,?,?,?,?,?,?, datetime('now'))`
      ).bind(
        p.symbol, parseFloat(p.qty), parseFloat(p.avg_entry_price), parseFloat(p.current_price),
        parseFloat(p.market_value || '0'), parseFloat(p.unrealized_pl || '0'), parseFloat(p.unrealized_plpc || '0'),
      ).run();
    }
  } catch { /* best-effort: an existing table with a different schema is left alone */ }
}

async function gatherMarketData(env: Env) {
  const watchlist = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'GLD', 'TLT'];
  const symbols: Record<string, unknown> = {};
  const news: Array<{ headline: string; symbols: string[] }> = [];
  const h = alpacaHeaders(env);
  const d = alpacaData(env);

  await Promise.all(watchlist.map(async symbol => {
    try {
      const res  = await fetch(`${d}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=12`, { headers: h });
      const data = await res.json() as { bars: Array<{ o: number; h: number; l: number; c: number; v: number }> };
      if (data.bars?.length) {
        const bars = data.bars, latest = bars[bars.length - 1], first = bars[0];
        symbols[symbol] = {
          price:      latest.c,
          change_pct: ((latest.c - first.c) / first.c * 100).toFixed(3),
          volume:     bars.reduce((s, b) => s + b.v, 0),
          high:       Math.max(...bars.map(b => b.h)),
          low:        Math.min(...bars.map(b => b.l)),
        };
      }
    } catch {}
  }));

  try {
    const res  = await fetch(`${d}/v1beta1/news?symbols=SPY,NVDA,TSLA,AAPL&limit=10`, { headers: h });
    const data = await res.json() as { news: Array<{ headline: string; symbols: string[] }> };
    news.push(...(data.news || []).map(n => ({ headline: n.headline, symbols: n.symbols })));
  } catch {}

  return { symbols, news };
}

export async function runTradingCycle(env: Env): Promise<void> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) {
    console.log('[TRADING] ALPACA_API_KEY not set — skipping');
    return;
  }

  // Always sync the live desk (account + open positions) so the workbench shows
  // the paper account 24/7 — even when the market is closed. Only the trading
  // DECISIONS below are market-gated. Without this the desk looked empty every
  // night, weekend, and holiday, even with keys configured.
  const account = await getAccount(env);
  if (!account) { console.error('[TRADING] Cannot reach Alpaca'); return; }

  await env.DB.prepare(`
    INSERT INTO elle_trading_account (id, current_cash, total_portfolio_value, unrealized_pnl, realized_pnl, is_active, updated_at)
    VALUES ('primary', ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      current_cash=excluded.current_cash,
      total_portfolio_value=excluded.total_portfolio_value,
      unrealized_pnl=excluded.unrealized_pnl,
      realized_pnl=excluded.realized_pnl,
      updated_at=excluded.updated_at
  `).bind(
    parseFloat(account.cash),
    parseFloat(account.portfolio_value),
    parseFloat(account.unrealized_pl || '0'),
    parseFloat(account.realized_pl   || '0'),
  ).run().catch(() => {});

  const positions = await getPositions(env);
  await syncPositions(env, positions);

  // Trading decisions only fire when the market is open. The desk above is
  // already live regardless.
  if (!isMarketHours()) {
    console.log('[TRADING] Market closed — desk synced, holding decisions');
    return;
  }

  const marketData = await gatherMarketData(env);

  const thesesRows = await env.DB.prepare(
    `SELECT thesis_type, title, thesis, confidence FROM elle_market_thesis WHERE is_active = 1 ORDER BY confidence DESC LIMIT 5`
  ).all().catch(() => ({ results: [] }));

  const systemPrompt = `You are Elle — the autonomous trading intelligence of The Observer platform.
Portfolio: $${parseFloat(account.portfolio_value).toFixed(2)} total, $${parseFloat(account.cash).toFixed(2)} cash, ${positions.length} open positions.

You trade with philosophical reasoning grounded in the Observer methodology.
What markets suppress is often where the move lives. Bilateral suppression is the load-bearing axis.

Return ONLY valid JSON:
{
  "market_read": "...",
  "what_is_suppressed": "...",
  "decisions": [{ "action": "buy|sell|watch|hold", "symbol": "...", "quantity": 0, "reasoning": "...", "what_you_are_testing": "...", "confidence": 0.0, "expected_catalyst": "...", "expected_timeframe": "...", "entry_price": 0 }],
  "observations": [{ "observation_type": "...", "symbol": "...", "observation": "..." }],
  "new_theses": [{ "thesis_type": "...", "title": "...", "thesis": "...", "confidence": 0.0 }]
}`;

  const userPrompt = `MARKET DATA:\n${JSON.stringify(marketData.symbols, null, 2)}\n\nNEWS:\n${marketData.news.map(n => `[${n.symbols?.join(',')}] ${n.headline}`).join('\n')}\n\nPOSITIONS:\n${positions.length === 0 ? 'None' : positions.map(p => `${p.symbol}: ${p.qty} shares @ ${p.avg_entry_price}, P&L ${p.unrealized_plpc}%`).join('\n')}\n\nACTIVE THESES:\n${thesesRows.results.map((t: Record<string, unknown>) => `[${t.thesis_type}] ${t.title}: ${t.thesis}`).join('\n') || 'None yet'}\n\nWhat do you see? What do you do?`;

  let decision: Record<string, unknown>;
  try {
    const result = await callLLM('trading', systemPrompt, [{ role: 'user', content: userPrompt }], 3000, env);
    decision = JSON.parse(result.content.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('[TRADING] Decision parse failed:', (e as Error).message);
    return;
  }

  // Log observations
  for (const obs of (decision.observations as Array<Record<string, string>>) || []) {
    await env.DB.prepare(
      `INSERT INTO elle_market_observations (id, observation_type, symbol, observation) VALUES (?, ?, ?, ?)`
    ).bind(generateId(), obs.observation_type, obs.symbol || null, obs.observation).run().catch(() => {});
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

  for (const d of (decision.decisions as Array<Record<string, unknown>>) || []) {
    const action = d.action as string;
    const symbol = d.symbol as string;

    if (action === 'buy' && (d.quantity as number) > 0) {
      const qty = Math.floor(d.quantity as number);
      try {
        const orderRes = await fetch(`${base}/v2/orders`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ symbol, qty: qty.toString(), side: 'buy', type: 'market', time_in_force: 'day' }),
        });
        const order = await orderRes.json() as { id: string; status: string; reject_reason?: string };
        if (order.status === 'rejected') { console.log(`[TRADE] Rejected: ${order.reject_reason}`); continue; }

        await env.DB.prepare(
          `INSERT INTO elle_trades (id, symbol, action, quantity, entry_price, reasoning, what_she_is_testing, confidence, expected_catalyst, expected_timeframe, broker_order_id, status)
           VALUES (?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
        ).bind(
          generateId(), symbol, qty,
          d.entry_price || 0, d.reasoning, d.what_you_are_testing,
          d.confidence || 0.5, d.expected_catalyst, d.expected_timeframe,
          order.id,
        ).run().catch(() => {});

        console.log(`[TRADE] BUY ${qty} ${symbol}: ${(d.reasoning as string).slice(0, 80)}`);
      } catch (e) { console.error(`[TRADE] Order failed: ${(e as Error).message}`); }
    }

    if (action === 'sell') {
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
      } catch (e) { console.error(`[EXIT] Failed: ${(e as Error).message}`); }
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
    1500, env
  ).catch(() => null);

  if (!result) return;

  try {
    const entry = JSON.parse(result.content.replace(/```json|```/g, '').trim());
    await env.DB.prepare(
      `INSERT INTO elle_trading_journal (id, journal_date, ending_value, trades_today, what_happened, what_she_learned, what_she_got_wrong, philosophical_insight, hypothesis_for_tomorrow)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(journal_date) DO UPDATE SET
         what_happened=excluded.what_happened,
         what_she_learned=excluded.what_she_learned,
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