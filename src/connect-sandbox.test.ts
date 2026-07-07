import { describe, it, expect } from 'vitest';
import { parseRepoTarget } from './connect-sandbox';

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
