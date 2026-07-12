import { describe, it, expect } from 'vitest';
import { guardOptionOrder, guardNotional, type HeldPosition } from './risk-guard';

describe('guardOptionOrder — naked short options', () => {
  const none: HeldPosition[] = [];

  it('allows any option BUY (long option loss is bounded to premium)', () => {
    expect(guardOptionOrder({ action: 'buy', right: 'call', qty: 5, underlying: 'NVDA' }, none).ok).toBe(true);
    expect(guardOptionOrder({ action: 'buy', right: 'put', qty: 5, underlying: 'NVDA' }, none).ok).toBe(true);
  });

  it('BLOCKS a naked written call', () => {
    const r = guardOptionOrder({ action: 'sell', right: 'call', qty: 2, underlying: 'NVDA' }, none);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/naked call/i);
  });

  it('BLOCKS a naked written put (cash-secured coverage unverifiable)', () => {
    const r = guardOptionOrder({ action: 'sell', right: 'put', qty: 1, underlying: 'TSLA' }, none);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/naked put/i);
  });

  it('ALLOWS a covered call (>= qty*100 shares of the underlying held long)', () => {
    const held: HeldPosition[] = [{ symbol: 'NVDA', qty: 200, side: 'long' }];
    expect(guardOptionOrder({ action: 'sell', right: 'call', qty: 2, underlying: 'NVDA' }, held).ok).toBe(true);
  });

  it('BLOCKS a call written against too few shares', () => {
    const held: HeldPosition[] = [{ symbol: 'NVDA', qty: 150, side: 'long' }];
    expect(guardOptionOrder({ action: 'sell', right: 'call', qty: 2, underlying: 'NVDA' }, held).ok).toBe(false);
  });

  it('ALLOWS selling to CLOSE an existing long contract', () => {
    const occ = 'NVDA260116C00150000';
    const held: HeldPosition[] = [{ symbol: occ, qty: 3, side: 'long' }];
    expect(guardOptionOrder({ action: 'sell', right: 'call', qty: 3, underlying: 'NVDA', optionSymbol: occ }, held).ok).toBe(true);
  });

  it('fails closed when option right is missing', () => {
    expect(guardOptionOrder({ action: 'sell', right: null, qty: 1, underlying: 'NVDA' }, none).ok).toBe(false);
  });
});

describe('guardNotional — per-order ceiling', () => {
  it('allows an order within the cap', () => {
    expect(guardNotional(1000, 10000, 0.25).ok).toBe(true);
  });
  it('blocks an order over the cap', () => {
    const r = guardNotional(5000, 10000, 0.25);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cap/i);
  });
  it('fails closed when equity or notional is unknown', () => {
    expect(guardNotional(NaN, 10000).ok).toBe(false);
    expect(guardNotional(1000, 0).ok).toBe(false);
  });
});
