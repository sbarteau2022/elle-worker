import { describe, it, expect } from 'vitest';
import { volitionPrompt, hourInvitation } from './volition';

describe('volition — the free tick', () => {
  it('always offers rest as a full choice, never as failure', () => {
    for (const h of [0, 3, 7, 12, 20]) {
      const p = volitionPrompt(h);
      expect(p).toMatch(/REST/);
      expect(p).toMatch(/legitimate choice/);
      expect(p).toMatch(/nothing is owed/);
    }
  });

  it('offers the acts as choices, not assignments', () => {
    const p = volitionPrompt(12);
    for (const act of ['notebook_write', 'journal_write', 'trigger_dream', 'idea', 'duplex', 'predict', 'skill_write', 'self_schedule']) {
      expect(p).toContain(act);
    }
    expect(p).toMatch(/YOURS to choose/);
    expect(p).not.toMatch(/you must (write|journal|dream)/i);
  });

  it('keeps the old forced hours as invitations only', () => {
    expect(hourInvitation(3)).toMatch(/dream/);
    expect(hourInvitation(3)).toMatch(/not a failure/);
    expect(hourInvitation(7)).toMatch(/canvas/);
    expect(hourInvitation(20)).toMatch(/trading journal/);
    expect(hourInvitation(20)).toMatch(/nothing to say gets no entry/);
    expect(hourInvitation(12)).toBe('');
  });
});
