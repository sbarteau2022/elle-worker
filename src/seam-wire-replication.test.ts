// ============================================================
// SEAM WIRE 001 — REPLICATION on the held-out GSM8K test split.
//
// Written and committed BEFORE the replication fixture existed. Pre-registered
// in research/seam-wire/SEAM_WIRE_001.md:
//
//   H1 (the only claim): readout B, stream `surprisal`, RESERVE test with the
//   INVERTED orientation (reserve high ⇒ OPEN): AUC ≥ 0.65 with the 95% lower
//   bound > 0.5, Gate 1 met. Everything else is reported, claims nothing.
//
//   OPEN for H1 = `open_at_512` (the completion ran past 512 tokens). This is the
//   identical event the val fixture's `truncated` recorded, because val was
//   generated at a 512 budget. The replication is generated at 1024 — the budget
//   the other HNPA re-checks moved to once 512 was seen to be too tight — so two
//   secondary labels become available and are REPORTED, not claimed:
//     truncated   = ran past 1024 (never closed even with double the room)
//     !correct    = closed on the wrong number
//   Both will likely fail Gate 1's 20-per-class floor; INSUFFICIENT is the
//   honest cell then, not a pass or a fail.
//
// Inversion is implemented by flipping the label handed to the gate, so the
// gate's RESERVE cell (positive = settled_open 0) reads "reserve high ⇒
// original OPEN". The VELOCITY cell under inversion is meaningless and is
// printed only for completeness.
//
// This file does not assert H1. It asserts the harness and prints the verdict.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { runArm, makeRng, type FixtureRow, type ArmReport } from './seam-wire';

const FIXTURE = 'test-fixtures/tap-series-gsm8k-test-n100.jsonl';
const OUT = 'research/seam-wire/SEAM_WIRE_001_replication.json';
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
  return `| ${a.readout} | ${a.stream.padEnd(20)} | ${a.n} | ${v.auc.toFixed(3)} (${v.auc_lower95.toFixed(3)}) ${v.verdict} | ${r.auc.toFixed(3)} (${r.auc_lower95.toFixed(3)}) ${r.verdict} | ${a.report.overall} |`;
}

const d = existsSync(FIXTURE) ? describe : describe.skip;

d('seam-wire · replication on held-out test split (H1 pre-registered)', () => {
  const rows = existsSync(FIXTURE) ? loadRows().filter((r) => !r.short) : [];
  const isOpen = (r: FixtureRow) => r.open_at_512 ?? r.truncated;
  const open = (r: FixtureRow): 0 | 1 => (isOpen(r) ? 1 : 0);
  const inverted = (r: FixtureRow): 0 | 1 => (isOpen(r) ? 0 : 1);
  const secondary: Record<string, (r: FixtureRow) => 0 | 1> = {
    'truncated@1024·inv': (r) => (r.truncated ? 0 : 1),
    'wrong·inv': (r) => (r.correct ? 1 : 0),
  };

  it('fixture: 100 full rows, every stream 96 long, open_at_512 present', () => {
    expect(rows.length).toBe(100);
    for (const r of rows) {
      expect(typeof r.open_at_512).toBe('boolean');
      for (const s of STREAMS) expect(r.streams[s].length).toBe(96);
    }
    const nOpen = rows.filter(isOpen).length;
    console.log(`open_at_512: ${nOpen} / 100 · truncated@1024: ${rows.filter((r) => r.truncated).length} · wrong: ${rows.filter((r) => !r.correct).length}`);
  });

  const asRegistered: ArmReport[] = [];
  const asInverted: ArmReport[] = [];
  const secondaries: ArmReport[] = [];
  const controls: ArmReport[] = [];

  it('runs every arm in both orientations', () => {
    for (const s of STREAMS) for (const ro of ['A', 'B'] as const) {
      asRegistered.push(runArm(ro, s, rows, open));
      const inv = runArm(ro, s, rows, inverted); inv.stream = `${s}·inverted`; asInverted.push(inv);
    }
    expect(asRegistered.length).toBe(6);
    for (const [name, fn] of Object.entries(secondary)) {
      const a = runArm('B', 'surprisal', rows, fn); a.stream = `surprisal·${name}`; secondaries.push(a);
    }
  });

  it('controls on the replication fixture must not BUILD (either orientation)', () => {
    const rng = makeRng(3031);
    const shuf = shuffleWith(rows.map(open), rng);
    for (const s of STREAMS) for (const ro of ['A', 'B'] as const) {
      const c = runArm(ro, s, rows, (r) => shuf[rows.indexOf(r)], 5); c.stream = `${s}·shufLabel`; controls.push(c);
      expect(c.report.overall).not.toBe('BUILD');
      const cInv = runArm(ro, s, rows, (r) => (1 - shuf[rows.indexOf(r)]) as 0 | 1, 5); cInv.stream = `${s}·shufLabel·inv`; controls.push(cInv);
      expect(cInv.report.overall).not.toBe('BUILD');
    }
  });

  it('prints H1 and the full table, writes the report', () => {
    const h1 = asInverted.find((a) => a.readout === 'B' && a.stream.startsWith('surprisal'))!;
    const reserve = h1.report.kill_tests[1];
    const gate1 = reserve.n_pos >= 20 && reserve.n_neg >= 20 && reserve.n_pos + reserve.n_neg >= 100;
    const h1Holds = gate1 && reserve.auc >= 0.65 && reserve.auc_lower95 > 0.5;
    const hdr = '| readout | stream | n | VELOCITY auc (lo95) | RESERVE auc (lo95) | overall |';
    const sep = '|---|---|---|---|---|---|';
    const out = ['', 'SEAM WIRE 001 — REPLICATION (held-out test split)',
      `H1: B/surprisal RESERVE inverted → AUC ${reserve.auc.toFixed(3)} (lo95 ${reserve.auc_lower95.toFixed(3)}), `
      + `n ${reserve.n_pos} OPEN / ${reserve.n_neg} SETTLED → ${h1Holds ? 'HOLDS' : 'FAILS'}`,
      '', 'as registered (reserve high ⇒ SETTLED)', hdr, sep, ...asRegistered.map(line),
      '', 'inverted (reserve high ⇒ OPEN)', hdr, sep, ...asInverted.map(line),
      '', 'secondary labels, B/surprisal only, reported not claimed', hdr, sep, ...secondaries.map(line),
      '', 'controls', hdr, sep, ...controls.map(line), ''].join('\n');
    console.log(out);
    writeFileSync(OUT, JSON.stringify({ h1: { holds: h1Holds, reserve }, asRegistered, asInverted, secondaries, controls }, null, 2));
    expect(typeof h1Holds).toBe('boolean');
  });
});
