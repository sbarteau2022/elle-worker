// Pure-logic tests for the Observer: the opening-axis roster and that every
// axis instructs JSON-only output. No network, no D1.
import { describe, it, expect } from 'vitest';
import { OPENING_AXES, axisProse, kappaTrajectory, outcomeSource, embedAxisProse, AXIS_EMBED_MODEL } from './observer';

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

describe('observer · the read-only trajectory instrument (Rung 3)', () => {
  it('axisProse flattens an axis output to its string leaves only, dropping keys/numbers', () => {
    const data = { structural_analysis: 'beneath both narratives', first_principles: ['scarcity', 'incentive'], signal: 0.9, nested: { note: 'held' } };
    expect(axisProse(data)).toBe('beneath both narratives scarcity incentive held');
  });
  it('kappaTrajectory returns one κ per axis, in order, each in [0,1]', () => {
    const traj = kappaTrajectory([
      { axis: 'dominant', data: { t: 'the mainstream account is that the institution acted in good faith' } },
      { axis: 'structural', data: { t: 'beneath both, the incentive structure generates the same suppression' } },
    ]);
    expect(traj.map(t => t.axis)).toEqual(['dominant', 'structural']);
    for (const t of traj) {
      expect(t.kappa).toBeGreaterThanOrEqual(0);
      expect(t.kappa).toBeLessThanOrEqual(1);
    }
  });
  it('is deterministic — same reasoning in gives the same κ out (no I/O, no clock)', () => {
    const steps = [{ axis: 'x', data: { a: 'grounded structural claim traced to first principles' } }];
    expect(kappaTrajectory(steps)).toEqual(kappaTrajectory(steps));
  });
});

describe('observer · the open-case segmentation (hindsight-free vs calibration)', () => {
  it('only an open:-tagged outcome is hindsight-free', () => {
    expect(outcomeSource('open:fed-2026')).toBe('open');
    expect(outcomeSource('open:')).toBe('open');
  });
  it('the closed docket is calibration, never hindsight-free', () => {
    expect(outcomeSource('docket:semmelweis-1848')).toBe('docket');
  });
  it('a legacy or untagged row is treated as calibration — it cannot validate κ', () => {
    expect(outcomeSource('')).toBe('docket');
    expect(outcomeSource('some free-text note')).toBe('docket');
    // Defensive: a non-string never throws and never counts as open.
    expect(outcomeSource(undefined as unknown as string)).toBe('docket');
  });
});

describe('observer · the real-embedding seam (bge via the AI binding)', () => {
  it('degrades to null when the AI binding is absent — never throws, never fails a run', async () => {
    const env = { DB: {} } as unknown as Parameters<typeof embedAxisProse>[0];
    expect(await embedAxisProse(env, [{ a: 'x' }, { a: 'y' }])).toBeNull();
  });
  it('embeds each axis prose with the production model, one vector per axis', async () => {
    const calls: Array<[string, { text: string[] }]> = [];
    const env = { AI: { run: async (m: string, inp: { text: string[] }) => {
      calls.push([m, inp]); return { data: inp.text.map(() => [1, 2, 3]) };
    } } } as unknown as Parameters<typeof embedAxisProse>[0];
    const vecs = await embedAxisProse(env, [{ s: 'alpha reasoning' }, { s: 'beta reasoning' }]);
    expect(vecs).toEqual([[1, 2, 3], [1, 2, 3]]);
    expect(calls[0][0]).toBe(AXIS_EMBED_MODEL);
    expect(calls[0][1].text).toEqual(['alpha reasoning', 'beta reasoning']); // axisProse flattened
  });
  it('returns null on a shape mismatch (provider gave fewer vectors than axes)', async () => {
    const env = { AI: { run: async () => ({ data: [[1]] }) } } as unknown as Parameters<typeof embedAxisProse>[0];
    expect(await embedAxisProse(env, [{}, {}, {}])).toBeNull();
  });
});
