// Pure-logic tests for the blanket completeness scorer. No network, no D1.
//
// The A1/A2/A3/A7 blocks below are regression tests for the four defects
// docs/observer_blanket_siege.cjs found in the pre-revision scorer. Each is
// written so that it FAILS against that old scorer:
//   A1 — the old weights summed to 0.96, so the top of the scale was unreachable
//        and the closing Math.min(...,1) was dead code.
//   A2 — the old blanket term was Math.min(nWf,3)/3, so the 4th agent and the
//        30th were worth exactly nothing.
//   A3 — every old predicate was a truthiness test, so a '.'-filled extraction
//        scored identically to a substantive one.
//   A7 — the old scorer threw on malformed input (blankets as a string,
//        collisions as an object) instead of scoring it.
import { describe, it, expect } from 'vitest';
import { completenessFromExtraction, type BlanketModel } from './observer-blanket';

// The reachable maximum of the scorer, stated here as the test's own constant so
// a silent change to the weights breaks this file rather than passing quietly.
const REACHABLE_MAX = 1.0;
// Agents at or beyond this count earn the full blanket weight (BLANKET_SATURATION).
const SATURATION = 8;

const agent = (i: number, nested?: string): BlanketModel['blankets'][number] => ({
  blanket_id: `b${i}`,
  name: `agent ${i}`,
  scale: 'institution',
  boundary_mechanism: 'credentials and licensure',
  internal_target_states: ['prestige'],
  defensive_behaviors: ['reject anomaly'],
  ...(nested ? { nested_within: nested } : {}),
});

const agents = (n: number): BlanketModel['blankets'] =>
  Array.from({ length: n }, (_, i) => agent(i + 1, i === 0 ? 'b2' : undefined));

const full: BlanketModel = {
  blankets: [
    { name: 'the agency', scale: 'institution', boundary_mechanism: 'credentials', internal_target_states: ['prestige'], defensive_behaviors: ['reject anomaly'], nested_within: 'B' },
    { name: 'the polity', scale: 'super_system', boundary_mechanism: 'legal charter', internal_target_states: ['stability'], defensive_behaviors: ['accept story'] },
    { name: 'the sponsor', scale: 'sub_organization', boundary_mechanism: 'capital', internal_target_states: ['solvency'], defensive_behaviors: ['hide debt'] },
  ],
  collisions: [{ sub_blanket_id: 'C', target_blanket_id: 'B', collision_mechanism: 'exports risk', risk_classification: 'structural_rupture', dissent_trough_signature: 'the anomaly' }],
  epistemic_suppression: { suppressed_signal: 's', beneficiary_blanket_id: 'A', cost_bearer_blanket_id: 'B' },
  systemic_alignment_verdict: { status: 'systemically_fragile', reasoning: 'the sponsor exports its risk upward' },
};

// A maximal extraction: every block filled, SATURATION well-formed agents.
const maximal: BlanketModel = { ...full, blankets: agents(SATURATION) };

describe('observer-blanket · completeness scorer', () => {
  it('a fully-specified extraction scores high', () => {
    expect(completenessFromExtraction(full)).toBeGreaterThan(0.85);
  });
  it('null / empty extraction scores 0', () => {
    expect(completenessFromExtraction(null)).toBe(0);
    expect(completenessFromExtraction({ blankets: [], collisions: [] })).toBe(0);
  });
  it('a thin model (one agent, no collision, no suppression) scores low', () => {
    const thin: BlanketModel = {
      blankets: [{ name: 'the agency', scale: 'institution', boundary_mechanism: 'credentials', internal_target_states: ['prestige'], defensive_behaviors: ['reject anomaly'] }],
      collisions: [],
    };
    const s = completenessFromExtraction(thin);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.2);
  });
  it('blankets missing required fields do not count as well-formed', () => {
    const malformed: BlanketModel = {
      blankets: [{ name: 'the agency', scale: 'institution', boundary_mechanism: 'credentials', internal_target_states: [], defensive_behaviors: [] }],
      collisions: [{ collision_mechanism: 'exports risk', risk_classification: 'institutional_capture' }],
    };
    // the collision block counts; the blanket contributes nothing
    expect(completenessFromExtraction(malformed)).toBeCloseTo(0.21, 6);
  });
  it('is monotone — adding structure never lowers the score', () => {
    const base: BlanketModel = { blankets: [full.blankets[0]], collisions: [] };
    expect(completenessFromExtraction(full)).toBeGreaterThanOrEqual(completenessFromExtraction(base));
  });
});

// ── A1 ────────────────────────────────────────────────────────────────────────
// The reachable maximum is EXACTLY 1.0 and is actually attained. Against the old
// 0.96 weights the first assertion fails (0.96 !== 1) — which is precisely the
// defect: the clamp could never fire, so it was dead code.
describe('observer-blanket · A1 the top of the scale is reachable', () => {
  it('a maximal extraction scores exactly the reachable maximum, 1.0', () => {
    expect(completenessFromExtraction(maximal)).toBe(REACHABLE_MAX);
  });
  it('no extraction can exceed the reachable maximum', () => {
    const excessive: BlanketModel = { ...full, blankets: agents(200) };
    expect(completenessFromExtraction(excessive)).toBe(REACHABLE_MAX);
    expect(completenessFromExtraction(excessive)).toBeLessThanOrEqual(REACHABLE_MAX);
  });
  it('every score lies in [0, reachable maximum]', () => {
    for (const n of [0, 1, 2, 3, 4, 8, 30]) {
      const s = completenessFromExtraction({ ...full, blankets: agents(n) });
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(REACHABLE_MAX);
    }
  });
});

// ── A2 ────────────────────────────────────────────────────────────────────────
// Agents past the third must still carry information. Against the old
// Math.min(nWf,3)/3 term, scores for 3/4/8/30 agents were all identical and the
// strict-increase assertions below fail.
describe('observer-blanket · A2 additional agents keep paying, with diminishing returns', () => {
  const scoreFor = (n: number) => completenessFromExtraction({ ...full, blankets: agents(n) });

  it('the score strictly increases with each agent up to saturation', () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8].map(scoreFor);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThan(series[i - 1]);
    }
  });
  it('specifically, the 4th agent is worth more than nothing', () => {
    expect(scoreFor(4)).toBeGreaterThan(scoreFor(3));
    expect(scoreFor(30)).toBeGreaterThan(scoreFor(3));
  });
  it('returns diminish: each agent adds less than the one before it', () => {
    const d = (n: number) => scoreFor(n) - scoreFor(n - 1);
    for (let n = 3; n <= SATURATION; n++) {
      expect(d(n)).toBeLessThan(d(n - 1));
      expect(d(n)).toBeGreaterThan(0);
    }
  });
  it('and it saturates: past SATURATION agents the term is bounded and flat', () => {
    expect(scoreFor(SATURATION + 1)).toBe(scoreFor(SATURATION));
    expect(scoreFor(500)).toBe(scoreFor(SATURATION));
  });
});

// ── A3 ────────────────────────────────────────────────────────────────────────
// A content-free extraction must not score like a real one. Against the old
// presence-only predicates the vacuous fixture below scored 0.96 — the maximum,
// identical to `maximal` — and every assertion here fails.
describe('observer-blanket · A3 a content-free extraction does not score like a reading', () => {
  // Same SHAPE as `maximal`: every field present, real enum values, only the
  // free-text content replaced with a single punctuation character.
  const vacuous = {
    blankets: Array.from({ length: SATURATION }, () => ({
      blanket_id: '.', name: '.', scale: 'institution', nested_within: '.',
      boundary_mechanism: '.', internal_target_states: ['.'], defensive_behaviors: ['.'],
    })),
    collisions: [{ collision_id: '.', sub_blanket_id: '.', target_blanket_id: '.', collision_mechanism: '.', risk_classification: 'institutional_capture', dissent_trough_signature: '.' }],
    epistemic_suppression: { suppressed_signal: '.', beneficiary_blanket_id: '.', cost_bearer_blanket_id: '.' },
    systemic_alignment_verdict: { status: 'systemically_fragile', reasoning: '.' },
  } as unknown as BlanketModel;

  it('scores strictly below an equally-shaped substantive extraction', () => {
    expect(completenessFromExtraction(vacuous)).toBeLessThan(completenessFromExtraction(maximal));
  });
  it('and scores below even a single well-formed agent', () => {
    const oneReal: BlanketModel = { blankets: [agent(1)], collisions: [] };
    expect(completenessFromExtraction(vacuous)).toBeLessThan(completenessFromExtraction(oneReal));
  });
  it('whitespace-only and empty-string fields do not count', () => {
    const blank = { ...vacuous, epistemic_suppression: { suppressed_signal: '   ', beneficiary_blanket_id: '', cost_bearer_blanket_id: '\t\n' } } as unknown as BlanketModel;
    expect(completenessFromExtraction(blank)).toBeLessThan(completenessFromExtraction(vacuous as BlanketModel) + 1e-9);
    expect(completenessFromExtraction({ ...blank, systemic_alignment_verdict: {} } as BlanketModel))
      .toBeLessThan(completenessFromExtraction(blank));
  });
  it('placeholder fillers ("n/a", "TBD", "none") do not count as content', () => {
    const placeheld: BlanketModel = {
      blankets: [],
      collisions: [],
      epistemic_suppression: { suppressed_signal: 'n/a', beneficiary_blanket_id: 'TBD', cost_bearer_blanket_id: 'none' },
    };
    expect(completenessFromExtraction(placeheld)).toBe(0);
  });
  it('a one-character mechanism is not a mechanism', () => {
    const stub: BlanketModel = {
      blankets: [{ name: 'the agency', scale: 'institution', boundary_mechanism: 'x', internal_target_states: ['prestige'], defensive_behaviors: ['reject anomaly'] }],
      collisions: [],
    };
    expect(completenessFromExtraction(stub)).toBe(0);
  });
});

// ── A7 ────────────────────────────────────────────────────────────────────────
// The scorer is TOTAL. Against the old scorer, `blankets: 'oops'` and
// `collisions: {a:1}` both threw a TypeError.
describe('observer-blanket · A7 the scorer is total — never throws, always a number', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['empty arrays', { blankets: [], collisions: [] }],
    ['blankets as a string', { blankets: 'oops', collisions: [] }],
    ['blankets as a number', { blankets: 7, collisions: [] }],
    ['blankets as null', { blankets: null, collisions: null }],
    ['collisions as an object', { blankets: [], collisions: { a: 1 } }],
    ['collision entries not objects', { blankets: [], collisions: ['x', 3, null] }],
    ['blanket entries not objects', { blankets: ['x', 3, null], collisions: [] }],
    ['epistemic_suppression as a string', { blankets: [], collisions: [], epistemic_suppression: 'x' }],
    ['epistemic_suppression as an array', { blankets: [], collisions: [], epistemic_suppression: ['x'] }],
    ['systemic_alignment_verdict null', { blankets: [], collisions: [], systemic_alignment_verdict: null }],
    ['systemic_alignment_verdict as a string', { blankets: [], collisions: [], systemic_alignment_verdict: 'ok' }],
    ['internal_target_states as a string', { blankets: [{ name: 'the agency', scale: 'institution', boundary_mechanism: 'credentials', internal_target_states: 'x', defensive_behaviors: ['z'] }], collisions: [] }],
    ['defensive_behaviors as an object', { blankets: [{ name: 'the agency', scale: 'institution', boundary_mechanism: 'credentials', internal_target_states: ['y'], defensive_behaviors: { a: 1 } }], collisions: [] }],
    ['a bare string', 'not a model'],
    ['a number', 42],
    ['a boolean', true],
    ['an array', [1, 2, 3]],
    ['NaN-bearing fields', { blankets: [], collisions: [], epistemic_suppression: { suppressed_signal: NaN } }],
    ['a getter that throws', Object.defineProperty({ collisions: [] }, 'blankets', { get() { throw new Error('boom'); }, enumerable: true })],
  ];

  it.each(cases)('%s → returns a finite number, does not throw', (_label, input) => {
    let out: unknown;
    expect(() => { out = completenessFromExtraction(input as BlanketModel | null); }).not.toThrow();
    expect(typeof out).toBe('number');
    expect(Number.isFinite(out as number)).toBe(true);
    expect(Number.isNaN(out as number)).toBe(false);
    expect(out as number).toBeGreaterThanOrEqual(0);
    expect(out as number).toBeLessThanOrEqual(REACHABLE_MAX);
  });
});
