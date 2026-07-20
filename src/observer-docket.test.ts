// Pure-logic tests for the Observer docket and grounding block. No network,
// no D1: the docket is version-controlled data and groundingBlock is pure.
import { describe, it, expect } from 'vitest';
import { OBSERVER_DOCKET, docketOutcomeForSubject } from './observer-docket';
import { groundingBlock } from './observer';
import { POWER_FLOOR } from './observer-falsifier';

describe('observer docket · the closed-case run-queue', () => {
  it('holds thirty cases, each with a non-empty subject, anchor, and realized outcome', () => {
    expect(OBSERVER_DOCKET.length).toBe(30);
    for (const c of OBSERVER_DOCKET) {
      expect(c.subject.trim().length).toBeGreaterThan(40);
      expect(c.anchor.trim().length).toBeGreaterThan(10);
      expect(c.realizedOutcome.trim().length).toBeGreaterThan(40);
    }
  });

  it('is large enough to clear the falsifier power floor with margin — the reason for the expansion', () => {
    // A ten-case docket cannot escape UNDERPOWERED (POWER_FLOOR = 8) once any
    // run drops; thirty leaves real headroom for drops and for a Spearman test.
    expect(OBSERVER_DOCKET.length).toBeGreaterThanOrEqual(POWER_FLOOR * 3);
  });

  it('every case key is unique — the join key between queue, analysis, and outcome', () => {
    const keys = OBSERVER_DOCKET.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every subject carries the frozen-clock instruction — reason only from what was knowable then', () => {
    for (const c of OBSERVER_DOCKET) {
      expect(c.subject).toMatch(/Analyze this case AS OF /);
      expect(c.subject).toMatch(/treat everything after that date as genuinely unknown/);
    }
  });

  it('docketOutcomeForSubject round-trips a subject back to its realized outcome', () => {
    const c = OBSERVER_DOCKET[0];
    const found = docketOutcomeForSubject(c.subject);
    expect(found?.key).toBe(c.key);
    expect(found?.realizedOutcome).toBe(c.realizedOutcome);
  });

  it('docketOutcomeForSubject tolerates surrounding whitespace but returns null for a non-docket subject', () => {
    const c = OBSERVER_DOCKET[3];
    expect(docketOutcomeForSubject(`  ${c.subject}  `)?.key).toBe(c.key);
    expect(docketOutcomeForSubject('some open case never on the docket')).toBeNull();
    expect(docketOutcomeForSubject('')).toBeNull();
  });
});

describe('observer · groundingBlock (pure corpus-grounding formatter)', () => {
  it('returns empty string when nothing was retrieved — a run with no grounding is honest, not broken', () => {
    expect(groundingBlock([])).toBe('');
  });

  it('formats retrieved passages as bounded reference lines, one per title', () => {
    const block = groundingBlock([
      { title: 'Witness Engine', text: 'the what_both_suppress field is the load-bearing tool' },
      { title: 'War in Superposition', text: 'independent convergence on the same structure' },
    ]);
    expect(block).toMatch(/Grounding passages retrieved from the sealed corpus/);
    expect(block).toContain('[Witness Engine]');
    expect(block).toContain('[War in Superposition]');
    expect(block.split('\n— ').length).toBe(3); // header + 2 passage lines
  });

  it('caps at six passages and truncates each to keep within the axis token budget', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `doc${i}`, text: 'x'.repeat(2000) }));
    const block = groundingBlock(many);
    const lines = block.split('\n').filter(l => l.startsWith('— '));
    expect(lines.length).toBe(6);
    for (const l of lines) expect(l.length).toBeLessThan(560); // "— [docN] " + 500 chars
  });

  it('collapses internal whitespace so multi-line corpus chunks stay one reference line each', () => {
    const block = groundingBlock([{ title: 'd', text: 'line one\n\n  line two\tline three' }]);
    const passage = block.split('\n').find(l => l.startsWith('— '))!;
    expect(passage).toBe('— [d] line one line two line three');
  });
});
