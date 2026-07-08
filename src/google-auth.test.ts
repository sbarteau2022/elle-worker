import { describe, it, expect } from 'vitest';
import { parseAllowedAudiences, audienceAllowed } from './google-auth';

describe('parseAllowedAudiences', () => {
  it('a single client ID parses to one entry', () => {
    expect(parseAllowedAudiences('123-web.apps.googleusercontent.com'))
      .toEqual(['123-web.apps.googleusercontent.com']);
  });

  it('a comma-separated list parses to all entries, whitespace-tolerant', () => {
    expect(parseAllowedAudiences('123-web.apps.googleusercontent.com, 123-ios.apps.googleusercontent.com'))
      .toEqual(['123-web.apps.googleusercontent.com', '123-ios.apps.googleusercontent.com']);
  });

  it('empty / unset / stray commas yield nothing', () => {
    expect(parseAllowedAudiences(undefined)).toEqual([]);
    expect(parseAllowedAudiences('')).toEqual([]);
    expect(parseAllowedAudiences(' , ,')).toEqual([]);
  });
});

describe('audienceAllowed', () => {
  const conf = '123-web.apps.googleusercontent.com,123-ios.apps.googleusercontent.com';

  it('accepts either allowlisted audience', () => {
    expect(audienceAllowed('123-web.apps.googleusercontent.com', conf)).toBe(true);
    expect(audienceAllowed('123-ios.apps.googleusercontent.com', conf)).toBe(true);
  });

  it("rejects an audience that isn't ours", () => {
    expect(audienceAllowed('attacker.apps.googleusercontent.com', conf)).toBe(false);
  });

  it('rejects a missing aud and an unset config (never open by default)', () => {
    expect(audienceAllowed(undefined, conf)).toBe(false);
    expect(audienceAllowed('', conf)).toBe(false);
    expect(audienceAllowed('123-web.apps.googleusercontent.com', undefined)).toBe(false);
    expect(audienceAllowed('123-web.apps.googleusercontent.com', '')).toBe(false);
  });

  it('is exact-match, not substring — a prefix or superstring aud is rejected', () => {
    expect(audienceAllowed('123-web.apps.googleusercontent.com.evil.com', conf)).toBe(false);
    expect(audienceAllowed('123-web', conf)).toBe(false);
  });
});
