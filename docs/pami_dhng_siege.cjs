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
// ── SELF-AUDIT (2nd pass over this harness, not over the codebase) ──────────
// A null result is only as strong as the probe's power, so this file was
// re-audited adversarially before its numbers were trusted. Six defects were
// found in the 1st-pass harness and are fixed here:
//
//   F1  no self-stamp. The results file named no commit, so a number could be
//       quoted against a tree it was never run on. Now stamps HEAD + dirty.
//   F2  B0's causal attribution was WRONG. The 1st pass blamed "ripVector's
//       clamp interacting with placeFeatures' n>1 branch". Reading both
//       verbatim: ripVector (hyper.ts:197-198) already clamps to ‖f‖ ≤ 1, so
//       placeFeatures NEVER takes its n>1 branch — it takes the else branch
//       and merely scales by 0.9. The collapse to exactly 2·atanh(tanh 0.9)
//       is caused by the clamp at hyper.ts:198 ALONE. Fixed, and backed by a
//       counterfactual that shows the discarded variation is really there.
//   F3  B1 tested ONE ε on hand-built synthetic {phases,dims} objects. A tear
//       measured at a single scale on a fabricated input cannot be
//       generalized. Now: an ε sweep across six decades, plus an arm that
//       perturbs a REAL pamiIndex.
//   F4  B3's within/between pair sets are NOT independent — each index
//       appears in many pairs, so Cohen's d there has no valid standard
//       error. Now labelled descriptive, and supplemented with a
//       one-trial-per-index statistic that does carry an interval.
//   F5  B4 took a EUCLIDEAN centroid of points in a HYPERBOLIC space. That is
//       the wrong centre; ‖c‖ from it is not the store's centre of mass. Now
//       computes a Fréchet/Karcher mean by Möbius iteration and reports both.
//   F6  the harness always exited 0. A probe that cannot fail cannot be wired
//       into CI. Now collects DEFECTS and exits nonzero.
//
// Every prose line in SUMMARY is tagged MEASURED (a probe in this file ran it)
// or UNMEASURED (read off the tree). A grep over a working tree is not a
// call-graph, and this harness no longer pretends otherwise.
//
//   node docs/pami_dhng_siege.cjs      # exit 0 = clean, 1 = adverse findings
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
  // mobiusAdd is pulled in for B4's Fréchet mean: the centre of mass of points
  // in the ball is not their Euclidean average, and computing it needs the
  // ball's own group operation — the SHIPPED one, not a re-implementation.
  `export { ripVector, placeFeatures, poincareDist, depth, norm, RIP_DIM, mobiusAdd } from ${JSON.stringify(path.join(root, 'src/hyper'))};`,
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

// F6: a probe that always exits 0 is a report, not a test. Every adverse
// finding is pushed here and the process exit code is derived from it.
const DEFECTS = [];
function defect(s) { DEFECTS.push(s); }

// F1: stamp the tree these numbers came from, so a quoted figure can always be
// traced to a commit — and so a figure measured on a dirty tree says so.
let stamp = 'unknown', dirty = false;
try {
  stamp = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim().length > 0;
} catch (_) { /* not a repo, or git unavailable — stamp stays 'unknown' */ }

say('='.repeat(72));
say('LANE-B SIEGE — PAMI residual → DHNG geometry');
say(`commit ${stamp}${dirty ? ' (WORKING TREE DIRTY)' : ''}`);
say('='.repeat(72));
say(`index length ${M.indexLength()} floats (8 phases + 13 dims) · RIP_DIM ${M.RIP_DIM}`);
const CAP = 2 * Math.atanh(Math.tanh(0.9));
say(`structural depth ceiling 2·atanh(tanh 0.9) = ${fmt(CAP)}`);

// ════════════════════════════════════════════════════════════════════════════
// B0 — DOES THE BRIDGE HAVE ANY RADIAL RANGE AT ALL?
//
// F2 CORRECTION to the 1st pass. The mechanism, read verbatim from hyper.ts:
//
//   ripVector      197:  const n = norm(f);
//                  198:  if (n > 1) for (let i = 0; i < dim; i++) f[i] /= n;
//   placeFeatures  208:  const t = n > 1 ? f.map(v => (v/n)*TANGENT_SCALE)
//                                        : f.map(v => v*TANGENT_SCALE);
//
// ripVector ALREADY clamps to ‖f‖ ≤ 1, so placeFeatures' n>1 branch is
// unreachable from this path — it always takes the else branch and just
// scales by 0.9. The 1st pass called the collapse "the clamp interacting with
// the n>1 branch"; that was wrong. The clamp at line 198 destroys the radial
// coordinate BY ITSELF: once ‖f‖ = 1 for every index, ‖t‖ = 0.9 for every
// index, and depth = 2·atanh(tanh 0.9) = 1.8000 for every index.
//
// A constant is not evidence of absent information — it can also mean the
// information was thrown away. So B0 also runs a COUNTERFACTUAL: shrink the
// index leaves until the sum falls under the clamp, and see whether depth
// starts to vary. If it does, the variation exists upstream and line 198 is
// discarding it.
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
  if (range < 1e-6) defect('B0 radial depth is constant across all families; the bridge carries 0 radial bits');
  if (satRate > 0.5) defect(`B0 ripVector saturates on ${(100 * satRate).toFixed(0)}% of real indices (clamp at hyper.ts:198)`);

  // ── F2 counterfactual: is the variation absent, or discarded? ─────────────
  // Scale every leaf of the index by α. tanh(symlog(·)) is monotone through
  // zero, so small α shrinks each hashed contribution and the sum eventually
  // falls under the clamp. If depth is flat at α=1 but spreads at small α,
  // the radial information EXISTS and line 198 is deleting it.
  const scaleIdx = (idx, a) => ({
    phases: idx.phases.map((v) => v * a),
    dims: idx.dims.map((v) => v * a),
  });
  const probe = [];
  for (const [name, gen] of Object.entries(fams)) {
    const rr = lcg(0xB0C0);
    for (let i = 0; i < 12; i++) { const x = M.pamiIndex(gen(rr, 1)); if (x) probe.push([name, x]); }
  }
  say('');
  say('COUNTERFACTUAL — shrink the index leaves by α and re-measure:');
  say('   α        ‖ripVector‖ mean   saturated%   depth range   depth sd');
  let recovered = 0;
  let rangeAt1 = 0;
  for (const a of [1, 0.5, 0.2, 0.1, 0.05, 0.02]) {
    const ns = [], ds = [];
    for (const [, x] of probe) {
      const f = M.ripVector(scaleIdx(x, a));
      ns.push(M.norm(f));
      ds.push(M.depth(M.placeFeatures(f, M.RIP_DIM)));
    }
    const st = mean(ns.map((v) => (v >= 1 - 1e-9 ? 1 : 0)));
    const rg = Math.max(...ds) - Math.min(...ds);
    if (rg > 1e-6) recovered++;
    if (a === 1) rangeAt1 = rg;
    say(`   ${String(a).padEnd(7)}  ${fmt(mean(ns), 6).padStart(14)}   ${(100 * st).toFixed(0).padStart(8)}%   ${fmt(rg, 6).padStart(11)}   ${fmt(sd(ds), 6).padStart(8)}`);
  }
  say('');
  say(rangeAt1 > 1e-6
    ? `CONCLUSION: depth SPREADS at native scale α=1 (range ${fmt(rangeAt1, 6)}) and at ${recovered} of 6 scales tested. The radial coordinate is live: the index-to-radius mapping passes variation through at the scale production actually runs.`
    : recovered > 0
      ? `CONCLUSION: depth is flat at α=1 but SPREADS at ${recovered} smaller scale(s). The radial variation is present in the index and is being DESTROYED before the ball — this is a discarded coordinate, not a missing one. A monotone radial squash (e.g. f ← f·tanh(‖f‖)/‖f‖) in ripVector restores the axis.`
      : `CONCLUSION: depth stays flat at every α tested. The saturating map is not the only cause; the hashed sum itself may carry no usable radial signal.`);
}

// ════════════════════════════════════════════════════════════════════════════
// B1 — THE PHASE TORUS
// pamiDistance treats phases circularly (mod 2π, fold at π). ripVector applies
// tanh(symlog(v)) to every numeric leaf as a real on a LINE. So θ = +π−ε and
// θ = −π+ε — the same point on 𝕋⁸, 2ε apart — should be adjacent under the
// native metric and maximally far apart under the bridge.
// Control: a pair with a comparable NATIVE distance away from the wrap, to
// prove the effect is the wrap and not generic bridge noise.
//
// F3 CORRECTION: the 1st pass measured a single ε = 0.01 on hand-built
// {phases,dims} objects that pamiIndex never produced. One scale on one
// fabricated input cannot support a claim about the pipeline. This pass sweeps
// ε across six decades and adds an arm that perturbs a REAL pamiIndex, so the
// synthetic result has to survive contact with production output.
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
  if (tear > 10) defect(`B1 the bridge tears the phase torus (${fmt(tear, 0)}× inflation of a 2ε wrap step)`);

  // ── F3(i) ε sweep: is the tear a property of one scale? ──────────────────
  say('');
  say('ε SWEEP (synthetic index) — the tear must not be an artefact of ε=0.01:');
  say('   ε          native wrap/ctrl   bridge wrap/ctrl');
  const tears = [];
  for (const e of [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
    const wA = base.slice(); wA[0] = Math.PI - e;
    const wB2 = base.slice(); wB2[0] = -Math.PI + e;
    const cA = base.slice(); cA[0] = 0.5;
    const cB = base.slice(); cB[0] = 0.5 + 2 * e;
    const pwe = M.pamiDistance(mk(wA), mk(wB2)), bwe = bridgeDist(mk(wA), mk(wB2));
    const pce = M.pamiDistance(mk(cA), mk(cB)), bce = bridgeDist(mk(cA), mk(cB));
    const t = bwe / Math.max(bce, 1e-12);
    tears.push(t);
    say(`   ${e.toExponential(0).padEnd(9)}  ${fmt(pwe / Math.max(pce, 1e-12), 3).padStart(15)}   ${fmt(t, 1).padStart(16)}`);
  }
  const minTear = Math.min(...tears);
  say(`   tear ratio holds at ≥ ${fmt(minTear, 1)}× across all six decades: ${minTear > 10 ? 'YES' : 'NO'}`);

  // ── F3(ii) real-index arm: does it survive production output? ────────────
  say('');
  say('REAL-INDEX ARM — same test on indices pamiIndex actually produced:');
  const rr = lcg(0xB1B1);
  const realTears = [];
  let realN = 0;
  for (let i = 0; i < 20; i++) {
    const idx = M.pamiIndex(ar1(rr, 1, 0.9));
    if (!idx) continue;
    realN++;
    const e = 0.01;
    const wa = { phases: idx.phases.slice(), dims: idx.dims.slice() };
    const wb = { phases: idx.phases.slice(), dims: idx.dims.slice() };
    wa.phases[0] = Math.PI - e; wb.phases[0] = -Math.PI + e;
    const ca = { phases: idx.phases.slice(), dims: idx.dims.slice() };
    const cb = { phases: idx.phases.slice(), dims: idx.dims.slice() };
    ca.phases[0] = 0.5; cb.phases[0] = 0.5 + 2 * e;
    const bwr = bridgeDist(wa, wb), bcr = bridgeDist(ca, cb);
    realTears.push(bwr / Math.max(bcr, 1e-12));
  }
  if (realTears.length) {
    say(`   n = ${realN} real indices · bridge wrap/ctrl ratio: min ${fmt(Math.min(...realTears), 1)}  median ${fmt(realTears.slice().sort((a, b) => a - b)[realTears.length >> 1], 1)}  max ${fmt(Math.max(...realTears), 1)}`);
    const rmin = Math.min(...realTears);
    say(`   the synthetic finding ${rmin > 10 ? 'SURVIVES' : 'does NOT survive'} contact with real pamiIndex output.`);
    if (rmin > 10) defect('B1 the torus tear reproduces on real pamiIndex output, not just synthetic inputs');
  } else {
    say('   no real indices produced — arm inconclusive.');
  }
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
  say(`    Cohen's d = ${fmt(d1, 3)}   [DESCRIPTIVE ONLY — see F4 note below]`);

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
  say('');
  say('    F4 NOTE — these two d values are DESCRIPTIVE and carry no interval.');
  say(`    The ${within.length} within- and ${between.length} between-family values are pairwise distances over`);
  say(`    only ${names.reduce((a, k) => a + byFam[k].length, 0)} indices, so each index appears in many pairs and the "n" in any`);
  say('    standard error would be a fiction. The 1st-pass harness reported d as');
  say('    though the pairs were independent. They are not. The retention figure');
  say('    is a ratio of two such statistics and inherits the same limitation:');
  say('    read it as a magnitude, never as a test.');

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
  const depthRange = Math.max(...order.map((o) => o[1])) - Math.min(...order.map((o) => o[1]));
  if (depthRange < 1e-6) defect('B3(d) per-family depth means are identical; depth does not order families at all');

  // ── F4 independent statistic: ONE trial per index, so n is real ──────────
  // Leave-one-out nearest-neighbour family purity. Each index contributes
  // exactly one Bernoulli trial (is my nearest neighbour from my own family?),
  // so a Wilson interval on the proportion is legitimate — unlike a d over
  // dependent pairs. Chance level is 1/4 with four equal-sized families.
  say('');
  say('(e) INDEPENDENT statistic — leave-one-out nearest-neighbour family purity');
  say('    (one trial per index, so this one carries a real interval; chance = 0.250)');
  const wilson = (k, n) => {
    if (!n) return [0, 0];
    const z = 1.959963985, ph = k / n, d = 1 + z * z / n;
    const c = (ph + z * z / (2 * n)) / d;
    const h = (z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  };
  const flat = [];
  for (const k of names) byFam[k].forEach((x, i) => flat.push({ fam: k, idx: x, pt: ptFam[k][i] }));
  const purity = (distFn) => {
    let hit = 0;
    for (let i = 0; i < flat.length; i++) {
      let bj = -1, bd = Infinity;
      for (let j = 0; j < flat.length; j++) {
        if (i === j) continue;
        const d = distFn(flat[i], flat[j]);
        if (d < bd) { bd = d; bj = j; }
      }
      if (bj >= 0 && flat[bj].fam === flat[i].fam) hit++;
    }
    return hit;
  };
  const hitN = purity((a, b) => M.pamiDistance(a.idx, b.idx));
  const hitB = purity((a, b) => M.poincareDist(a.pt, b.pt));
  const n = flat.length;
  const [nl, nu] = wilson(hitN, n), [bl, bu] = wilson(hitB, n);
  say(`    native metric : ${hitN}/${n} = ${fmt(hitN / n, 3)}   95% Wilson [${fmt(nl, 3)}, ${fmt(nu, 3)}]`);
  say(`    through bridge: ${hitB}/${n} = ${fmt(hitB / n, 3)}   95% Wilson [${fmt(bl, 3)}, ${fmt(bu, 3)}]`);
  say(`    bridge interval excludes the native point estimate: ${bu < hitN / n || bl > hitN / n ? 'YES' : 'NO'}`);
  say(`    bridge interval excludes chance (0.250): ${bl > 0.25 ? 'YES' : 'NO'}`);
  if (bl <= 0.25) defect('B3(e) bridge nearest-neighbour purity is not distinguishable from chance at 95%');
  else if (bu < hitN / n) defect('B3(e) the bridge loses family purity relative to the native metric (intervals do not cover it)');
}

// ════════════════════════════════════════════════════════════════════════════
// B4 — THE REFERENCE MEASURE
// d(0,ψ) is "distance from typicality" only if the store's mass sits at the
// origin. Nothing in placeFeatures enforces that. Measure the offset.
//
// F5 CORRECTION: the 1st pass averaged the coordinates arithmetically. That is
// the Euclidean centroid, and it is NOT the centre of mass of points in a
// hyperbolic space. The right object is the Fréchet (Karcher) mean: the point
// minimising Σ d(c,pᵢ)².
//
// F5 — 2nd CORRECTION, FOUND BY RUNNING THIS PROBE. The comment written here
// on the previous pass asserted the direction of the 1st-pass error: that a
// Euclidean average is "pulled toward the origin and understates the offset".
// That prediction is WRONG for this store, and the run says so — the Fréchet
// mean lands at ‖c‖ = 0.4566 against the Euclidean centroid's 0.5650, i.e. the
// 1st pass OVERSTATED the offset by 19%. (Plausible cause: every point here is
// radially saturated at ‖p‖ = tanh 0.9 and only the directions differ, and
// under the squared-geodesic objective a widely-spread direction set pulls the
// true centre inward further than the chord average does.) The direction is
// therefore MEASURED below, never asserted: the sign of cnFre − cnEuc decides
// the wording, and the objective column proves which centre actually wins.
// Computed here by the standard Riemannian iteration, using the SHIPPED
// mobiusAdd:
//     λ_c = 2/(1−‖c‖²)
//     log_c(y) = (1−‖c‖²)·atanh(‖u‖)·u/‖u‖ ,  u = (−c) ⊕ y
//     exp_c(v) = c ⊕ ( tanh(‖v‖/(1−‖c‖²)) · v/‖v‖ )
//     c ← exp_c( (1/n) Σ log_c(pᵢ) )   until it stops moving
// Both centres are reported so the size of the 1st-pass error is visible.
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
  const cEuc = new Array(M.RIP_DIM).fill(0);
  for (const p of pts) for (let i = 0; i < cEuc.length; i++) cEuc[i] += p[i] / pts.length;
  const cnEuc = M.norm(cEuc);

  // F5: Fréchet/Karcher mean by Riemannian iteration on the shipped mobiusAdd.
  const neg = (x) => x.map((v) => -v);
  const logAt = (c, y) => {
    const u = M.mobiusAdd(neg(c), y);
    const nu = M.norm(u);
    if (nu < 1e-15) return u.map(() => 0);
    const s = ((1 - M.norm(c) ** 2) * Math.atanh(Math.min(1 - 1e-12, nu))) / nu;
    return u.map((v) => v * s);
  };
  const expAt = (c, v) => {
    const nv = M.norm(v);
    if (nv < 1e-15) return c.slice();
    const s = Math.tanh(nv / Math.max(1e-15, 1 - M.norm(c) ** 2)) / nv;
    return M.mobiusAdd(c, v.map((x) => x * s));
  };
  let cFre = cEuc.slice(), iters = 0, moved = Infinity;
  for (; iters < 200 && moved > 1e-12; iters++) {
    const g = new Array(M.RIP_DIM).fill(0);
    for (const p of pts) { const l = logAt(cFre, p); for (let i = 0; i < g.length; i++) g[i] += l[i] / pts.length; }
    const next = expAt(cFre, g);
    moved = Math.sqrt(next.reduce((a, v, i) => a + (v - cFre[i]) ** 2, 0));
    cFre = next;
  }
  const cnFre = M.norm(cFre);

  const dToC = pts.map((p) => M.poincareDist(p, cFre));
  const dToE = pts.map((p) => M.poincareDist(p, cEuc));
  const dTo0 = pts.map((p) => M.depth(p));
  const objective = (c) => mean(pts.map((p) => M.poincareDist(p, c) ** 2));
  say(`store n = ${pts.length} "ordinary" (predictable-ish) indices`);
  say(`Euclidean centroid (1st pass, WRONG centre): ‖c‖ = ${fmt(cnEuc, 6)}   mean d² = ${fmt(objective(cEuc), 6)}`);
  say(`Fréchet/Karcher mean (${iters} iters, |Δ| ${moved.toExponential(1)}): ‖c‖ = ${fmt(cnFre, 6)}   mean d² = ${fmt(objective(cFre), 6)}`);
  say(`origin as a candidate centre:                ‖c‖ = 0.000000   mean d² = ${fmt(objective(new Array(M.RIP_DIM).fill(0)), 6)}`);
  say(`Fréchet mean beats the Euclidean centroid on its own objective: ${objective(cFre) <= objective(cEuc) ? 'YES' : 'NO'}`);
  const dOff = cnFre - cnEuc;
  const pOff = 100 * (cnFre / Math.max(cnEuc, 1e-12) - 1);
  say(`the 1st pass ${dOff > 0 ? 'UNDERSTATED' : 'OVERSTATED'} the offset by ${fmt(Math.abs(dOff), 6)} (${fmt(Math.abs(pOff), 1)}%) — direction measured, not assumed`);
  if (objective(cFre) > objective(cEuc)) defect('B4 the Karcher iteration did not beat the Euclidean centroid on its own objective; the Fréchet mean here is not trustworthy');
  say('');
  say(`mean geodesic to Fréchet mean ${fmt(mean(dToC))} ± ${fmt(sd(dToC), 6)}`);
  say(`mean geodesic to Euclid mean  ${fmt(mean(dToE))} ± ${fmt(sd(dToE), 6)}`);
  say(`mean geodesic to origin       ${fmt(mean(dTo0))} ± ${fmt(sd(dTo0), 6)}`);
  say(`ρ(depth, distance-from-Fréchet-mean) = ${fmt(spearman(dTo0, dToC), 4)}`);
  say('');
  say(cnFre < 0.05
    ? `The store IS approximately origin-centred (‖c‖=${fmt(cnFre, 4)}), so depth ≈ atypicality is defensible for THIS store — but nothing in the code enforces it; it is a property of these inputs, not of the design.`
    : `The store's mass sits ${fmt(cnFre, 4)} off the origin, so d(0,ψ) is NOT "distance from typicality" — it is distance from an arbitrary point the design happened to pick.`);
  if (cnFre >= 0.05) defect(`B4 the store's Fréchet mean sits ${fmt(cnFre, 3)} off the origin; d(0,ψ) is not distance-from-typicality`);
}

hdr('SUMMARY');
say('Every line below is tagged MEASURED (a probe in this file executed it) or');
say('UNMEASURED (read off the working tree). A grep is not a call-graph, and a');
say('read cannot support the same weight as a run.');
say('');
say('L1 residual → index  [UNMEASURED — this is a READ of the tree, not a run]');
say('   NO PRODUCER IN CODE. Every non-test pamiIndex call is fed synthetic');
say('   memorySignalNeutral() in phi-minimax-scorecard.ts; the one live path');
say('   (router.ts case \'pami\') takes signal[] verbatim from LLM JSON, and');
say('   pami.ts:617 / router.ts:553 both instruct the CALLER to "subtract your');
say('   prediction first". No prediction operator 𝒫 was found anywhere in src/.');
say('   BOUND: this is a source read. It establishes that no producer was FOUND,');
say('   not that none can exist — a dynamically dispatched or externally supplied');
say('   residual would not appear to it. Treat it as a strong lead, not a proof.');
say('');
say('L2 index → pamiDistance  [MEASURED — B1 control arm, B2, B3(b), B3(e)]');
say('   Real, pure, deterministic, and torus-correct: the native metric treats the');
say('   ±π wrap as the small step it is (B1 native ratio ≈ 1) and separates');
say('   structure families well above chance (B3(e), interval reported there).');
say('');
say('L3 index → ball  [MEASURED — B0, B1, B2, B3(c), B4]');
say('   See the per-probe verdicts above; the adverse ones are listed below.');
say('');
say('Nothing here was measured against a live residual, because none was found.');

hdr(`ADVERSE FINDINGS: ${DEFECTS.length}`);
if (DEFECTS.length) for (const d of DEFECTS) say(`  - ${d}`);
else say('  none — every probe in this harness passed.');

fs.writeFileSync(path.join(root, 'docs', 'PAMI_DHNG_SIEGE_RESULTS.txt'), R.join('\n') + '\n');
console.log('\n[written] docs/PAMI_DHNG_SIEGE_RESULTS.txt');

// F6: exit code carries the verdict, so this can be wired into CI.
process.exit(DEFECTS.length ? 1 : 0);
