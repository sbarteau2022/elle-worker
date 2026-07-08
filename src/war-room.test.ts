// Pure-logic tests for the War Room: the ladder, the tactic picker, the deck's
// integrity (every card teaches a counter; the safeguard has positive-valence
// tactics to teach as end-states). No network, no D1.
import { describe, it, expect } from 'vitest';
import { rungFromStats, pickTactic, WAR_DECK, VALENCES } from './war-room';

describe('war room · the ladder', () => {
  it('nothing ranks until 4 deployments are on record', () => {
    expect(rungFromStats(0, 0).rung).toBe(1);
    expect(rungFromStats(3, 3).rung).toBe(1); // perfect but unproven
  });
  it('rungs move on factual recognition rate', () => {
    expect(rungFromStats(10, 1).rung).toBe(1);
    expect(rungFromStats(10, 3).rung).toBe(2);
    expect(rungFromStats(10, 5).rung).toBe(3);
    expect(rungFromStats(10, 7).rung).toBe(4);
    expect(rungFromStats(10, 9).rung).toBe(5);
  });
  it('reports the rate it ranked on', () => {
    expect(rungFromStats(10, 7).rate).toBe(0.7);
  });
});

describe('war room · the tactic picker', () => {
  it('returns a card from the deck, deterministically under a seeded roll', () => {
    const t = pickTactic(WAR_DECK, new Map(), 1, () => 0);
    expect(WAR_DECK.some(d => d.id === t.id)).toBe(true);
  });
  it('weights toward what the student fails to name', () => {
    // Everything mastered except one tactic never once named.
    const mastery = new Map(WAR_DECK.map(t => [t.id, { deployed: 10, named: 10 }]));
    mastery.set('attack_emptiness', { deployed: 10, named: 0 });
    let hits = 0;
    const n = 400;
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let i = 0; i < n; i++) if (pickTactic(WAR_DECK, mastery, 3, rand).id === 'attack_emptiness') hits++;
    // 24-card deck, uniform would be ~4% — the unnamed tactic must dominate that.
    expect(hits / n).toBeGreaterThan(0.15);
  });
});

describe('war room · the deck + the safeguard', () => {
  it('every card teaches a counter and carries a legal valence', () => {
    for (const t of WAR_DECK) {
      expect(t.counter.length).toBeGreaterThan(20);
      expect(['+', '0', '-']).toContain(t.valence);
      expect(t.move.length).toBeGreaterThan(20);
    }
  });
  it('unique ids', () => {
    expect(new Set(WAR_DECK.map(t => t.id)).size).toBe(WAR_DECK.length);
  });
  it('the deck is not all dirty — positive-valence tactics exist to teach as end-states', () => {
    expect(WAR_DECK.filter(t => t.valence === '+').length).toBeGreaterThanOrEqual(3);
    expect(WAR_DECK.filter(t => t.valence === '-').length).toBeGreaterThanOrEqual(8);
  });
  it('valence labels name whose ends the tactic serves', () => {
    expect(VALENCES.map(v => v.key).sort()).toEqual(['+', '-', '0']);
  });
});
