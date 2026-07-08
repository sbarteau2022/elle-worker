// ============================================================
// ELLE — options contract resolution · src/alpaca-options.ts
//
// She reasons about options in human terms (underlying, put or call, a
// target strike, an expiration date) — trusting an LLM to hand-construct a
// raw OCC symbol ("AAPL240119P00170000") is a good way to place an order on
// the wrong contract. This resolves her terms against Alpaca's real,
// currently-listed contracts (GET /v2/options/contracts) and picks the one
// whose strike is closest to what she asked for, returning the real
// tradeable OCC symbol. trading.ts places the order; this module only
// resolves what to place it on.
// ============================================================

export interface ResolvedContract {
  symbol: string;            // the real OCC symbol to trade
  strike_price: number;
  expiration_date: string;   // YYYY-MM-DD, as Alpaca returned it
  type: 'call' | 'put';
  underlying_symbol: string;
}

export interface AlpacaContract {
  symbol: string;
  strike_price: string;
  expiration_date: string;
  type?: string;
  status?: string;
}

// Pure — the actual "which contract did she mean" decision, unit-testable
// without a network call.
export function pickClosestStrike(contracts: AlpacaContract[], targetStrike: number): AlpacaContract | null {
  if (!contracts.length) return null;
  return contracts.reduce((best, c) => {
    const d = Math.abs(parseFloat(c.strike_price) - targetStrike);
    const bestD = Math.abs(parseFloat(best.strike_price) - targetStrike);
    return d < bestD ? c : best;
  });
}

export interface ResolveOptionArgs {
  underlying: string;
  right: 'call' | 'put';
  expiration: string;    // YYYY-MM-DD
  targetStrike: number;
}

export async function resolveOptionContract(
  alpacaBase: string,
  headers: Record<string, string>,
  opts: ResolveOptionArgs,
): Promise<{ contract: ResolvedContract } | { error: string }> {
  const underlying = String(opts.underlying || '').toUpperCase().trim();
  if (!underlying) return { error: 'resolveOptionContract: underlying required' };
  if (opts.right !== 'call' && opts.right !== 'put') {
    return { error: `resolveOptionContract: right must be "call" or "put", got "${opts.right}"` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(opts.expiration || ''))) {
    return { error: `resolveOptionContract: expiration must be YYYY-MM-DD, got "${opts.expiration}"` };
  }
  if (!(Number(opts.targetStrike) > 0)) {
    return { error: 'resolveOptionContract: a positive targetStrike is required' };
  }

  const url = `${alpacaBase}/v2/options/contracts?underlying_symbols=${encodeURIComponent(underlying)}` +
    `&expiration_date=${opts.expiration}&type=${opts.right}&status=active&limit=100`;
  let data: { option_contracts?: AlpacaContract[] };
  try {
    const res = await fetch(url, { headers });
    data = await res.json();
  } catch (e) {
    return { error: `resolveOptionContract: contracts lookup failed — ${e instanceof Error ? e.message : String(e)}` };
  }

  const picked = pickClosestStrike(data.option_contracts || [], Number(opts.targetStrike));
  if (!picked) {
    return { error: `resolveOptionContract: no listed ${opts.right} contracts for ${underlying} expiring ${opts.expiration}` };
  }

  return {
    contract: {
      symbol: picked.symbol,
      strike_price: parseFloat(picked.strike_price),
      expiration_date: picked.expiration_date,
      type: opts.right,
      underlying_symbol: underlying,
    },
  };
}
