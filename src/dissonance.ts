// ============================================================
// DISSONANCE — src/dissonance.ts  —  SHADOW / the actionable-signal fix
//
// The κ backtest exposed the flaw: a single regulator measures a stream
// against its OWN volatility (w = |ret|/2·ATR), so every bar is "normal-sized
// against itself." It re-scales to whatever regime it is in and can never be
// surprised — frac_strained = frac_charged = 0 on all seven symbols across
// three years. A self-referential signal cannot cross a rail.
//
// Dissonance is the fix: the signal comes from two views that DISAGREE, not
// one stream measured against itself. This is the same primitive the spine's
// dissent and the council reach for — signal lives where independent views
// split. The instance already latent in the architecture is THE TWO CLOCKS:
//
//   · the FAST valve  (ρ=0.10 — the smoke alarm, PT-II's detection clock)
//   · the SLOW historian (ρ=0.02 — the leak-rate floor)
//
// watching the SAME stream. Both equilibrate to the same level under steady
// state (z* = −w·zMax, independent of ρ — proven in the test), so when the
// market is calm OR steadily trending they CONVERGE and agree → no signal.
// During a regime CHANGE the fast clock reacts and the slow one lags, so they
// diverge. That gap — D = κ_fast − κ_slow — is the dissonance: silent during
// agreement, loud during change. It is the beat frequency between two
// φ-regulators, and it fires exactly where the single self-normalized κ can't.
//
// D is a TRANSITION detector (it responds to the change of regime, not its
// level) — orthogonal to the single-κ level, which is the point.
//
// STATUS: SHADOW. Gates nothing. Backtested against the same universe as the
// single-κ run; writes elle_dissonance_backtest for the comparison.
// ============================================================
import { stepAsymmetricZ, asymmetricKappa, ASYM_Z_MAX } from './recovery';
import { pearson, std, fetchYears, type BtEnv } from './backtest';

export const DISS_RHO_FAST = 0.10;   // the smoke alarm
export const DISS_RHO_SLOW = 0.02;   // the historian — the leak-rate floor
export const DISS_ATR_N = 22;
// The two clocks disagreeing by more than this many conviction-points counts
// as "fired" — a genuine dissonance event, the thing single-κ never produced.
export const DISS_FIRE = 0.05;

export interface DissonanceState {
  zFast: number; zSlow: number; atr: number; prevPrice: number; step: number;
}
export function freshDissonance(price: number): DissonanceState {
  return { zFast: 0, zSlow: 0, atr: 0, prevPrice: Number.isFinite(price) && price > 0 ? price : 0, step: 0 };
}

export interface DissonanceReading {
  state: DissonanceState;
  kappaFast: number;
  kappaSlow: number;
  d: number;    // signed: fast − slow (negative = fast strained below slow first — early warning)
  mag: number;  // |d| — the dissonance magnitude
  fired: boolean;
}

export function readDissonance(s: DissonanceState): DissonanceReading {
  const kappaFast = asymmetricKappa(s.zFast);
  const kappaSlow = asymmetricKappa(s.zSlow);
  const d = kappaFast - kappaSlow;
  return { state: s, kappaFast, kappaSlow, d, mag: Math.abs(d), fired: Math.abs(d) >= DISS_FIRE };
}

// One observation steps BOTH clocks off the SAME (dir, weight) — the identical
// perturbation form the conviction channel uses. The only difference between
// the clocks is ρ, so any divergence is pure horizon disagreement.
export function stepDissonance(s: DissonanceState, price: number, side: 'long' | 'short'): DissonanceReading {
  if (!Number.isFinite(price) || price <= 0 || s.prevPrice <= 0) {
    return readDissonance({ ...s, prevPrice: Number.isFinite(price) && price > 0 ? price : s.prevPrice });
  }
  const ret = (price - s.prevPrice) / s.prevPrice;
  const absRet = Math.abs(ret);
  const atrPrev = s.step === 0 || s.atr === 0 ? absRet : s.atr;
  const w = atrPrev > 0 ? Math.min(1, absRet / (2 * atrPrev)) : 0;
  const adverse = side === 'short' ? ret > 0 : ret < 0;
  const dir = adverse ? 'strain' as const : 'recover' as const;
  const zFast = stepAsymmetricZ(s.zFast, dir, w, DISS_RHO_FAST, ASYM_Z_MAX);
  const zSlow = stepAsymmetricZ(s.zSlow, dir, w, DISS_RHO_SLOW, ASYM_Z_MAX);
  const atr = atrPrev + (absRet - atrPrev) / DISS_ATR_N;
  return readDissonance({ zFast, zSlow, atr, prevPrice: price, step: s.step + 1 });
}

// ── the backtest, pure ───────────────────────────────────────
export interface DissonanceBacktestResult {
  symbol: string;
  bars: number;
  trainBars: number;
  testBars: number;
  horizon: number;
  dissMagStd: number;      // does it move
  dissMagMax: number;      // how loud does it get
  fracFired: number;       // PT-D1: does it FIRE where single-κ never did (>0 is the win)
  corrDissLeadVol: number; // PT-D2: does |D| lead |forward return|
  corrDissLeadDir: number; // PT-D3: does signed D lead direction (expect ~0)
}

export function runDissonanceBacktest(
  symbol: string, closes: number[], splitFrac = 0.5, horizon = 5,
): DissonanceBacktestResult | null {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  if (c.length < 60) return null;
  const split = Math.max(20, Math.floor(c.length * splitFrac));
  if (split >= c.length - horizon - 5) return null;

  // Warm both clocks on [0, split).
  let s = freshDissonance(c[0]);
  for (let i = 1; i < split; i++) s = stepDissonance(s, c[i], 'long').state;

  const mag: number[] = [], dSigned: number[] = [], fwdAbs: number[] = [], fwdRet: number[] = [];
  let fired = 0, tested = 0, magMax = 0;
  for (let i = split; i < c.length - horizon; i++) {
    const r = stepDissonance(s, c[i], 'long');
    s = r.state;
    mag.push(r.mag); dSigned.push(r.d);
    fwdAbs.push(Math.abs((c[i + horizon] - c[i]) / c[i]));
    fwdRet.push((c[i + horizon] - c[i]) / c[i]);
    if (r.fired) fired++;
    if (r.mag > magMax) magMax = r.mag;
    tested++;
  }
  if (tested < 20) return null;

  return {
    symbol, bars: c.length, trainBars: split, testBars: tested, horizon,
    dissMagStd: std(mag),
    dissMagMax: magMax,
    fracFired: fired / tested,
    corrDissLeadVol: pearson(mag, fwdAbs),
    corrDissLeadDir: pearson(dSigned, fwdRet),
  };
}

// ── persistence + suite (reuses the backtest's Alpaca fetch) ──
export async function ensureDissonanceSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_dissonance_backtest (
       symbol TEXT PRIMARY KEY, bars INTEGER, train_bars INTEGER, test_bars INTEGER,
       horizon INTEGER, diss_mag_std REAL, diss_mag_max REAL, frac_fired REAL,
       corr_diss_lead_vol REAL, corr_diss_lead_dir REAL, start_iso TEXT, updated_at TEXT
     )`,
  ).run();
}

export async function runDissonanceBacktestSuite(env: BtEnv): Promise<number> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return 0;
  await ensureDissonanceSchema(env.DB);
  const symbols = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'GLD', 'TLT'];
  const startISO = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  let written = 0;
  for (const symbol of symbols) {
    try {
      const closes = await fetchYears(env, symbol, startISO);
      const r = runDissonanceBacktest(symbol, closes, 0.5, 5);
      if (!r) continue;
      await env.DB.prepare(
        `INSERT INTO elle_dissonance_backtest
           (symbol, bars, train_bars, test_bars, horizon, diss_mag_std, diss_mag_max, frac_fired,
            corr_diss_lead_vol, corr_diss_lead_dir, start_iso, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           bars=excluded.bars, train_bars=excluded.train_bars, test_bars=excluded.test_bars,
           horizon=excluded.horizon, diss_mag_std=excluded.diss_mag_std, diss_mag_max=excluded.diss_mag_max,
           frac_fired=excluded.frac_fired, corr_diss_lead_vol=excluded.corr_diss_lead_vol,
           corr_diss_lead_dir=excluded.corr_diss_lead_dir, start_iso=excluded.start_iso, updated_at=excluded.updated_at`,
      ).bind(
        r.symbol, r.bars, r.trainBars, r.testBars, r.horizon, r.dissMagStd, r.dissMagMax,
        r.fracFired, r.corrDissLeadVol, r.corrDissLeadDir, startISO,
      ).run();
      written++;
    } catch (e) { console.error(`[DISSONANCE] ${symbol} failed:`, (e as Error).message); }
  }
  return written;
}
