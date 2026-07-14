// ============================================================
// THE OVERLAY, WITH PERTURBATION IN IT — real data, round two.
//
// The real-data transfer test (docs/RECOVERY_VS_ATR_REAL.md) retired the
// φ-composition as a BINARY exit for trend entries (expectancy −0.08R vs
// ATR's +0.75R: it amputated the fat right tail that pays for the whole
// system) and named the next experiment: a DE-RISKING OVERLAY — conviction
// drives position SIZE continuously instead of a binary in/out, preserving
// tail participation while cutting adverse exposure. This is that
// experiment, plus the second named upgrade: PERTURBATION-WEIGHTED
// conviction (stepKappaWeighted) — bar magnitude goes into the recursion
// itself, dissolving the arbitrary dead-band cutoff.
//
// Same fixture, same 591 paired 55-bar-breakout entries, same true Wilder
// ATR(22). Four policies per entry, exactly paired:
//   A       binary Chandelier 3×ATR(22) exit, size 1 throughout (the
//           incumbent: +0.754R/trade on these entries)
//   C_bin   overlay: size_t = conviction from the BINARY regulator
//           (dead-band 0.25·ATR, as in the retired exit) — the Chandelier
//           stop remains the ONLY terminal exit, identical trade envelope
//   C_pert  overlay: size_t = conviction from the PERTURBATION-WEIGHTED
//           regulator (w = |ret|/(2·ATR) clamped; NO dead-band — the weight
//           subsumes it) — same identical trade envelope
//   C_asym  overlay: size_t = conviction from the ASYMMETRIC log-odds
//           regulator (collapse φ·s, recovery φ⁻¹·s — rates inversely
//           proportional, product s²; open rails κ ∈ (0.047, 0.759) — no
//           complete failure or success reachable) — same envelope
// Sizing uses the conviction BEFORE the bar being P&L'd (no lookahead).
// Because the overlays share A's exact entry AND exit bars, the comparison
// isolates ONE question: what does conviction-sizing do to the identical
// trade?
//
// PRE-REGISTERED, before first run (the PT-IV discipline: if one fails,
// the assertion flips to pin measured reality and the doc records the
// failure):
//   P1  Risk efficiency: C_pert earns more per unit of exposure than A
//       (pooled Σpnl/Σexposure > A's Σpnl/Σbars).
//   P2  Left tail: C_pert's worst single trade is shallower than A's.
//   P3  Tail participation survives sizing: C_pert's NVDA expectancy stays
//       strongly positive (> +1.0R/trade) — the overlay must NOT re-commit
//       the amputation the binary exit was retired for.
//   P4  The perturbation question itself: C_pert ≥ C_bin on per-unit
//       return — magnitude-weighting should beat the binary+dead-band
//       regulator (less spurious strain from noise bars, faster response
//       to real crashes).
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRecoveryRegulator, createAsymmetricRegulator } from './recovery';

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

function signals(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 56; i < bars.length - 5; i++) {
    let hi = -Infinity;
    for (let k = i - 55; k < i; k++) hi = Math.max(hi, bars[k].c);
    if (bars[i].c > hi) out.push(i);
  }
  return out;
}

const STOP_MULT = 3;
const DEAD_BAND_ATR = 0.25;

// A's exit bar for this entry — the shared trade envelope for all three.
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

interface OverlayTrade { pnlR: number; exposure: number; bars: number; minCumR: number }

// One trade, one sizing rule. mode 'unit' = constant size 1 (policy A).
function runOverlay(bars: Bar[], i0: number, exitBar: number, mode: 'unit' | 'bin' | 'pert' | 'asym'): OverlayTrade {
  const entry = bars[i0].c, R = STOP_MULT * trueATR(bars, i0);
  const reg = createRecoveryRegulator(0.5);
  const asym = createAsymmetricRegulator(); // rho=0.10, Z=3: kappa in (0.047, 0.759), neutral start 0.5
  let pnlR = 0, exposure = 0, minCumR = 0;
  for (let i = i0 + 1; i <= exitBar; i++) {
    const ret = bars[i].c - bars[i - 1].c;
    const atr = trueATR(bars, i);
    // Size for THIS bar = conviction as of the PREVIOUS bar (no lookahead).
    const size = mode === 'unit' ? 1 : mode === 'asym' ? asym.state().kappa : reg.state().kappa;
    pnlR += size * ret / R;
    exposure += size;
    minCumR = Math.min(minCumR, pnlR);
    // Now observe the bar, updating conviction for the NEXT bar's sizing.
    if (mode === 'bin') {
      if (Math.abs(ret) >= DEAD_BAND_ATR * atr) reg.observe(ret > 0 ? 'recover' : 'strain');
    } else if (mode === 'pert') {
      reg.observeWeighted(ret > 0 ? 'recover' : 'strain', Math.abs(ret) / (2 * atr));
    } else if (mode === 'asym') {
      asym.observe(ret > 0 ? 'recover' : 'strain', Math.abs(ret) / (2 * atr));
    }
  }
  return { pnlR, exposure, bars: exitBar - i0, minCumR };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describe('the de-risking overlay with perturbation-weighted conviction — real data, paired envelopes', () => {
  const data = loadFixture();
  const A: OverlayTrade[] = [], Cbin: OverlayTrade[] = [], Cpert: OverlayTrade[] = [], Casym: OverlayTrade[] = [];
  const nvda = { a: [] as OverlayTrade[], pert: [] as OverlayTrade[], asym: [] as OverlayTrade[] };
  for (const [name, bars] of data) {
    for (const i0 of signals(bars)) {
      const exitBar = chandelierExitBar(bars, i0);
      const a = runOverlay(bars, i0, exitBar, 'unit');
      const b = runOverlay(bars, i0, exitBar, 'bin');
      const p = runOverlay(bars, i0, exitBar, 'pert');
      const y = runOverlay(bars, i0, exitBar, 'asym');
      A.push(a); Cbin.push(b); Cpert.push(p); Casym.push(y);
      if (name === 'NVDA') { nvda.a.push(a); nvda.pert.push(p); nvda.asym.push(y); }
    }
  }
  const perUnit = (ts: OverlayTrade[]) => ts.reduce((s, t) => s + t.pnlR, 0) / Math.max(1e-9, ts.reduce((s, t) => s + t.exposure, 0));

  it('sanity — identical envelopes, paired counts, finite numbers', () => {
    expect(A.length).toBe(Cbin.length);
    expect(A.length).toBe(Cpert.length);
    expect(A.length).toBeGreaterThanOrEqual(100);
    for (const ts of [A, Cbin, Cpert]) for (const t of ts) {
      expect(Number.isFinite(t.pnlR)).toBe(true);
      expect(t.exposure).toBeGreaterThanOrEqual(0);
    }
    // A's per-trade pnl here must equal the prior test's exitR by construction
    // (size-1 sum of the same bar returns over the same envelope): spot-check
    // the pooled expectancy against the recorded +0.754.
    expect(mean(A.map(t => t.pnlR))).toBeCloseTo(0.754, 1);
  });

  it('P1 — PRE-REGISTERED CLAIM FAILED: the overlay is ~14% LESS efficient per unit of exposure, not more', () => {
    // Pre-registered: C_pert > A per unit of exposure. MEASURED: 0.0191 vs
    // 0.0222 — A wins efficiency. What the overlay actually buys is the
    // RISK SHAPE, not efficiency: half the deployed exposure (12.0 vs 23.0),
    // a 44% shallower worst trade (−1.08R vs −1.92R), a 47% shallower mean
    // in-trade drawdown (−0.32R vs −0.60R), and — the rehabilitation that
    // matters — tail participation PRESERVED (NVDA +1.48R vs the retired
    // binary exit's +0.14R). Third failed pre-registration of the series,
    // pinned so a regression is loud:
    expect(perUnit(Cpert)).toBeLessThan(perUnit(A));            // A keeps the efficiency crown
    expect(perUnit(Cpert)).toBeGreaterThan(perUnit(A) * 0.75);  // but the overlay stays within 25% of it
    expect(mean(Cpert.map(t => t.pnlR))).toBeGreaterThan(0.25); // and is solidly POSITIVE expectancy — unlike the retired binary exit
  });

  it('P2 (pre-registered) — left tail: C_pert\'s worst single trade is shallower than A\'s', () => {
    expect(Math.min(...Cpert.map(t => t.pnlR))).toBeGreaterThan(Math.min(...A.map(t => t.pnlR)));
  });

  it('P3 (pre-registered) — tail participation survives sizing: NVDA expectancy stays strongly positive', () => {
    expect(mean(nvda.pert.map(t => t.pnlR))).toBeGreaterThan(1.0);
  });

  it('P4 (pre-registered) — perturbation-weighting beats the binary+dead-band regulator per unit of exposure', () => {
    expect(perUnit(Cpert)).toBeGreaterThanOrEqual(perUnit(Cbin));
  });

  // ── the asymmetric regulator, pre-registered before first run ──────────
  // The design constraints: collapse rate inversely proportional to recovery
  // rate (φ·s vs φ⁻¹·s, product s², ratio φ²), and open rails — complete
  // failure/success structurally unreachable (κ ∈ (0.047, 0.759), log-odds
  // leaky integrator). The genuine risk being tested: φ²-slow recovery may
  // bleed size through a trend's pullback-recover cycles and re-commit the
  // tail amputation. PA1–PA4:
  it('PA1 (pre-registered) — fast collapse cuts the left tail at least as well as symmetric: worst trade ≤ C_pert\'s', () => {
    expect(Math.min(...Casym.map(t => t.pnlR))).toBeGreaterThanOrEqual(Math.min(...Cpert.map(t => t.pnlR)) - 0.05);
  });

  it('PA2 (pre-registered) — the drawdown shape improves or holds: mean in-trade DD ≤ C_pert\'s', () => {
    expect(mean(Casym.map(t => t.minCumR))).toBeGreaterThanOrEqual(mean(Cpert.map(t => t.minCumR)) - 0.02);
  });

  it('PA3 (pre-registered) — THE question: does φ²-slow recovery re-amputate the tail? NVDA must stay > +1.0R', () => {
    expect(mean(nvda.asym.map(t => t.pnlR))).toBeGreaterThan(1.0);
  });

  it('PA4 (pre-registered) — expectancy stays solidly positive (> +0.25R, the bar the pert overlay cleared)', () => {
    expect(mean(Casym.map(t => t.pnlR))).toBeGreaterThan(0.25);
  });

  it('prints the full overlay table', () => {
    const rowOf = (label: string, ts: OverlayTrade[]) => {
      console.log(
        `${label.padEnd(7)}| ${mean(ts.map(t => t.pnlR)).toFixed(3).padStart(7)} | ${perUnit(ts).toFixed(4).padStart(7)} | ` +
        `${median(ts.map(t => t.exposure)).toFixed(1).padStart(6)} | ${Math.min(...ts.map(t => t.pnlR)).toFixed(2).padStart(6)} | ` +
        `${mean(ts.map(t => t.minCumR)).toFixed(3).padStart(7)}`
      );
    };
    console.log('\n=== OVERLAY on real data — same 591 entries, same Chandelier envelope, four sizing rules ===');
    console.log('policy | exp(R)  | per-unit | expos. | worst  | meanMinCum');
    rowOf('A', A); rowOf('C_bin', Cbin); rowOf('C_pert', Cpert); rowOf('C_asym', Casym);
    console.log(`\nNVDA expectancy: A ${mean(nvda.a.map(t => t.pnlR)).toFixed(3)} · C_pert ${mean(nvda.pert.map(t => t.pnlR)).toFixed(3)} · C_asym ${mean(nvda.asym.map(t => t.pnlR)).toFixed(3)}`);
    expect(A.length).toBeGreaterThan(0);
  });
});
