// Dumps the per-row TraceRows behind SEAM_WIRE_001 so the Rust gate
// (harness-dhng/src/swarm_eval.rs) can be run on the identical rows.
import { readFileSync, writeFileSync } from 'node:fs';
import { readoutA, readoutB, toTraceRow, type FixtureRow } from '../../src/seam-wire';
const rows = readFileSync(process.argv[2] ?? 'test-fixtures/tap-series-gsm8k-n100.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FixtureRow);
const out: Record<string, { settled_open: number; reserve: number | null; velocity_peak: number | null }[]> = {};
for (const stream of ['surprisal', 'norm12', 'norm48']) for (const ro of ['A', 'B'] as const) {
  out[`${ro}/${stream}`] = rows.map((r, i) => {
    const t = ro === 'A' ? readoutA(r.streams[stream]) : readoutB(r.streams[stream], i);
    const open = r.open_at_512 ?? r.truncated; const row = toTraceRow(t, (process.argv[4] === 'inv' ? !open : open) ? 1 : 0);
    return { settled_open: row.settled_open as number, reserve: row.reserve, velocity_peak: row.velocity_peak };
  });
}
writeFileSync(process.argv[3] ?? 'research/seam-wire/trace_rows.json', JSON.stringify(out));
console.log('wrote', Object.keys(out).length, 'arms ×', rows.length, 'rows');
