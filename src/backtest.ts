// ============================================================
// κ BACKTEST — src/backtest.ts  —  SHADOW / the predictive-value test
//
// The replay pinned κ at 0.5: it cold-started every regulator at neutral on a
// price-matched bar with 6-8 bars to stand on. This answers the real question
// the way it should be asked — train/test on YEARS of Alpaca daily data:
//
//   1. WARM the regulator on the first half of each series (it "stands on"
//      real history — κ enters the test half LIVE, with an established vol
//      scale, not forced to 0.5).
//   2. On the second half, make it throw predictions at every bar and measure
//      whether κ "fluxes like the market" — and, crucially, whether the flux
//      LEADS the market or only LAGS it.
//
// It steps the SAME observeCycle the live conviction channel uses (conviction.ts)
// — this is the live instrument on real history, not a re-implementation.
//
// PRE-REGISTERED (before running), splitting the one phrase into three falsifiable claims:
//   PT-BT1  κ FLUXES: on the warmed test half, std(κ) ≫ 0 and it visits both
//           the strained and charged sides — the "pinned at 0.5" artifact is
//           an artifact of the cold short window, not the instrument.
//   PT-BT2  κ predicts forward VOLATILITY: strain magnitude (0.5−κ)+ correlates
//           POSITIVELY with |forward return| — vol clusters, and a vol-derived
//           state should see that. Prior: YES.
//   PT-BT3  κ does NOT predict forward DIRECTION: (κ−0.5) has ~0 correlation
//           with signed forward return. Prior: NO — κ is a drawdown-shaper,
//           it reacts to realized vol, it does not forecast returns. The whole
//           trading arc says so; this pins it or overturns it on out-of-sample data.
//   (Contemporaneous corr(κ−0.5, trailing return) is reported too — expected
//    strongly POSITIVE, the sanity check that κ tracks what just happened.)
//
// STATUS: SHADOW. Gates nothing. Writes elle_kappa_backtest for retrieval.
// ============================================================
import { freshState, observeCycle } from './conviction';

// ── pure statistics ──────────────────────────────────────────
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let cxy = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cxy += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return 0;
  return cxy / Math.sqrt(vx * vy);
}

export function std(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / n);
}

// ── the backtest, pure ───────────────────────────────────────
export interface BacktestResult {
  symbol: string;
  bars: number;
  trainBars: number;
  testBars: number;
  horizon: number;
  kappaEnterTest: number;   // κ AFTER warming — the "stood-on" value, not 0.5
  kappaStdTest: number;     // PT-BT1: does it flux
  fracStrained: number;
  fracCharged: number;
  corrContemporaneous: number; // corr(κ−0.5, trailing return) — expect +
  corrLeadDirection: number;   // PT-BT3: corr(κ−0.5, forward return) — expect ~0
  corrLeadVolatility: number;  // PT-BT2: corr((0.5−κ)+, |forward return|) — expect +
}

export function runKappaBacktest(
  symbol: string, closes: number[], splitFrac = 0.5, horizon = 5,
): BacktestResult | null {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  if (c.length < 60) return null; // too short to warm and test meaningfully
  const split = Math.max(20, Math.floor(c.length * splitFrac));
  if (split >= c.length - horizon - 5) return null;

  // Warm on [0, split): the regulator stands on real history.
  let state = freshState(symbol, c[0], 1);
  for (let i = 1; i < split; i++) state = observeCycle(state, c[i], 'long').state;
  const kappaEnterTest = observeCycle(state, c[split], 'long').kappa; // κ as it crosses into test (not 0.5)

  // Test on [split, n−horizon): predict at each bar, measure forward.
  const kappas: number[] = [];
  const kMinusHalf: number[] = [];
  const strainMag: number[] = [];
  const trailRet: number[] = [];
  const fwdRet: number[] = [];
  const fwdAbs: number[] = [];
  let strained = 0, charged = 0, tested = 0;

  for (let i = split; i < c.length - horizon; i++) {
    const r = observeCycle(state, c[i], 'long');
    state = r.state;
    const k = r.kappa;
    kappas.push(k);
    kMinusHalf.push(k - 0.5);
    strainMag.push(Math.max(0, 0.5 - k));
    trailRet.push((c[i] - c[i - 1]) / c[i - 1]);
    fwdRet.push((c[i + horizon] - c[i]) / c[i]);
    fwdAbs.push(Math.abs((c[i + horizon] - c[i]) / c[i]));
    if (r.status === 'strained') strained++;
    else if (r.status === 'charged') charged++;
    tested++;
  }
  if (tested < 20) return null;

  return {
    symbol,
    bars: c.length, trainBars: split, testBars: tested, horizon,
    kappaEnterTest,
    kappaStdTest: std(kappas),
    fracStrained: strained / tested,
    fracCharged: charged / tested,
    corrContemporaneous: pearson(kMinusHalf, trailRet),
    corrLeadDirection: pearson(kMinusHalf, fwdRet),
    corrLeadVolatility: pearson(strainMag, fwdAbs),
  };
}

// ── Alpaca daily bars (self-contained; the worker has the keys) ──
interface BtEnv {
  ALPACA_API_KEY?: string;
  ALPACA_SECRET_KEY?: string;
  DB: D1Database;
}
const alpacaHeaders = (env: BtEnv) => ({
  'APCA-API-KEY-ID': env.ALPACA_API_KEY || '',
  'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY || '',
});

async function fetchYears(env: BtEnv, symbol: string, startISO: string): Promise<number[]> {
  const out: number[] = [];
  let pageToken = '';
  for (let guard = 0; guard < 20; guard++) {
    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${encodeURIComponent(startISO)}&limit=10000&adjustment=all&feed=iex${pageToken ? `&page_token=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: alpacaHeaders(env) });
    if (!res.ok) break;
    const data = await res.json() as { bars?: Array<{ c: number }>; next_page_token?: string | null };
    for (const b of data.bars || []) out.push(b.c);
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return out;
}

export async function ensureBacktestSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_kappa_backtest (
       symbol TEXT PRIMARY KEY, bars INTEGER, train_bars INTEGER, test_bars INTEGER,
       horizon INTEGER, kappa_enter_test REAL, kappa_std_test REAL,
       frac_strained REAL, frac_charged REAL,
       corr_contemporaneous REAL, corr_lead_direction REAL, corr_lead_volatility REAL,
       start_iso TEXT, updated_at TEXT
     )`,
  ).run();
}

// The orchestrator: pull ~6 years of daily bars for a liquid set, run the
// train/test backtest, persist. Best-effort; one-shot from the cron.
export async function runKappaBacktestSuite(env: BtEnv): Promise<number> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return 0;
  await ensureBacktestSchema(env.DB);
  const symbols = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'GLD', 'TLT'];
  // ~6 years back. Timestamp passed in ISO; Date is available in worker runtime.
  const startISO = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  let written = 0;

  for (const symbol of symbols) {
    try {
      const closes = await fetchYears(env, symbol, startISO);
      const r = runKappaBacktest(symbol, closes, 0.5, 5);
      if (!r) continue;
      await env.DB.prepare(
        `INSERT INTO elle_kappa_backtest
           (symbol, bars, train_bars, test_bars, horizon, kappa_enter_test, kappa_std_test,
            frac_strained, frac_charged, corr_contemporaneous, corr_lead_direction, corr_lead_volatility,
            start_iso, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           bars=excluded.bars, train_bars=excluded.train_bars, test_bars=excluded.test_bars,
           horizon=excluded.horizon, kappa_enter_test=excluded.kappa_enter_test,
           kappa_std_test=excluded.kappa_std_test, frac_strained=excluded.frac_strained,
           frac_charged=excluded.frac_charged, corr_contemporaneous=excluded.corr_contemporaneous,
           corr_lead_direction=excluded.corr_lead_direction, corr_lead_volatility=excluded.corr_lead_volatility,
           start_iso=excluded.start_iso, updated_at=excluded.updated_at`,
      ).bind(
        r.symbol, r.bars, r.trainBars, r.testBars, r.horizon, r.kappaEnterTest, r.kappaStdTest,
        r.fracStrained, r.fracCharged, r.corrContemporaneous, r.corrLeadDirection, r.corrLeadVolatility,
        startISO,
      ).run();
      written++;
    } catch (e) { console.error(`[BACKTEST] ${symbol} failed:`, (e as Error).message); }
  }
  return written;
}
