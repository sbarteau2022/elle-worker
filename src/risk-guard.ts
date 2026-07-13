// ============================================================
// RISK GUARD — src/risk-guard.ts
//
// The execution path (trading.ts cron + router.ts alpacaOrder) places bare
// `market`/`day` orders with NO risk checks: no naked-option block, no notional
// cap, no stop. On the paper account that is harmless; the config carries a
// documented live path (`https://api.alpaca.markets`), and on live a single
// naked short option gapping through its strike overnight can exceed the whole
// account before the next 15-minute cron fires.
//
// These are PURE functions (no env, no I/O) so they are unit-testable in
// isolation and can be called from BOTH execution paths before an order is
// posted. They FAIL CLOSED: on missing/ambiguous inputs they reject, because a
// guard that opens on uncertainty is not a guard.
//
// Scope of v1: block NAKED SHORT OPTIONS (uncapped loss, no comparable margin
// protection) and cap per-order notional. Equity shorts are left to Alpaca's
// margin system and the caller's own short/cover logic — they are bounded very
// differently from a naked written option and are out of scope here.
// ============================================================

export interface HeldPosition {
  symbol: string;            // OCC option symbol OR equity ticker
  qty: number | string;     // signed or unsigned; we read magnitude + side
  side?: string;            // 'long' | 'short' (Alpaca) — optional
}

export interface OptionSellIntent {
  action: 'buy' | 'sell';
  right: 'call' | 'put' | null;
  qty: number;               // contracts
  underlying: string;        // e.g. 'NVDA'
  optionSymbol?: string;     // the resolved OCC symbol, when known
}

export interface GuardResult { ok: boolean; reason?: string; }

const OK: GuardResult = { ok: true };
const posQty = (p: HeldPosition): number => Math.abs(Number(p.qty) || 0);
const isLong = (p: HeldPosition): boolean =>
  (p.side ? p.side.toLowerCase() === 'long' : Number(p.qty) > 0);

// ── naked-option guard ───────────────────────────────────────
// A `sell` on an option WRITES/shorts it. It is permitted ONLY when it is
// covered, which here means one of:
//   (a) it reduces an existing LONG position in the exact same contract
//       (selling to close — bounded, the premium is already yours), or
//   (b) it is a covered CALL: the account holds >= qty*100 shares of the
//       underlying (each contract covers 100 shares).
// Everything else — naked calls, all written puts (cash-secured coverage can't
// be verified from positions alone) — is REJECTED. `buy` is always allowed
// (max loss on a long option is the premium paid).
export function guardOptionOrder(intent: OptionSellIntent, positions: HeldPosition[]): GuardResult {
  if (intent.action !== 'sell') return OK;                 // buying to open/close is bounded
  if (!intent.right) return { ok: false, reason: 'option order missing right (call/put) — cannot assess coverage' };
  const qty = Math.floor(Number(intent.qty) || 0);
  if (qty <= 0) return { ok: false, reason: 'option sell qty must be a positive integer' };
  const pos = positions || [];

  // (a) selling to close an existing long contract
  if (intent.optionSymbol) {
    const held = pos.find(p => p.symbol === intent.optionSymbol && isLong(p));
    if (held && posQty(held) >= qty) return OK;
  }

  // (b) covered call: long shares of the underlying cover the written calls
  if (intent.right === 'call') {
    const shares = pos.find(p => p.symbol === intent.underlying.toUpperCase() && isLong(p));
    if (shares && posQty(shares) >= qty * 100) return OK;
  }

  // otherwise it is naked
  return {
    ok: false,
    reason: intent.right === 'put'
      ? `blocked: writing ${qty} naked put(s) on ${intent.underlying} — uncapped assignment risk, cash-secured coverage cannot be verified from positions`
      : `blocked: writing ${qty} naked call(s) on ${intent.underlying} — uncapped loss; needs ${qty * 100} shares to be covered or an existing long contract to close`,
  };
}

// ── per-order notional cap ───────────────────────────────────
// Reject any single order whose notional exceeds `maxFrac` of account equity.
// A blunt but effective ceiling against a single fat-fingered / hallucinated
// quantity taking the whole book. Fails closed if equity is unknown.
export function guardNotional(orderNotional: number, equity: number, maxFrac = 0.25): GuardResult {
  const n = Number(orderNotional), e = Number(equity);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'order notional unknown — refusing to size blind' };
  if (!Number.isFinite(e) || e <= 0) return { ok: false, reason: 'account equity unknown — refusing to size blind' };
  const frac = n / e;
  return frac <= maxFrac
    ? OK
    : { ok: false, reason: `blocked: order notional $${n.toFixed(0)} is ${(frac * 100).toFixed(0)}% of equity (cap ${(maxFrac * 100).toFixed(0)}%)` };
}
