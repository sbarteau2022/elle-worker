import { describe, it, expect } from 'vitest';
import { pamiIndex, pamiDistance, PHI, type PamiConfig } from './pami';
import {
  CANDIDATES, epsMin, retrievalRisk, epsMinAdaptive, retrievalRiskAdaptive,
  peakDiscrepancy, resonanceRisk, recoveryHorizon, recoveryRisk,
  scorecard, minimaxWinner, minimaxWinnerAdaptive,
} from './phi-minimax-scorecard';

describe('φ minimax scorecard — Domain 1 (retrieval collision risk)', () => {
  it('pins ε_min for all four candidates on the basis-neutral memory family', () => {
    expect(epsMin(PHI)).toBeCloseTo(0.07756, 4);
    expect(epsMin(Math.E)).toBeCloseTo(0.07177, 4);
    expect(epsMin(Math.SQRT2)).toBeCloseTo(0.04812, 4);
    expect(epsMin(Math.PI)).toBeCloseTo(0.06848, 4);
  });

  it('none of the four clear the engine\'s own DELTA_DEFAULT separation bar — all above 0.74 risk', () => {
    for (const { base } of CANDIDATES) expect(retrievalRisk(base)).toBeGreaterThan(0.74);
  });

  it('φ has the LARGEST separation (lowest risk) of the four on ε_min — but see the accuracy check below', () => {
    const risks = CANDIDATES.map((c) => ({ name: c.name, risk: retrievalRisk(c.base) }));
    const phiRisk = risks.find((r) => r.name === 'phi')!.risk;
    for (const r of risks) if (r.name !== 'phi') expect(phiRisk).toBeLessThanOrEqual(r.risk);
  });
});

describe('φ minimax scorecard — Domain 1b (adaptive δ, pami.ts\'s real fix, not a hypothetical)', () => {
  it('pins each candidate\'s local density-scaled δ around its own closest pair', () => {
    expect(epsMinAdaptive(PHI).localDelta).toBeCloseTo(0.05258, 4);
    expect(epsMinAdaptive(Math.E).localDelta).toBeCloseTo(0.09009, 4);
    expect(epsMinAdaptive(Math.SQRT2).localDelta).toBeCloseTo(0.05000, 4);
    expect(epsMinAdaptive(Math.PI).localDelta).toBeCloseTo(0.07516, 4);
  });

  it('φ\'s collision RESOLVES under adaptive δ (zero risk) — the other three still collide, just less severely', () => {
    expect(retrievalRiskAdaptive(PHI)).toBe(0); // eps_min > local_delta: no collision at all
    expect(retrievalRiskAdaptive(Math.E)).toBeCloseTo(0.2033, 3);
    expect(retrievalRiskAdaptive(Math.SQRT2)).toBeCloseTo(0.0376, 3);
    expect(retrievalRiskAdaptive(Math.PI)).toBeCloseTo(0.0889, 3);
    // all four drop dramatically versus the static-delta reading (0.74-0.84) —
    // most of what looked like "collision risk" was the static threshold,
    // exactly as predicted before this was implemented and measured.
    for (const { base } of CANDIDATES) expect(retrievalRiskAdaptive(base)).toBeLessThan(retrievalRisk(base));
  });
});

describe('φ minimax scorecard — Domain 2 (resonance risk, reusing rcrb-001\'s method)', () => {
  it('pins peak discrepancy for all four winding numbers', () => {
    expect(peakDiscrepancy(1 / PHI)).toBeCloseTo(0.23315, 4);
    expect(peakDiscrepancy(1 / Math.E)).toBeCloseTo(0.26343, 4);
    expect(peakDiscrepancy(1 / Math.SQRT2)).toBeCloseTo(0.21762, 4);
    expect(peakDiscrepancy(1 / Math.PI)).toBeCloseTo(0.71825, 4);
  });

  it('π is the only candidate anywhere near the 0.85 fatal ceiling', () => {
    expect(resonanceRisk(Math.PI)).toBeGreaterThan(0.8);
    for (const { name, base } of CANDIDATES) if (name !== 'pi') expect(resonanceRisk(base)).toBeLessThan(0.32);
  });
});

describe('φ minimax scorecard — Domain 3 (recovery horizon)', () => {
  it('pins convergence-step counts — narrow spread, φ fastest by a hair', () => {
    expect(recoveryHorizon(PHI)).toBe(107);
    expect(recoveryHorizon(Math.SQRT2)).toBe(108);
    expect(recoveryHorizon(Math.PI)).toBe(110);
    expect(recoveryHorizon(Math.E)).toBe(111);
  });

  it('all four sit far under the 400-step fatal ceiling — this domain never decides the winner here', () => {
    for (const { base } of CANDIDATES) expect(recoveryRisk(base)).toBeLessThan(0.28);
  });
});

describe('φ minimax scorecard — P_final and the winner', () => {
  it('pins the full scorecard exactly as measured', () => {
    const rows = scorecard();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.phi.P_final).toBeCloseTo(0.7415, 3);
    expect(byName.e.P_final).toBeCloseTo(0.7608, 3);
    expect(byName.sqrt2.P_final).toBeCloseTo(0.8396, 3);
    expect(byName.pi.P_final).toBeCloseTo(0.8450, 3);
    // each candidate's worst domain, named — the whole point of minimax:
    expect(byName.phi.S_ret).toBeCloseTo(byName.phi.P_final, 3);   // phi's floor: retrieval
    expect(byName.e.S_ret).toBeCloseTo(byName.e.P_final, 3);       // e's floor: retrieval too
    expect(byName.sqrt2.S_ret).toBeCloseTo(byName.sqrt2.P_final, 3); // sqrt2's floor: retrieval too
    expect(byName.pi.S_res).toBeCloseTo(byName.pi.P_final, 3);     // pi's floor: RESONANCE, not retrieval
  });

  it('φ wins THIS construction — lowest P_final, by never being the worst at anything', () => {
    const winner = minimaxWinner();
    expect(winner.name).toBe('phi');
    expect(winner.P_final).toBeLessThan(0.75);
  });
});

describe('φ minimax scorecard — the winner under adaptive δ: a THIRD different answer', () => {
  it('pins P_final_adaptive for all four — every domain-1 risk collapses once δ scales with density', () => {
    const rows = scorecard();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.phi.P_final_adaptive).toBeCloseTo(0.2743, 3);   // now bound by Domain 2 (resonance), not retrieval
    expect(byName.e.P_final_adaptive).toBeCloseTo(0.3099, 3);     // still bound by Domain 2
    expect(byName.sqrt2.P_final_adaptive).toBeCloseTo(0.2700, 3); // Domain 1's risk stopped being sqrt2's problem
    expect(byName.pi.P_final_adaptive).toBeCloseTo(0.8450, 3);    // unchanged — pi's failure was never retrieval
  });

  it('√2 edges out φ by a hair once retrieval collision is fixed — a THIRD winner, not confirmation of the first', () => {
    const winner = minimaxWinnerAdaptive();
    expect(winner.name).toBe('sqrt2');
    const rows = scorecard();
    const phi = rows.find((r) => r.name === 'phi')!;
    // the margin is real but thin — sub-0.005 apart, not a decisive win
    expect(phi.P_final_adaptive - winner.P_final_adaptive).toBeCloseTo(0.0043, 3);
  });
});

// ── The sensitivity check: this whole result depends on ε_min vs accuracy ──
function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}
function memorySignalNeutral(n: number, seed: number): number[] {
  const rand = seeded(seed);
  const f0 = 0.004 * (1 + ((seed * 0.37) % 1) * 4);
  const step = 0.003 + 0.004 * ((seed * 0.71) % 1);
  const am = 0.002 + 0.01 * ((seed * 0.53) % 1);
  const phases = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < 4; c++) v += Math.sin((2 * Math.PI * (f0 + step * c) * i) + phases[c]) / (c + 1);
    out.push(v * (1 + 0.5 * Math.sin(2 * Math.PI * am * i)));
  }
  return out;
}
function configFor(scaleBase: number, N = 1024, baseScale = 4): PamiConfig {
  const kMin = Math.ceil(Math.log(0.8 / baseScale) / Math.log(scaleBase));
  const kMaxNatural = Math.floor(Math.log((N / 3) / baseScale) / Math.log(scaleBase));
  const kMax = Math.max(kMin + 3, Math.min(kMaxNatural, kMin + 24));
  return { phaseCount: 8, qMax: 6, scaleKMin: kMin, scaleKMax: kMax, baseScale, scaleBase };
}
function accuracyRisk(base: number): number {
  const N = 1024;
  const cfg = configFor(base, N);
  const mems = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(memorySignalNeutral(N, s), cfg));
  if (mems.some((m) => m === null)) return 1;
  let correct = 0;
  for (let s = 1; s <= 6; s++) {
    const q = pamiIndex(memorySignalNeutral(N, s).slice(0, Math.floor(N * 0.6)), cfg);
    if (!q) continue;
    const dists = mems.map((m) => pamiDistance(q, m!));
    if (dists.indexOf(Math.min(...dists)) === s - 1) correct++;
  }
  return 1 - correct / 6; // risk = 1 - accuracy
}

describe('φ minimax scorecard — THE CAVEAT: this is not robust to the domain-1 metric choice', () => {
  it('swapping eps_min for retrieval ACCURACY flips domain 1\'s ranking, and flips the minimax winner to e', () => {
    const accRisk = {
      phi: accuracyRisk(PHI), e: accuracyRisk(Math.E),
      sqrt2: accuracyRisk(Math.SQRT2), pi: accuracyRisk(Math.PI),
    };
    // matches pami-basis-ablation.test.ts's pinned F1 finding exactly:
    // e=0.833 accuracy (0.167 risk), phi=0.333 accuracy (0.667 risk)
    expect(accRisk.phi).toBeCloseTo(1 - 1 / 3, 3);
    expect(accRisk.e).toBeCloseTo(1 - 5 / 6, 3);

    const rows = scorecard();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    const P_final_with_accuracy = {
      phi: Math.max(accRisk.phi, byName.phi.S_res, byName.phi.S_rcrb),
      e: Math.max(accRisk.e, byName.e.S_res, byName.e.S_rcrb),
      sqrt2: Math.max(accRisk.sqrt2, byName.sqrt2.S_res, byName.sqrt2.S_rcrb),
      pi: Math.max(accRisk.pi, byName.pi.S_res, byName.pi.S_rcrb),
    };
    const winnerName = Object.entries(P_final_with_accuracy).sort((a, b) => a[1] - b[1])[0][0];
    expect(winnerName).toBe('e'); // NOT phi — the winner flips under the other legitimate metric
  });
});
