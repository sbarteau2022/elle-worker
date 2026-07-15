import { describe, it, expect } from 'vitest';
import { harmonicCoherence, groundingGate, harmonicSelfTest } from './harmonic-coherence';

const N = 64;
const sig = (f: number, phase: number) => Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * f * i) / N + phase));

describe('harmonicCoherence — phase-tolerant coherence', () => {
  it('a signal is maximally coherent with itself', () => {
    expect(harmonicCoherence(sig(3, 0), sig(3, 0))).toBeGreaterThan(0.99);
  });
  it('tolerates a phase shift (sin vs cos, same frequency) via the lag scan', () => {
    expect(harmonicCoherence(sig(3, 0), sig(3, Math.PI / 2))).toBeGreaterThan(0.9);
  });
  it('reads anti-phase as coherent — same oscillation shifted by π is still locked', () => {
    const base = sig(3, 0);
    expect(harmonicCoherence(base, base.map((x) => -x))).toBeGreaterThan(0.9);
  });
  it('reads a different frequency as incoherent (genuinely unlocked)', () => {
    expect(harmonicCoherence(sig(3, 0), sig(7, 1.1))).toBeLessThan(0.6);
  });
  it('a flat signal has no phase to lock to (neutral)', () => {
    expect(harmonicCoherence([1, 1, 1, 1], sig(2, 0).slice(0, 4))).toBe(0.5);
  });
});

describe('groundingGate — the four verdicts keep consistency and grounding distinct', () => {
  const base = sig(3, 0);
  const sameFreqShifted = sig(3, Math.PI / 2);
  const diffFreq = sig(7, 1.1);

  it('fails internal consistency → incoherent', () => {
    expect(groundingGate(base, diffFreq, null).verdict).toBe('incoherent');
  });
  it('internally coherent but NO external channel → consistent_only (self-consistent, ungrounded)', () => {
    const r = groundingGate(base, base, null);
    expect(r.verdict).toBe('consistent_only');
    expect(r.external_coherence).toBeNull();
  });
  it('internally coherent but clashes with the world signal → ungrounded_consistent (delusion caught)', () => {
    expect(groundingGate(base, base, diffFreq).verdict).toBe('ungrounded_consistent');
  });
  it('coherent with a world-coupled channel → grounded', () => {
    expect(groundingGate(base, base, sameFreqShifted).verdict).toBe('grounded');
  });
  it('grounded is UNREACHABLE without an external reference — the boundary is structural, not a note', () => {
    // no matter how internally coherent, a null external channel can never be `grounded`
    for (const internalPerfect of [base, sig(2, 0), sig(5, 0.4)]) {
      expect(groundingGate(internalPerfect, internalPerfect, null).verdict).not.toBe('grounded');
    }
  });
});

describe('harmonicSelfTest', () => {
  it('passes every invariant, including all four gate verdicts', () => {
    const r = harmonicSelfTest();
    expect(r.identical_is_max).toBe(true);
    expect(r.phase_shift_tolerated).toBe(true);
    expect(r.antiphase_is_coherent).toBe(true);
    expect(r.different_freq_is_incoherent).toBe(true);
    expect(r.reaches_incoherent).toBe(true);
    expect(r.reaches_consistent_only).toBe(true);
    expect(r.reaches_ungrounded_consistent).toBe(true);
    expect(r.reaches_grounded).toBe(true);
    expect(r.ok).toBe(true);
  });
});
