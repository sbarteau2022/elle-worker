// ============================================================
// REGIME ANALYSIS — src/regime.ts  —  SHADOW / the RIGHT experiments
//
// Not "did it predict volatility" (wrong yardstick). The signals are two
// different observables and the information lives in their INTERACTION:
//
//   κ level  = STATE       — where the system sits in its stability landscape
//                            (persistent, slow — the vol-leading regime variable)
//   dissonance = TRANSITION — the system is CHANGING (spiky, self-gating)
//
// κ is altitude; dissonance is acceleration. Neither replaces the other. So we
// run the experiments that separate them:
//
//   1. SNR per signal (r²/(1−r²) vs forward vol) + a confidence index. A signal
//      inside the SNR tolerance is trusted directly; below it, its contribution
//      is down-weighted by confidence — not discarded, indexed.
//   2. CONDITIONAL TRANSITION cells — Risk = f(κ, Δκ, D), not f(D):
//        A  κ high + D rising  → stable regime disturbed
//        B  κ low  + D rising  → already-unstable regime under more stress
//        C  κ low  + D falling → recovery
//        D  κ high + D falling → stable & calm
//      The same dissonance means different things by κ context. If B's forward
//      vol > A's, the interaction is real and D-alone is the wrong model.
//   3. LEAD-TIME distribution — when dissonance fires, forward vol at h ∈
//      {1,3,5,10,20}: where does the signal peak? That is the mechanism's
//      operating timescale (not a single correlation number).
//   4. RECOVERY clock — κ's mean-reversion half-life: how fast coherence
//      returns after a disturbance. The third clock, measured.
//
// STATUS: SHADOW. Gates nothing. Writes elle_regime_analysis.
// ============================================================
import { pearson, std, fetchYears, type BtEnv } from './backtest';
import { freshDissonance, stepDissonance, DISS_FIRE } from './dissonance';

export const SNR_TOLERANCE = 0.05; // r²/(1−r²) below this ⇒ confidence-index it down

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const snr = (r: number) => { const r2 = r * r; return r2 >= 1 ? Infinity : r2 / (1 - r2); };

// Confidence index: 1 when SNR ≥ tolerance (trust it), scaling to 0 as SNR → 0
// (index it down). This is the "tolerance window or confidence indexing" rule.
export function confidenceIndex(signalSnr: number, tol = SNR_TOLERANCE): number {
  if (!Number.isFinite(signalSnr)) return 1;
  return Math.min(1, signalSnr / tol);
}

// AR(1) half-life of a series in bars — the recovery timescale.
export function halfLife(xs: number[]): number {
  if (xs.length < 10) return 0;
  const x0 = xs.slice(0, -1), x1 = xs.slice(1);
  const phi = pearson(x0, x1);            // lag-1 autocorrelation
  if (phi <= 0 || phi >= 1) return Infinity; // no mean reversion detectable
  return Math.log(0.5) / Math.log(phi);
}

export interface RegimeCell { label: string; meanFwdVol: number; n: number; }
export interface RegimeResult {
  symbol: string;
  bars: number; testBars: number;
  snrKappa: number;        // state signal SNR vs forward vol
  snrDissonance: number;   // transition signal SNR vs forward vol
  confKappa: number;
  confDissonance: number;
  cells: RegimeCell[];     // A/B/C/D conditional transition analysis
  interactionReal: boolean;// cellB.vol > cellA.vol — κ context flips D's meaning
  leadRatios: { h: number; ratio: number }[]; // fired-vol / all-vol per horizon
  leadPeakH: number;       // horizon of max ratio — the operating timescale
  recoveryHalfLife: number;// κ mean-reversion half-life in bars
}

export function runRegimeAnalysis(
  symbol: string, closes: number[], splitFrac = 0.5, horizons = [1, 3, 5, 10, 20],
): RegimeResult | null {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  const maxH = Math.max(...horizons);
  if (c.length < 80) return null;
  const split = Math.max(30, Math.floor(c.length * splitFrac));
  if (split >= c.length - maxH - 5) return null;

  // Warm the two-clock stepper on the train half.
  let s = freshDissonance(c[0]);
  for (let i = 1; i < split; i++) s = stepDissonance(s, c[i], 'long').state;

  const kappa: number[] = [], D: number[] = [], fired: boolean[] = [];
  const idx: number[] = [];
  let prevK = 0.5, prevD = 0;
  const dKappa: number[] = [], dD: number[] = [];
  for (let i = split; i < c.length - maxH; i++) {
    const r = stepDissonance(s, c[i], 'long'); s = r.state;
    kappa.push(r.kappaFast); D.push(r.mag); fired.push(r.fired);
    dKappa.push(r.kappaFast - prevK); dD.push(r.mag - prevD);
    prevK = r.kappaFast; prevD = r.mag; idx.push(i);
  }
  const fwdVol = (i: number, h: number) => Math.abs((c[i + h] - c[i]) / c[i]);
  const fwd5 = idx.map(i => fwdVol(i, 5));

  // 1. SNR + confidence index.
  const snrKappa = snr(pearson(kappa, fwd5));
  const snrDiss = snr(pearson(D, fwd5));

  // 2. Conditional transition cells.
  const kMed = median(kappa);
  const cellsAcc: Record<string, number[]> = { A: [], B: [], C: [], D: [] };
  for (let t = 0; t < kappa.length; t++) {
    const hi = kappa[t] > kMed, rising = dD[t] > 0;
    const key = hi && rising ? 'A' : !hi && rising ? 'B' : !hi && !rising ? 'C' : 'D';
    cellsAcc[key].push(fwd5[t]);
  }
  const label: Record<string, string> = {
    A: 'κ-high·D-rising (stable disturbed)', B: 'κ-low·D-rising (unstable stressed)',
    C: 'κ-low·D-falling (recovery)', D: 'κ-high·D-falling (stable calm)',
  };
  const cells = Object.keys(cellsAcc).map(k => ({ label: label[k], meanFwdVol: mean(cellsAcc[k]), n: cellsAcc[k].length }));
  const cellA = mean(cellsAcc.A), cellB = mean(cellsAcc.B);

  // 3. Lead-time distribution: fired-vol / all-vol per horizon.
  const leadRatios = horizons.map(h => {
    const allV: number[] = [], firedV: number[] = [];
    for (let t = 0; t < idx.length; t++) {
      const v = fwdVol(idx[t], h);
      allV.push(v);
      if (fired[t]) firedV.push(v);
    }
    const base = mean(allV);
    return { h, ratio: base > 0 ? mean(firedV) / base : 0 };
  });
  const leadPeakH = leadRatios.reduce((best, r) => r.ratio > best.ratio ? r : best, leadRatios[0]).h;

  return {
    symbol, bars: c.length, testBars: kappa.length,
    snrKappa, snrDissonance: snrDiss,
    confKappa: confidenceIndex(snrKappa), confDissonance: confidenceIndex(snrDiss),
    cells, interactionReal: cellB > cellA,
    leadRatios, leadPeakH,
    recoveryHalfLife: halfLife(kappa),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── persistence + suite ──────────────────────────────────────
export async function ensureRegimeSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS elle_regime_analysis (
       symbol TEXT PRIMARY KEY, bars INTEGER, test_bars INTEGER,
       snr_kappa REAL, snr_dissonance REAL, conf_kappa REAL, conf_dissonance REAL,
       cell_a_vol REAL, cell_a_n INTEGER, cell_b_vol REAL, cell_b_n INTEGER,
       cell_c_vol REAL, cell_c_n INTEGER, cell_d_vol REAL, cell_d_n INTEGER,
       interaction_real INTEGER, lead_peak_h INTEGER, lead_ratios TEXT,
       recovery_half_life REAL, start_iso TEXT, updated_at TEXT
     )`,
  ).run();
}

export async function runRegimeSuite(env: BtEnv): Promise<number> {
  if (!env.ALPACA_API_KEY || !env.ALPACA_SECRET_KEY) return 0;
  await ensureRegimeSchema(env.DB);
  const symbols = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'GLD', 'TLT'];
  const startISO = new Date(Date.now() - 6 * 365 * 864e5).toISOString().slice(0, 10);
  let written = 0;
  for (const symbol of symbols) {
    try {
      const closes = await fetchYears(env, symbol, startISO);
      const r = runRegimeAnalysis(symbol, closes);
      if (!r) continue;
      const cell = (i: number) => r.cells[i];
      await env.DB.prepare(
        `INSERT INTO elle_regime_analysis
           (symbol, bars, test_bars, snr_kappa, snr_dissonance, conf_kappa, conf_dissonance,
            cell_a_vol, cell_a_n, cell_b_vol, cell_b_n, cell_c_vol, cell_c_n, cell_d_vol, cell_d_n,
            interaction_real, lead_peak_h, lead_ratios, recovery_half_life, start_iso, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           bars=excluded.bars, test_bars=excluded.test_bars, snr_kappa=excluded.snr_kappa,
           snr_dissonance=excluded.snr_dissonance, conf_kappa=excluded.conf_kappa,
           conf_dissonance=excluded.conf_dissonance, cell_a_vol=excluded.cell_a_vol, cell_a_n=excluded.cell_a_n,
           cell_b_vol=excluded.cell_b_vol, cell_b_n=excluded.cell_b_n, cell_c_vol=excluded.cell_c_vol,
           cell_c_n=excluded.cell_c_n, cell_d_vol=excluded.cell_d_vol, cell_d_n=excluded.cell_d_n,
           interaction_real=excluded.interaction_real, lead_peak_h=excluded.lead_peak_h,
           lead_ratios=excluded.lead_ratios, recovery_half_life=excluded.recovery_half_life,
           start_iso=excluded.start_iso, updated_at=excluded.updated_at`,
      ).bind(
        r.symbol, r.bars, r.testBars, r.snrKappa, r.snrDissonance, r.confKappa, r.confDissonance,
        cell(0).meanFwdVol, cell(0).n, cell(1).meanFwdVol, cell(1).n, cell(2).meanFwdVol, cell(2).n,
        cell(3).meanFwdVol, cell(3).n, r.interactionReal ? 1 : 0, r.leadPeakH,
        JSON.stringify(r.leadRatios), r.recoveryHalfLife, startISO,
      ).run();
      written++;
    } catch (e) { console.error(`[REGIME] ${symbol} failed:`, (e as Error).message); }
  }
  return written;
}
