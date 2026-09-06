// Contraction protocol — pfar_phase_space.tex §7 (Elle origin/main 46a5c12), made concrete
// and PRE-REGISTERED here before it is run on any fixture:
//   trajectory  = per-window κ_c of the surprisal head (96 tokens), window 64, STRIDE 1 → 33 samples
//   target      = mean κ_c over the last 5 windows (the "settled" value the trajectory contracts to)
//   deviation   u_t = |κ_c,t − target| + 1e-6,  t = 0..32
//   fit         ln u_t = ln u_0 − r·t by OLS on the first 60% (t = 0..19)
//   held-out    predict u_t for t = 20..32 under u_0·e^{−r t}; NRMSE = RMSE / mean(u_held)
//   PASS        median held-out NRMSE < 0.15 AND r > 0 (contraction) in ≥ 90% of trajectories,
//               over N ≥ 200 CLOSED trajectories (closed = did not run past 512 tokens)
// Usage: npx tsx research/seam-wire/contraction_protocol.ts fixture1.jsonl [fixture2.jsonl ...]
import { readFileSync } from 'node:fs';
import { coupling, windows, type FixtureRow } from '../../src/seam-wire';

const files = process.argv.slice(2);
const rows: FixtureRow[] = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const isOpen = (r: FixtureRow) => r.open_at_512 ?? r.truncated;

function traj(series: number[], seed: number): number[] {
  return windows(series.slice(0, 96), 64, 1).map((w, i) => coupling(w, { seed: seed * 7919 + i }).kappa);
}
function fit(u: number[]) {
  const nFit = Math.floor(u.length * 0.6);
  const xs = [...Array(nFit).keys()], ys = xs.map((t) => Math.log(u[t]));
  const mx = xs.reduce((a, b) => a + b, 0) / nFit, my = ys.reduce((a, b) => a + b, 0) / nFit;
  let sxy = 0, sxx = 0; for (let i = 0; i < nFit; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx, icpt = my - slope * mx, r = -slope;
  const held = u.slice(nFit);
  let se = 0; held.forEach((v, j) => { const t = nFit + j; const pred = Math.exp(icpt + slope * t); se += (v - pred) ** 2; });
  const rmse = Math.sqrt(se / held.length), mean = held.reduce((a, b) => a + b, 0) / held.length;
  return { r, nrmse: rmse / mean };
}
function report(label: string, rs: FixtureRow[]) {
  const res = rs.map((row, i) => { const k = traj(row.streams.surprisal, i); const target = k.slice(-5).reduce((a, b) => a + b, 0) / 5; const u = k.map((v) => Math.abs(v - target) + 1e-6); return fit(u); });
  const nr = res.map((x) => x.nrmse).sort((a, b) => a - b), med = nr[Math.floor(nr.length / 2)];
  const contracting = res.filter((x) => x.r > 0).length / res.length;
  const pass = res.length >= 200 && med < 0.15 && contracting >= 0.9;
  console.log(`${label.padEnd(8)} n=${res.length}  median NRMSE ${med.toFixed(3)}  r>0 in ${(100 * contracting).toFixed(1)}%  median r ${res.map((x) => x.r).sort((a, b) => a - b)[Math.floor(res.length / 2)].toFixed(4)}  → ${pass ? 'PASS' : res.length < 200 ? 'UNDER-N' : 'FAIL'}`);
}
report('CLOSED', rows.filter((r) => !isOpen(r)));
report('OPEN', rows.filter(isOpen));
report('ALL', rows);
