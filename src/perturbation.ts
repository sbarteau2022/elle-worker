// ============================================================
// PERTURBATION — src/perturbation.ts  —  SHADOW / dissonance as REGULATOR
//
// Correcting the frame: dissonance is not a forecaster, it is PERTURBATION.
// Its job is to REGULATE — to not let the needle settle on the bottom. The
// κ backtest showed the pathology: a single self-normalized regulator relaxes
// into a dead hover and NOTHING crosses its rail (frac_strained = 0 on all
// seven symbols, three years). A signal grading itself against its own scale
// sinks below its own noise floor and goes quiet.
//
// Dissonance (the two-clock beat, |D| = |κ_fast − κ_slow|) is the perturbation
// that lifts the sub-threshold signal back over the rail — STOCHASTIC
// RESONANCE. It is wired BACK INTO the regulator as extra drive:
//
//   w_eff = min(1, w + G·|D|)
//   z_reg = stepAsymmetricZ(z_reg, dir, w_eff, ρ)
//
// Two properties make it a regulator and not just noise:
//   · SELF-GATING — |D| is ~0 in steady state (calm OR steady trend: the
//     clocks agree), so the perturbation only fires during a TRANSITION, which
//     is exactly when the needle must not be allowed to settle. Steady-state
//     rest is left alone; a regime change is kept alive.
//   · OPEN RAILS PRESERVED — w_eff is clamped to 1, so the same leaky-integrator
//     proof still bounds |z_reg| < Z strictly. The perturbation keeps the needle
//     OFF the bottom; it never slams it into the top. Complete failure and
//     complete success remain structurally unreachable — the design constraint
//     ("never let the loss function achieve complete failure or success") holds.
//
// STATUS: SHADOW. Gates nothing. Backtested against the same universe; the test
// that matters is not "does it predict" but "does the needle stay alive and
// cross where the plain one froze, without breaking the open rails."
// ============================================================
import { stepAsymmetricZ, asymmetricKappa, ASYM_Z_MAX } from './recovery';
import { pearson, std, fetchYears, type BtEnv } from './backtest';

export const PERT_RHO = 0.10;        // the needle's clock (the fast valve)
export const PERT_ATR_N = 22;
export const DISS_RHO_FAST = 0.10;
export const DISS_RHO_SLOW = 0.02;
export const DISS_GAIN = 3.0;        // dissonance → extra drive (resonance gain)
const RAIL = ASYM_Z_MAX / 2;         // "crossed / active" = |z| past the strained/charged rail

export interface PerturbedState {
  zFast: number; zSlow: number; zReg: number; atr: number; prevPrice: number; step: number;
}
export function freshPerturbed(price: number): PerturbedState {
  return { zFast: 0, zSlow: 0, zReg: 0, atr: 0, prevPrice: Number.isFinite(price) && price > 0 ? price : 0, step: 0 };
}

export interface PerturbedReading {
  state: PerturbedState;
  kappaReg: number;    // the regulated needle
  kappaPlain: number;  // the un-perturbed fast clock, for the side-by-side
  dissonance: number;  // |D| — the perturbation magnitude this step
  wEff: number;        // the perturbed weight actually applied
  active: boolean;     // the regulated needle crossed a rail (the plain one couldn't)
  activePlain: boolean;// the plain needle crossed a rail
}

// gain is a parameter so a gain=0 control reproduces the plain fast clock exactly.
export function stepPerturbed(s: PerturbedState, price: number, side: 'long' | 'short', gain = DISS_GAIN): PerturbedReading {
  if (!Number.isFinite(price) || price <= 0 || s.prevPrice <= 0) {
    const st = { ...s, prevPrice: Number.isFinite(price) && price > 0 ? price : s.prevPrice };
    return read(st, 0, 0);
  }
  const ret = (price - s.prevPrice) / s.prevPrice;
  const absRet = Math.abs(ret);
  const atrPrev = s.step === 0 || s.atr === 0 ? absRet : s.atr;
  const w = atrPrev > 0 ? Math.min(1, absRet / (2 * atrPrev)) : 0;
  const adverse = side === 'short' ? ret > 0 : ret < 0;
  const dir = adverse ? 'strain' as const : 'recover' as const;

  // The two clocks (pure) → the dissonance perturbation.
  const zFast = stepAsymmetricZ(s.zFast, dir, w, DISS_RHO_FAST, ASYM_Z_MAX);
  const zSlow = stepAsymmetricZ(s.zSlow, dir, w, DISS_RHO_SLOW, ASYM_Z_MAX);
  const mag = Math.abs(asymmetricKappa(zFast) - asymmetricKappa(zSlow));

  // Dissonance lifts the drive — but only while the clocks disagree.
  const wEff = Math.min(1, w + gain * mag);
  const zReg = stepAsymmetricZ(s.zReg, dir, wEff, PERT_RHO, ASYM_Z_MAX);

  return read({ zFast, zSlow, zReg, atr: atrPrev + (absRet - atrPrev) / PERT_ATR_N, prevPrice: price, step: s.step + 1 }, mag, wEff);
}

function read(s: PerturbedState, mag: number, wEff: number): PerturbedReading {
  return {
    state: s,
    kappaReg: asymmetricKappa(s.zReg),
    kappaPlain: asymmetricKappa(s.zFast),
    dissonance: mag,
    wEff,
    active: Math.abs(s.zReg) > RAIL,
    activePlain: Math.abs(s.zFast) > RAIL,
  };
}

// ── the backtest, pure ───────────────────────────────────────
export interface PerturbationBacktestResult {
  symbol: string;
  bars: number; trainBars: number; testBars: number;
  fracActiveReg: number;    // PT-P1: the needle crosses (plain was ~0)
  fracActivePlain: number;  // the frozen baseline
  railBreaches: number;     // PT-P3: times κ_reg left the open rails — MUST be 0
  fwdVolWhenActive: number; // PT-P2: is activity self-gated to real regime
  fwdVolWhenQuiet: number;
}

export function runPerturbationBacktest(
  symbol: string, closes: number[], splitFrac = 0.5, horizon = 5,
): PerturbationBacktestResult | null {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  if (c.length < 60) return null;
  const split = Math.max(20, Math.floor(c.length * splitFrac));
  if (split >= c.length - horizon - 5) return null;

  let s = freshPerturbed(c[0]);
  for (let i = 1; i < split; i++) s = stepPerturbed(s, c[i], 'long').state;

  let activeReg = 0, activePlain = 0, breaches = 0, tested = 0;
  const volActive: number[] = [], volQuiet: number[] = [];
  for (let i = split; i < c.length - horizon; i++) {
    const r = stepPerturbed(s, c[i], 'long');
    s = r.state;
    if (r.active) activeReg++;
    if (r.activePlain) activePlain++;
    if (r.kappaReg <= 0 || r.kappaReg >= 1) breaches++; // open-rail invariant
    const fwdVol = Math.abs((c[i + horizon] - c[i]) / c[i]);
    (r.active ? volActive : volQuiet).push(fwdVol);
    tested++;
  }
  if (tested < 20) return null;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    symbol, bars: c.length, trainBars: split, testBars: tested,
    fracActiveReg: activeReg / tested,
    fracActivePlain: activePlain / tested,
    railBreaches: breaches,
    fwdVolWhenActive: mean(volActive),
    fwdVolWhenQuiet: mean(volQuiet),
  };
}

// ── persistence + suite ──────────────────────────────────────
export async function ensurePerturbationSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_perturbation_backtest (
       symbol TEXT PRIMARY KEY, bars INTEGER, train_bars INTEGER, test_bars INTEGER,
       frac_active_reg REAL, frac_active_plain REAL, rail_breaches INTEGER,
       fwd_vol_when_active REAL, fwd_vol_when_quiet REAL, start_iso TEXT, updated_at TEXT
     )`,
  ).run();
}

export async function runPerturbationBacktestSuite(env: BtEnv): Promise<number> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return 0;
  await ensurePerturbationSchema(env.DB);
  const symbols = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'GLD', 'TLT'];
  const startISO = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  let written = 0;
  for (const symbol of symbols) {
    try {
      const closes = await fetchYears(env, symbol, startISO);
      const r = runPerturbationBacktest(symbol, closes, 0.5, 5);
      if (!r) continue;
      await env.DB.prepare(
        `INSERT INTO elle_perturbation_backtest
           (symbol, bars, train_bars, test_bars, frac_active_reg, frac_active_plain, rail_breaches,
            fwd_vol_when_active, fwd_vol_when_quiet, start_iso, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           bars=excluded.bars, train_bars=excluded.train_bars, test_bars=excluded.test_bars,
           frac_active_reg=excluded.frac_active_reg, frac_active_plain=excluded.frac_active_plain,
           rail_breaches=excluded.rail_breaches, fwd_vol_when_active=excluded.fwd_vol_when_active,
           fwd_vol_when_quiet=excluded.fwd_vol_when_quiet, start_iso=excluded.start_iso, updated_at=excluded.updated_at`,
      ).bind(
        r.symbol, r.bars, r.trainBars, r.testBars, r.fracActiveReg, r.fracActivePlain,
        r.railBreaches, r.fwdVolWhenActive, r.fwdVolWhenQuiet, startISO,
      ).run();
      written++;
    } catch (e) { console.error(`[PERTURBATION] ${symbol} failed:`, (e as Error).message); }
  }
  return written;
}
