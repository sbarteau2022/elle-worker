#!/usr/bin/env node
'use strict';
// settling_time.cjs — the G7 experiment. The paper claims settling on the atlas
// takes ≤ φ⁻¹ of the Euclidean settling time. This re-measures every recorded
// task trajectory (ATLAS.jsonl: anchor + each turn's 16-d map direction) under
// BOTH metrics on the same points: Lorentz distance in the hyperboloid, and
// Euclidean distance in the Poincaré ball. Settling time = first turn after
// which the distance-from-anchor series stays within τ·max of its final value.
// Reports the per-task ratio T_lorentz / T_euclid and how many tasks satisfy
// the φ⁻¹ claim. Whatever the number is, that is the number.
const fs = require('fs'); const path = require('path'); const os = require('os');
const H = require('/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/electron/native/providers/hyper-map.cjs');
const PHI_INV = 2 / (1 + Math.sqrt(5));
const TAU = Number(process.env.SETTLE_TAU) || 0.1;
const WS = process.env.ELLE_SWARM_WORKSPACE || path.join(os.homedir(), 'Library', 'Application Support', 'elle', 'swarm-workspace');
const OUT = path.join(__dirname, 'runs', 'settling_time.json');

function settle(series) {
  if (series.length < 2) return null;
  const last = series[series.length - 1]; const scale = Math.max(1e-9, ...series.map(Math.abs));
  for (let t = 0; t < series.length; t++) { if (series.slice(t).every((v) => Math.abs(v - last) <= TAU * scale)) return t + 1; }
  return series.length;
}
const euclid = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

const tasks = []; const skipped = [];
for (const d of fs.readdirSync(WS)) {
  const f = path.join(WS, d, 'ATLAS.jsonl'); if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const head = lines[0]; const rows = lines.slice(1).filter((r) => Array.isArray(r.dir) && head && Array.isArray(head.anchor));
  if (!head || !head.anchor || rows.length < 2) { skipped.push({ task: d, why: !head ? 'empty' : !head.anchor ? 'no anchor' : `${rows.length} turn(s) with a direction` }); continue; }
  const anchorB = H.toPoincare(head.anchor);
  const dL = rows.map((r) => H.dist(head.anchor, H.probePoint(r.dir)));
  const dE = rows.map((r) => euclid(anchorB, H.toPoincare(H.probePoint(r.dir))));
  const tL = settle(dL), tE = settle(dE);
  tasks.push({ task: d, turns: rows.length, tL, tE, ratio: tL && tE ? tL / tE : null, kappaEnd: rows[rows.length - 1].kappa, region: head.region ? head.region.level : null });
}
const ratios = tasks.map((t) => t.ratio).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
const mean = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
const claim = ratios.length ? ratios.filter((r) => r <= PHI_INV).length / ratios.length : null;
const report = { at: new Date().toISOString(), tau: TAU, n: tasks.length, skipped, median_ratio: median, mean_ratio: mean, frac_meeting_phi_inv: claim, phi_inv: PHI_INV, tasks };
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`G7 settling: n=${tasks.length} trajectories (${skipped.length} skipped: ${[...new Set(skipped.map((x) => x.why))].join('; ')}); T_lorentz/T_euclid median=${median === null ? 'n/a' : median.toFixed(3)} mean=${mean === null ? 'n/a' : mean.toFixed(3)}; fraction ≤ φ⁻¹ (${PHI_INV.toFixed(3)}): ${claim === null ? 'n/a' : (claim * 100).toFixed(0) + '%'} → ${OUT}`);
