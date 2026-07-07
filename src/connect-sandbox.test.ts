import { describe, it, expect } from 'vitest';
import { parseRepoTarget, normalizeCloneTarget } from './connect-sandbox';

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
