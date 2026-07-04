import { describe, it, expect } from 'vitest';
import { resolveRepo, slugify, writeRefused, b64encode, b64decode, BRANCH_PREFIX } from './forge';

describe('forge guards', () => {
  it('allows only her own repos, with or without the owner prefix', () => {
    expect(resolveRepo('elle-worker')).toBe('elle-worker');
    expect(resolveRepo('sbarteau2022/elle-worker')).toBe('elle-worker');
    expect(resolveRepo('ELLE')).toBe('Elle');
    expect(resolveRepo('elle-dev-console')).toBe('elle-dev-console');
    expect(resolveRepo('elle-law')).toBe('elle-law');
    expect(resolveRepo('sbarteau2022/elle-law')).toBe('elle-law');
    expect(resolveRepo('someone/other-repo')).toBeNull();
    expect(resolveRepo('elle-worker-evil')).toBeNull();
    expect(resolveRepo('')).toBeNull();
  });

  it('refuses writes to anything but elle/* branches', () => {
    expect(writeRefused('main', 'src/index.ts')).toMatch(/never "main"/);
    expect(writeRefused('feature/x', 'src/index.ts')).toMatch(/elle\//);
    expect(writeRefused(`${BRANCH_PREFIX}edi-hookup-a1b2`, 'src/edi.ts')).toBeNull();
  });

  it('refuses writes to the CI gate and traversals', () => {
    const b = `${BRANCH_PREFIX}task-0000`;
    expect(writeRefused(b, '.github/workflows/ci.yml')).toMatch(/read-only/);
    expect(writeRefused(b, '.github/workflows/anything.yml')).toMatch(/read-only/);
    expect(writeRefused(b, 'src/../.github/workflows/ci.yml')).toMatch(/traversal/);
    expect(writeRefused(b, '')).toMatch(/path required/);
    expect(writeRefused(b, '.github/pull_request_template.md')).toBeNull();
  });

  it('slugifies titles into branch-safe fragments', () => {
    expect(slugify('Universal EDI hookup for purveyors')).toBe('universal-edi-hookup-for-purveyors');
    expect(slugify('  ~~weird!! title??  ')).toBe('weird-title');
    expect(slugify('')).toBe('task');
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(48);
  });

  it('round-trips unicode through base64', () => {
    const s = 'κ dynamics — dérivées; 中文; emoji 🜁\nline two';
    expect(b64decode(b64encode(s))).toBe(s);
  });
});
