import { describe, it, expect } from 'vitest';
import { parseVersionedTitle, groupVersionFamilies } from './corpus-lineage';

describe('parseVersionedTitle', () => {
  it('parses an underscore version suffix after stripping the ingest-order prefix', () => {
    expect(parseVersionedTitle('0010_TheSuperposition_v2')).toEqual({ base: 'thesuperposition', version: 2 });
  });

  it('parses a space-separated version suffix', () => {
    expect(parseVersionedTitle('0015_TheSuperposition v3')).toEqual({ base: 'thesuperposition', version: 3 });
  });

  it('normalizes "Foundation vN" to the same base as a bare "vN"', () => {
    expect(parseVersionedTitle('0005_TheSuperposition Foundation v1')).toEqual({ base: 'thesuperposition', version: 1 });
    expect(parseVersionedTitle('0007_TheThreshold_Foundation_v1')).toEqual({ base: 'thethreshold', version: 1 });
  });

  it('groups mixed underscore/space title styles to the same base', () => {
    const a = parseVersionedTitle('0016_TheThreshold v2');
    const b = parseVersionedTitle('0028_TheThreshold_v3');
    expect(a?.base).toBe(b?.base);
  });

  it('handles multi-word bases', () => {
    expect(parseVersionedTitle('0021_the plenum v3')).toEqual({ base: 'the plenum', version: 3 });
  });

  it('returns null for titles with no version marker', () => {
    expect(parseVersionedTitle('big-picture-architecture')).toBeNull();
    expect(parseVersionedTitle('results')).toBeNull();
  });

  it('returns null for a bare "v" with no digits', () => {
    expect(parseVersionedTitle('Some Title v')).toBeNull();
  });
});

describe('groupVersionFamilies', () => {
  it('groups same-base titles and drops singletons', () => {
    const rows = [
      { id: 'p1', title: '0005_TheSuperposition Foundation v1' },
      { id: 'p2', title: '0010_TheSuperposition_v2' },
      { id: 'p3', title: '0015_TheSuperposition v3' },
      { id: 'p4', title: '0029_TheSuperposition_v4' },
      { id: 'p5', title: '0021_the plenum v3' }, // singleton — no other "the plenum" version
      { id: 'p6', title: 'results' }, // unparseable — excluded entirely
    ];
    const families = groupVersionFamilies(rows);
    expect(families.has('thesuperposition')).toBe(true);
    expect(families.get('thesuperposition')!.length).toBe(4);
    expect(families.has('the plenum')).toBe(false); // singleton dropped
  });

  it('returns an empty map when nothing chains', () => {
    const families = groupVersionFamilies([{ id: 'p1', title: 'results' }, { id: 'p2', title: 'memories' }]);
    expect(families.size).toBe(0);
  });
});
