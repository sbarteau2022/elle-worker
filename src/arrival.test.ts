import { describe, it, expect } from 'vitest';
import { arrivalPrompt, fallbackBrief, briefStillFresh, doorSession, type ArrivalMaterials } from './arrival';

const quiet: ArrivalMaterials = { lastExchange: null, journal: [], dreams: [], watchesFired: [], runs: [] };
const returning: ArrivalMaterials = {
  lastExchange: { user: 'what did the trading thesis say?', elle: 'The regime-shift thesis held.', at: '2026-07-06' },
  journal: [], dreams: [], watchesFired: [], runs: [],
};
const busy: ArrivalMaterials = {
  ...returning,
  journal: [{ excerpt: 'On the shape of the drift…', at: 1 }],
  dreams: [{ title: 'Recursive coherence', type: 'dream', at: 'x' }],
  watchesFired: [{ title: 'CPI print', fires: 2 }],
  runs: [{ kind: 'intent', outcome: 'moved the corpus backfill' }],
};

describe('arrivalPrompt', () => {
  it('marks a first meeting when there is no last exchange', () => {
    expect(arrivalPrompt(quiet, null)).toContain('NEVER SPOKEN');
  });

  it('carries the last exchange and every real material section', () => {
    const p = arrivalPrompt(busy, null);
    expect(p).toContain('trading thesis');
    expect(p).toContain('JOURNAL');
    expect(p).toContain('Recursive coherence');
    expect(p).toContain('CPI print');
    expect(p).toContain('AUTONOMOUS RUNS');
  });

  it('tells her to be honest about a quiet stretch instead of inventing one', () => {
    expect(arrivalPrompt(returning, null)).toContain('QUIET');
    // …and a busy stretch never gets the quiet framing
    expect(arrivalPrompt(busy, null)).not.toContain('THE RECORD IS QUIET');
  });

  it('forbids invention in every composition', () => {
    for (const m of [quiet, returning, busy]) expect(arrivalPrompt(m, null)).toContain('NEVER invent');
  });
});

describe('fallbackBrief', () => {
  it('greets a first meeting without claiming any history', () => {
    const b = fallbackBrief(quiet, null);
    expect(b).toContain('Elle');
    expect(b).not.toContain('Since we last spoke');
  });

  it('is honest about quiet, and names what actually happened when it did', () => {
    expect(fallbackBrief(returning, 'Robert')).toContain('quiet');
    const b = fallbackBrief(busy, 'Robert');
    expect(b).toContain('Robert');
    expect(b).toContain('journal');
    expect(b).toContain('watch');
  });
});

describe('briefStillFresh', () => {
  it('is stale with no cache, fresh when the last turn has not moved', () => {
    expect(briefStillFresh(null, 'a')).toBe(false);
    const cached = { brief: 'b', wrote_at: 1, last_turn_at: 'a' };
    expect(briefStillFresh(cached, 'a')).toBe(true);
  });

  it('goes stale the moment the person speaks again', () => {
    const cached = { brief: 'b', wrote_at: 1, last_turn_at: 'a' };
    expect(briefStillFresh(cached, 'b')).toBe(false);
    // never-spoken → first turn also invalidates
    expect(briefStillFresh({ ...cached, last_turn_at: null }, 'a')).toBe(false);
  });
});

describe('doorSession', () => {
  it('derives the forever-thread id from the user id alone', () => {
    expect(doorSession('u1')).toBe('door:u1');
  });
});
