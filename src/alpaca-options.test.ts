import { describe, it, expect } from 'vitest';
import { pickClosestStrike, resolveOptionContract, type AlpacaContract } from './alpaca-options';

describe('pickClosestStrike', () => {
  const contracts: AlpacaContract[] = [
    { symbol: 'AAA', strike_price: '150.00', expiration_date: '2026-01-16' },
    { symbol: 'BBB', strike_price: '175.00', expiration_date: '2026-01-16' },
    { symbol: 'CCC', strike_price: '200.00', expiration_date: '2026-01-16' },
  ];

  it('picks the exact match when one exists', () => {
    expect(pickClosestStrike(contracts, 175)?.symbol).toBe('BBB');
  });

  it('picks whichever is nearer when there is no exact match', () => {
    expect(pickClosestStrike(contracts, 160)?.symbol).toBe('AAA'); // |160-150|=10 < |160-175|=15
    expect(pickClosestStrike(contracts, 190)?.symbol).toBe('CCC'); // |190-200|=10 < |190-175|=15
  });

  it('returns null for an empty contract list rather than throwing', () => {
    expect(pickClosestStrike([], 100)).toBeNull();
  });

  it('breaks a tie by taking the first candidate encountered', () => {
    const tied: AlpacaContract[] = [
      { symbol: 'LOW', strike_price: '90', expiration_date: '2026-01-16' },
      { symbol: 'HIGH', strike_price: '110', expiration_date: '2026-01-16' },
    ];
    expect(pickClosestStrike(tied, 100)?.symbol).toBe('LOW');
  });
});

describe('resolveOptionContract — validation (no network touched)', () => {
  const base = 'https://paper-api.alpaca.markets';
  const headers = {};

  it('refuses a missing underlying', async () => {
    const r = await resolveOptionContract(base, headers, { underlying: '', right: 'put', expiration: '2026-01-16', targetStrike: 100 });
    expect('error' in r && r.error).toMatch(/underlying required/);
  });

  it('refuses a right that is neither call nor put', async () => {
    const r = await resolveOptionContract(base, headers, { underlying: 'AAPL', right: 'straddle' as any, expiration: '2026-01-16', targetStrike: 100 });
    expect('error' in r && r.error).toMatch(/must be "call" or "put"/);
  });

  it('refuses a malformed expiration date', async () => {
    const r = await resolveOptionContract(base, headers, { underlying: 'AAPL', right: 'call', expiration: '01/16/2026', targetStrike: 100 });
    expect('error' in r && r.error).toMatch(/YYYY-MM-DD/);
  });

  it('refuses a non-positive target strike', async () => {
    const r1 = await resolveOptionContract(base, headers, { underlying: 'AAPL', right: 'call', expiration: '2026-01-16', targetStrike: 0 });
    expect('error' in r1 && r1.error).toMatch(/positive targetStrike/);
    const r2 = await resolveOptionContract(base, headers, { underlying: 'AAPL', right: 'call', expiration: '2026-01-16', targetStrike: -50 });
    expect('error' in r2 && r2.error).toMatch(/positive targetStrike/);
  });
});
