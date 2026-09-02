// ── TOKEN FORECAST GATE (docs/TOKEN_FORECAST_PREREGISTRATION.md) ───────────
//
// Does forecasting 𝒯's observation stream (src/token-operator.ts) beat a
// trivial baseline? The forecaster under test is the ALREADY-SHIPPED
// EuclidPredictor (src/predict.ts) — nothing new is written for the operator
// side, because a predictor invented for its own benchmark is unfalsifiable.
//
// Every threshold here is quoted from the pre-registration, which was
// committed (78fc074) BEFORE this file existed. Seeded throughout, so a red
// run is reproducible rather than a lottery ticket — the hyper-b1.test.ts
// convention.
//
// Read §0.2 of the pre-registration before quoting any number from here: a
// synthetic pass is a PRECONDITION, never acceptance. Only a failure is
// decisive.

import { describe, it, expect } from 'vitest';
import { mulberry32 } from './hyper';
import { EuclidPredictor } from './predict';

const SERIES = 20;
const N_SCORED = 512;
const SERIES_LEN = N_SCORED + 8;   // +slack; t=0 is never scorable (no baseline)
const BASE_SEED = 0x7ACE0;

type Rand = () => number;
type Channel = 'ttft_ms' | 'itl_mean_ms' | 'energy_total_j' | 'steps';
const CHANNELS: Channel[] = ['ttft_ms', 'itl_mean_ms', 'energy_total_j', 'steps'];
type Trace = Record<Channel, number[]>;

function gauss(rand: Rand): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ── the structured generator (pre-registration §1) ────────────────────────
// Parameters are plausible order-of-magnitude values for a local 27B-class
// model on consumer hardware. They are NOT measurements.

// `prefillWalk` is TRUE for the pre-registered arm (§1 item 2: context grows
// within a session, which is a random walk with drift). The sweep at the
// bottom sets it FALSE — not to flatter the result, but because with it on,
// the near-unit-root prefill term dominates the channel's dynamics and phi
// controls almost nothing. Isolating phi is the only way to read what the
// latent actually buys.
function structuredTrace(rand: Rand, phi = 0.85, prefillWalk = true): Trace {
  const BASE_TTFT = 320, BASE_ITL = 22, BASE_PREFILL = 600;
  let load = 0;              // AR(1) latent in log space, phi = 0.85
  let level = 0;             // regime-shift offset
  let prefill = BASE_PREFILL;
  const out: Trace = { ttft_ms: [], itl_mean_ms: [], energy_total_j: [], steps: [] };

  for (let t = 0; t < SERIES_LEN; t++) {
    load = phi * load + 0.35 * gauss(rand);                     // (1) load autocorrelation
    if (rand() < 0.02) level += gauss(rand) * 0.5;              // (3) regime shift
    if (prefillWalk) {
      prefill = Math.max(120, prefill * 1.004 + gauss(rand) * 15); // (2) context grows
      if (rand() < 0.01) prefill = BASE_PREFILL;                //     ... until it resets
    }
    const straggler = rand() < 0.05 ? Math.exp(0.6 + rand() * 0.8) : 1; // (4) heavy tail

    const loadMul = Math.exp(load * 0.30 + level);
    const ttft = BASE_TTFT * loadMul * (prefill / BASE_PREFILL) * straggler;
    const itl = BASE_ITL * loadMul * (rand() < 0.05 ? 1.4 : 1) * (1 + 0.05 * gauss(rand));
    const tokensOut = Math.max(24, 220 + gauss(rand) * 70);
    const durationMs = ttft + itl * tokensOut;
    const watts = 38 + 27 * Math.min(1, Math.max(0, 0.5 + load * 0.30));  // (5) energy = P*t
    const steps = Math.min(8, Math.max(1, Math.round(2.4 + gauss(rand) * 1.1 + level)));

    out.ttft_ms.push(ttft);
    out.itl_mean_ms.push(itl);
    out.energy_total_j.push((watts * durationMs) / 1000);
    out.steps.push(steps);
  }
  return out;
}

// ── control arm: WHITE (iid, zero temporal structure) ─────────────────────
// Marginal mean/variance matched per channel to the structured arm, so the
// ONLY thing removed is time.

function whiteTraceMatching(ref: Trace, rand: Rand): Trace {
  const out = {} as Trace;
  for (const ch of CHANNELS) {
    const xs = ref[ch];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const varc = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
    // log-normal with matched first two moments (channels are positive-valued)
    const sigma2 = Math.log(1 + varc / (mean * mean));
    const mu = Math.log(mean) - sigma2 / 2;
    out[ch] = Array.from({ length: SERIES_LEN }, () => Math.exp(mu + Math.sqrt(sigma2) * gauss(rand)));
  }
  return out;
}

// ── ablation arm: SHUFFLED (same marginals, autocorrelation destroyed) ────

function shuffledTrace(ref: Trace, rand: Rand): Trace {
  const out = {} as Trace;
  for (const ch of CHANNELS) {
    const xs = [...ref[ch]];
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    out[ch] = xs;
  }
  return out;
}

// ── scoring (pre-registration §3) ─────────────────────────────────────────
// One dim-1 predictor per channel. Baselines run on the IDENTICAL index set:
// only indices where all three emit a forecast are scored, starting at the
// first such index — no burn-in, which is the conservative choice (it makes
// the operator carry its own cold start).

interface Skill { sMean: number; sPersist: number; n: number }

function scoreChannel(y: number[]): Skill {
  const predictor = new EuclidPredictor(1);
  let runningSum = 0;
  let sePred = 0, seMean = 0, sePersist = 0, n = 0;

  for (let t = 0; t < y.length && n < N_SCORED; t++) {
    const step = predictor.step([y[t]]);          // forecast BEFORE ingest (causal)
    const fPred = step.predicted ? step.predicted[0] : null;
    const fPersist = t >= 1 ? y[t - 1] : null;
    const fMean = t >= 1 ? runningSum / t : null;

    if (fPred !== null && fPersist !== null && fMean !== null) {
      sePred += (y[t] - fPred) ** 2;
      seMean += (y[t] - fMean) ** 2;
      sePersist += (y[t] - fPersist) ** 2;
      n++;
    }
    runningSum += y[t];
  }

  return {
    sMean: seMean > 0 ? 1 - sePred / seMean : NaN,
    sPersist: sePersist > 0 ? 1 - sePred / sePersist : NaN,
    n,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface ArmResult {
  perChannel: Record<Channel, { medMean: number; medPersist: number; winBoth: number; minN: number }>;
  medMeanAll: number;
  medPersistAll: number;
  winBothAll: number;
}

function runArm(kind: 'structured' | 'white' | 'shuffled'): ArmResult {
  const skills: Record<Channel, Skill[]> = { ttft_ms: [], itl_mean_ms: [], energy_total_j: [], steps: [] };

  for (let s = 0; s < SERIES; s++) {
    const base = structuredTrace(mulberry32(BASE_SEED + s));
    const trace =
      kind === 'structured' ? base
      : kind === 'white' ? whiteTraceMatching(base, mulberry32(BASE_SEED + 9000 + s))
      : shuffledTrace(base, mulberry32(BASE_SEED + 7000 + s));
    for (const ch of CHANNELS) skills[ch].push(scoreChannel(trace[ch]));
  }

  const perChannel = {} as ArmResult['perChannel'];
  for (const ch of CHANNELS) {
    perChannel[ch] = {
      medMean: median(skills[ch].map((k) => k.sMean)),
      medPersist: median(skills[ch].map((k) => k.sPersist)),
      winBoth: skills[ch].filter((k) => k.sMean > 0 && k.sPersist > 0).length,
      minN: Math.min(...skills[ch].map((k) => k.n)),
    };
  }
  const allMean = CHANNELS.flatMap((ch) => skills[ch].map((k) => k.sMean));
  const allPersist = CHANNELS.flatMap((ch) => skills[ch].map((k) => k.sPersist));
  return {
    perChannel,
    medMeanAll: median(allMean),
    medPersistAll: median(allPersist),
    winBothAll: CHANNELS.reduce((a, ch) => a + perChannel[ch].winBoth, 0),
  };
}

function report(name: string, r: ArmResult): void {
  console.log(`\n── ${name} ─────────────────────────────────────`);
  console.log('channel            S_MEAN    S_PERSIST   S>0 both   N');
  for (const ch of CHANNELS) {
    const c = r.perChannel[ch];
    console.log(
      `${ch.padEnd(18)} ${c.medMean.toFixed(4).padStart(8)} ${c.medPersist.toFixed(4).padStart(11)}` +
      `   ${String(c.winBoth).padStart(2)}/${SERIES}     ${c.minN}`,
    );
  }
  console.log(`${'MEDIAN (all)'.padEnd(18)} ${r.medMeanAll.toFixed(4).padStart(8)} ${r.medPersistAll.toFixed(4).padStart(11)}   ${r.winBothAll}/${SERIES * 4}`);
}

// ─────────────────────────────────────────────────────────────────────────

describe('token forecast gate — EuclidPredictor over 𝒯\'s observation stream', () => {
  const structured = runArm('structured');
  const white = runArm('white');
  const shuffled = runArm('shuffled');

  it('reports every pre-registered arm', () => {
    report('STRUCTURED (the arm under test)', structured);
    report('WHITE (negative control — no temporal structure)', white);
    report('SHUFFLED (ablation — same marginals, time destroyed)', shuffled);
    console.log(
      '\nA5 as pre-registered (S_PERSIST drop when shuffled): ' +
      `${structured.medPersistAll.toFixed(4)} → ${shuffled.medPersistAll.toFixed(4)}`,
    );
    console.log(
      'Correctly-posed control (S_MEAN, which is the optimal causal predictor on iid data): ' +
      `structured ${structured.medMeanAll.toFixed(4)} · white ${white.medMeanAll.toFixed(4)} · shuffled ${shuffled.medMeanAll.toFixed(4)}\n`,
    );
    expect(structured.perChannel.ttft_ms.minN).toBe(N_SCORED);
  });

  // Pre-registration §4: 20 series, N >= 512 scored predictions each.
  it('meets the pre-registered sample size', () => {
    for (const ch of CHANNELS) expect(structured.perChannel[ch].minN).toBe(N_SCORED);
  });

  // ── the verdict, per channel (pre-registration §3: never pooled) ────────
  //
  // A1 >= 0.10, A2 >= 0.05, A3 >= 14/20 — the thresholds are UNCHANGED from
  // the pre-registration. What the run established is that they are met by
  // two channels and missed by two, so they are applied where §3 always said
  // they had to be applied: per channel.
  //
  // PASSING: ttft_ms, energy_total_j — genuinely autocorrelated, the operator
  // beats BOTH baselines consistently.
  // FAILING: itl_mean_ms (S_PERSIST ~ 0.003: the selector correctly fell back
  // to persistence and gained nothing over it) and steps (near-iid, so the
  // running mean is already near-optimal and A1 cannot be met).
  //
  // These are asserted in both directions ON PURPOSE. If a future change makes
  // itl_mean_ms or steps pass, the negative assertions below go red and force
  // this file and docs/TOKEN_FORECAST_PREREGISTRATION.md §6 to be updated,
  // rather than letting a changed finding pass unnoticed.

  const PASSING: Channel[] = ['ttft_ms', 'energy_total_j'];
  const FAILING: Channel[] = ['itl_mean_ms', 'steps'];

  it('A1+A2+A3 hold for ttft_ms and energy_total_j', () => {
    for (const ch of PASSING) {
      const c = structured.perChannel[ch];
      expect(c.medMean).toBeGreaterThanOrEqual(0.10);      // A1
      expect(c.medPersist).toBeGreaterThanOrEqual(0.05);   // A2
      expect(c.winBoth).toBeGreaterThanOrEqual(14);        // A3
    }
  });

  it('A3 does NOT hold for itl_mean_ms or steps — the recorded negative result', () => {
    for (const ch of FAILING) {
      expect(structured.perChannel[ch].winBoth).toBeLessThan(14);
    }
    // itl: ties persistence (A2 missed). steps: ties the mean (A1 missed).
    expect(structured.perChannel.itl_mean_ms.medPersist).toBeLessThan(0.05);
    expect(structured.perChannel.steps.medMean).toBeLessThan(0.10);
  });

  // The correctly-posed negative control. On iid data the running mean IS the
  // optimal causal predictor, so a forecaster that has found nothing real can
  // at best tie it: S_MEAN must sit at ~0. (A4 as literally pre-registered
  // used S_PERSIST, which is mis-posed — see the pre-registration §6 writeup:
  // persistence is a BAD baseline on iid data, so beating it there is free.)
  it('control: S_MEAN ~ 0 on WHITE — no skill where no structure exists', () => {
    expect(white.medMeanAll).toBeLessThan(0.05);
  });

  // A5's intent, posed against the baseline that can actually carry it: the
  // temporal advantage must COLLAPSE when time is destroyed.
  it('A5 (intent): S_MEAN collapses when the series is shuffled in time', () => {
    expect(shuffled.medMeanAll).toBeLessThan(structured.medMeanAll * 0.5);
  });
});

// ── SENSITIVITY: how much real autocorrelation does this need? ─────────────
//
// NOT pre-registered — this is a follow-on sweep, and it is the only part of
// this file that produces a number worth carrying to real data. The arm above
// proves the operator extracts an AR(1) latent that the generator PUT THERE
// at phi = 0.85; that is close to tautological on its own. The decision-useful
// question is where the payoff dies, so that a real TTFT series can be checked
// against a threshold BEFORE anyone builds a forecasting layer on 𝒯.

// The first version of this sweep asserted that MORE autocorrelation buys MORE
// skill. That assertion went red, and it was the assertion that was wrong, not
// the operator: persistence is the OPTIMAL predictor of a random walk, so as a
// series becomes more walk-like there is less and less for any forecaster to
// take. Skill-vs-persistence is therefore governed by MEAN REVERSION, not by
// autocorrelation — a strongly autocorrelated random walk is unbeatable, while
// a weakly autocorrelated mean-reverting series is easy money.
//
// The obvious candidate for a one-line diagnostic is the Lo–MacKinlay variance
// ratio, VR = Var(y_t − y_{t−2}) / (2 · Var(y_t − y_{t−1})), where VR ≈ 1 means
// random walk and VR < 1 means mean-reverting.
//
// IT DOES NOT WORK HERE, AND THE SWEEP BELOW IS WHAT SHOWS THAT. Across a phi
// sweep that moves skill by 10x (0.386 -> 0.033), VR barely moves at all
// (0.505 -> 0.522). The reason is that ttft's first differences are dominated
// by observation noise — straggler spikes and per-step jitter — which pins VR
// near 0.5, the value iid data gives, no matter what the latent is doing. VR
// is measuring the noise, not the predictable component.
//
// So this sweep REJECTS its own proposed shortcut. There is no summary
// statistic here that can be handed over as "check this before building." The
// honest deliverable is the horse race itself: scoreChannel() above already
// runs EuclidPredictor against both baselines on an identical index set, and
// it can be pointed at a real ingested ttft series the moment 𝒯 holds ~512 of
// them. Run the race on real data; do not try to predict its outcome from a
// statistic that has not itself been shown to track it.

function varianceRatio(y: number[]): number {
  const d1: number[] = [], d2: number[] = [];
  for (let t = 1; t < y.length; t++) d1.push(y[t] - y[t - 1]);
  for (let t = 2; t < y.length; t++) d2.push(y[t] - y[t - 2]);
  const v = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  };
  return v(d2) / (2 * v(d1));
}

describe('sensitivity: what property of a series decides whether this pays', () => {
  it('shows skill collapsing as the latent becomes a random walk — and rejects VR as its proxy', () => {
    const PHIS = [0.0, 0.3, 0.6, 0.85, 0.95, 0.99];
    console.log('\n── ttft_ms, prefill random-walk DISABLED so phi is the driver ──');
    console.log('   phi    variance ratio    S_PERSIST    verdict');

    const rows: { phi: number; vr: number; s: number }[] = [];
    for (const phi of PHIS) {
      const skills: number[] = [], vrs: number[] = [];
      for (let s = 0; s < SERIES; s++) {
        const y = structuredTrace(mulberry32(BASE_SEED + s), phi, false).ttft_ms;
        skills.push(scoreChannel(y).sPersist);
        vrs.push(varianceRatio(y));
      }
      const s = median(skills), vr = median(vrs);
      rows.push({ phi, vr, s });
      console.log(
        `  ${phi.toFixed(2)}    ${vr.toFixed(4).padStart(10)}    ${s.toFixed(4).padStart(9)}    ` +
        `${s >= 0.05 ? 'pays' : 'does NOT pay'}`,
      );
    }
    const vrSpread = Math.abs(rows[rows.length - 1].vr - rows[0].vr);
    const sSpread = Math.abs(rows[rows.length - 1].s - rows[0].s);
    console.log(
      `\n  skill moved ${sSpread.toFixed(4)} across this sweep; VR moved ${vrSpread.toFixed(4)}.\n` +
      '  VR is therefore REJECTED as a precondition statistic — it tracks the\n' +
      '  observation noise, not the predictable component. Do not ship it as a\n' +
      '  "check this first" number.\n\n' +
      '  What to do on real data instead: once 𝒯 holds ~512 records, point\n' +
      '  scoreChannel() at the real ttft series and read S_PERSIST directly.\n' +
      '  The race is cheap; its outcome is not forecastable from a summary.\n',
    );

    // The real relationship: as the latent approaches a random walk, the
    // predictable component becomes exactly what persistence already captures,
    // and skill collapses. More autocorrelation buys LESS, not more.
    expect(rows[rows.length - 1].s).toBeLessThan(rows[0].s);
    expect(rows[0].s).toBeGreaterThan(0.20);          // strongly mean-reverting: pays
    expect(rows[rows.length - 1].s).toBeLessThan(0.05); // near-unit-root: does not

    // The rejection of VR, asserted so it cannot quietly be re-adopted: it must
    // move at least 4x less than the skill it was proposed to predict.
    expect(vrSpread * 4).toBeLessThan(sSpread);
  });
});
