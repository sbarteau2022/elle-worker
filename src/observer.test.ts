// Pure-logic tests for the Observer: the opening-axis roster and that every
// axis instructs JSON-only output. No network, no D1.
import { describe, it, expect } from 'vitest';
import { OPENING_AXES } from './observer';

describe('observer · the opening axes', () => {
  it('two opening axes — Dominant Narrative and Counter-Narrative — feeding the structural reading', () => {
    expect(OPENING_AXES).toHaveLength(2);
    expect(OPENING_AXES.map(a => a.id)).toEqual(['dominant_narrative', 'counter_narrative']);
  });
  it('numbered 1-2 with no gaps or duplicates', () => {
    expect(OPENING_AXES.map(a => a.n)).toEqual([1, 2]);
  });
  it('unique ids', () => {
    expect(new Set(OPENING_AXES.map(a => a.id)).size).toBe(OPENING_AXES.length);
  });
  it('open on the cheap tier — the two narratives are fast, unmotivated reads', () => {
    expect(OPENING_AXES.every(a => a.task === 'fast')).toBe(true);
  });
  it('every axis carries a real system prompt instructing JSON-only output', () => {
    for (const a of OPENING_AXES) {
      expect(a.system.length).toBeGreaterThan(80);
      expect(a.system).toMatch(/Respond ONLY with valid JSON/);
    }
  });
});
