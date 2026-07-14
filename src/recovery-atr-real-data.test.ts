// ============================================================
// RECOVERY vs ATR — REAL DATA. The gate the whole SHADOW series was
// waiting for: no more synthetic series. Six real names, five real years
// of daily OHLC (2013-02-08 → 2018-02-07, S&P constituents), containing —
// by public market history, chosen a priori, not scanned for:
//   CHK  — the definitive multi-year slow bleed (~−90%, grinding)
//   KMI  — the late-2015 waterfall (−65% incl. dividend-cut crash + bounces)
//   GE   — chop, then the famous 2017 bleed
//   FCX  — 2014-15 commodity bleed, then a 2016 recovery trend
//   NVDA — the monster 2016-17 trend
//   WMT  — chop + the Oct-2015 one-day −10% earnings waterfall
// Plus two market-wide events hitting all six: the Aug-24-2015 flash crash
// (crash + dead-cat) and the Feb-2018 VIX-mageddon at the window's end.
//
// Methodology, fixed before running:
//   · Entries are SHARED and mechanical: 55-bar close breakout (Turtle-
//     classic Donchian). No discretion, no cherry-picking.
//   · PAIRED per-signal evaluation: every signal spawns one virtual trade
//     evaluated to exit under BOTH policies independently (overlaps
//     allowed — this is exit-policy analysis, not a portfolio sim). The
//     comparison is exactly paired on identical entries.
//   · Policy A: Chandelier 3×ATR(22) trail from the highest close. TRUE
//     ATR now — real high/low, Wilder TR — so the synthetic harness's
//     range-proxy factor is gone entirely.
//   · Policy B: the φ-conviction composition, parameters IDENTICAL to the
//     synthetic benchmark (floor 0.15, dead-band 0.25·ATR, valve ρ=0.10,
//     RULE-0 at −1R, R = 3·ATR at entry). Untouched — this is a transfer
//     test, not a re-tune.
//   · Close-to-close fills, no costs/slippage — same simplifications for
//     both sides; stated, not hidden.
//
// PRE-REGISTERED from the synthetic findings (docs/RECOVERY_VS_ATR.md),
// written before this file was first run:
//   P1  Losing trades: B's median exit is shallower than A's (the
//       adverse-regime exit-quality edge transfers to real data).
//   P2  B's median MAE is no worse than A's (≤ 1.05×).
//   P3  B's median hold is shorter than A's.
//   Winners' capture is REPORTED, not asserted — the synthetic result
//   (equal capture) was explicitly flagged as parameter-bound.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRecoveryRegulator } from './recovery';
import { createSuperposition, DEFAULT_COLLAPSE } from './superposition';

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

// Wilder true range, simple 22-bar mean (matching the Chandelier standard).
function trueATR(bars: Bar[], i: number, n = 22): number {
  const from = Math.max(1, i - n + 1);
  let s = 0, cnt = 0;
  for (let k = from; k <= i; k++) {
    const tr = Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - bars[k - 1].c), Math.abs(bars[k].l - bars[k - 1].c));
    s += tr; cnt++;
  }
  return Math.max(1e-9, s / cnt);
}

// 55-bar close breakout signals (Turtle-classic), enough runway on both sides.
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
const CONVICTION_FLOOR = 0.15;
const DEAD_BAND_ATR = 0.25;
interface Trade { exitR: number; maeR: number; bars: number; exited: boolean }

function runA(bars: Bar[], i0: number): Trade {
  const entry = bars[i0].c, R = STOP_MULT * trueATR(bars, i0);
  let hwm = entry, maeR = 0;
  for (let i = i0 + 1; i < bars.length; i++) {
    const px = bars[i].c;
    hwm = Math.max(hwm, px);
    maeR = Math.min(maeR, (px - entry) / R);
    if (px < hwm - STOP_MULT * trueATR(bars, i))
      return { exitR: (px - entry) / R, maeR: Math.abs(maeR), bars: i - i0, exited: true };
  }
  return { exitR: (bars[bars.length - 1].c - entry) / R, maeR: Math.abs(maeR), bars: bars.length - 1 - i0, exited: false };
}

function runB(bars: Bar[], i0: number): Trade {
  const entry = bars[i0].c, R = STOP_MULT * trueATR(bars, i0);
  const reg = createRecoveryRegulator(0.5);
  const sup = createSuperposition(0.10);
  let maeR = 0;
  for (let i = i0 + 1; i < bars.length; i++) {
    const px = bars[i].c, ret = px - bars[i - 1].c, atr = trueATR(bars, i);
    maeR = Math.min(maeR, (px - entry) / R);
    if (Math.abs(ret) >= DEAD_BAND_ATR * atr) reg.observe(ret > 0 ? 'recover' : 'strain');
    const conviction = reg.state().kappa;
    sup.observe({
      kappa: conviction,
      velocity: Math.max(-1, Math.min(1, ret / (2 * atr))),
      input_perturbation: Math.min(1, Math.abs(ret) / (2 * atr)),
    });
    const unrealizedR = (px - entry) / R;
    const d = sup.decideCollapse('LONG', i - i0, unrealizedR, 0, 'momentum', DEFAULT_COLLAPSE);
    if (d.action !== 'HOLD' || conviction < CONVICTION_FLOOR)
      return { exitR: unrealizedR, maeR: Math.abs(maeR), bars: i - i0, exited: true };
  }
  return { exitR: (bars[bars.length - 1].c - entry) / R, maeR: Math.abs(maeR), bars: bars.length - 1 - i0, exited: false };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

describe('recovery vs ATR on real data — six names, five years, paired entries', () => {
  const data = loadFixture();
  const perTicker = new Map<string, { a: Trade[]; b: Trade[] }>();
  const allA: Trade[] = [], allB: Trade[] = [];
  for (const [name, bars] of data) {
    const a: Trade[] = [], b: Trade[] = [];
    for (const i0 of signals(bars)) { a.push(runA(bars, i0)); b.push(runB(bars, i0)); }
    perTicker.set(name, { a, b });
    allA.push(...a); allB.push(...b);
  }

  it('sanity — a real sample, not an anecdote: all six tickers loaded, ≥100 paired signals pooled', () => {
    expect(data.size).toBe(6);
    for (const [, bars] of data) expect(bars.length).toBe(1259);
    expect(allA.length).toBeGreaterThanOrEqual(100);
    expect(allA.length).toBe(allB.length); // exactly paired
  });

  it('P1 (pre-registered) — losing trades: B cuts losers at better prices than A on real data', () => {
    const losersA = allA.filter(t => t.exitR < 0).map(t => t.exitR);
    const losersB = allB.filter(t => t.exitR < 0).map(t => t.exitR);
    expect(losersA.length).toBeGreaterThan(20); // enough losers to compare
    expect(median(losersB)).toBeGreaterThan(median(losersA));
  });

  it('P2 (pre-registered) — B\'s median MAE is no worse than A\'s (≤1.05×)', () => {
    expect(median(allB.map(t => t.maeR))).toBeLessThanOrEqual(median(allA.map(t => t.maeR)) * 1.05);
  });

  it('P3 (pre-registered) — B holds shorter', () => {
    expect(median(allB.map(t => t.bars))).toBeLessThan(median(allA.map(t => t.bars)));
  });

  it('THE VERDICT, pinned — trade-level exit quality transferred, and the system-level expectancy is NEGATIVE', () => {
    // Both things are true at once, and the distinction is the finding:
    // P1–P3 passed (B genuinely exits bad situations better), yet as a
    // STANDALONE exit on trend-following entries B destroys the edge —
    // pooled expectancy A ≈ +0.75R/trade vs B ≈ −0.08R/trade, because
    // trend-following's entire payout lives in the fat right tail (NVDA:
    // A +2.92R/trade) and B systematically amputates it (B +0.14R there).
    // Higher win rate (41.6% vs 34.7%), smaller edge — the classic trap.
    // The composition, as parameterized, is an adverse-regime/risk-off
    // instrument, NOT a trend exit. Pinned loosely so the verdict is
    // regression-locked without float-flake:
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(allA.map(t => t.exitR))).toBeGreaterThan(0.5);   // ATR trail: strongly positive on these entries
    expect(mean(allB.map(t => t.exitR))).toBeLessThan(0.1);      // φ-composition: edge amputated
  });

  it('prints the full per-ticker and pooled table — winners\' capture reported, not asserted', () => {
    const row = (label: string, a: Trade[], b: Trade[]) => {
      const w = (ts: Trade[]) => ts.filter(t => t.exitR > 0).map(t => t.exitR);
      const L = (ts: Trade[]) => ts.filter(t => t.exitR < 0).map(t => t.exitR);
      console.log(
        `${label.padEnd(7)}| ${String(a.length).padStart(4)} | ` +
        `${median(L(a)).toFixed(2).padStart(6)} ${median(L(b)).toFixed(2).padStart(6)} | ` +
        `${median(w(a)).toFixed(2).padStart(5)} ${median(w(b)).toFixed(2).padStart(5)} | ` +
        `${median(a.map(t => t.maeR)).toFixed(2).padStart(5)} ${median(b.map(t => t.maeR)).toFixed(2).padStart(5)} | ` +
        `${String(median(a.map(t => t.bars))).padStart(4)} ${String(median(b.map(t => t.bars))).padStart(4)}`
      );
    };
    console.log('\n=== REAL DATA: recovery vs ATR — paired 55-bar-breakout entries, 2013–2018 ===');
    console.log('ticker | sigs | loser(R) A      B | win(R) A     B | MAE   A     B | bars A    B');
    for (const [name, { a, b }] of perTicker) row(name, a, b);
    row('POOLED', allA, allB);
    // The number the tradeoff nets out to: mean exit R per trade (expectancy),
    // and win rate — is better loss-cutting worth worse trend-riding?
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const wr = (ts: Trade[]) => ts.filter(t => t.exitR > 0).length / ts.length;
    console.log(`\nPOOLED expectancy (mean exit R/trade): A ${mean(allA.map(t => t.exitR)).toFixed(3)} · B ${mean(allB.map(t => t.exitR)).toFixed(3)}`);
    console.log(`POOLED win rate: A ${(wr(allA) * 100).toFixed(1)}% · B ${(wr(allB) * 100).toFixed(1)}%`);
    console.log(`NVDA (the trend that decides it) expectancy: A ${mean(perTicker.get('NVDA')!.a.map(t => t.exitR)).toFixed(3)} · B ${mean(perTicker.get('NVDA')!.b.map(t => t.exitR)).toFixed(3)}`);
    expect(perTicker.size).toBe(6);
  });
});
