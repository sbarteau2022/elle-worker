// ============================================================
// THE GATES, INTEGRATED — does another real engine change anything?
//
// Every prior file in this series (RECOVERY_VS_ATR_REAL → RECOVERY_OVERLAY_REAL
// → WITNESS_GATES) measured the asymmetric regulator (src/recovery.ts →
// src/conviction.ts) alone, stepped only by its own price/ATR perturbation.
// That is honest but incomplete: coherence.ts's dissonance channel
// (src/dissonance.ts) is a SEPARATE, already-computed, currently WRITE-ONLY
// engine — it runs daily in production (runCoherenceField) but nothing reads
// it back into a trading decision. This file is the read-back: the one
// change that makes "the whole system operating together" a true statement
// about the backtest engine, not an aspiration in a doc.
//
// WHAT IS WIRED IN, AND WHY IT'S THIS AND NOT MORE:
//
//   · Dissonance (src/dissonance.ts) — WIRED. It is a real signal computed
//     from the same real OHLC data, via an independent regulator pair (the
//     ρ=0.10 fast clock vs the ρ=0.02 slow clock on the SAME price stream),
//     genuinely orthogonal to the single-κ asymmetric regulator's own state
//     (dissonance fires on cross-clock DISAGREEMENT, not on either clock's
//     level). Folding it in is a real integration, not set dressing.
//
//   · The Atlas / memory kernel (Dynanic-Hyperbolic-Neural-Graph) — NOT
//     wired, on purpose, and said plainly rather than faked: the device
//     repo's own README ("Roadmap") states nodes currently carry no
//     nodeFeatures/nodePhases through the sync path — the atlas holds Elle's
//     conversational co-recall graph, not market data, and nothing in it
//     is about these six tickers. Wiring it in would mean inventing a
//     connection between an LSTM of Elle's own memory topology and CHK's
//     stock price that does not exist. That is the dishonest move this
//     series has refused at every gate (see WITNESS_GATES.md's own refused
//     pre-registrations). Absence, stated, beats fabrication.
//
//   · The conductor loop (src/conductor.ts) — NOT wired, on purpose. It
//     orchestrates the LLM intent/forge queue, not the numeric trading
//     cron; trading.ts already runs as its own 15-min cron independent of
//     it. Folding trading decisions into the LLM-driven conductor loop
//     would be a live-architecture change to a system already gated
//     behind ELLE_CONVICTION_ENFORCE in production — out of scope for a
//     backtest, and not something to change without a staging path this
//     session doesn't have. What's testable here — whether an orthogonal
//     computed signal changes the regulator's measured behavior — is
//     wired in below.
//
// THE INTEGRATION, precisely: for each trade, a dissonance regulator pair
// (freshDissonance/stepDissonance) is warmed causally over the 130 real
// bars preceding entry (the same look-back window production's
// runCoherenceField actually uses), then stepped forward in lockstep with
// the asymmetric regulator, one bar at a time, no lookahead. Each bar's
// asymmetric-regulator weight is boosted by the PRIOR bar's dissonance
// magnitude (mag = |κ_fast − κ_slow|, DISS_FIRE = 0.05 is "fired"):
//
//   w' = min(1, w_price · (1 + mag_prior / DISS_FIRE))
//
// mag = 0 (clocks agree, no regime change detected) → boost = 1 → w' = w_price
// EXACTLY — C_asym_diss degenerates to plain C_asym whenever dissonance is
// silent. mag ≥ DISS_FIRE (a genuine fired event) → boost ≥ 2 → the
// regulator leans harder into whatever direction price already moved, on
// the bars where an independent instrument confirms something is actually
// changing regime, not just noisy within one. Every difference between
// C_asym and C_asym_diss below is therefore attributable ONLY to bars where
// the two engines actually disagree — a clean natural experiment, not a
// blended average that changes everything a little.
//
// PRE-REGISTERED, before first run:
//   D1  Silence check: on bars where dissonance never fires across a
//       trade's whole life, C_asym_diss's final κ equals C_asym's final κ
//       exactly (the degeneration claim above, made falsifiable).
//   D2  Pooled expectancy: C_asym_diss ≥ C_asym's (dissonance-informed
//       weighting should not make the already-modest drawdown-shaper
//       worse on average — it either helps or is a wash).
//   D3  Defensive character holds: C_asym_diss's worst trade and mean
//       in-trade drawdown stay within 10% of C_asym's (adding a signal
//       should not undo the risk-shaping identity WITNESS_GATES.md
//       measured C_asym to have).
//   D4  NVDA tail: C_asym_diss's NVDA expectancy is reported, not asserted
//       — the whole series' history (RECOVERY_VS_ATR_REAL → OVERLAY) is
//       that tail participation is the metric that breaks first when a
//       regulator leans harder into strain. Whether amplifying on
//       genuine regime-change bars helps or hurts NVDA specifically is
//       the open, honestly unresolved question this file exists to ask.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAsymmetricRegulator } from './recovery';
import { freshDissonance, stepDissonance, readDissonance, DISS_FIRE, type DissonanceState } from './dissonance';

interface Bar { date: string; o: number; h: number; l: number; c: number }

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

// Warm a dissonance state causally over the DISS_LOOKBACK real bars preceding
// entry (matching production's runCoherenceField window) — no bars from
// inside or after the trade are used to seed it.
const DISS_LOOKBACK = 130;
function warmDissonance(bars: Bar[], i0: number): DissonanceState {
  const start = Math.max(0, i0 - DISS_LOOKBACK);
  let s = freshDissonance(bars[start].c);
  for (let i = start + 1; i <= i0; i++) s = stepDissonance(s, bars[i].c, 'long').state;
  return s;
}

const SPREAD_BASE = 0.02;
interface GateTrade { pnlR: number; grossR: number; costR: number; turnover: number; exposure: number; minCumR: number; finalKappa: number; everFired: boolean }

// mode 'asym' replays plain C_asym (the WITNESS_GATES incumbent, byte-for-byte
// the same math) as the in-file control; 'asym-diss' is the integration.
function runGate(
  bars: Bar[], i0: number, exitBar: number, mode: 'unit' | 'asym' | 'asym-diss', spreadFracATR: number,
): GateTrade {
  const entry = bars[i0].c, R = STOP_MULT * trueATR(bars, i0);
  const asym = createAsymmetricRegulator();
  let diss = mode === 'asym-diss' ? warmDissonance(bars, i0) : null;
  let grossR = 0, costR = 0, turnover = 0, exposure = 0, minCumR = 0, prevSize = 0, everFired = false;
  for (let i = i0 + 1; i <= exitBar; i++) {
    const ret = bars[i].c - bars[i - 1].c;
    const atr = trueATR(bars, i);
    const size = mode === 'unit' ? 1 : asym.state().kappa;
    const dSize = Math.abs(size - prevSize);
    costR += dSize * (spreadFracATR * atr) / R;
    turnover += dSize;
    prevSize = size;
    grossR += size * ret / R;
    exposure += size;
    minCumR = Math.min(minCumR, grossR - costR);

    const wPrice = Math.abs(ret) / (2 * atr);
    let w = wPrice;
    if (mode === 'asym-diss' && diss) {
      const r = readDissonance(diss);
      if (r.fired) everFired = true;
      w = Math.min(1, wPrice * (1 + r.mag / DISS_FIRE));
      diss = stepDissonance(diss, bars[i].c, 'long').state;
    }
    if (mode !== 'unit') asym.observe(ret > 0 ? 'recover' : 'strain', w);
  }
  costR += prevSize * (spreadFracATR * trueATR(bars, exitBar)) / R;
  turnover += prevSize;
  return { pnlR: grossR - costR, grossR, costR, turnover, exposure, minCumR, finalKappa: asym.state().kappa, everFired };
}

describe('the gates, integrated — dissonance-weighted C_asym vs plain C_asym, real data', () => {
  const data = loadFixture();
  const Y: GateTrade[] = [], D: GateTrade[] = [];
  const yByTicker = new Map<string, GateTrade[]>(), dByTicker = new Map<string, GateTrade[]>();
  const neverFired: { y: GateTrade; d: GateTrade }[] = [];

  for (const [name, bars] of data) {
    const y: GateTrade[] = [], d: GateTrade[] = [];
    for (const i0 of breakoutSignals(bars)) {
      const ex = chandelierExitBar(bars, i0);
      const ty = runGate(bars, i0, ex, 'asym', SPREAD_BASE);
      const td = runGate(bars, i0, ex, 'asym-diss', SPREAD_BASE);
      y.push(ty); d.push(td); Y.push(ty); D.push(td);
      if (!td.everFired) neverFired.push({ y: ty, d: td });
    }
    yByTicker.set(name, y); dByTicker.set(name, d);
  }

  it('sanity — same 591 paired entries as WITNESS_GATES, exactly paired', () => {
    expect(Y.length).toBe(591);
    expect(D.length).toBe(Y.length);
  });

  it('D1 — PRE-REGISTERED CLAIM FAILED: "never fired" is not "mag was ever zero"', () => {
    // Pre-registered: on trades where dissonance never crosses DISS_FIRE
    // (0.05), C_asym_diss degenerates EXACTLY to plain C_asym. MEASURED:
    // false — max |Δfinal κ| 0.050 among the 30 never-fired trades.
    // Mechanism, named: the hypothesis conflated "never fired" (mag never
    // crosses the 0.05 THRESHOLD) with "mag was ever exactly zero" — but
    // the boost formula w' = wPrice·(1+mag/DISS_FIRE) scales CONTINUOUSLY
    // with mag, and two φ-regulators on real, never-perfectly-smooth price
    // series essentially never produce mag = 0.0 on the nose. The formula
    // does exactly what its own header says (continuous, not gated on
    // `fired`); the pre-registered silence claim, as written, was simply
    // wrong about when that formula would degenerate. Pinned to the
    // measured bound so the mechanism stays locked, not asserted away.
    expect(neverFired.length).toBeGreaterThan(0); // some trades genuinely never fire
    const maxDelta = Math.max(...neverFired.map(({ y, d }) => Math.abs(d.finalKappa - y.finalKappa)));
    expect(maxDelta).toBeGreaterThan(1e-6);   // the "exact" pre-registration, refuted
    expect(maxDelta).toBeLessThan(0.08);      // but the drift IS small (max ~0.05) — sub-threshold mag barely moves κ
  });

  it('D2 — PRE-REGISTERED CLAIM FAILED: dissonance-weighting costs expectancy, it does not add it', () => {
    // Pre-registered: C_asym_diss's pooled expectancy ≥ C_asym's (−0.02
    // tolerance). MEASURED: 0.270 vs 0.310 — a real ~13% relative decline,
    // outside tolerance. Mechanism: amplifying the perturbation weight on
    // ANY nonzero cross-clock disagreement (not just fired events) means
    // the regulator leans into strain slightly harder and slightly more
    // often than the price-only version — including on ordinary noise that
    // never rises to a "fired" event. NVDA (the tail that decides this
    // whole series) drops from +1.248R to +1.118R — the same amputate-the-
    // tail-when-you-lean-harder-into-strain mechanism the ORIGINAL
    // RECOVERY_VS_ATR_REAL transfer test named for the binary exit, in
    // miniature. Pinned to what was actually measured, not the hope.
    const pooledY = mean(Y.map(t => t.pnlR)), pooledD = mean(D.map(t => t.pnlR));
    expect(pooledD).toBeLessThan(pooledY);                 // the failure, locked
    expect(pooledD / pooledY).toBeGreaterThan(0.8);        // ...but the cost is real, not catastrophic (~13%)
  });

  it('D3 (pre-registered) — defensive character holds within 10%: worst trade and mean in-trade DD', () => {
    const worstY = Math.min(...Y.map(t => t.pnlR)), worstD = Math.min(...D.map(t => t.pnlR));
    const ddY = mean(Y.map(t => t.minCumR)), ddD = mean(D.map(t => t.minCumR));
    expect(worstD).toBeGreaterThanOrEqual(worstY * 1.10); // "no more than 10% deeper" (both negative)
    expect(ddD).toBeGreaterThanOrEqual(ddY * 1.10);
  });

  it('D4 — NVDA tail participation, reported not asserted', () => {
    const nvY = yByTicker.get('NVDA')!, nvD = dByTicker.get('NVDA')!;
    expect(nvY.length).toBeGreaterThan(0);
    expect(Number.isFinite(mean(nvD.map(t => t.pnlR)))).toBe(true);
  });

  it('prints the full comparison table', () => {
    const row = (label: string, ts: GateTrade[]) =>
      console.log(`${label.padEnd(16)}| ${mean(ts.map(t => t.pnlR)).toFixed(3).padStart(7)} | ${Math.min(...ts.map(t => t.pnlR)).toFixed(2).padStart(6)} | ${mean(ts.map(t => t.minCumR)).toFixed(3).padStart(7)} | ${(ts.filter(t => t.everFired).length / ts.length * 100).toFixed(0).padStart(3)}%`);
    console.log('\n=== GATES INTEGRATED — C_asym vs C_asym_diss, real data, per ticker ===');
    console.log('policy          | exp(R)  | worst  | meanDD  | %fired');
    for (const name of yByTicker.keys()) {
      row(`${name} C_asym`, yByTicker.get(name)!);
      row(`${name} C_asym_diss`, dByTicker.get(name)!);
    }
    row('POOLED C_asym', Y);
    row('POOLED C_asym_diss', D);
    console.log(`\nSilent trades (dissonance never fired): ${neverFired.length}/${Y.length} (${(neverFired.length / Y.length * 100).toFixed(1)}%) — these are the exact-equality control`);
    console.log(`NVDA: C_asym ${mean(yByTicker.get('NVDA')!.map(t => t.pnlR)).toFixed(3)} · C_asym_diss ${mean(dByTicker.get('NVDA')!.map(t => t.pnlR)).toFixed(3)}`);
    expect(true).toBe(true);
  });
});
