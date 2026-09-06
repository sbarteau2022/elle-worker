// Readout A2 — pre-registered before this file was first run (2026-09-06):
// the only claim is that A2 is NO LONGER DEGENERATE (it rejects nothing after
// warm-up and its scores are not constant). Whether it discriminates the
// length label is REPORTED in both orientations with a label-shuffle control;
// no AUC is claimed. Gate: validate.ts unchanged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readoutA2, readoutA, toTraceRow, makeRng, type FixtureRow } from './seam-wire';
import { runValidateKappa } from './kappa-memory/validate';

const FILES = ['test-fixtures/tap-series-gsm8k-n100.jsonl', 'test-fixtures/tap-series-gsm8k-test-n100.jsonl'];
const load = (f: string): FixtureRow[] => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const isOpen = (r: FixtureRow) => r.open_at_512 ?? r.truncated;
const cell = (rows: FixtureRow[], lab: (r: FixtureRow, i: number) => 0 | 1) => {
  const rep = runValidateKappa(rows.map((r, i) => toTraceRow(readoutA2(r.streams.surprisal, (r.streams as any).proj48), lab(r, i))));
  const [v, rr] = rep.kill_tests as any[];
  return `VEL ${v.auc.toFixed(3)} (${v.auc_lower95.toFixed(3)}) ${v.verdict} | RES ${rr.auc.toFixed(3)} (${rr.auc_lower95.toFixed(3)}) ${rr.verdict} | ${rep.overall}`;
};

describe('readout A2 — two-observation seam', () => {
  for (const f of FILES) {
    const rows = load(f);
    it(`${f.split('/').pop()}: proj48 present, A2 scores every post-warmup window, scores vary`, () => {
      for (const r of rows) expect((r.streams as any).proj48.length).toBe(96);
      const t = readoutA2(rows[0].streams.surprisal, (rows[0].streams as any).proj48);
      const tA = readoutA(rows[0].streams.surprisal);
      expect(t.nWindows).toBe(9);
      expect(t.nRejected).toBeLessThanOrEqual(tA.nRejected);
      const scored = t.score.filter((x) => !Number.isNaN(x));
      expect(scored.length).toBeGreaterThanOrEqual(7);
      expect(Math.max(...scored) - Math.min(...scored)).toBeGreaterThan(1e-6);
    });
    it(`${f.split('/').pop()}: gate cells reported, not claimed`, () => {
      const rng = makeRng(11);
      const shuffled = rows.map(isOpen).map((v) => (v ? 1 : 0) as 0 | 1).sort(() => rng() - 0.5);
      console.log(`  A2 ${f.split('/').pop()}`);
      console.log(`    registered (OPEN=1): ${cell(rows, (r) => (isOpen(r) ? 1 : 0))}`);
      console.log(`    inverted   (OPEN=0): ${cell(rows, (r) => (isOpen(r) ? 0 : 1))}`);
      console.log(`    shuffled labels    : ${cell(rows, (_r, i) => shuffled[i])}`);
      expect(true).toBe(true);
    });
  }
});
