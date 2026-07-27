import { describe, it, expect } from 'vitest';
import {
  maxOrderFrac, maxSymbolFrac, sizeWithinCap, sizeWithinPortfolioCaps,
  DEFAULT_MAX_ORDER_FRAC, DEFAULT_MAX_SYMBOL_FRAC,
} from './order-guards';

describe('maxOrderFrac — configurable buy-in ceiling', () => {
  it('defaults to 10% with no env override', () => {
    expect(maxOrderFrac({})).toBe(DEFAULT_MAX_ORDER_FRAC);
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: undefined })).toBe(DEFAULT_MAX_ORDER_FRAC);
  });

  it('honors a valid override', () => {
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: '0.05' })).toBe(0.05);
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: '0.25' })).toBe(0.25);
  });

  it('rejects overrides past risk-guard\'s 25% ceiling or non-positive/garbage', () => {
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: '0.5' })).toBe(DEFAULT_MAX_ORDER_FRAC);
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: '0' })).toBe(DEFAULT_MAX_ORDER_FRAC);
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: '-1' })).toBe(DEFAULT_MAX_ORDER_FRAC);
    expect(maxOrderFrac({ ELLE_MAX_ORDER_FRAC: 'lots' })).toBe(DEFAULT_MAX_ORDER_FRAC);
  });
});

describe('sizeWithinCap — downsize opening orders under the cap', () => {
  it('passes an order already under the cap through untouched', () => {
    const r = sizeWithinCap(5, 100, 100_000, 0.10); // $500 of $100k
    expect(r).toEqual({ qty: 5, downsized: false });
  });

  it('cuts an oversized order down to the cap instead of rejecting it', () => {
    const r = sizeWithinCap(500, 100, 100_000, 0.10); // $50k asked, $10k cap
    expect(r.qty).toBe(100);
    expect(r.downsized).toBe(true);
    expect(r.reason).toMatch(/downsized 500 → 100/);
  });

  it('never sizes UP toward the cap', () => {
    expect(sizeWithinCap(1, 100, 100_000, 0.10).qty).toBe(1);
  });

  it('sizes to zero when even one unit exceeds the cap', () => {
    const r = sizeWithinCap(1, 5000, 10_000, 0.10); // $5000 unit vs $1000 cap
    expect(r.qty).toBe(0);
    expect(r.downsized).toBe(true);
    expect(r.reason).toMatch(/even 1 unit/);
  });

  it('fails closed on unknown price or equity', () => {
    expect(sizeWithinCap(10, 0, 100_000, 0.10).qty).toBe(0);
    expect(sizeWithinCap(10, NaN, 100_000, 0.10).qty).toBe(0);
    expect(sizeWithinCap(10, 100, 0, 0.10).qty).toBe(0);
    expect(sizeWithinCap(10, 100, NaN, 0.10).qty).toBe(0);
  });

  it('rejects a non-positive quantity', () => {
    expect(sizeWithinCap(0, 100, 100_000, 0.10).qty).toBe(0);
    expect(sizeWithinCap(-3, 100, 100_000, 0.10).qty).toBe(0);
  });

  it('floors fractional fits (no fractional shares/contracts)', () => {
    const r = sizeWithinCap(100, 333, 10_000, 0.10); // cap $1000 / $333 = 3.003
    expect(r.qty).toBe(3);
    expect(r.downsized).toBe(true);
  });
});

describe('maxSymbolFrac — per-symbol exposure ceiling', () => {
  it('defaults to 15% and honors valid overrides', () => {
    expect(maxSymbolFrac({})).toBe(DEFAULT_MAX_SYMBOL_FRAC);
    expect(maxSymbolFrac({ ELLE_MAX_SYMBOL_FRAC: '0.2' })).toBe(0.2);
    expect(maxSymbolFrac({ ELLE_MAX_SYMBOL_FRAC: '0.5' })).toBe(0.5);
  });

  it('rejects out-of-range or garbage overrides', () => {
    expect(maxSymbolFrac({ ELLE_MAX_SYMBOL_FRAC: '0.9' })).toBe(DEFAULT_MAX_SYMBOL_FRAC);
    expect(maxSymbolFrac({ ELLE_MAX_SYMBOL_FRAC: '0' })).toBe(DEFAULT_MAX_SYMBOL_FRAC);
    expect(maxSymbolFrac({ ELLE_MAX_SYMBOL_FRAC: 'all of it' })).toBe(DEFAULT_MAX_SYMBOL_FRAC);
  });
});

describe('sizeWithinPortfolioCaps — order cap AND per-symbol exposure cap', () => {
  // equity $100k, order cap 10% ($10k), symbol cap 15% ($15k)
  const E = 100_000, OF = 0.10, SF = 0.15;

  it('passes a small order in an unheld symbol untouched', () => {
    expect(sizeWithinPortfolioCaps(10, 100, E, OF, 0, SF)).toEqual({ qty: 10, downsized: false });
  });

  it('still applies the per-order cap when the symbol is unheld', () => {
    const r = sizeWithinPortfolioCaps(500, 100, E, OF, 0, SF); // $50k asked, $10k order cap
    expect(r.qty).toBe(100);
    expect(r.downsized).toBe(true);
  });

  it('blocks any add to a symbol already at the exposure cap', () => {
    const r = sizeWithinPortfolioCaps(1, 100, E, OF, 15_000, SF);
    expect(r.qty).toBe(0);
    expect(r.reason).toMatch(/exposure cap/);
  });

  it('downsizes an add so held + order stays under the symbol cap', () => {
    const r = sizeWithinPortfolioCaps(100, 100, E, OF, 12_000, SF); // $3k room
    expect(r.qty).toBe(30);
    expect(r.downsized).toBe(true);
    expect(r.reason).toMatch(/per-symbol cap/);
  });

  it('the binding cap wins: symbol room larger than order cap → order cap rules', () => {
    const r = sizeWithinPortfolioCaps(200, 100, E, OF, 1_000, SF); // room $14k, order cap $10k
    expect(r.qty).toBe(100);
  });

  it('fails closed on unknown price/equity and non-positive qty', () => {
    expect(sizeWithinPortfolioCaps(10, 0, E, OF, 0, SF).qty).toBe(0);
    expect(sizeWithinPortfolioCaps(10, 100, 0, OF, 0, SF).qty).toBe(0);
    expect(sizeWithinPortfolioCaps(0, 100, E, OF, 0, SF).qty).toBe(0);
  });
});
