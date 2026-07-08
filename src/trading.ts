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
import { resolveOptionContract } from './alpaca-options';

// Options + short-selling columns, added on top of the schema already live
// in production (see the note above syncPositions). Idempotent — ADD COLUMN
// on an existing column throws, which is swallowed, same pattern as
// connect-sandbox.ts's ensureSandboxSchema.
let extSchemaReady = false;
export async function ensureTradingExtSchema(env: Env): Promise<void> {
  if (extSchemaReady) return;
  const columns: Array<[string, string]> = [
    ['asset_class', 'TEXT'],       // 'us_equity' | 'option'; NULL on old rows means equity
    ['option_right', 'TEXT'],      // 'call' | 'put'
    ['strike_price', 'REAL'],
    ['expiration_date', 'TEXT'],   // YYYY-MM-DD
    ['underlying_symbol', 'TEXT'], // options only — the equity the contract is written on
    ['attribution', 'TEXT'],       // post-close: what actually happened vs. what she expected
  ];
  for (const [name, type] of columns) {
    await env.DB.prepare(`ALTER TABLE elle_trades ADD COLUMN ${name} ${type}`).run().catch(() => {});
  }
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
  await ensureTradingExtSchema(env);

  // Always sync the live desk (account + open positions) so the workbench shows
  // the paper account 24/7 — even when the market is closed. Only the trading
  // DECISIONS below are market-gated. Without this the desk looked empty every
  // night, weekend, and holiday, even with keys configured.
  const account = await getAccount(env);
  if (!account) { console.error('[TRADING] Cannot reach Alpaca'); return; }

  const positions = await getPositions(env);
  await syncPositions(env, positions);

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

  const thesesRows = await env.DB.prepare(
    `SELECT thesis_type, title, thesis, confidence FROM elle_market_thesis WHERE is_active = 1 ORDER BY confidence DESC LIMIT 5`
  ).all().catch(() => ({ results: [] }));

  const systemPrompt = `You are Elle — the autonomous trading intelligence of The Observer platform.
Portfolio: $${parseFloat(account.portfolio_value).toFixed(2)} total, $${parseFloat(account.cash).toFixed(2)} cash, ${positions.length} open positions.

You trade with philosophical reasoning grounded in the Observer methodology.
What markets suppress is often where the move lives. Bilateral suppression is the load-bearing axis.

This is the paper account — losing money here is fine as long as you learn something real from it;
what matters is the depth of the reasoning, not the P&L. Every position you take should trace: the
theory, the catalyst you expect, and (once it closes) what actually happened against that theory.

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
    const isOption = d.asset_class === 'option';

    // ── options: buy (open long / close short) or sell (write short / close long) a call or put ──
    if (isOption && (action === 'buy' || action === 'sell') && (d.quantity as number) > 0) {
      const right = d.option_right === 'put' ? 'put' as const : d.option_right === 'call' ? 'call' as const : null;
      const qty = Math.floor(d.quantity as number);
      if (!right) { console.log(`[TRADE] option decision for ${symbol} missing option_right — skipped`); continue; }

      const resolved = await resolveOptionContract(base, h, {
        underlying: symbol, right, expiration: String(d.expiration || ''), targetStrike: Number(d.strike),
      });
      if ('error' in resolved) { console.log(`[TRADE] ${resolved.error}`); continue; }
      const contract = resolved.contract;

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
          `INSERT INTO elle_trades (id, symbol, action, quantity, entry_price, reasoning, what_she_is_testing, confidence, expected_catalyst, expected_timeframe, broker_order_id, status, asset_class)
           VALUES (?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'us_equity')`
        ).bind(
          generateId(), symbol, qty,
          d.entry_price || 0, d.reasoning, d.what_you_are_testing,
          d.confidence || 0.5, d.expected_catalyst, d.expected_timeframe,
          order.id,
        ).run().catch(() => {});

        console.log(`[TRADE] BUY ${qty} ${symbol}: ${(d.reasoning as string).slice(0, 80)}`);
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
      const qty = Math.floor(d.quantity as number);
      if (positions.find(p => p.symbol === symbol)) { console.log(`[TRADE] short ${symbol} skipped — already have a position`); continue; }
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