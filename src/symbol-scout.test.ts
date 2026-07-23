import { describe, it, expect } from 'vitest';
import { parseCandidates, parseResearchNote, formatResearchDesk, MAX_RESEARCH_PER_DAY, type DeskRow } from './symbol-scout';

describe('parseCandidates — her proposed symbols, sanitized', () => {
  const none = new Set<string>();

  it('parses the documented shape and normalizes tickers', () => {
    const raw = '```json\n{"candidates":[{"symbol":"crm","why":"AI guidance raise"},{"symbol":"DE","why":"ag cycle turn"}]}\n```';
    expect(parseCandidates(raw, none)).toEqual([
      { symbol: 'CRM', why: 'AI guidance raise' },
      { symbol: 'DE', why: 'ag cycle turn' },
    ]);
  });

  it('accepts a bare array too', () => {
    expect(parseCandidates('[{"symbol":"BRK.B","why":"x"}]', none)).toEqual([{ symbol: 'BRK.B', why: 'x' }]);
  });

  it('drops excluded, duplicate, and malformed tickers', () => {
    const raw = JSON.stringify({ candidates: [
      { symbol: 'NVDA', why: 'excluded' },
      { symbol: 'CRM', why: 'ok' },
      { symbol: 'CRM', why: 'dupe' },
      { symbol: 'TOOLONGX', why: 'not a ticker' },
      { symbol: 'DROP TABLE', why: 'nope' },
      { symbol: '', why: 'empty' },
    ] });
    expect(parseCandidates(raw, new Set(['NVDA']))).toEqual([{ symbol: 'CRM', why: 'ok' }]);
  });

  it('caps at the daily research budget', () => {
    const raw = JSON.stringify({ candidates: ['CRM', 'DE', 'PEP', 'KO', 'ABT'].map(symbol => ({ symbol, why: 'x' })) });
    expect(parseCandidates(raw, none).length).toBe(MAX_RESEARCH_PER_DAY);
  });

  it('returns empty on garbage instead of throwing', () => {
    expect(parseCandidates('not json', none)).toEqual([]);
    expect(parseCandidates('{"candidates":"nope"}', none)).toEqual([]);
    expect(parseCandidates('42', none)).toEqual([]);
  });
});

describe('parseResearchNote — structured note or nothing', () => {
  it('parses a full note and clamps confidence to [0,1]', () => {
    const note = parseResearchNote(JSON.stringify({
      findings: 'f', thesis: 't', expected_catalyst: 'c', risks: 'r', verdict: 'BUY', confidence: 1.7,
    }));
    expect(note).toMatchObject({ findings: 'f', thesis: 't', verdict: 'buy', confidence: 1 });
  });

  it('defaults an unknown verdict to watch and missing confidence to 0.5', () => {
    const note = parseResearchNote('{"findings":"f","thesis":"t","verdict":"yolo"}');
    expect(note?.verdict).toBe('watch');
    expect(note?.confidence).toBe(0.5);
  });

  it('returns null on unparseable content', () => {
    expect(parseResearchNote('not json')).toBeNull();
    expect(parseResearchNote('null')).toBeNull();
  });
});

describe('formatResearchDesk — the prompt read-back', () => {
  const row = (symbol: string, over: Partial<DeskRow> = {}): DeskRow => ({
    symbol, thesis: 'thesis here', expected_catalyst: 'earnings 8/1', risks: 'macro',
    verdict: 'buy', confidence: 0.7, created_at: '2026-07-23 14:00:00', ...over,
  });

  it('renders one line per symbol with verdict, confidence and date', () => {
    const out = formatResearchDesk([row('CRM')]);
    expect(out).toContain('CRM [buy, conf 0.70, 2026-07-23]');
    expect(out).toContain('Catalyst: earnings 8/1');
    expect(out).toContain('Risks: macro');
  });

  it('handles null fields without crashing', () => {
    const out = formatResearchDesk([row('DE', { thesis: null, expected_catalyst: null, risks: null, verdict: null, confidence: null })]);
    expect(out).toContain('DE [watch, conf —');
  });

  it('respects the budget and returns empty for no rows', () => {
    expect(formatResearchDesk([])).toBe('');
    const many = Array.from({ length: 50 }, (_, i) => row(`S${i}`));
    expect(formatResearchDesk(many, 600).length).toBeLessThanOrEqual(600);
  });
});
