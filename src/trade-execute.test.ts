import { describe, it, expect } from 'vitest';
import { closingSideFor } from './router';
import { orderKey } from './router-idempotency';

describe('closingSideFor', () => {
  it('closes a short by buying (getting this backwards doubles the short instead of closing it)', () => {
    expect(closingSideFor('short')).toBe('buy');
  });
  it('closes a long by selling', () => {
    expect(closingSideFor('long')).toBe('sell');
  });
  it('defaults to selling when the side is unknown (matches the pre-shorting behavior)', () => {
    expect(closingSideFor(undefined)).toBe('sell');
  });
});

describe('orderKey', () => {
  it('is stable for identical equity orders (the idempotency guarantee it exists for)', () => {
    expect(orderKey('buy', 'aapl', 3)).toBe(orderKey('buy', 'AAPL', 3));
  });

  it('two different option contracts on the same underlying/action/qty get different keys', () => {
    const put150 = orderKey('buy', 'AAPL', 1, 'put:150:2026-01-16');
    const put160 = orderKey('buy', 'AAPL', 1, 'put:160:2026-01-16');
    expect(put150).not.toBe(put160);
  });

  it('the same option order produces the same key twice (still idempotent)', () => {
    const a = orderKey('buy', 'AAPL', 1, 'put:150:2026-01-16');
    const b = orderKey('buy', 'AAPL', 1, 'put:150:2026-01-16');
    expect(a).toBe(b);
  });

  it('an equity order and an option order on the same underlying/action/qty never collide', () => {
    const equity = orderKey('buy', 'AAPL', 1);
    const option = orderKey('buy', 'AAPL', 1, 'call:150:2026-01-16');
    expect(equity).not.toBe(option);
  });
});
