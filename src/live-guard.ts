// ============================================================
// LIVE-TRADING GUARD — src/live-guard.ts
//
// Real-money trading must be armed EXPLICITLY, never implied by a URL.
// Before this module, the ONLY thing keeping the autonomous trading cron
// and the chat-reachable trade tools on paper money was ALPACA_BASE_URL
// happening to default to the paper endpoint — repointing that one var at
// api.alpaca.markets silently armed live orders with no second control.
//
// This is the single choke point both execution paths resolve their base
// URL through (trading.ts alpacaBase, router.ts alpacaOrder). The rule,
// and it FAILS CLOSED:
//
//   • paper endpoint (or nothing configured)  → allowed, always.
//   • anything else                           → allowed ONLY when
//     ELLE_LIVE_TRADING is exactly 'on'; otherwise it THROWS, loudly,
//     naming both vars — so a live URL without deliberate arming stops
//     every Alpaca call rather than quietly trading real money.
//
// 'on' is exact and case-sensitive: 'true', '1', 'ON', 'yes' do NOT arm.
// A guard you can arm by accident is not a guard.
// ============================================================

export const ALPACA_PAPER_BASE = 'https://paper-api.alpaca.markets';

export interface LiveGuardEnv {
  ALPACA_BASE_URL?: string;
  ELLE_LIVE_TRADING?: string;
}

export function liveTradingArmed(env: LiveGuardEnv): boolean {
  return env.ELLE_LIVE_TRADING === 'on';
}

export function resolveAlpacaBase(env: LiveGuardEnv): string {
  const base = (env.ALPACA_BASE_URL || ALPACA_PAPER_BASE).trim().replace(/\/+$/, '');
  if (base === ALPACA_PAPER_BASE) return base;
  if (!liveTradingArmed(env)) {
    throw new Error(
      `LIVE TRADING BLOCKED: ALPACA_BASE_URL is "${base}" (not the paper endpoint) ` +
      `but ELLE_LIVE_TRADING is not 'on'. Real-money trading requires BOTH set ` +
      `deliberately: point ALPACA_BASE_URL back at ${ALPACA_PAPER_BASE}, or arm live ` +
      `trading explicitly with \`wrangler secret put ELLE_LIVE_TRADING\` = on.`
    );
  }
  return base;
}
