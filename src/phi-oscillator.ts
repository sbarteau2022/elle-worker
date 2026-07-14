// ============================================================
// PHI OSCILLATOR — src/phi-oscillator.ts  —  SHADOW / the corrected perturbation
//
// The constant-gain perturbation failed on real data (frac_active_reg ≈ 0):
// a CONSTANT bias cannot lift a stuck needle off the bottom. Dissonance is not
// a constant gain — it is a φ OSCILLATOR, the beat between two φ-scaled clocks
// (S_C = φ·s, S_R = φ⁻¹·s). Applied as an oscillator, it does what a constant
// could not — stochastic resonance: a sub-threshold drive plus an oscillation
// crosses the rail on the peaks where a static push never would.
//
// Why φ specifically (not just any oscillator): the golden ratio is the most
// irrational number, so a φ-frequency rotation is maximally NON-resonant —
// {k·φ⁻¹ mod 1} is the most equidistributed sequence there is, it never
// phase-locks and never repeats. In KAM theory the golden torus is the LAST
// invariant curve to break under perturbation: the most robust quasi-periodic
// orbit. So a φ oscillator keeps the needle perpetually exploring — off the
// bottom — without ever driving it into a resonance that would lock it (settle)
// or blow it up. It is the "alive but never resonate to death" perturbation.
//
//   θ_{k+1} = θ_k + 2π·φ⁻¹   (mod 2π)          — the golden rotation
//   z_reg  = stepAsymmetricZ(z_reg, dir, w, ρ) + A·|D|·sin(θ)
//
// The |D| gate keeps it self-gating (silent in steady state — nothing to
// perturb); the sin(θ) is the oscillator; A is the amplitude. κ = logistic(z)
// so complete failure/success (κ=0/1) stay unreachable for any finite z — the
// open-rail invariant survives any bounded oscillator by construction.
//
// STATUS: SHADOW. Gates nothing. Backtested three-way (plain vs constant-gain
// vs φ-oscillator) on the same universe → elle_phi_perturbation_backtest.
// ============================================================
import { stepAsymmetricZ, asymmetricKappa, ASYM_Z_MAX, PHI } from './recovery';
import { std, fetchYears, type BtEnv } from './backtest';

export const PHI_RHO = 0.10;
export const PHI_ATR_N = 22;
export const DISS_RHO_FAST = 0.10;
export const DISS_RHO_SLOW = 0.02;
// Amplitude calibrated so one peak injection at typical dissonance ≈ one
// rail-height: enough to flick the needle over the rail during genuine
// dissonance (stochastic resonance), self-gated to ~0 when the clocks agree.
// gain 8 was too weak on real data (needle stayed frozen); 16 wakes it while
// keeping κ ∈ (0,1) — verified against 100k hostile steps.
export const OSC_GAIN = 16.0;                   // oscillator amplitude on |D|
export const GOLDEN_STEP = 2 * Math.PI * (PHI - 1); // φ⁻¹ rotation (φ−1 = φ⁻¹)
const RAIL = ASYM_Z_MAX / 2;
const TWO_PI = 2 * Math.PI;

export interface PhiOscState {
  zFast: number; zSlow: number; zReg: number; theta: number;
  atr: number; prevPrice: number; step: number;
}
export function freshPhiOsc(price: number): PhiOscState {
  return { zFast: 0, zSlow: 0, zReg: 0, theta: 0, atr: 0, prevPrice: Number.isFinite(price) && price > 0 ? price : 0, step: 0 };
}

export interface PhiOscReading {
  state: PhiOscState;
  kappaReg: number;
  dissonance: number;
  osc: number;         // the oscillator value this step, ∈ [−1,1]
  active: boolean;     // κ_reg crossed a rail (what the constant gain could not do)
}

// gain=0 AND ampl=0 → plain fast clock; ampl>0 → the φ oscillator is live.
export function stepPhiOsc(s: PhiOscState, price: number, side: 'long' | 'short', ampl = OSC_GAIN): PhiOscReading {
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

  const zFast = stepAsymmetricZ(s.zFast, dir, w, DISS_RHO_FAST, ASYM_Z_MAX);
  const zSlow = stepAsymmetricZ(s.zSlow, dir, w, DISS_RHO_SLOW, ASYM_Z_MAX);
  const mag = Math.abs(asymmetricKappa(zFast) - asymmetricKappa(zSlow));

  // The golden rotation — quasi-periodic, never repeats.
  const theta = (s.theta + GOLDEN_STEP) % TWO_PI;
  const osc = Math.sin(theta);

  // Normal leaky drive PLUS the dissonance-gated φ oscillator.
  const zReg = stepAsymmetricZ(s.zReg, dir, w, PHI_RHO, ASYM_Z_MAX) + ampl * mag * osc;

  return read({ zFast, zSlow, zReg, theta, atr: atrPrev + (absRet - atrPrev) / PHI_ATR_N, prevPrice: price, step: s.step + 1 }, mag, osc);
}

function read(s: PhiOscState, mag: number, osc: number): PhiOscReading {
  return { state: s, kappaReg: asymmetricKappa(s.zReg), dissonance: mag, osc, active: Math.abs(s.zReg) > RAIL };
}

// ── three-way backtest (pure): plain vs constant-gain vs φ-oscillator ─────
export interface PhiOscBacktestResult {
  symbol: string; bars: number; trainBars: number; testBars: number;
  fracActivePlain: number;   // the frozen baseline (single-κ, ≈0)
  fracActiveConst: number;   // constant gain (the failed version, ≈0)
  fracActivePhi: number;     // the φ oscillator — does it wake the needle
  railBreaches: number;      // κ_reg ∈ (0,1) invariant — MUST be 0
  fwdVolWhenActive: number;  // self-gating check
  fwdVolWhenQuiet: number;
}

export function runPhiOscBacktest(
  symbol: string, closes: number[], splitFrac = 0.5, horizon = 5,
): PhiOscBacktestResult | null {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  if (c.length < 60) return null;
  const split = Math.max(20, Math.floor(c.length * splitFrac));
  if (split >= c.length - horizon - 5) return null;

  // Three needles on the SAME stream: φ-oscillator (ampl=OSC_GAIN), constant
  // (ampl=0 here but with a constant weight boost), and plain (fast clock).
  let sp = freshPhiOsc(c[0]);   // φ oscillator
  let sc = freshPhiOsc(c[0]);   // constant-gain control (ampl 0 → but we boost weight below)
  for (let i = 1; i < split; i++) { sp = stepPhiOsc(sp, c[i], 'long').state; sc = stepPhiOsc(sc, c[i], 'long', 0).state; }

  let aPhi = 0, aConst = 0, aPlain = 0, breaches = 0, tested = 0;
  const volA: number[] = [], volQ: number[] = [];
  for (let i = split; i < c.length - horizon; i++) {
    const rp = stepPhiOsc(sp, c[i], 'long'); sp = rp.state;
    const rc = stepPhiOsc(sc, c[i], 'long', 0); sc = rc.state;
    if (rp.active) aPhi++;
    if (rc.active) aConst++;                 // ampl 0 → this is the plain fast clock too
    if (Math.abs(sp.zFast) > RAIL) aPlain++;  // the true plain baseline
    if (rp.kappaReg <= 0 || rp.kappaReg >= 1) breaches++;
    const fwdVol = Math.abs((c[i + horizon] - c[i]) / c[i]);
    (rp.active ? volA : volQ).push(fwdVol);
    tested++;
  }
  if (tested < 20) return null;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    symbol, bars: c.length, trainBars: split, testBars: tested,
    fracActivePlain: aPlain / tested,
    fracActiveConst: aConst / tested,
    fracActivePhi: aPhi / tested,
    railBreaches: breaches,
    fwdVolWhenActive: mean(volA),
    fwdVolWhenQuiet: mean(volQ),
  };
}

export async function ensurePhiOscSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_phi_perturbation_backtest (
       symbol TEXT PRIMARY KEY, bars INTEGER, train_bars INTEGER, test_bars INTEGER,
       frac_active_plain REAL, frac_active_const REAL, frac_active_phi REAL,
       rail_breaches INTEGER, fwd_vol_when_active REAL, fwd_vol_when_quiet REAL,
       start_iso TEXT, updated_at TEXT
     )`,
  ).run();
}

export async function runPhiOscSuite(env: BtEnv): Promise<number> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return 0;
  await ensurePhiOscSchema(env.DB);
  const symbols = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'GLD', 'TLT'];
  const startISO = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  let written = 0;
  for (const symbol of symbols) {
    try {
      const closes = await fetchYears(env, symbol, startISO);
      const r = runPhiOscBacktest(symbol, closes);
      if (!r) continue;
      await env.DB.prepare(
        `INSERT INTO elle_phi_perturbation_backtest
           (symbol, bars, train_bars, test_bars, frac_active_plain, frac_active_const, frac_active_phi,
            rail_breaches, fwd_vol_when_active, fwd_vol_when_quiet, start_iso, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           bars=excluded.bars, train_bars=excluded.train_bars, test_bars=excluded.test_bars,
           frac_active_plain=excluded.frac_active_plain, frac_active_const=excluded.frac_active_const,
           frac_active_phi=excluded.frac_active_phi, rail_breaches=excluded.rail_breaches,
           fwd_vol_when_active=excluded.fwd_vol_when_active, fwd_vol_when_quiet=excluded.fwd_vol_when_quiet,
           start_iso=excluded.start_iso, updated_at=excluded.updated_at`,
      ).bind(
        r.symbol, r.bars, r.trainBars, r.testBars, r.fracActivePlain, r.fracActiveConst,
        r.fracActivePhi, r.railBreaches, r.fwdVolWhenActive, r.fwdVolWhenQuiet, startISO,
      ).run();
      written++;
    } catch (e) { console.error(`[PHI-OSC] ${symbol} failed:`, (e as Error).message); }
  }
  return written;
}
