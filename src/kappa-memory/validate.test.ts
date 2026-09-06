import { describe, it, expect } from 'vitest';
import { rocAuc, aucStdError, runValidateKappa, GATE, type TraceRow } from './validate';
import { SEAM } from './seam';

describe('rocAuc (Mann–Whitney, tie-aware)', () => {
  it('perfect separation (positives all score higher) → 1.0', () => {
    expect(rocAuc([1, 2, 3, 4], [0, 0, 1, 1])).toBe(1);
  });
  it('perfect inversion (positives all score lower) → 0.0', () => {
    // scores 4,3,2,1 with positives at the two LOWEST (2,1) → AUC 0.
    expect(rocAuc([4, 3, 2, 1], [0, 0, 1, 1])).toBe(0);
  });
  it('a single mid-rank tie across the class boundary contributes exactly ½', () => {
    // pos={2}, neg={1,2}: pos beats one neg (1) and ties one (2) → 1.5/2 = 0.75
    expect(rocAuc([1, 2, 2], [0, 0, 1])).toBeCloseTo(0.75, 6);
  });
  it('all scores identical → 0.5 (pure ties, no signal)', () => {
    expect(rocAuc([5, 5, 5, 5], [0, 1, 0, 1])).toBeCloseTo(0.5, 6);
  });
  it('a missing class degenerates to 0.5, never a throw', () => {
    expect(rocAuc([1, 2, 3], [1, 1, 1])).toBe(0.5);
    expect(rocAuc([1, 2, 3], [0, 0, 0])).toBe(0.5);
  });
  it('ignores non-finite scores and out-of-range labels', () => {
    // The NaN pos and label-2 row drop out; what remains is perfect separation.
    expect(rocAuc([NaN, 1, 5, 9], [1, 0, 2, 1])).toBe(1);
  });
  it('matches the rank-sum identity on a hand-checked mixed case', () => {
    // scores 10,20,30,40,50 ; labels 0,1,0,1,1  →  U/(nPos*nNeg)
    // positives at scores 20,40,50 (ranks 2,4,5), rankSum=11, U=11-6=5, /(3*2)=0.8333
    expect(rocAuc([10, 20, 30, 40, 50], [0, 1, 0, 1, 1])).toBeCloseTo(0.8333, 3);
  });
});

describe('aucStdError (Hanley–McNeil)', () => {
  it('shrinks as n grows for a fixed AUC', () => {
    const small = aucStdError(0.8, 20, 20);
    const large = aucStdError(0.8, 500, 500);
    expect(large).toBeLessThan(small);
    expect(small).toBeGreaterThan(0);
  });
  it('is NaN when a class is empty', () => {
    expect(Number.isNaN(aucStdError(0.8, 0, 30))).toBe(true);
  });
});

// ── Row builders ─────────────────────────────────────────────────────────────
// A labeled trace with a chosen predictor value. Only the fields the eval reads.
function row(settled_open: number, velocity_peak: number, reserve: number): TraceRow {
  return { settled_open, velocity_peak, reserve };
}

describe('runValidateKappa — gating and honesty invariants', () => {
  it('NEVER reports the seam written, and the master gate is not validatable (Gate 0)', () => {
    const rep = runValidateKappa([], 1);
    expect(rep.seam_written).toBe(false);
    expect(rep.master_gate.validatable).toBe(false);
    expect(rep.master_gate.blocked_by).toContain('Gate 0');
    // The actual seam is still closed — the runner is read-only over it.
    expect(SEAM.KAPPA_VALIDATED).toBe(false);
  });

  it('below Gate 1 sample size → INSUFFICIENT, no verdict claimed', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i % 2, i, i));
    const rep = runValidateKappa(rows, 1);
    expect(rep.overall).toBe('INSUFFICIENT');
    for (const t of rep.kill_tests) {
      expect(t.verdict).toBe('INSUFFICIENT');
      expect(t.reason).toContain('Gate 1');
    }
    expect(rep.next_action).toContain('Accumulate');
  });

  it('enough data but no discriminating signal → KILL (keeps the gate closed)', () => {
    // predictors independent of the label: interleaved, no separation.
    const rows: TraceRow[] = [];
    for (let i = 0; i < 200; i++) rows.push(row(i % 2, (i * 7) % 13, (i * 5) % 11));
    const rep = runValidateKappa(rows, 1);
    expect(rep.overall).toBe('KILL');
    expect(rep.kill_tests.every((t) => t.verdict !== 'BUILD')).toBe(true);
  });

  it('a strong, separable signal past the bar → BUILD, but flagged necessary-not-sufficient', () => {
    // Make velocity_peak cleanly separate OPEN (label 1) from SETTLED: open turns
    // get high velocity, settled turns low. 120 of each class.
    const rows: TraceRow[] = [];
    for (let i = 0; i < 120; i++) rows.push(row(1, 100 + i, 0));       // OPEN, high velocity
    for (let i = 0; i < 120; i++) rows.push(row(0, i * 0.1, 0));        // SETTLED, low velocity
    const rep = runValidateKappa(rows, 1);
    const vel = rep.kill_tests.find((t) => t.gate === 'VELOCITY_BOUNDARY')!;
    expect(vel.auc).toBeGreaterThanOrEqual(GATE.VELOCITY_BOUNDARY_AUC);
    expect(vel.verdict).toBe('BUILD');
    expect(vel.reason).toContain('necessary, not sufficient');
    expect(vel.seam_edit_if_build).toContain('manual commit');
    expect(rep.overall).toBe('BUILD');
    expect(rep.next_action).toContain('Do NOT flip the seam');
    // Still no seam write.
    expect(rep.seam_written).toBe(false);
  });

  it('counts labeled vs total honestly (unlabeled rows excluded from n_labeled)', () => {
    const rows: TraceRow[] = [
      row(1, 5, 5), row(0, 3, 3),
      { settled_open: null, velocity_peak: 9, reserve: 9 }, // unlabeled
    ];
    const rep = runValidateKappa(rows, 1);
    expect(rep.n_total).toBe(3);
    expect(rep.n_labeled).toBe(2);
  });
});
