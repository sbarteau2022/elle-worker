#!/usr/bin/env node
// ============================================================
// LANE-B SIEGE — "the residual is the prediction error; surprise as geometry"
//
// Runs the REAL src/pami.ts and src/hyper.ts (esbuild-bundled, no mocks) and
// asks the one question the claim rests on: does the PAMI → DHNG pipeline
// actually turn surprisal into geometry?
//
// The claim decomposes into three independent links, and this harness attacks
// each one separately so a failure localizes:
//   L1  residual R(t) → PamiIndex      (does the index vary with surprisal?)
//   L2  PamiIndex → pamiDistance        (is the native metric well-behaved?)
//   L3  PamiIndex → ripVector → ball    (does the bridge preserve L2?)
//
// Deterministic: seeded LCG, no wall-clock, no network. Re-run and get the
// same numbers or the harness is broken.
//
//   node docs/pami_dhng_siege.cjs
// ============================================================
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

// ── build the bundle from the real sources ──────────────────────────────────
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pami-siege-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, [
  `export { pamiIndex, pamiDistance, resonance, SPEC_CONFIG, indexLength } from ${JSON.stringify(path.join(root, 'src/pami'))};`,
  `export { ripVector, placeFeatures, poincareDist, depth, norm, RIP_DIM } from ${JSON.stringify(path.join(root, 'src/hyper'))};`,
].join('\n'));
const bundle = path.join(tmp, 'bundle.cjs');
execFileSync('npx', ['--no-install', 'esbuild', '--bundle', '--format=cjs', '--platform=node',
  '--outfile=' + bundle, entry], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const M = require(bundle);

// ── determinism ─────────────────────────────────────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ── stats ───────────────────────────────────────────────────────────────────
function rank(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  const n = a.length, am = a.reduce((x, y) => x + y, 0) / n, bm = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - am, y = b[i] - bm; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}
const spearman = (a, b) => pearson(rank(a), rank(b));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const fmt = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// ── signal families ─────────────────────────────────────────────────────────
const N = 512;
function sine(r, amp) {      // perfectly predictable: one tone, zero surprisal
  const f = 0.01 + 0.06 * r(), ph = r() * 2 * Math.PI, out = [];
  for (let i = 0; i < N; i++) out.push(amp * Math.sin(2 * Math.PI * f * i + ph));
  return out;
}
function white(r, amp) {     // maximal surprisal per sample, no structure
  const out = []; for (let i = 0; i < N; i++) out.push(amp * gauss(r)); return out;
}
function ar1(r, amp, rho) {  // partially predictable
  const out = []; let x = 0;
  for (let i = 0; i < N; i++) { x = rho * x + gauss(r); out.push(amp * x); } return out;
}
function burst(r, amp) {     // rare large deviations: high surprisal, sparse
  const out = []; for (let i = 0; i < N; i++) out.push(r() < 0.02 ? amp * 6 * gauss(r) : amp * 0.05 * gauss(r)); return out;
}
function chirp(r, amp) {     // predictable but nonstationary
  const out = []; const f0 = 0.005 + 0.01 * r();
  for (let i = 0; i < N; i++) out.push(amp * Math.sin(2 * Math.PI * (f0 * i + 4e-5 * i * i))); return out;
}

const R = [];
function say(s) { R.push(s); console.log(s); }
function hdr(s) { say(''); say('━'.repeat(78)); say(s); say('━'.repeat(78)); }

say('LANE-B SIEGE — PAMI residual → DHNG geometry');
say(`index length ${M.indexLength()} floats (8 phases + 13 dims) · RIP_DIM ${M.RIP_DIM}`);
const CAP = 2 * Math.atanh(Math.tanh(0.9));
say(`structural depth ceiling 2·atanh(tanh 0.9) = ${fmt(CAP)}`);

// ════════════════════════════════════════════════════════════════════════════
// B0 — DOES THE BRIDGE HAVE ANY RADIAL RANGE AT ALL?
// ‖f‖ ≤ 1 is enforced inside ripVector, and placeFeatures scales by 0.9. If the
// hash sum saturates for typical indices, every index lands at EXACTLY the cap
// and radial depth carries zero bits. That would end the claim on its own.
// ════════════════════════════════════════════════════════════════════════════
hdr('B0 · radial range of the bridge  (is depth even a variable?)');
{
  const r = lcg(0xB0);
  const fams = { sine, white, ar1: (rr, a) => ar1(rr, a, 0.9), burst, chirp };
  const depths = [], sat = [];
  const perFam = {};
  for (const [name, gen] of Object.entries(fams)) {
    const ds = [];
    for (let i = 0; i < 40; i++) {
      const idx = M.pamiIndex(gen(r, 1));
      if (!idx) continue;
      const f = M.ripVector(idx);
      const nf = M.norm(f);
      const d = M.depth(M.placeFeatures(f, M.RIP_DIM));
      depths.push(d); ds.push(d); sat.push(nf >= 1 - 1e-9 ? 1 : 0);
    }
    perFam[name] = ds;
  }
  const satRate = mean(sat);
  say(`n = ${depths.length} indices across 5 signal families`);
  say(`‖ripVector‖ saturated at 1 (⇒ depth pinned to the ceiling): ${(100 * satRate).toFixed(1)}%`);
  say(`depth  min ${fmt(Math.min(...depths))}  max ${fmt(Math.max(...depths))}  mean ${fmt(mean(depths))}  sd ${fmt(sd(depths), 6)}`);
  for (const [k, v] of Object.entries(perFam)) say(`   ${k.padEnd(6)} depth mean ${fmt(mean(v))}  sd ${fmt(sd(v), 6)}`);
  const range = Math.max(...depths) - Math.min(...depths);
  say('');
  say(range < 1e-6
    ? `VERDICT: DEAD. Radial depth is CONSTANT (range ${fmt(range, 9)}). Every PAMI index lands at the same distance from the origin, so "depth = surprisal" carries exactly 0 bits through this bridge.`
    : `VERDICT: depth varies (range ${fmt(range)}). B3 tests whether the variation tracks surprisal.`);
}

// ════════════════════════════════════════════════════════════════════════════
// B1 — THE PHASE TORUS
// pamiDistance treats phases circularly (mod 2π, fold at π). ripVector applies
// tanh(symlog(v)) to every numeric leaf as a real on a LINE. So θ = +π−ε and
// θ = −π+ε — the same point on 𝕋⁸, 2ε apart — should be adjacent under the
// native metric and maximally far apart under the bridge.
// Control: a pair with a comparable NATIVE distance away from the wrap, to
// prove the effect is the wrap and not generic bridge noise.
// ════════════════════════════════════════════════════════════════════════════
hdr('B1 · phase-torus destruction  (native metric wraps; bridge does not)');
{
  const dims = new Array(13).fill(0).map((_, i) => 1 - 0.05 * i);
  const mk = (ph) => ({ phases: ph.slice(), dims: dims.slice() });
  const bridgeDist = (a, b) =>
    M.poincareDist(M.placeFeatures(M.ripVector(a), M.RIP_DIM), M.placeFeatures(M.ripVector(b), M.RIP_DIM));

  const eps = 0.01;
  const base = [0.5, -1.2, 2.0, 0.3, -0.7, 1.1, -2.4, 0.9];
  const wrapA = base.slice(); wrapA[0] = Math.PI - eps;
  const wrapB = base.slice(); wrapB[0] = -Math.PI + eps;      // same torus point, 2ε away
  const ctrlA = base.slice(); ctrlA[0] = 0.5;
  const ctrlB = base.slice(); ctrlB[0] = 0.5 + 2 * eps;        // same native separation, mid-range

  const rows = [
    ['wrap pair  (+π−ε vs −π+ε)', mk(wrapA), mk(wrapB)],
    ['control    (0.5 vs 0.5+2ε)', mk(ctrlA), mk(ctrlB)],
  ];
  say('pair                          pamiDistance    bridge geodesic');
  const out = {};
  for (const [label, a, b] of rows) {
    const pd = M.pamiDistance(a, b), bd = bridgeDist(a, b);
    out[label] = [pd, bd];
    say(`${label.padEnd(30)} ${fmt(pd, 6).padStart(10)}   ${fmt(bd, 6).padStart(14)}`);
  }
  const [pw, bw] = out['wrap pair  (+π−ε vs −π+ε)'];
  const [pc, bc] = out['control    (0.5 vs 0.5+2ε)'];
  say('');
  say(`native  wrap/control ratio: ${fmt(pw / Math.max(pc, 1e-12), 3)}   (≈1 ⇒ the native metric sees the wrap as the same tiny step — correct)`);
  say(`bridge  wrap/control ratio: ${fmt(bw / Math.max(bc, 1e-12), 3)}   (≫1 ⇒ the bridge tears the torus)`);
  const tear = bw / Math.max(bc, 1e-12);
  say('');
  say(tear > 10
    ? `VERDICT: CONFIRMED. The bridge inflates a 2ε torus step into a ${fmt(tear, 0)}× separation. tanh(symlog(θ)) is a map of ℝ, not of 𝕋⁸ — the phase half of the index (8 of 21 floats, the entire F6 fingerprint) is geometrically wrong the moment it enters the ball.`
    : `VERDICT: NOT confirmed at this magnitude (ratio ${fmt(tear, 2)}). The wrap survives the bridge better than predicted.`);
}

// ════════════════════════════════════════════════════════════════════════════
// B2 — RANK FIDELITY  (21 floats → 16 hashed directions)
// If the bridge is a faithful embedding, ordering by pamiDistance and ordering
// by ball geodesic should agree. Spearman over many real index pairs; plus the
// worst inversion, which is what a retrieval would actually get wrong.
// ════════════════════════════════════════════════════════════════════════════
hdr('B2 · rank fidelity of the bridge  (Spearman: native metric vs ball)');
{
  const r = lcg(0xB2);
  const gens = [ (rr) => sine(rr, 1), (rr) => white(rr, 1), (rr) => ar1(rr, 1, 0.9),
                 (rr) => ar1(rr, 1, 0.3), (rr) => burst(rr, 1), (rr) => chirp(rr, 1) ];
  const idxs = [], pts = [];
  for (let i = 0; i < 90; i++) {
    const g = gens[i % gens.length];
    const idx = M.pamiIndex(g(r, 1));
    if (!idx) continue;
    idxs.push(idx); pts.push(M.placeFeatures(M.ripVector(idx), M.RIP_DIM));
  }
  const pd = [], bd = [], pairs = [];
  for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
    pd.push(M.pamiDistance(idxs[i], idxs[j]));
    bd.push(M.poincareDist(pts[i], pts[j]));
    pairs.push([i, j]);
  }
  const rho = spearman(pd, bd);
  say(`n = ${idxs.length} real indices, ${pd.length} pairs`);
  say(`Spearman ρ(pamiDistance, ball geodesic) = ${fmt(rho)}`);
  say(`pamiDistance   range [${fmt(Math.min(...pd))}, ${fmt(Math.max(...pd))}]  sd ${fmt(sd(pd))}`);
  say(`ball geodesic  range [${fmt(Math.min(...bd))}, ${fmt(Math.max(...bd))}]  sd ${fmt(sd(bd))}`);
  // worst collision: far natively, adjacent in the ball
  let worst = -1, wi = -1;
  const pdm = Math.max(...pd), bdm = Math.max(...bd);
  for (let k = 0; k < pd.length; k++) {
    const s = (pd[k] / pdm) - (bd[k] / bdm);
    if (s > worst) { worst = s; wi = k; }
  }
  say(`worst collision: pair (${pairs[wi][0]},${pairs[wi][1]}) — native ${fmt(pd[wi])} (${(100*pd[wi]/pdm).toFixed(0)}% of max) but ball ${fmt(bd[wi])} (${(100*bd[wi]/bdm).toFixed(0)}% of max)`);
  say('');
  say(rho > 0.8 ? `VERDICT: the bridge largely preserves the native ordering (ρ=${fmt(rho,3)}).`
    : rho > 0.4 ? `VERDICT: PARTIAL. ρ=${fmt(rho,3)} — the bridge preserves the coarse ordering and loses the fine one. 21 floats onto 16 non-orthogonal hashed directions cannot be injective; retrieval on the ball is not retrieval on PAMI.`
    : `VERDICT: BROKEN. ρ=${fmt(rho,3)} — the ball ordering is close to unrelated to the native ordering. The bridge is not an embedding of the index.`);
}

// ════════════════════════════════════════════════════════════════════════════
// B3 — DOES ANYTHING IN THE PIPELINE TRACK SURPRISAL?
// Genuinely two-sided. D(q) is scale-free by construction, so amplitude
// invariance is a POINT IN FAVOUR (a residual is surprising by structure, not
// by loudness) — but only if some other axis then separates predictable from
// unpredictable. Both are measured; neither is rigged.
// ════════════════════════════════════════════════════════════════════════════
hdr('B3 · surprisal sensitivity  (amplitude invariance vs structure sensitivity)');
{
  const r = lcg(0xB3);
  // (a) amplitude invariance: same signal, ×100
  let ampNative = [], ampDepth = [];
  for (let i = 0; i < 20; i++) {
    const s = ar1(lcg(0x100 + i), 1, 0.9);
    const a = M.pamiIndex(s), b = M.pamiIndex(s.map((v) => v * 100));
    if (!a || !b) continue;
    ampNative.push(M.pamiDistance(a, b));
    ampDepth.push(Math.abs(M.depth(M.placeFeatures(M.ripVector(a), M.RIP_DIM)) - M.depth(M.placeFeatures(M.ripVector(b), M.RIP_DIM))));
  }
  say(`(a) amplitude ×100, identical structure:`);
  say(`    pamiDistance  mean ${fmt(mean(ampNative), 6)}  max ${fmt(Math.max(...ampNative), 6)}   ← 0 = amplitude-invariant`);
  say(`    |Δdepth|      mean ${fmt(mean(ampDepth), 6)}  max ${fmt(Math.max(...ampDepth), 6)}`);

  // (b) structure sensitivity: within-family vs between-family native distance
  const fams = { sine: (rr) => sine(rr, 1), white: (rr) => white(rr, 1),
                 ar1_9: (rr) => ar1(rr, 1, 0.9), burst: (rr) => burst(rr, 1) };
  const byFam = {};
  for (const [k, g] of Object.entries(fams)) {
    byFam[k] = []; for (let i = 0; i < 25; i++) { const x = M.pamiIndex(g(r)); if (x) byFam[k].push(x); }
  }
  const within = [], between = [];
  const names = Object.keys(byFam);
  for (const k of names) for (let i = 0; i < byFam[k].length; i++) for (let j = i + 1; j < byFam[k].length; j++) within.push(M.pamiDistance(byFam[k][i], byFam[k][j]));
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++)
    for (const x of byFam[names[a]]) for (const y of byFam[names[b]]) between.push(M.pamiDistance(x, y));
  const d1 = (mean(between) - mean(within)) / Math.sqrt((sd(within) ** 2 + sd(between) ** 2) / 2);
  say('');
  say(`(b) does the NATIVE metric separate structure families?`);
  say(`    within-family  mean ${fmt(mean(within))} ± ${fmt(sd(within))}  (n=${within.length})`);
  say(`    between-family mean ${fmt(mean(between))} ± ${fmt(sd(between))}  (n=${between.length})`);
  say(`    Cohen's d = ${fmt(d1, 3)}`);

  // (c) same, through the bridge
  const wB = [], bB = [];
  const pt = (x) => M.placeFeatures(M.ripVector(x), M.RIP_DIM);
  const ptFam = {}; for (const k of names) ptFam[k] = byFam[k].map(pt);
  for (const k of names) for (let i = 0; i < ptFam[k].length; i++) for (let j = i + 1; j < ptFam[k].length; j++) wB.push(M.poincareDist(ptFam[k][i], ptFam[k][j]));
  for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++)
    for (const x of ptFam[names[a]]) for (const y of ptFam[names[b]]) bB.push(M.poincareDist(x, y));
  const d2 = (mean(bB) - mean(wB)) / Math.sqrt((sd(wB) ** 2 + sd(bB) ** 2) / 2);
  say('');
  say(`(c) same question, through the bridge:`);
  say(`    within-family  mean ${fmt(mean(wB))} ± ${fmt(sd(wB))}`);
  say(`    between-family mean ${fmt(mean(bB))} ± ${fmt(sd(bB))}`);
  say(`    Cohen's d = ${fmt(d2, 3)}   (native d = ${fmt(d1, 3)}; retention ${fmt(100 * d2 / Math.max(d1, 1e-9), 0)}%)`);

  // (d) does DEPTH order the families by unpredictability?
  say('');
  say(`(d) radial depth per family — the actual "surprise = depth" claim:`);
  for (const k of names) {
    const ds = ptFam[k].map(M.depth);
    say(`    ${k.padEnd(6)} depth ${fmt(mean(ds))} ± ${fmt(sd(ds), 6)}`);
  }
  const order = names.map((k) => [k, mean(ptFam[k].map(M.depth))]).sort((a, b) => a[1] - b[1]);
  say(`    ordering (shallow→deep): ${order.map(([k, v]) => `${k} ${fmt(v, 4)}`).join('  <  ')}`);
  say(`    expected if depth = surprisal: sine < ar1_9 < burst ≈ white`);
}

// ════════════════════════════════════════════════════════════════════════════
// B4 — THE REFERENCE MEASURE
// d(0,ψ) is "distance from typicality" only if the store's mass sits at the
// origin. Nothing in placeFeatures enforces that. Measure the offset.
// ════════════════════════════════════════════════════════════════════════════
hdr('B4 · reference-measure calibration  (where is the store\'s centre of mass?)');
{
  const r = lcg(0xB4);
  const gens = [(rr) => sine(rr, 1), (rr) => ar1(rr, 1, 0.9), (rr) => ar1(rr, 1, 0.5), (rr) => chirp(rr, 1)];
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const idx = M.pamiIndex(gens[i % gens.length](r));
    if (idx) pts.push(M.placeFeatures(M.ripVector(idx), M.RIP_DIM));
  }
  const c = new Array(M.RIP_DIM).fill(0);
  for (const p of pts) for (let i = 0; i < c.length; i++) c[i] += p[i] / pts.length;
  const cn = M.norm(c);
  const dToC = pts.map((p) => M.poincareDist(p, c));
  const dTo0 = pts.map((p) => M.depth(p));
  say(`store n = ${pts.length} "ordinary" (predictable-ish) indices`);
  say(`Euclidean-mean centroid: ‖c‖ = ${fmt(cn, 6)}   (0 ⇒ the store's mass IS at the origin)`);
  say(`mean geodesic to centroid ${fmt(mean(dToC))} ± ${fmt(sd(dToC), 6)}`);
  say(`mean geodesic to origin   ${fmt(mean(dTo0))} ± ${fmt(sd(dTo0), 6)}`);
  say(`ρ(depth, distance-from-centroid) = ${fmt(spearman(dTo0, dToC), 4)}`);
  say('');
  say(cn < 0.05
    ? `The store IS approximately origin-centred (‖c‖=${fmt(cn,4)}), so depth ≈ atypicality is defensible for THIS store — but nothing in the code enforces it; it is a property of these inputs, not of the design.`
    : `The store's mass sits ${fmt(cn, 4)} off the origin, so d(0,ψ) is NOT "distance from typicality" — it is distance from an arbitrary point the design happened to pick.`);
}

hdr('SUMMARY');
say('L1 residual → index : NO PRODUCER IN CODE. Every non-test pamiIndex call is');
say('   fed synthetic memorySignalNeutral() in phi-minimax-scorecard.ts; the one');
say('   live path (router.ts case \'pami\') takes signal[] verbatim from LLM JSON,');
say('   and pami.ts:617 / router.ts:553 both instruct the CALLER to "subtract your');
say('   prediction first". There is no prediction operator 𝒫 anywhere in src/.');
say('L2 index → pamiDistance : real, pure, deterministic, torus-correct.');
say('L3 index → ball         : see B0–B2 above.');
say('');
say('Nothing here was measured against a live residual, because there is not one.');

fs.writeFileSync(path.join(root, 'docs', 'PAMI_DHNG_SIEGE_RESULTS.txt'), R.join('\n') + '\n');
console.log('\n[written] docs/PAMI_DHNG_SIEGE_RESULTS.txt');
