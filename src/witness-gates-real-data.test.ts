// ============================================================
// THE THREE FINAL GATES — costs, leverage-normalization, the
// mean-reversion niche. Real data, pre-registered, measured.
//
// The v3.0 spec writes these gates as equations; this file closes them the
// only way gates close in this series — in the harness. Honest translation
// of each formula into the system's actual 1-D terms:
//
//   GATE 1 (costs / "thermodynamic friction"): cost ∝ |Δsize| per bar —
//     standard turnover friction. d_H in a 1-D conviction state is |Δκ|.
//     Base spread = 2% of ATR per unit of size traded (liquid-name daily
//     scale); a 10× stress row for illiquid/fast conditions.
//   GATE 2 (leverage-normalization): Λ = min(1, 1/(φ·V)) with V = current
//     ATR / entry ATR — inverse-variance de-levering (textbook
//     vol-targeting; φ de-levers 38% earlier than the plain version).
//     De-lever ONLY (min with 1): the engine may never scale UP into
//     expanding variance.
//   GATE 3 (the mean-reversion niche): enter long on a FRESH cross of the
//     rolling z-score into the band [−φ², −φ] — the one place φ does real
//     structural work (brackets the classic 2σ trigger, with a
//     falling-knife exclusion below −φ²). Exit at mean touch (z ≥ 0) or 20
//     bars. The excluded knife cohort (fresh cross below −φ²) is ALSO
//     measured, so the band's lower cutoff is tested, not assumed.
//
// PRE-REGISTERED, before first run:
//   G1a  At base costs, every policy's ORDERING from the overlay test is
//        unchanged (daily-cadence friction on liquid names is second-order).
//   G1b  The Round-2 doc's own speculation — "costs hurt the overlay more
//        than A's two transactions; the gap likely widens" — is TESTED, not
//        assumed. Turnover arithmetic now suggests the opposite (overlay
//        enters at half size, exits small; A pays two full-size fills).
//        Registered as: overlay total turnover < A's total turnover.
//   G1c  The spec's survival claim: C_asym expectancy stays positive after
//        10× stress costs.
//   G2a  Vol-normalized C_asym (Gate 2 applied) improves or holds worst
//        trade and mean in-trade DD vs plain C_asym.
//   G2b  ...without dropping NVDA tail participation below +1.0R.
//   G3a  The knife cutoff is real: in-band entries (z ∈ [−φ², −φ]) have
//        better mean raw outcomes than excluded knife entries (z < −φ²).
//   G3b  THE niche question: on MR entries — where the payoff is
//        left-tail-dominated, not right-tail — the asym overlay's per-unit
//        return ≥ full-size per-unit (the efficiency win the trend niche
//        refused, found where the instrument's shape fits the payoff).
//   G3c  Asym overlay's worst MR trade is shallower than full-size's.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAsymmetricRegulator } from './recovery';

interface Bar { date: string; o: number; h: number; l: number; c: number }
const PHI = (1 + Math.sqrt(5)) / 2;

function loadFixture(): Map<string, Bar[]> {
  const raw = readFileSync(join(__dirname, '..', 'test-fixtures', 'real-ohlc-5yr.csv'), 'utf8');
  const out = new Map<string, Bar[]>();
  for (const line of raw.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [date, o, h, l, c, , name] = line.split(',');
    if (!out.has(name)) out.set(name, []);
    out.get(name)!.push({ date, o: +o, h: +h, l: +l, c: +c });
  }
  return out;
}
function trueATR(bars: Bar[], i: number, n = 22): number {
  const from = Math.max(1, i - n + 1);
  let s = 0, cnt = 0;
  for (let k = from; k <= i; k++) {
    const tr = Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - bars[k - 1].c), Math.abs(bars[k].l - bars[k - 1].c));
    s += tr; cnt++;
  }
  return Math.max(1e-9, s / cnt);
}
function breakoutSignals(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 56; i < bars.length - 5; i++) {
    let hi = -Infinity;
    for (let k = i - 55; k < i; k++) hi = Math.max(hi, bars[k].c);
    if (bars[i].c > hi) out.push(i);
  }
  return out;
}
const STOP_MULT = 3;
function chandelierExitBar(bars: Bar[], i0: number): number {
  const entry = bars[i0].c;
  let hwm = entry;
  for (let i = i0 + 1; i < bars.length; i++) {
    const px = bars[i].c;
    hwm = Math.max(hwm, px);
    if (px < hwm - STOP_MULT * trueATR(bars, i)) return i;
  }
  return bars.length - 1;
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

// ── one trade with sizing mode, cost model, and optional vol-normalization ──
interface GateTrade { pnlR: number; grossR: number; costR: number; turnover: number; exposure: number; minCumR: number }
function runGate(
  bars: Bar[], i0: number, exitBar: number,
  mode: 'unit' | 'asym' | 'asym-lev',
  spreadFracATR: number, // cost per unit size traded, as a fraction of current ATR
): GateTrade {
  const entry = bars[i0].c, R = STOP_MULT * trueATR(bars, i0), atrEntry = trueATR(bars, i0);
  const asym = createAsymmetricRegulator();
  let grossR = 0, costR = 0, turnover = 0, exposure = 0, minCumR = 0, prevSize = 0;
  for (let i = i0 + 1; i <= exitBar; i++) {
    const ret = bars[i].c - bars[i - 1].c;
    const atr = trueATR(bars, i);
    let size = mode === 'unit' ? 1 : asym.state().kappa;
    if (mode === 'asym-lev') {
      // GATE 2: Λ = min(1, 1/(φ·V)), V = ATR_now/ATR_entry — de-lever only.
      const V = atr / atrEntry;
      size *= Math.min(1, 1 / (PHI * V));
    }
    const dSize = Math.abs(size - prevSize);
    costR += dSize * (spreadFracATR * atr) / R;   // GATE 1: pay friction on every size change
    turnover += dSize;
    prevSize = size;
    grossR += size * ret / R;
    exposure += size;
    minCumR = Math.min(minCumR, grossR - costR);
    asym.observe(ret > 0 ? 'recover' : 'strain', Math.abs(ret) / (2 * atr));
  }
  // Close the position: pay the exit fill too.
  costR += prevSize * (spreadFracATR * trueATR(bars, exitBar)) / R;
  turnover += prevSize;
  return { pnlR: grossR - costR, grossR, costR, turnover, exposure, minCumR };
}

// ── GATE 3: mean-reversion entries — fresh cross into [−φ², −φ] ──
function smaStd(bars: Bar[], i: number, n = 55): { sma: number; std: number } {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += bars[k].c;
  const sma = s / n;
  let v = 0;
  for (let k = i - n + 1; k <= i; k++) v += (bars[k].c - sma) ** 2;
  return { sma, std: Math.max(1e-9, Math.sqrt(v / n)) };
}
function zAt(bars: Bar[], i: number): number {
  const { sma, std } = smaStd(bars, i);
  return (bars[i].c - sma) / std;
}
function mrSignals(bars: Bar[]): { inBand: number[]; knife: number[] } {
  const inBand: number[] = [], knife: number[] = [];
  for (let i = 57; i < bars.length - 5; i++) {
    const z = zAt(bars, i), zPrev = zAt(bars, i - 1);
    if (z <= -PHI && z >= -PHI * PHI && zPrev > -PHI) inBand.push(i);          // fresh entry into the niche
    else if (z < -PHI * PHI && zPrev >= -PHI * PHI) knife.push(i);             // fresh break BELOW it — excluded cohort
  }
  return { inBand, knife };
}
function mrExitBar(bars: Bar[], i0: number): number {
  for (let i = i0 + 1; i < Math.min(bars.length, i0 + 21); i++) if (zAt(bars, i) >= 0) return i;
  return Math.min(bars.length - 1, i0 + 20);
}

describe('the three final gates — real data, pre-registered', () => {
  const data = loadFixture();
  const SPREAD_BASE = 0.02, SPREAD_STRESS = 0.20;

  // ---- Gates 1 & 2 ride the trend-entry envelopes from the overlay test ----
  const A0: GateTrade[] = [], A1: GateTrade[] = [], A10: GateTrade[] = [];
  const Y0: GateTrade[] = [], Y1: GateTrade[] = [], Y10: GateTrade[] = [];
  const L1: GateTrade[] = [];
  const nvdaLev: GateTrade[] = [];
  for (const [name, bars] of data) {
    for (const i0 of breakoutSignals(bars)) {
      const ex = chandelierExitBar(bars, i0);
      A0.push(runGate(bars, i0, ex, 'unit', 0));
      A1.push(runGate(bars, i0, ex, 'unit', SPREAD_BASE));
      A10.push(runGate(bars, i0, ex, 'unit', SPREAD_STRESS));
      Y0.push(runGate(bars, i0, ex, 'asym', 0));
      Y1.push(runGate(bars, i0, ex, 'asym', SPREAD_BASE));
      Y10.push(runGate(bars, i0, ex, 'asym', SPREAD_STRESS));
      const lev = runGate(bars, i0, ex, 'asym-lev', SPREAD_BASE);
      L1.push(lev);
      if (name === 'NVDA') nvdaLev.push(lev);
    }
  }

  it('G1a — at base costs, the ordering is unchanged and friction is second-order at daily cadence', () => {
    expect(mean(A1.map(t => t.costR))).toBeLessThan(0.05);            // A pays ~0.01R/trade
    expect(mean(Y1.map(t => t.costR))).toBeLessThan(0.05);
    expect(mean(A1.map(t => t.pnlR))).toBeGreaterThan(mean(Y1.map(t => t.pnlR)));  // A still leads expectancy
    expect(mean(Y1.map(t => t.pnlR))).toBeGreaterThan(0.25);          // overlay still solidly positive
  });

  it('G1b — TESTING the Round-2 doc\'s own cost speculation: does the overlay really churn more than A?', () => {
    // The doc guessed "costs hurt the overlay more; the gap likely widens."
    // Turnover arithmetic suggests the opposite: A pays 2.0 full-size fills;
    // the overlay enters at ~0.5, drips small |Δκ| changes, exits small.
    expect(mean(Y1.map(t => t.turnover))).toBeLessThan(mean(A1.map(t => t.turnover)));
  });

  it('G1c — the survival claim: C_asym stays positive-expectancy even at 10× stress costs', () => {
    expect(mean(Y10.map(t => t.pnlR))).toBeGreaterThan(0);
    // And report A under the same stress for the table.
    expect(Number.isFinite(mean(A10.map(t => t.pnlR)))).toBe(true);
  });

  it('G2a — vol-normalized leverage (Λ = min(1, 1/(φ·V))) improves or holds the risk shape vs plain C_asym', () => {
    expect(Math.min(...L1.map(t => t.pnlR))).toBeGreaterThanOrEqual(Math.min(...Y1.map(t => t.pnlR)) - 0.05);
    expect(mean(L1.map(t => t.minCumR))).toBeGreaterThanOrEqual(mean(Y1.map(t => t.minCumR)) - 0.02);
  });

  it('G2b — PRE-REGISTERED CLAIM FAILED: the spec\'s Gate-2 formula re-amputates the tail through the vol channel', () => {
    // Pre-registered: NVDA > +1.0R under vol-normalization. MEASURED: 0.439R
    // (down from plain C_asym's 1.263). Mechanism: V = ATR_now/ATR_entry in
    // DOLLARS — a monster trend's dollar-ATR grows with its price even at
    // constant percentage volatility, so Λ = min(1, 1/(φ·V)) throttles size
    // precisely through the payoff. "Price grew" is not "risk expanded";
    // the formula as spec'd conflates them. A %-of-price vol measure is the
    // named next candidate — registered for a future run, not slipped in
    // post-hoc. What Gate 2 DID buy, pinned: the most defensive profile in
    // the series (worst −0.49R, mean DD −0.164R) at a steep tail price.
    expect(mean(nvdaLev.map(t => t.pnlR))).toBeLessThan(1.0);   // the failure, locked
    expect(mean(nvdaLev.map(t => t.pnlR))).toBeGreaterThan(0);   // participation not zero
    expect(Math.min(...L1.map(t => t.pnlR))).toBeGreaterThan(-0.6);      // best worst-trade of the series
    expect(mean(L1.map(t => t.minCumR))).toBeGreaterThan(-0.2);          // best in-trade DD of the series
  });

  // ---- Gate 3: the mean-reversion niche ----
  const mrFullAll: GateTrade[] = [], mrAsymAll: GateTrade[] = [], knifeFullAll: GateTrade[] = [];
  for (const [, bars] of data) {
    const { inBand, knife } = mrSignals(bars);
    for (const i0 of inBand) {
      const ex = mrExitBar(bars, i0);
      mrFullAll.push(runGate(bars, i0, ex, 'unit', SPREAD_BASE));
      mrAsymAll.push(runGate(bars, i0, ex, 'asym', SPREAD_BASE));
    }
    for (const i0 of knife) {
      knifeFullAll.push(runGate(bars, i0, mrExitBar(bars, i0), 'unit', SPREAD_BASE));
    }
  }
  const perUnit = (ts: GateTrade[]) => ts.reduce((s, t) => s + t.pnlR, 0) / Math.max(1e-9, ts.reduce((s, t) => s + t.exposure, 0));

  it('G3 sanity — the niche produced a real sample on real data', () => {
    expect(mrFullAll.length).toBeGreaterThanOrEqual(25);
    expect(knifeFullAll.length).toBeGreaterThanOrEqual(10);
  });

  it('G3a — PRE-REGISTERED CLAIM FAILED, INVERTED: the knife zone BEAT the sanctioned niche on this universe', () => {
    // Pre-registered: in-band (z ∈ [−φ², −φ]) beats the excluded knife zone
    // (z < −φ²). MEASURED: in-band −0.122R mean, knife +0.112R — the cutoff
    // points the WRONG WAY here. Mechanism: this six-name universe was
    // chosen a priori as bleeders/crashers for the EXIT tests (CHK, GE,
    // KMI...) — buying −1.6σ..−2.6σ dips inside structural downtrends is
    // exactly catching the knife the band claimed to avoid, while deeper
    // crosses often marked capitulation lows. Caveat on record: the
    // universe is adversarial for long-MR by construction; the claim may
    // fare differently on mean-reverting instruments. On THIS data, the
    // φ..φ² long-dip niche loses money and its exclusion rule is inverted.
    expect(mean(mrFullAll.map(t => t.pnlR))).toBeLessThan(0);                       // the niche loses outright
    expect(mean(knifeFullAll.map(t => t.pnlR))).toBeGreaterThan(mean(mrFullAll.map(t => t.pnlR)));  // inversion, locked
  });

  it('G3b — PRE-REGISTERED CLAIM UNANSWERABLE: both per-units are negative — no efficiency crown in a losing strategy', () => {
    // Pre-registered: overlay wins per-unit in the left-tail-dominated
    // niche. MEASURED: full −0.0072, overlay −0.0078 — a tie at noise
    // level, both NEGATIVE, because the underlying MR strategy loses on
    // this universe (G3a). Efficiency of a losing strategy is not a prize.
    // What survives (G3c, held): the overlay HALVED the damage — expectancy
    // −0.060 vs −0.122, worst −1.24 vs −2.96, mean DD −0.376 vs −0.828 —
    // the drawdown-shaper identity holding even inside a losing niche.
    expect(perUnit(mrFullAll)).toBeLessThan(0);
    expect(perUnit(mrAsymAll)).toBeLessThan(0);
    expect(Math.abs(perUnit(mrAsymAll) - perUnit(mrFullAll))).toBeLessThan(0.005);  // tie, locked
    expect(mean(mrAsymAll.map(t => t.pnlR))).toBeGreaterThan(mean(mrFullAll.map(t => t.pnlR)) * 0.7); // damage halved
  });

  it('G3c — and cuts the worst MR trade shallower', () => {
    expect(Math.min(...mrAsymAll.map(t => t.pnlR))).toBeGreaterThan(Math.min(...mrFullAll.map(t => t.pnlR)));
  });

  it('prints the full gates table', () => {
    const row = (label: string, ts: GateTrade[]) =>
      console.log(`${label.padEnd(22)}| ${mean(ts.map(t => t.pnlR)).toFixed(3).padStart(7)} | ${mean(ts.map(t => t.costR)).toFixed(4).padStart(7)} | ${mean(ts.map(t => t.turnover)).toFixed(2).padStart(5)} | ${Math.min(...ts.map(t => t.pnlR)).toFixed(2).padStart(6)} | ${mean(ts.map(t => t.minCumR)).toFixed(3).padStart(7)}`);
    console.log('\n=== THE THREE GATES — real data ===');
    console.log('policy                | exp(R)  | cost(R) | turn. | worst  | meanMinCum');
    console.log('--- trend entries (591), Gate 1 (costs) + Gate 2 (leverage) ---');
    row('A base-cost', A1); row('A 10x-stress', A10);
    row('C_asym base-cost', Y1); row('C_asym 10x-stress', Y10);
    row('C_asym vol-normed', L1);
    console.log(`--- mean-reversion niche (Gate 3): ${mrFullAll.length} in-band entries, ${knifeFullAll.length} knife-excluded ---`);
    row('MR full-size', mrFullAll); row('MR asym overlay', mrAsymAll); row('MR knife (excluded)', knifeFullAll);
    console.log(`MR per-unit: full ${perUnit(mrFullAll).toFixed(4)} · asym ${perUnit(mrAsymAll).toFixed(4)}`);
    console.log(`NVDA vol-normed expectancy: ${mean(nvdaLev.map(t => t.pnlR)).toFixed(3)}`);
    expect(true).toBe(true);
  });
});
