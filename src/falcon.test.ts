// Pure-logic tests for the Millennium Falcon: axis roster integrity (16 axes,
// numbered 1-16, no gaps or duplicates) and the tolerant JSON extractor that
// every axis call runs through. No network, no D1.
import { describe, it, expect } from 'vitest';
import { TIER1_AXES, TIER2_AXES, parseFirstJson, parseDirections } from './falcon';

describe('falcon · the axis roster', () => {
  it('six axes in Tier 1, nine in Tier 2 — fifteen feeding the Rupture as Axis 16', () => {
    expect(TIER1_AXES).toHaveLength(6);
    expect(TIER2_AXES).toHaveLength(9);
  });
  it('numbered 1-15 with no gaps or duplicates, in tier order', () => {
    const all = [...TIER1_AXES, ...TIER2_AXES];
    expect(all.map(a => a.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it('unique ids', () => {
    const all = [...TIER1_AXES, ...TIER2_AXES];
    expect(new Set(all.map(a => a.id)).size).toBe(all.length);
  });
  it('every axis carries a real system prompt instructing JSON-only output', () => {
    for (const a of [...TIER1_AXES, ...TIER2_AXES]) {
      expect(a.system.length).toBeGreaterThan(80);
      expect(a.system).toMatch(/Respond ONLY with valid JSON/);
    }
  });
  it('tier field matches which array the axis is in', () => {
    expect(TIER1_AXES.every(a => a.tier === 1)).toBe(true);
    expect(TIER2_AXES.every(a => a.tier === 2)).toBe(true);
  });
});

describe('falcon · tolerant JSON extraction', () => {
  it('parses a clean JSON object', () => {
    expect(parseFirstJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: 'two' });
  });
  it('unwraps a fenced code block', () => {
    expect(parseFirstJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('finds the first balanced object inside surrounding prose', () => {
    expect(parseFirstJson('Sure, here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });
  it('handles braces inside string values without losing balance', () => {
    expect(parseFirstJson('{"note":"a {nested} brace inside a string","n":2}')).toEqual({ note: 'a {nested} brace inside a string', n: 2 });
  });
  it('returns null on unparseable input', () => {
    expect(parseFirstJson('no json here at all')).toBeNull();
    expect(parseFirstJson('')).toBeNull();
  });
});

describe('falcon · enqueue input parsing', () => {
  it('accepts a directions array, trims, drops empties', () => {
    expect(parseDirections({ directions: ['  Addiction ', '', 'Epilepsy'] })).toEqual(['Addiction', 'Epilepsy']);
  });
  it('folds in a lone `direction` alongside the array', () => {
    expect(parseDirections({ directions: ['Cancer'], direction: 'Alzheimer' })).toEqual(['Cancer', 'Alzheimer']);
  });
  it('dedupes exact repeats', () => {
    expect(parseDirections({ directions: ['Slavery', 'Slavery', 'Dreyfus'] })).toEqual(['Slavery', 'Dreyfus']);
  });
  it('caps at 200 directions', () => {
    const many = Array.from({ length: 250 }, (_, i) => `d${i}`);
    expect(parseDirections({ directions: many })).toHaveLength(200);
  });
  it('returns empty when nothing usable is given', () => {
    expect(parseDirections({})).toEqual([]);
    expect(parseDirections({ directions: ['   ', ''] })).toEqual([]);
  });
});
