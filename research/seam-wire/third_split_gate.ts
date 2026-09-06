// Third-split gate — runs the PRE-REGISTERED claims from SEAM_WIRE_001.md
// ("Pre-registered third split") on the pooled test + train fixtures. Nothing
// here is tunable: readout B, stream surprisal, RESERVE inverted, validate.ts.
// Usage: npx tsx research/seam-wire/third_split_gate.ts <fixture...>
import { readFileSync } from 'node:fs';
import { readoutB, toTraceRow, makeRng, calibratedKappa, type FixtureRow } from '../../src/seam-wire';
import { runValidateKappa } from '../../src/kappa-memory/validate';

const files = process.argv.slice(2);
const rows: FixtureRow[] = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const traces = rows.map((r, i) => readoutB(r.streams.surprisal, i));
const isOpen = (r: FixtureRow) => r.open_at_512 ?? r.truncated;
type Lab = (r: FixtureRow, i: number) => 0 | 1;
function cell(name: string, lab: Lab) {
  const rep = runValidateKappa(rows.map((r, i) => toTraceRow(traces[i], lab(r, i))));
  const rr = (rep.kill_tests as any[])[1];
  const holds = rr.verdict === 'BUILD';
  console.log(`${name.padEnd(34)} RESERVE auc ${rr.auc.toFixed(3)} (lo95 ${rr.auc_lower95.toFixed(3)}) n ${rr.n_pos}/${rr.n_neg} → ${rr.verdict}${holds ? '  ✔' : ''}`);
  return holds;
}
console.log(`pooled rows ${rows.length}  open@512 ${rows.filter(isOpen).length}  truncated ${rows.filter((r) => r.truncated).length}  wrong ${rows.filter((r) => !r.correct).length}`);
// inverted orientation: positive (=SETTLED slot) := NOT the event, so "reserve high ⇒ event"
const h2 = cell('H2 length (ran past 512)', (r) => (isOpen(r) ? 0 : 1));
const h3 = cell('H3 never closed (truncated@1024)', (r) => (r.truncated ? 0 : 1));
const h4 = cell('H4 wrong answer', (r) => (r.correct ? 1 : 0));
console.log('-- controls (label shuffle, seeds 1..3): any BUILD voids the run');
let voided = false;
for (const seed of [1, 2, 3]) {
  const rng = makeRng(seed);
  const sh = rows.map(isOpen).map((v) => (v ? 0 : 1) as 0 | 1).sort(() => rng() - 0.5);
  voided ||= cell(`  shuffle seed ${seed}`, (_r, i) => sh[i]);
}
// calibration transfer on the NEW rows only (train split), coefficients untouched
const fresh = rows.filter((r) => (r as any).split === 'train' || files.length === 1);
const target = fresh.length ? fresh : rows;
const ks = target.map((r, i) => calibratedKappa(r.streams.surprisal, i));
const ok = ks.filter((k) => k.reason === 'ok').length;
const brier = (lab: (r: FixtureRow) => number) => { let s = 0, n = 0; target.forEach((r, i) => { const k = ks[i]; if (k.kappa === null) return; s += (k.kappa - lab(r)) ** 2; n++; }); return s / Math.max(1, n); };
console.log(`calibration transfer: in-support ${ok}/${target.length}  Brier vs settled ${brier((r) => (isOpen(r) ? 0 : 1)).toFixed(4)}  Brier vs correct ${brier((r) => (r.correct ? 1 : 0)).toFixed(4)}  (0.25 = uninformative)`);
console.log(`VERDICT  H2 ${h2 ? 'HOLDS' : 'FAILS'}  H3 ${h3 ? 'HOLDS' : 'FAILS'}  H4 ${h4 ? 'HOLDS' : 'FAILS'}  controls ${voided ? 'VOID' : 'clean'}`);
