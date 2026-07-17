// ============================================================
// TRADING GROUND — tests. Two duties:
//   1. the pure formatter renders exactly the sections its inputs earn,
//      inside the budget, and nothing when there is nothing;
//   2. the impure halves NEVER throw into the trading cycle — a fully
//      broken env (D1 down, Vectorize down, AI down) yields an empty
//      ground / a silent no-op, not an exception. Same discipline as
//      kappa-memory's "a broken db yields null, not an exception."
// ============================================================
import { describe, it, expect } from 'vitest';
import { formatGroundBlock, gatherTradingGround, recordTradeRationale, type GroundInputs, type GroundEnv } from './trading-ground';

const fullInputs = (): GroundInputs => ({
  lessons: [
    { symbol: 'NVDA', pnl_pct: 12.4, attribution: 'The catalyst materialized: datacenter guidance beat. Theory right.' },
    { symbol: 'KMI', pnl_pct: -8.1, attribution: 'Dividend cut hit before the bounce thesis could play. Wrong on timing.' },
  ],
  journal: {
    journal_date: '2026-07-16',
    what_she_learned: 'Suppressed energy names were bid before the print.',
    what_she_got_wrong: 'Held the GLD hedge a day too long.',
    hypothesis_for_tomorrow: 'Semis lead if inter-area coherence stays risk-on.',
  },
  field: [
    { scope: 'world', name: 'WORLD', mean_kappa: 0.52, mean_dissonance: 0.03, cross_coherence: 0.61, dispersion: null, frac_firing: 0.1, inter_area_coherence: 0.44 },
    { scope: 'area', name: 'semis', mean_kappa: 0.58, mean_dissonance: 0.07, cross_coherence: 0.72, dispersion: null, frac_firing: 0.4, inter_area_coherence: null },
  ],
  memories: [
    { type: 'trade_rationale', date: '2026-07-10', body: 'Bought NVDA on suppression-of-supply-constraint story.' },
    { type: 'insight', date: '2026-06-30', body: 'Bilateral suppression precedes the move in illiquid names.' },
  ],
});

describe('formatGroundBlock (pure)', () => {
  it('renders every earned section with its data', () => {
    const block = formatGroundBlock(fullInputs());
    expect(block).toContain('LESSONS FROM YOUR CLOSED TRADES');
    expect(block).toContain('NVDA (+12.4%)');
    expect(block).toContain('KMI (-8.1%)');
    expect(block).toContain('YOUR LAST JOURNAL (2026-07-16)');
    expect(block).toContain('Hypothesis you set for today');
    expect(block).toContain('COHERENCE FIELD');
    expect(block).toContain('WORLD: mean κ 0.52');
    expect(block).toContain('semis: κ 0.58');
    expect(block).toContain('FROM YOUR CORPUS AND MEMORY');
    expect(block).toContain('(trade_rationale · 2026-07-10)');
  });

  it('renders nothing from nothing — an empty ground is an empty string, not scaffolding', () => {
    expect(formatGroundBlock({ lessons: [], journal: null, field: [], memories: [] })).toBe('');
  });

  it('omits sections independently (only lessons → only the lessons section)', () => {
    const block = formatGroundBlock({ ...fullInputs(), journal: null, field: [], memories: [] });
    expect(block).toContain('LESSONS FROM YOUR CLOSED TRADES');
    expect(block).not.toContain('JOURNAL');
    expect(block).not.toContain('COHERENCE FIELD');
    expect(block).not.toContain('CORPUS');
  });

  it('respects the budget: whole sections are dropped, never truncated mid-line', () => {
    const block = formatGroundBlock(fullInputs(), 200);
    expect(block.length).toBeLessThanOrEqual(200);
    // Whatever made it in is a complete section (starts with a known header).
    if (block) expect(/^(LESSONS|YOUR LAST JOURNAL|COHERENCE FIELD|FROM YOUR CORPUS)/.test(block)).toBe(true);
  });

  it('null metric values render as —, not NaN', () => {
    const block = formatGroundBlock({ ...fullInputs(), lessons: [], journal: null, memories: [] });
    expect(block).toContain('dispersion —');
    expect(block).not.toContain('NaN');
  });
});

// A hostile env: every binding present, every call throws.
const brokenEnv = (): GroundEnv => ({
  DB: { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database,
  VECTORIZE: { query: () => { throw new Error('vectorize down'); }, upsert: () => { throw new Error('vectorize down'); } } as unknown as VectorizeIndex,
  SESSIONS: { put: () => { throw new Error('kv down'); }, get: () => { throw new Error('kv down'); } } as unknown as KVNamespace,
  AI: { run: () => { throw new Error('ai down'); } } as unknown as Ai,
});

describe('gatherTradingGround (broken world)', () => {
  it('a fully broken env yields an empty ground, never an exception', async () => {
    const g = await gatherTradingGround(brokenEnv(), { symbols: { SPY: { change_pct: '0.1' } }, news: [{ headline: 'x', symbols: ['SPY'] }] });
    expect(g.block).toBe('');
    expect(g.recalledIds).toEqual([]);
  });
});

describe('recordTradeRationale (broken world)', () => {
  it('a fully broken env is a silent no-op, never an exception', async () => {
    await expect(
      recordTradeRationale(brokenEnv(), { symbol: 'NVDA', action: 'buy', reasoning: 'test theory' }, ['abc']),
    ).resolves.toBeUndefined();
  });

  it('missing symbol or reasoning is a no-op before any binding is touched', async () => {
    await expect(recordTradeRationale(brokenEnv(), { symbol: '', action: 'buy', reasoning: 'r' }, [])).resolves.toBeUndefined();
    await expect(recordTradeRationale(brokenEnv(), { symbol: 'NVDA', action: 'buy', reasoning: '' }, [])).resolves.toBeUndefined();
  });
});
