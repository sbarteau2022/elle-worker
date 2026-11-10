// ============================================================
// SEAM WIRE — REAL DATA. Both readouts, three live streams, one gate.
//
// Fixture: test-fixtures/tap-series-gsm8k-n100.jsonl — produced by
// research/seam-wire/tap_series.py from Qwen3.8-27B's own taps over the 100
// GSM8K control-baseline completions (runs/control-baseline/val_base_n100.json
// in the HNPA repo). Labels come from that eval, untouched.
//
// PRE-REGISTERED, before this file was first run:
//   label          settled_open = truncated ? 1 : 0   (a generation that never closed)
//   head           96 completion tokens per row — chosen because the gate's Gate 1
//                  needs 100 rows and the shortest baseline completion is 97 tokens.
//                  No readout had been run when this was fixed. Length is therefore
//                  identical for every row and cannot leak the label.
//   windows        64 / stride 4  → 9 windows per row
//   bands (B)      slow [1/64, 4/64), fast [8/64, 32/64) cycles per token
//   null (B)       200 circular shifts, seeded
//   gate           kappa-memory/validate.ts verbatim: AUC ≥ 0.70 velocity,
//                  ≥ 0.65 reserve, 95% lower bound must clear 0.5
//   controls       (i) labels shuffled with a fixed seed, (ii) each row's tokens
//                  shuffled with a fixed seed. Either BUILDing voids the run.
//
// This file asserts the harness (fixture shape, controls). It does NOT assert
// the verdict of the real arms. Whatever they say is the result.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { runArm, makeRng, type FixtureRow, type ArmReport } from './seam-wire';

const FIXTURE = 'test-fixtures/tap-series-gsm8k-n100.jsonl';
const OUT = 'research/seam-wire/SEAM_WIRE_001.json';
const STREAMS = ['surprisal', 'norm12', 'norm48'] as const;

function loadRows(): FixtureRow[] {
  return readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FixtureRow);
}
function shuffleWith<T>(xs: T[], rng: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function line(a: ArmReport): string {
  const [v, r] = a.report.kill_tests;
  return `| ${a.readout} | ${a.stream.padEnd(9)} | ${a.n} | ${a.meanRejected.toFixed(2)} | ${a.meanSeamEvents.toFixed(2)} `
    + `| ${v.auc.toFixed(3)} (${v.auc_lower95.toFixed(3)}) ${v.verdict} | ${r.auc.toFixed(3)} (${r.auc_lower95.toFixed(3)}) ${r.verdict} | ${a.report.overall} |`;
}

const have = existsSync(FIXTURE);
const d = have ? describe : describe.skip;

d('seam-wire · real data (numbers decide)', () => {
  const rows = loadRows();
  const full = rows.filter((r) => !r.short);
  const labelTrunc = (r: FixtureRow): 0 | 1 => (r.truncated ? 1 : 0);

  it('fixture: 100 rows, none short, ≥20 per class, every stream 96 long', () => {
    expect(rows.length).toBe(100);
    expect(full.length).toBe(100);
    const pos = full.filter((r) => r.truncated).length;
    expect(pos).toBeGreaterThanOrEqual(20);
    expect(100 - pos).toBeGreaterThanOrEqual(20);
    for (const r of full) for (const s of STREAMS) expect(r.streams[s].length).toBe(96);
  });

  const arms: ArmReport[] = [];
  const controls: ArmReport[] = [];

  it('runs both readouts on all three streams', () => {
    for (const s of STREAMS) {
      arms.push(runArm('A', s, full, labelTrunc));
      arms.push(runArm('B', s, full, labelTrunc));
    }
    expect(arms.length).toBe(6);
  });

  it('control (i): shuffled labels must not BUILD', () => {
    const rng = makeRng(2026);
    const labels = shuffleWith(full.map(labelTrunc), rng);
    for (const s of STREAMS) for (const ro of ['A', 'B'] as const) {
      const arm = runArm(ro, s, full, (r) => labels[full.indexOf(r)], 1);
      arm.stream = `${s}·shufLabel`;
      controls.push(arm);
      expect(arm.report.overall).not.toBe('BUILD');
    }
  });

  it('control (ii): token-shuffled series must not BUILD', () => {
    const rng = makeRng(7);
    const scrambled: FixtureRow[] = full.map((r) => ({
      ...r,
      streams: Object.fromEntries(STREAMS.map((s) => [s, shuffleWith(r.streams[s], rng)])),
    }));
    for (const s of STREAMS) for (const ro of ['A', 'B'] as const) {
      const arm = runArm(ro, s, scrambled, labelTrunc, 2);
      arm.stream = `${s}·shufTok`;
      controls.push(arm);
      expect(arm.report.overall).not.toBe('BUILD');
    }
  });

  it('prints the table and writes the report', () => {
    const hdr = '| readout | stream | n | rej/row | seam/row | VELOCITY auc (lo95) | RESERVE auc (lo95) | overall |';
    const sep = '|---|---|---|---|---|---|---|---|';
    const out = ['', 'SEAM WIRE 001 — label: settled_open = truncated', hdr, sep,
      ...arms.map(line), '', 'controls', hdr, sep, ...controls.map(line), ''].join('\n');
    console.log(out);
    writeFileSync(OUT, JSON.stringify({ label: 'settled_open = truncated', head: 96, arms, controls }, null, 2));
    expect(arms.length).toBe(6);
  });
});
