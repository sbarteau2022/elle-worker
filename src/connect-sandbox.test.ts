import { describe, it, expect } from 'vitest';
import { parseRepoTarget, normalizeCloneTarget, resolveLlmTimeoutMs, buildLlmJob } from './connect-sandbox';

describe('sandbox_clone target routing — which lane carries it', () => {
  it('recognizes owner/name as GitHub-shaped (the always-open cloud lane)', () => {
    expect(parseRepoTarget('sbarteau2022/elle-worker')).toEqual({ repo: 'sbarteau2022/elle-worker', ref: undefined });
  });

  it('carries an explicit ref', () => {
    expect(parseRepoTarget('sbarteau2022/Elle#main')).toEqual({ repo: 'sbarteau2022/Elle', ref: 'main' });
    expect(parseRepoTarget('owner/repo@abc123')).toEqual({ repo: 'owner/repo', ref: 'abc123' });
  });

  it('strips github.com URLs and .git suffixes', () => {
    expect(parseRepoTarget('https://github.com/owner/repo.git')).toEqual({ repo: 'owner/repo', ref: undefined });
    expect(parseRepoTarget('https://www.github.com/owner/repo#dev')).toEqual({ repo: 'owner/repo', ref: 'dev' });
  });

  it('refuses local paths — those need the laptop lane', () => {
    expect(parseRepoTarget('/Users/stewart/projects/thing')).toBeNull();
    expect(parseRepoTarget('./src')).toBeNull();
    expect(parseRepoTarget('src')).toBeNull();          // no owner/name shape
    expect(parseRepoTarget('a path with spaces')).toBeNull();
    expect(parseRepoTarget('')).toBeNull();
  });
});

describe('normalizeCloneTarget — bare own-repo names find their owner', () => {
  it('resolves a bare allowlisted name to sbarteau2022/<name>', () => {
    expect(normalizeCloneTarget('elle-worker')).toBe('sbarteau2022/elle-worker');
    expect(normalizeCloneTarget('Elle')).toBe('sbarteau2022/Elle');
    expect(normalizeCloneTarget('ELLE-WORKER')).toBe('sbarteau2022/elle-worker'); // case-insensitive match, canonical casing out
  });

  it('leaves repo-shaped and pathlike targets untouched', () => {
    expect(normalizeCloneTarget('sbarteau2022/elle-worker')).toBe('sbarteau2022/elle-worker');
    expect(normalizeCloneTarget('other/elle-worker#dev')).toBe('other/elle-worker#dev');
    expect(normalizeCloneTarget('/Users/stewart/code/elle-worker')).toBe('/Users/stewart/code/elle-worker');
    expect(normalizeCloneTarget('./elle-worker')).toBe('./elle-worker');
  });

  it('passes unknown bare names through for the laptop lane to try', () => {
    expect(normalizeCloneTarget('some-other-project')).toBe('some-other-project');
    expect(normalizeCloneTarget('')).toBe('');
  });
});

describe('resolveLlmTimeoutMs — the local inference timeout, env-tunable', () => {
  it('defaults to 180s when unset or garbage', () => {
    expect(resolveLlmTimeoutMs(undefined)).toBe(180_000);
    expect(resolveLlmTimeoutMs('')).toBe(180_000);
    expect(resolveLlmTimeoutMs('not-a-number')).toBe(180_000);
    expect(resolveLlmTimeoutMs('-5')).toBe(180_000);
    expect(resolveLlmTimeoutMs('0')).toBe(180_000);
  });

  it('honors a real override, clamped to the dispatch band', () => {
    expect(resolveLlmTimeoutMs('60000')).toBe(60_000);
    expect(resolveLlmTimeoutMs('50')).toBe(1_000);        // below the floor → floor
    expect(resolveLlmTimeoutMs('999999999')).toBe(600_000); // above the ceiling → ceiling
  });
});

describe('buildLlmJob — temperature rides the wire only when real', () => {
  const msgs = [{ role: 'user' as const, content: 'hi' }];

  it('omits temperature when unset — an older client sees the exact old shape', () => {
    const job = buildLlmJob('j1', 'sys', msgs, 2048, 180_000);
    expect(job).toEqual({ id: 'j1', system: 'sys', messages: msgs, max_tokens: 2048, timeout_ms: 180_000 });
    expect('temperature' in job).toBe(false);
  });

  it('carries a finite temperature, including a deliberate 0', () => {
    expect(buildLlmJob('j2', 's', msgs, 512, 1_000, 0.9).temperature).toBe(0.9);
    expect(buildLlmJob('j2', 's', msgs, 512, 1_000, 0).temperature).toBe(0);
  });

  it('drops NaN and Infinity rather than sending them to the laptop', () => {
    expect('temperature' in buildLlmJob('j3', 's', msgs, 512, 1_000, NaN)).toBe(false);
    expect('temperature' in buildLlmJob('j3', 's', msgs, 512, 1_000, Infinity)).toBe(false);
  });
});
