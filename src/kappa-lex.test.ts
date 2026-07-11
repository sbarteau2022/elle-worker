// Tests for the lex2 κ estimator (journal.ts) — the fixed-point repair.
//
// The v1 formula was 0.5 + (grounded−hedge)/N over two ~10-word lexicons, so
// every text containing none of those words returned EXACTLY 0.5000. In
// production that was 84% of computed turns: a point-mass masquerading as a
// measurement. These tests pin the property that killed v1 (no large
// equivalence class collapsing to one value) and the directional intents that
// were always the formula's point (hedging ↓, grounded assertion ↑,
// repetitive circling ↓).
//
//   npx vitest run src/kappa-lex.test.ts
import { describe, it, expect } from 'vitest';
import { computeKappa, computeKappaDetail, KAPPA_DEF } from './journal';

// Marker-free casual texts — none contain a hedge/grounded lexicon word.
// Under v1 every one of these returned exactly 0.5.
const MARKER_FREE = [
  'The garden looked different after the rain stopped this morning.',
  'She walked to the corner store. The bread was gone. A note on the shelf offered raincheck slips.',
  'Four birds on the wire. Then three. The cat watched from the porch rail without moving at all.',
  'We packed the car before dawn and drove east along the coast road with the windows down.',
  'His grandfather kept every receipt in a cigar box, sorted by month, tied with string.',
  'The recipe calls for two eggs, a cup of flour, and patience with the oven door.',
  'Water finds the crack in any foundation given a season of freezing and thawing again.',
  'Nobody remembered who painted the mural on the water tower, only that one summer it appeared.',
];

describe('lex2 fixed-point repair', () => {
  it('marker-free texts no longer collapse to a single value', () => {
    const values = MARKER_FREE.map(computeKappa);
    // The killed pathology: one equivalence class → one value. Distinct texts
    // must produce a spread of values, not a point-mass.
    expect(new Set(values).size).toBeGreaterThanOrEqual(6);
  });

  it('no exact-0.5000 point mass on ordinary prose', () => {
    const at05 = MARKER_FREE.map(computeKappa).filter(v => v === 0.5).length;
    expect(at05).toBe(0);
  });

  it('stays within [0,1] under extreme input', () => {
    const extremes = [
      'must '.repeat(400),                                     // grounded flood
      'maybe perhaps possibly '.repeat(300),                   // hedge flood
      'word '.repeat(1000),                                    // maximal repetition
      'a.',                                                    // near-empty
      Array.from({ length: 500 }, (_, i) => `tok${i}`).join(' '), // maximal diversity
    ];
    for (const t of extremes) {
      const k = computeKappa(t);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
  });
});

describe('lex2 directional intent', () => {
  const base = 'The proof holds under composition and the boundary case is covered by the lemma we established.';
  it('grounded assertion raises κ relative to hedged equivocation', () => {
    const grounded = `${base} This is proven, therefore the result must follow, and it clearly does.`;
    const hedged = `${base} Maybe it holds, perhaps, though I guess it is unclear and it sort of seems arguable.`;
    expect(computeKappa(grounded)).toBeGreaterThan(computeKappa(hedged));
  });

  it('repetitive circling lowers κ relative to diverse prose of the same shape', () => {
    const circling = 'the same edge again and again the same edge again and again the same edge again and again the same edge again and again the same edge again and again';
    const diverse = 'each morning brings a different question about structure memory rhythm color weight distance silence pressure orbit texture and the instrument that measures them';
    expect(computeKappa(circling)).toBeLessThan(computeKappa(diverse));
  });
});

describe('lex2 contract', () => {
  it('is deterministic', () => {
    for (const t of MARKER_FREE) expect(computeKappa(t)).toBe(computeKappa(t));
  });

  it('computeKappa equals computeKappaDetail(...).kappa and carries the def tag', () => {
    for (const t of MARKER_FREE.slice(0, 3)) {
      const d = computeKappaDetail(t);
      expect(computeKappa(t)).toBe(d.kappa);
      expect(d.def).toBe(KAPPA_DEF);
    }
  });

  it('empty input returns the neutral value with zeroed features', () => {
    const d = computeKappaDetail('');
    expect(d.kappa).toBe(0.5);
    expect(d.words).toBe(0);
  });

  it('detail exposes the features a future validation needs', () => {
    const d = computeKappaDetail('It must hold because the lemma forces it; therefore we are done.');
    expect(d.grounded).toBeGreaterThan(0);
    expect(d.sentences).toBeGreaterThanOrEqual(1);
    expect(d.ttr).toBeGreaterThan(0);
    expect(typeof d.connective_density).toBe('number');
  });
});
