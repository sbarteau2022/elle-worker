import { describe, it, expect } from 'vitest';
import { cosine, rankSkills, type SkillVec } from './skills';

describe('skill router — cosine', () => {
  it('is 1 for the same direction (magnitude-invariant)', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('is -1 for mismatched lengths or a zero vector', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(-1);
    expect(cosine([0, 0], [1, 1])).toBe(-1);
  });
});

describe('skill router — rankSkills', () => {
  const S = (name: string, embedding: number[] | null): SkillVec => ({
    name, description: `${name} desc`, body: `${name} body`, embedding,
  });

  it('returns matches above threshold, best first, honoring topK', () => {
    const q = [1, 0, 0];
    const out = rankSkills(q, [S('a', [1, 0, 0]), S('b', [0.9, 0.1, 0]), S('c', [0, 1, 0])], { topK: 2, threshold: 0.5 });
    expect(out.map(s => s.name)).toEqual(['a', 'b']);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });

  it('drops sub-threshold matches and skips unembedded skills', () => {
    const out = rankSkills([1, 0, 0], [S('near', [0.99, 0.01, 0]), S('far', [0, 0, 1]), S('unindexed', null)], { threshold: 0.58 });
    expect(out.map(s => s.name)).toEqual(['near']);
  });

  it('injects nothing when no skill clears the bar', () => {
    expect(rankSkills([1, 0, 0], [S('x', [0, 1, 0])], { threshold: 0.58 })).toEqual([]);
  });
});
