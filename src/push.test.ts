import { describe, it, expect } from 'vitest';
import { inQuietHours, mayKnock, localHourIn, DEFAULT_PREFS } from './push';

describe('inQuietHours', () => {
  it('handles the midnight wrap (22 → 8)', () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);  // end is exclusive
    expect(inQuietHours(12, 22, 8)).toBe(false);
    expect(inQuietHours(22, 22, 8)).toBe(true);  // start is inclusive
  });

  it('handles a same-day window and the no-window degenerate', () => {
    expect(inQuietHours(14, 13, 17)).toBe(true);
    expect(inQuietHours(12, 13, 17)).toBe(false);
    expect(inQuietHours(5, 9, 9)).toBe(false); // start === end ⇒ never quiet
  });
});

describe('mayKnock — the three laws', () => {
  const prefs = { ...DEFAULT_PREFS }; // budget 2, quiet 22–8

  it('allows a knock inside budget and outside quiet hours', () => {
    expect(mayKnock(prefs, 0, 14).ok).toBe(true);
    expect(mayKnock(prefs, 1, 14).ok).toBe(true);
  });

  it('refuses over budget, with the count in the reason', () => {
    const r = mayKnock(prefs, 2, 14);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2/2');
  });

  it('refuses during quiet hours', () => {
    expect(mayKnock(prefs, 0, 23).ok).toBe(false);
    expect(mayKnock(prefs, 0, 23).reason).toContain('quiet');
  });

  it('a zero budget means she never knocks — the off switch is absolute', () => {
    const r = mayKnock({ ...prefs, reach_budget_per_week: 0 }, 0, 14);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('off');
  });
});

describe('localHourIn', () => {
  it('resolves an hour in a real timezone and degrades to UTC on garbage', () => {
    const noonUTC = new Date('2026-07-07T12:00:00Z');
    expect(localHourIn('America/Chicago', noonUTC)).toBe(7);  // CDT = UTC-5
    expect(localHourIn('not/a-zone', noonUTC)).toBe(12);      // falls back to UTC
  });

  it('never returns 24 (the Intl midnight quirk is normalized)', () => {
    const midnightUTC = new Date('2026-07-07T00:30:00Z');
    expect(localHourIn('UTC', midnightUTC)).toBe(0);
  });
});
