import { describe, it, expect } from 'vitest';
import { tiltIndex, duelKappa } from './law';

// The κ-telemetry contract: the tilt is the steepest composure drop of at
// least the threshold depth; a held series has no tilt; derivatives come from
// the shared kappa-dynamics module (dt = 1 step, null when underdetermined).

describe('tiltIndex', () => {
  it('returns null when composure holds', () => {
    expect(tiltIndex([0.8, 0.82, 0.79, 0.81])).toBeNull();
    expect(tiltIndex([0.7])).toBeNull();
    expect(tiltIndex([])).toBeNull();
  });

  it('finds the steepest qualifying drop', () => {
    // drops: -0.1 at i=2, -0.3 at i=4 → tilt at 4
    expect(tiltIndex([0.9, 0.9, 0.8, 0.85, 0.55])).toBe(4);
  });

  it('ignores drops shallower than the threshold', () => {
    expect(tiltIndex([0.8, 0.75, 0.72])).toBeNull(); // -0.05, -0.03: too shallow
  });
});

describe('duelKappa', () => {
  it('orders by turn number and maps tilt back to duel turn n', () => {
    const k = duelKappa([
      { n: 6, composure: 0.5 },   // deliberately out of order
      { n: 2, composure: 0.9 },
      { n: 4, composure: 0.85 },
    ]);
    expect(k.series).toEqual([0.9, 0.85, 0.5]);
    expect(k.turn_ns).toEqual([2, 4, 6]);
    expect(k.tilt_turn).toBe(6);          // the -0.35 drop
    expect(k.points).toHaveLength(3);
    expect(k.points[0].velocity).toBeNull();  // underdetermined, not 0
    expect(k.points[1].velocity).toBeCloseTo(-0.05, 6);
    expect(k.points[2].velocity).toBeCloseTo(-0.35, 6);
  });

  it('reports no tilt for a composed duel', () => {
    const k = duelKappa([{ n: 2, composure: 0.8 }, { n: 4, composure: 0.82 }]);
    expect(k.tilt_turn).toBeNull();
  });
});
