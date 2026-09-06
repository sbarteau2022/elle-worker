import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calibratedKappa, KAPPA_CALIBRATION, makeRng, type FixtureRow } from './seam-wire';

const load = (f: string): FixtureRow[] =>
  readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('calibratedKappa — the wire, with an evidence floor', () => {
  it('no evidence is NOT 0.9977: empty and short series yield null', () => {
    expect(calibratedKappa([]).kappa).toBeNull();
    expect(calibratedKappa([]).reason).toBe('head-incomplete');
    expect(calibratedKappa(Array(95).fill(1)).kappa).toBeNull();
    const sigmaB = 1 / (1 + Math.exp(-KAPPA_CALIBRATION.B));
    expect(sigmaB).toBeCloseTo(0.9977, 3); // the defect, documented
  });
  it('a constant series has no coupling: S is out of support, κ is null', () => {
    const r = calibratedKappa(Array(96).fill(2.0));
    expect(r.kappa).toBeNull();
    expect(['out-of-support', 'non-finite']).toContain(r.reason);
  });
  it('only the first 96 tokens count — extra tokens do not change κ', () => {
    const rng = makeRng(7);
    const s = Array.from({ length: 300 }, () => 2 + rng());
    const a = calibratedKappa(s), b = calibratedKappa(s.slice(0, 96));
    expect(a.kappa).toBe(b.kappa);
    expect(a.nWindows).toBe(KAPPA_CALIBRATION.N_WINDOWS);
  });
  for (const f of ['test-fixtures/tap-series-gsm8k-n100.jsonl', 'test-fixtures/tap-series-gsm8k-test-n100.jsonl']) {
    it(`${f.split('/').pop()}: every real row is in support, κ∈(0,1), SETTLED median > OPEN median`, () => {
      const rows = load(f);
      const ks = rows.map((r, i) => ({ k: calibratedKappa(r.streams.surprisal, i), open: r.open_at_512 ?? r.truncated }));
      for (const { k } of ks) { expect(k.reason).toBe('ok'); expect(k.kappa!).toBeGreaterThan(0); expect(k.kappa!).toBeLessThan(1); }
      const med = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const mo = med(ks.filter((x) => x.open).map((x) => x.k.kappa!)), ms = med(ks.filter((x) => !x.open).map((x) => x.k.kappa!));
      console.log(`  ${f.split('/').pop()} median κ  OPEN ${mo.toFixed(3)}  SETTLED ${ms.toFixed(3)}`);
      expect(ms).toBeGreaterThan(mo);
    });
  }
});
