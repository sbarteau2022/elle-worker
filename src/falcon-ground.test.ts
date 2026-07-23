// Pure-logic tests for the Material Ground gate. No network, no D1.
import { describe, it, expect } from 'vitest';
import { dedupeSources, assertGrounded, groundToBlock, GroundingUnavailableError, type MaterialGround } from './falcon-ground';

const base = (over: Partial<MaterialGround>): MaterialGround => ({
  grounded: false, findings: [], sources: [], corpus: [], passes: 1, provider: 'none', searchProse: '', ...over,
});

describe('falcon-ground · the firing gate', () => {
  it('refuses to fire when the sweep returned no real grounding', () => {
    expect(() => assertGrounded(base({ grounded: false, provider: 'openrouter' }))).toThrow(GroundingUnavailableError);
  });
  it('names the provider in the refusal so an outage is diagnosable', () => {
    try { assertGrounded(base({ grounded: false, provider: 'openrouter' })); }
    catch (e) { expect((e as Error).message).toMatch(/openrouter/); return; }
    throw new Error('expected a refusal');
  });
  it('fires when the sweep returned real cited grounding', () => {
    expect(() => assertGrounded(base({ grounded: true, sources: ['SEC 10-K'] }))).not.toThrow();
  });
});

describe('falcon-ground · source dedupe', () => {
  it('dedupes case-insensitively and trims, preserving order', () => {
    expect(dedupeSources(['Reuters', ' reuters ', 'Bloomberg', 'REUTERS'])).toEqual(['Reuters', 'Bloomberg']);
  });
  it('drops empties', () => {
    expect(dedupeSources(['', '  ', 'FT'])).toEqual(['FT']);
  });
});

describe('falcon-ground · the axis reference block', () => {
  it('numbers findings, carries sources, and instructs grounding not invention', () => {
    const g = base({
      grounded: true,
      findings: [{ claim: 'ARR grew 40% YoY', source: 'S-1', dimension: 'financial' }],
      sources: ['S-1'], passes: 2,
    });
    const block = groundToBlock(g);
    expect(block).toMatch(/ARR grew 40% YoY/);
    expect(block).toMatch(/S-1/);
    expect(block).toMatch(/do not invent/i);
    expect(block).toMatch(/2 sweep passes/);
  });
  it('folds in the historical corpus look-back when present', () => {
    const g = base({ grounded: true, corpus: [{ title: 'Dot-com capex cycle', series: 'econ', text: 'overbuild then collapse', score: 0.7 }] });
    expect(groundToBlock(g)).toMatch(/HISTORICAL LOOK-BACK/);
    expect(groundToBlock(g)).toMatch(/Dot-com capex cycle/);
  });
});
