import { describe, it, expect } from 'vitest';
import { parseIntake, BGE_LARGE_DIMS } from './mem-intake';

const goodVector = () => {
  const v = new Array(BGE_LARGE_DIMS).fill(0);
  v[0] = 0.12; v[512] = -0.7; v[1023] = 0.003;
  return v;
};

describe('parseIntake — content contract', () => {
  it('rejects a missing/empty/whitespace content', () => {
    expect(parseIntake({}).error).toMatch(/content/);
    expect(parseIntake({ content: '' }).error).toMatch(/content/);
    expect(parseIntake({ content: '   ' }).error).toMatch(/content/);
    expect(parseIntake({ content: 42 }).error).toMatch(/content/);
  });

  it('accepts bare content with safe defaults, writer named', () => {
    const p = parseIntake({ content: 'she saw the harbor at dusk' });
    expect(p.error).toBeUndefined();
    expect(p.opts!.type).toBe('observation');
    expect(p.opts!.importance).toBeCloseTo(0.6);
    expect(p.opts!.sourceEngine).toBe('workbench_intake');
    expect(p.vector).toBeUndefined();
  });

  it('clamps importance, filters non-string tags, caps at 12', () => {
    const p = parseIntake({ content: 'x', importance: 7, tags: ['a', 3, 'b', ...'cdefghijklmn'.split('')] });
    expect(p.opts!.importance).toBe(1);
    expect(p.opts!.tags!.every((t) => typeof t === 'string')).toBe(true);
    expect(p.opts!.tags!.length).toBe(12);
  });

  it('unknown memory type falls back to observation; known types pass', () => {
    expect(parseIntake({ content: 'x', type: 'plutonium' }).opts!.type).toBe('observation');
    expect(parseIntake({ content: 'x', type: 'insight' }).opts!.type).toBe('insight');
  });
});

describe('parseIntake — supplied-vector contract (fail-fast, precise reasons)', () => {
  it('accepts a well-formed 1024-dim vector', () => {
    const p = parseIntake({ content: 'x', vector: goodVector() });
    expect(p.error).toBeUndefined();
    expect(p.vector!.length).toBe(BGE_LARGE_DIMS);
  });

  it('rejects wrong dimensionality with the dims named — the wrong-model tell', () => {
    const p = parseIntake({ content: 'x', vector: new Array(768).fill(0.1) });
    expect(p.error).toMatch(/768/);
    expect(p.error).toMatch(/1024/);
  });

  it('rejects non-finite entries with the index named', () => {
    const v = goodVector(); v[7] = NaN;
    expect(parseIntake({ content: 'x', vector: v }).error).toMatch(/\[7\]/);
    const w = goodVector(); (w as unknown[])[3] = 'a';
    expect(parseIntake({ content: 'x', vector: w }).error).toMatch(/\[3\]/);
  });

  it('rejects an all-zero vector — a degenerate embed must not enter the space', () => {
    const p = parseIntake({ content: 'x', vector: new Array(BGE_LARGE_DIMS).fill(0) });
    expect(p.error).toMatch(/zero/);
  });

  it('rejects a non-array vector', () => {
    expect(parseIntake({ content: 'x', vector: 'oops' }).error).toMatch(/array/);
  });

  it('null vector means "embed server-side", not an error', () => {
    const p = parseIntake({ content: 'x', vector: null });
    expect(p.error).toBeUndefined();
    expect(p.vector).toBeUndefined();
  });
});
