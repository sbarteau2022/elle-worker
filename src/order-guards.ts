// ============================================================
// ORDER GUARDS — src/order-guards.ts
//
// Env-aware sizing shared by BOTH execution paths (the trading.ts cron and
// router.ts alpacaOrder). risk-guard.ts holds the pure verdict functions;
// this module turns them into an enforced buy-in ceiling: every opening
// order is priced, compared against account equity, and cut down to the cap
// instead of going out oversized. The cap is deliberately small — the point
// is many small diversified positions, not a few account-sized swings.
//
// ELLE_MAX_ORDER_FRAC overrides the default (fraction of equity per order,
// e.g. "0.05"). Values outside (0, 0.25] fall back to the default — the cap
// can be tightened by config but never opened past risk-guard's 25% ceiling.
// ============================================================

import { guardNotional } from './risk-guard';

export const DEFAULT_MAX_ORDER_FRAC = 0.10;
const ALPACA_DATA = 'https://data.alpaca.markets';

export interface SizingEnv { ELLE_MAX_ORDER_FRAC?: string }

export function maxOrderFrac(env: SizingEnv): number {
  const raw = Number(env.ELLE_MAX_ORDER_FRAC);
  return Number.isFinite(raw) && raw > 0 && raw <= 0.25 ? raw : DEFAULT_MAX_ORDER_FRAC;
}

export interface SizedOrder {
  qty: number;        // the quantity that may actually go out (0 = don't place)
  downsized: boolean; // true when qty was reduced to fit the cap
  reason?: string;    // human-readable note whenever qty !== requested
}

// Fit a requested quantity under the per-order notional cap. Fails closed:
// unknown price or equity sizes to zero, because a cap that opens on missing
// data is not a cap. Never sizes UP — a request already under the cap passes
// through untouched.
export function sizeWithinCap(qty: number, unitPrice: number, equity: number, maxFrac: number): SizedOrder {
  const q = Math.floor(Number(qty) || 0);
  if (q <= 0) return { qty: 0, downsized: false, reason: 'qty must be a positive integer' };
  const g = guardNotional(q * unitPrice, equity, maxFrac);
  if (g.ok) return { qty: q, downsized: false };
  if (!(Number(unitPrice) > 0) || !(Number(equity) > 0)) return { qty: 0, downsized: true, reason: g.reason };
  const fit = Math.floor((equity * maxFrac) / unitPrice);
  if (fit < 1) {
    return { qty: 0, downsized: true, reason: `even 1 unit @ $${unitPrice.toFixed(2)} exceeds the ${(maxFrac * 100).toFixed(0)}% per-order cap on $${equity.toFixed(0)} equity` };
  }
  return { qty: fit, downsized: true, reason: `downsized ${q} → ${fit} to fit the ${(maxFrac * 100).toFixed(0)}% per-order cap ($${(equity * maxFrac).toFixed(0)} on $${equity.toFixed(0)} equity)` };
}

// Latest trade price for an equity, from the data API (same for paper/live).
// Null on any failure — callers fail closed via sizeWithinCap.
export async function latestEquityPrice(headers: Record<string, string>, symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${ALPACA_DATA}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`, { headers });
    if (!res.ok) return null;
    const data = await res.json() as { trade?: { p?: number } };
    const p = Number(data.trade?.p);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

// Latest trade price for an option contract (per share; one contract is
// 100 shares — callers multiply). Null on any failure.
export async function latestOptionMark(headers: Record<string, string>, occSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${ALPACA_DATA}/v1beta1/options/trades/latest?symbols=${encodeURIComponent(occSymbol)}`, { headers });
    if (!res.ok) return null;
    const data = await res.json() as { trades?: Record<string, { p?: number }> };
    const p = Number(data.trades?.[occSymbol]?.p);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}
