import { describe, it, expect } from 'vitest';
import {
  dynamicBudget,
  normalizeQuery,
  hashKey,
  workingSetKey,
  BUDGET_MIN,
  BUDGET_MAX,
} from './kv-cache';

describe('dynamicBudget', () => {
  it('loads nothing for empty or trivial turns', () => {
    expect(dynamicBudget('')).toBe(BUDGET_MIN);
    expect(dynamicBudget('   ')).toBe(BUDGET_MIN);
    expect(dynamicBudget('hi')).toBe(BUDGET_MIN);
    expect(dynamicBudget('Hey!')).toBe(BUDGET_MIN);
    expect(dynamicBudget('thanks')).toBe(BUDGET_MIN);
    expect(dynamicBudget('got it')).toBe(BUDGET_MIN);
  });

  it('loads nothing for a sub-threshold aside with no question and no recall cue', () => {
    expect(dynamicBudget('the blue sky')).toBe(BUDGET_MIN);
  });

  it('warms a set for a real question', () => {
    const b = dynamicBudget('what did the last trade actually return on close?');
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThanOrEqual(BUDGET_MAX);
  });

  it('widens hard when the turn explicitly reaches into the past', () => {
    const plain = dynamicBudget('summarize the current trading thesis in detail');
    const cued = dynamicBudget('remember the current trading thesis we discussed in detail');
    expect(cued).toBeGreaterThan(plain);
  });

  it('grows with length and multi-part structure', () => {
    const short = dynamicBudget('what is the thesis?');
    const long = dynamicBudget(
      'walk through the thesis, then the open positions, and also the realized pnl, ' +
      'and explain how each one connects to the risk posture you settled on earlier'
    );
    expect(long).toBeGreaterThan(short);
  });

  it('never exceeds the max, even for a maximal query', () => {
    const huge = 'remember ' + 'why does the model, and the plan, then also the risk? '.repeat(40);
    expect(dynamicBudget(huge)).toBeLessThanOrEqual(BUDGET_MAX);
  });

  it('honors a lower max override', () => {
    const q = 'remember everything we discussed about the thesis and the positions in detail?';
    expect(dynamicBudget(q, { max: 500 })).toBeLessThanOrEqual(500);
  });

  it('is deterministic', () => {
    const q = 'what did we decide about the risk posture, and why?';
    expect(dynamicBudget(q)).toBe(dynamicBudget(q));
  });
});

describe('normalizeQuery', () => {
  it('collapses case, whitespace, and punctuation to one canonical form', () => {
    expect(normalizeQuery('  The Thesis, Please!  ')).toBe('the thesis please');
    expect(normalizeQuery('the   thesis')).toBe('the thesis');
    expect(normalizeQuery('“The Thesis”')).toBe('the thesis');
  });

  it('preserves the question mark so a question differs from its statement', () => {
    expect(normalizeQuery('the thesis?')).toBe('the thesis?');
    expect(normalizeQuery('the thesis')).not.toBe(normalizeQuery('the thesis?'));
  });

  it('maps whitespace/case/punct-only variants to the same string', () => {
    expect(normalizeQuery('What is the THESIS?')).toBe(normalizeQuery('what   is the thesis?'));
    expect(normalizeQuery("what's the plan")).toBe(normalizeQuery('Whats the plan.'));
  });

  it('handles nullish input', () => {
    expect(normalizeQuery(undefined as unknown as string)).toBe('');
    expect(normalizeQuery(null as unknown as string)).toBe('');
  });
});

describe('hashKey', () => {
  it('is stable and 8 hex chars', () => {
    const h = hashKey('the thesis');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashKey('the thesis')).toBe(h);
  });

  it('separates distinct inputs', () => {
    expect(hashKey('the thesis')).not.toBe(hashKey('the plan'));
  });

  it('handles the empty string', () => {
    expect(hashKey('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('workingSetKey', () => {
  it('is scoped by session and collapses equivalent queries', () => {
    const a = workingSetKey('sess-1', 'What is the thesis?');
    const b = workingSetKey('sess-1', 'what   is the THESIS?');
    expect(a).toBe(b);
    expect(a.startsWith('wsc:sess-1:')).toBe(true);
  });

  it('separates sessions so one session never serves another cached set', () => {
    expect(workingSetKey('sess-1', 'the thesis')).not.toBe(workingSetKey('sess-2', 'the thesis'));
  });

  it('falls back to a global scope when there is no session', () => {
    expect(workingSetKey(null, 'the thesis').startsWith('wsc:global:')).toBe(true);
  });
});
