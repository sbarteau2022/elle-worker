import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from './fusion';

describe('reciprocalRankFusion', () => {
  it('scores rank 1 in a single list as 1/(1+k)', () => {
    const fused = reciprocalRankFusion([[{ id: 'a' }, { id: 'b' }]], 60);
    expect(fused[0]).toEqual({ id: 'a', score: 1 / 61 });
    expect(fused[1]).toEqual({ id: 'b', score: 1 / 62 });
  });

  it('sums scores across lists for an id present in both', () => {
    const dense = [{ id: 'x' }, { id: 'y' }];
    const fts = [{ id: 'y' }, { id: 'x' }];
    const fused = reciprocalRankFusion([dense, fts], 60);

    // x: rank 1 in dense (1/61) + rank 2 in fts (1/62)
    // y: rank 2 in dense (1/62) + rank 1 in fts (1/61)
    // symmetric — both should end up with the same combined score
    const x = fused.find(f => f.id === 'x')!;
    const y = fused.find(f => f.id === 'y')!;
    expect(x.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(y.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(x.score).toBeCloseTo(y.score, 10);
  });

  it('sorts descending by fused score', () => {
    const dense = [{ id: 'top' }, { id: 'mid' }, { id: 'bottom' }];
    const fused = reciprocalRankFusion([dense]);
    expect(fused.map(f => f.id)).toEqual(['top', 'mid', 'bottom']);
  });

  it('an id absent from a list contributes nothing from that list (not a zero-score entry)', () => {
    const dense = [{ id: 'only-dense' }];
    const fts = [{ id: 'only-fts' }];
    const fused = reciprocalRankFusion([dense, fts]);
    expect(fused).toHaveLength(2);
    expect(fused.find(f => f.id === 'only-dense')!.score).toBeCloseTo(1 / 61, 10);
    expect(fused.find(f => f.id === 'only-fts')!.score).toBeCloseTo(1 / 61, 10);
  });

  it('returns an empty array for no ranked lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
