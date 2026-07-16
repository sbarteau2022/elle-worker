import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALPACA_PAPER_BASE, liveTradingArmed, resolveAlpacaBase } from './live-guard';

// Before this guard existed, the ONLY thing keeping the autonomous trading
// cron and the chat trade tools on paper money was ALPACA_BASE_URL happening
// to default to the paper endpoint — repointing one var silently armed
// real-money orders. These tests pin the two-key rule: a live URL trades
// ONLY when ELLE_LIVE_TRADING is exactly 'on', and everything else fails
// loudly rather than trading quietly.

describe('resolveAlpacaBase', () => {
  it('defaults to paper when nothing is configured', () => {
    expect(resolveAlpacaBase({})).toBe(ALPACA_PAPER_BASE);
  });

  it('allows the paper endpoint without any flag', () => {
    expect(resolveAlpacaBase({ ALPACA_BASE_URL: ALPACA_PAPER_BASE })).toBe(ALPACA_PAPER_BASE);
  });

  it('tolerates a trailing slash on the paper endpoint', () => {
    expect(resolveAlpacaBase({ ALPACA_BASE_URL: `${ALPACA_PAPER_BASE}/` })).toBe(ALPACA_PAPER_BASE);
  });

  it('BLOCKS the live endpoint when ELLE_LIVE_TRADING is unset', () => {
    expect(() => resolveAlpacaBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets' }))
      .toThrow(/LIVE TRADING BLOCKED/);
  });

  it('BLOCKS any non-paper URL, not just the known live one — fail closed on typos', () => {
    expect(() => resolveAlpacaBase({ ALPACA_BASE_URL: 'https://paper-api.alpaca.markets.evil.example' }))
      .toThrow(/LIVE TRADING BLOCKED/);
  });

  it("only the exact string 'on' arms live — 'true'/'1'/'ON'/'yes' do not", () => {
    for (const notArmed of ['true', '1', 'ON', 'yes', 'On', ' on ']) {
      expect(() => resolveAlpacaBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets', ELLE_LIVE_TRADING: notArmed }))
        .toThrow(/LIVE TRADING BLOCKED/);
    }
  });

  it("allows the live endpoint when ELLE_LIVE_TRADING is exactly 'on'", () => {
    expect(resolveAlpacaBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets', ELLE_LIVE_TRADING: 'on' }))
      .toBe('https://api.alpaca.markets');
  });

  it('the thrown message names both vars so the fix is in the error itself', () => {
    try {
      resolveAlpacaBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets' });
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('ALPACA_BASE_URL');
      expect(msg).toContain('ELLE_LIVE_TRADING');
      expect(msg).toContain(ALPACA_PAPER_BASE);
    }
  });
});

describe('liveTradingArmed', () => {
  it('is true only for the exact string on', () => {
    expect(liveTradingArmed({ ELLE_LIVE_TRADING: 'on' })).toBe(true);
    expect(liveTradingArmed({})).toBe(false);
    expect(liveTradingArmed({ ELLE_LIVE_TRADING: 'off' })).toBe(false);
  });
});

// Both execution paths must resolve their base through the guard — a future
// refactor that re-inlines `env.ALPACA_BASE_URL || paper` in either file
// reopens the silent-live hole. Pinned at the source level (the same way
// rapid.test.ts pins SQL text) because alpacaOrder is module-private.
describe('guard coverage of both execution paths', () => {
  const src = (f: string) => readFileSync(fileURLToPath(String(new URL(f, import.meta.url))), 'utf8');

  it('trading.ts (autonomous cron) resolves its base via resolveAlpacaBase', () => {
    const trading = src('./trading.ts');
    expect(trading).toMatch(/resolveAlpacaBase/);
    expect(trading).not.toMatch(/env\.ALPACA_BASE_URL\s*\|\|/);
  });

  it('router.ts (chat trade tools) resolves its base via resolveAlpacaBase', () => {
    const router = src('./router.ts');
    expect(router).toMatch(/resolveAlpacaBase/);
    expect(router).not.toMatch(/ALPACA_BASE_URL[^\n]*\|\|\s*'https:\/\/paper-api/);
  });
});

// The cron path (trading.ts alpacaBase) actually throws end-to-end, not just
// the pure helper: a live URL without the flag halts trading loudly.
describe('trading.ts alpacaBase wiring', () => {
  it('throws through the real trading module', async () => {
    const { alpacaBase } = await import('./trading');
    expect(() => alpacaBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets' } as never))
      .toThrow(/LIVE TRADING BLOCKED/);
    expect(alpacaBase({} as never)).toBe(ALPACA_PAPER_BASE);
  });
});
