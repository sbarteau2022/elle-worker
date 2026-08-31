#!/usr/bin/env node
// ============================================================================
// delta_content_probe.cjs — δ-hyperbolicity on CONTENT-DERIVED structure.
//
// PREDICTIVE_CODING_LITERATURE.md §6 item 2: "Measure delta-hyperbolicity on
// content-derived structure. Still never done. Still the stated Target C
// precondition. Repo-only, no external dependency."
//
// Why the prior reading does not count: GRAPH_PRESSURE_TEST.md's toroidal
// 0.53–0.73 was measured over co-recall edges the retriever itself created
// (recordAssociations forms all pairwise edges among a recall's touched set,
// so any 3+-node recall organically seeds a cycle). That measures the
// retriever's behavior, not the content. DHNG_VS_EUCLIDEAN.md: "If the real
// graph is cyclic, none of the above transfers."
//
// ── PRE-REGISTERED DESIGN (written before any measurement ran) ──────────────
//
// Question: is the structure derivable from the repo's real corpus content
// tree-like (hyperbolic) or cyclic — per the repo's own instrument?
//
// Arm 1 (primary): the real corpus (corpus/**/*.md, the same files seedCorpus
//   ingests), chunked by the PRODUCTION chunker semanticChunks (extracted
//   verbatim from src/index.ts at runtime — drift impossible), tf-idf cosine
//   similarity, symmetrized k-NN graph, measured with the SHIPPED
//   deltaHyperbolicity / curvatureSignature from src/structure.ts.
//   Sensitivity: k ∈ {3,5,8}; R=5 seeded relabelings (the instrument samples
//   the lexicographically FIRST 32 node names, so random labels = uniform
//   random 32-subset); sample ∈ {32,64} at k=5.
//
// Arm 2 (secondary): PAMI content geometry. 4 signal families × 30 real
//   pamiIndex outputs, pamiDistance k-NN graph through the same instrument,
//   plus a direct metric 4-point δ on the pamiDistance matrix (Gromov's
//   condition needs only a metric). Post-S1/S2 this geometry is honest.
//
// Controls (instrument validation, HARD assertions — probe exits 1 on fail):
//   balanced binary tree n=511  → δ = 0 exactly
//   clique K32                  → δ = 0 exactly (δ=0 does NOT mean tree —
//                                 the curvatureSignature comment's own caveat)
//   cycle C64                   → δ = n/4 = 16, δ/diam = 0.5; assert δ_rel ≥ 0.3
//   torus 23×23                 → cyclic; reported, not asserted
//
// Verdict rule (pre-registered): Arm 1 reads TREE-LIKE iff, for EVERY k and
// EVERY relabeling, curvatureSignature.suggested.hyperbolic > .toroidal AND
// the median δ/diam is < half the cycle control's δ/diam. Anything else reads
// CYCLIC-OR-MIXED and the Target C caveat stands.
//
// Seeds: 0xDE17A000+ (PAMI signals), 0xA11C0DE0+ (relabelings/sampling) —
// disjoint from every seed used by the sieges (0xB0C0, 0xB1B1, 0x100+) and
// the bridge calibration (0xCA11B001, 0xF17B002, 0x51–0x57).
//
// Known limitations (stated up front, not discovered later):
//   • Production retrieval edges come from bge-large-en-v1.5 embeddings;
//     repo-only forbids calling that model, so tf-idf cosine is the proxy for
//     content similarity. Lexical structure ≠ embedding structure.
//   • k-NN is itself a modeling choice; hence the k-sensitivity sweep.
//   • δ is topology-only (GRAPH_PRESSURE_TEST.md finding 6's blind spot).
// ============================================================================
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-probe-'));

// ── bundle the real instruments ─────────────────────────────────────────────
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, [
  `export { deltaHyperbolicity, curvatureSignature, graphInvariants } from ${JSON.stringify(path.join(root, 'src/structure'))};`,
  `export { pamiIndex, pamiDistance, SPEC_CONFIG } from ${JSON.stringify(path.join(root, 'src/pami'))};`,
].join('\n'));
const bundle = path.join(tmp, 'bundle.cjs');
execFileSync('npx', ['--no-install', 'esbuild', '--bundle', '--format=cjs', '--platform=node',
  '--outfile=' + bundle, entry], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const M = require(bundle);

// ── extract the PRODUCTION chunker verbatim from src/index.ts ───────────────
const indexSrc = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const m = indexSrc.match(/function semanticChunks\(text: string[\s\S]*?\n\}/);
if (!m) { console.error('FATAL: semanticChunks not found in src/index.ts'); process.exit(1); }
const chunkTs = path.join(tmp, 'chunker.ts');
fs.writeFileSync(chunkTs, 'export ' + m[0] + '\n');
const chunkJs = path.join(tmp, 'chunker.cjs');
execFileSync('npx', ['--no-install', 'esbuild', '--bundle', '--format=cjs', '--platform=node',
  '--outfile=' + chunkJs, chunkTs], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const { semanticChunks } = require(chunkJs);

// ── determinism (same LCG/gauss as the sieges) ──────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ── signal families (verbatim from docs/pami_dhng_siege.cjs) ────────────────
const N = 512;
function sine(r, amp) {
  const f = 0.01 + 0.06 * r(), ph = r() * 2 * Math.PI, out = [];
  for (let i = 0; i < N; i++) out.push(amp * Math.sin(2 * Math.PI * f * i + ph));
  return out;
}
function white(r, amp) { const out = []; for (let i = 0; i < N; i++) out.push(amp * gauss(r)); return out; }
function ar1(r, amp, rho) { const out = []; let x = 0; for (let i = 0; i < N; i++) { x = rho * x + gauss(r); out.push(amp * x); } return out; }
function burst(r, amp) { const out = []; for (let i = 0; i < N; i++) out.push(r() < 0.02 ? amp * 6 * gauss(r) : amp * 0.05 * gauss(r)); return out; }

// ── graph helpers ───────────────────────────────────────────────────────────
// Seeded relabeling: node i gets the hex of its shuffled position, so the
// instrument's sorted-first-32 sampler sees a uniform random 32-subset.
function relabel(n, seed) {
  const r = lcg(seed), perm = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  return perm.map((p) => 'n' + p.toString(16).padStart(5, '0'));
}
function edgesWithNames(rawEdges, names) {
  return rawEdges.map(([a, b]) => ({ src: names[a], dst: names[b] }));
}
function adjacencyOf(rawEdges, n) {
  const adj = Array.from({ length: n }, () => new Set());
  for (const [a, b] of rawEdges) { if (a !== b) { adj[a].add(b); adj[b].add(a); } }
  return adj;
}
function bfsDists(adj, src) {
  const dist = new Map([[src, 0]]); const q = [src]; let h = 0;
  while (h < q.length) { const u = q[h++]; for (const w of adj[u]) if (!dist.has(w)) { dist.set(w, dist.get(u) + 1); q.push(w); } }
  return dist;
}
function graphStats(rawEdges, n, seed) {
  const adj = adjacencyOf(rawEdges, n);
  const seen = new Set(); let giant = 0, components = 0;
  for (let i = 0; i < n; i++) if (!seen.has(i)) {
    components++; const d = bfsDists(adj, i); for (const k of d.keys()) seen.add(k);
    giant = Math.max(giant, d.size);
  }
  const r = lcg(seed); let diam = 0;
  for (let t = 0; t < 64; t++) {
    const src = Math.floor(r() * n); const d = bfsDists(adj, src);
    for (const v of d.values()) diam = Math.max(diam, v);
  }
  return { components, giantFrac: giant / n, diam };
}
// Symmetrized k-NN from a similarity lookup (higher = closer) or distance
// lookup (lower = closer).
function knnEdges(n, k, score, closerIsHigher) {
  const set = new Set();
  for (let i = 0; i < n; i++) {
    const scored = [];
    for (let j = 0; j < n; j++) if (j !== i) scored.push([score(i, j), j]);
    scored.sort((a, b) => closerIsHigher ? b[0] - a[0] : a[0] - b[0]);
    for (let t = 0; t < Math.min(k, scored.length); t++) {
      if (closerIsHigher && scored[t][0] <= 0) break; // no similarity at all
      const j = scored[t][1];
      set.add(i < j ? i + ':' + j : j + ':' + i);
    }
  }
  return [...set].map((s) => s.split(':').map(Number));
}
// Direct Gromov 4-point δ on an arbitrary metric over sampled indices.
function metricDelta(dist, idxs) {
  let best = 0, diam = 0;
  for (let i = 0; i < idxs.length; i++)
    for (let j = i + 1; j < idxs.length; j++) diam = Math.max(diam, dist(idxs[i], idxs[j]));
  for (let i = 0; i < idxs.length; i++)
    for (let j = i + 1; j < idxs.length; j++)
      for (let k = j + 1; k < idxs.length; k++)
        for (let l = k + 1; l < idxs.length; l++) {
          const [x, y, u, v] = [idxs[i], idxs[j], idxs[k], idxs[l]];
          const s = [dist(x, y) + dist(u, v), dist(x, u) + dist(y, v), dist(x, v) + dist(y, u)].sort((p, q) => q - p);
          best = Math.max(best, (s[0] - s[1]) / 2);
        }
  return { delta: best, diam };
}
function sampleIdxs(n, count, seed) {
  const r = lcg(seed), perm = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  return perm.slice(0, Math.min(count, n));
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const RELABEL_SEEDS = [0xA11C0DE0, 0xA11C0DE1, 0xA11C0DE2, 0xA11C0DE3, 0xA11C0DE4];
let failures = 0;
const fail = (msg) => { failures++; console.log('  ASSERT FAIL: ' + msg); };
const ok = (msg) => console.log('  ok: ' + msg);

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ CONTROLS (instrument validation on known graphs) ═══');
{
  // balanced binary tree, n=511
  const treeE = []; for (let i = 1; i < 511; i++) treeE.push([Math.floor((i - 1) / 2), i]);
  // clique K32
  const cliqueE = []; for (let i = 0; i < 32; i++) for (let j = i + 1; j < 32; j++) cliqueE.push([i, j]);
  // cycle C64
  const cycE = []; for (let i = 0; i < 64; i++) cycE.push([i, (i + 1) % 64]);
  // torus 23×23
  const T = 23, torE = [];
  for (let a = 0; a < T; a++) for (let b = 0; b < T; b++) {
    const id = a * T + b;
    torE.push([id, a * T + (b + 1) % T]); torE.push([id, ((a + 1) % T) * T + b]);
  }
  const controls = [
    ['tree n=511', treeE, 511], ['clique K32', cliqueE, 32],
    ['cycle C64', cycE, 64], ['torus 23x23', torE, T * T],
  ];
  const ctrl = {};
  for (const [name, raw, n] of controls) {
    const deltas = [], rels = [];
    for (const seed of RELABEL_SEEDS.slice(0, 3)) {
      const edges = edgesWithNames(raw, relabel(n, seed));
      const d = M.deltaHyperbolicity(edges);
      const st = graphStats(raw, n, seed);
      deltas.push(d); rels.push(st.diam ? d / st.diam : 0);
    }
    ctrl[name] = { delta: median(deltas), rel: median(rels) };
    console.log(`  ${name}: δ median ${median(deltas)} (spread ${Math.min(...deltas)}–${Math.max(...deltas)}), δ/diam ${median(rels).toFixed(4)}`);
  }
  if (ctrl['tree n=511'].delta !== 0) fail('tree δ must be exactly 0'); else ok('tree δ = 0');
  if (ctrl['clique K32'].delta !== 0) fail('clique δ must be exactly 0'); else ok('clique δ = 0 (δ=0 ≠ tree)');
  if (ctrl['cycle C64'].rel < 0.3) fail(`cycle δ/diam ${ctrl['cycle C64'].rel} < 0.3`); else ok(`cycle δ/diam = ${ctrl['cycle C64'].rel.toFixed(3)}`);
  global.__cycleRel = ctrl['cycle C64'].rel;
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ARM 1: real corpus, production chunker, tf-idf k-NN ═══');
const arm1 = { perK: {}, verdictTree: true };
{
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) files.push(p);
    }
  })(path.join(root, 'corpus'));
  files.sort();
  const chunks = [];
  for (const f of files) for (const c of semanticChunks(fs.readFileSync(f, 'utf8'))) chunks.push(c);
  console.log(`  corpus: ${files.length} files → ${chunks.length} chunks (production semanticChunks)`);

  // tf-idf vectors: tf = 1+log(count), idf = log(1 + N/df), drop hapax terms.
  const df = new Map();
  const tokss = chunks.map((c) => {
    const counts = new Map();
    for (const t of (c.toLowerCase().match(/[a-z][a-z0-9']+/g) || [])) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
    return counts;
  });
  const nC = chunks.length;
  const vecs = tokss.map((counts) => {
    const v = new Map(); let norm = 0;
    for (const [t, c] of counts) {
      const d = df.get(t); if (d < 2) continue;
      const w = (1 + Math.log(c)) * Math.log(1 + nC / d);
      v.set(t, w); norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  const cos = (i, j) => {
    let [a, b] = vecs[i].size <= vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
    let s = 0; for (const [t, w] of a) { const x = b.get(t); if (x) s += w * x; }
    return s;
  };
  // precompute full similarity matrix once (n² but each dot is sparse)
  const sim = Array.from({ length: nC }, () => new Float64Array(nC));
  for (let i = 0; i < nC; i++) for (let j = i + 1; j < nC; j++) { const s = cos(i, j); sim[i][j] = s; sim[j][i] = s; }

  for (const k of [3, 5, 8]) {
    const raw = knnEdges(nC, k, (i, j) => sim[i][j], true);
    const rows = [];
    for (const seed of RELABEL_SEEDS) {
      const edges = edgesWithNames(raw, relabel(nC, seed));
      const sig = M.curvatureSignature(edges);
      const st = graphStats(raw, nC, seed);
      rows.push({ seed, delta: sig.delta, rel: st.diam ? sig.delta / st.diam : 0, h: sig.suggested.hyperbolic, t: sig.suggested.toroidal, cyc: sig.cycle_rank, st });
      if (sig.suggested.hyperbolic <= sig.suggested.toroidal) arm1.verdictTree = false;
    }
    const relMed = median(rows.map((r) => r.rel));
    if (relMed >= global.__cycleRel / 2) arm1.verdictTree = false;
    arm1.perK[k] = rows;
    const r0 = rows[0].st;
    console.log(`  k=${k}: |E|=${raw.length}, components=${r0.components}, giant=${(r0.giantFrac * 100).toFixed(1)}%, diam≈${r0.diam}`);
    console.log(`        δ median ${median(rows.map((r) => r.delta))} (spread ${Math.min(...rows.map((r) => r.delta))}–${Math.max(...rows.map((r) => r.delta))}), δ/diam median ${relMed.toFixed(4)}`);
    console.log(`        suggested hyperbolic ${median(rows.map((r) => r.h)).toFixed(4)} vs toroidal ${median(rows.map((r) => r.t)).toFixed(4)}, cycle_rank ${rows[0].cyc}`);
  }
  // sample-size sensitivity at k=5
  const raw5 = knnEdges(nC, 5, (i, j) => sim[i][j], true);
  const e64 = edgesWithNames(raw5, relabel(nC, RELABEL_SEEDS[0]));
  const d64 = M.deltaHyperbolicity(e64, { sample: 64 });
  console.log(`  k=5 sample=64 sensitivity: δ = ${d64} (vs sample=32 δ = ${arm1.perK[5][0].delta})`);
  arm1.d64 = d64;

  // robustness: direct metric 4-point δ on angular distance over sampled chunks
  const ang = (i, j) => Math.acos(Math.max(-1, Math.min(1, sim[i][j]))) / Math.PI;
  const mrows = RELABEL_SEEDS.slice(0, 3).map((s) => {
    const md = metricDelta(ang, sampleIdxs(nC, 32, s));
    return md.diam ? md.delta / md.diam : 0;
  });
  console.log(`  metric 4-point δ/diam on angular distance: median ${median(mrows).toFixed(4)} (n=3 samples of 32)`);
  arm1.metricRel = median(mrows);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ARM 2: PAMI content geometry (post-S1/S2) ═══');
const arm2 = {};
{
  const fams = [['sine', (r) => sine(r, 1)], ['white', (r) => white(r, 1)],
                ['ar1_9', (r) => ar1(r, 1, 0.9)], ['burst', (r) => burst(r, 1)]];
  const pts = [];
  let nulls = 0;
  fams.forEach(([name, gen], fi) => {
    for (let i = 0; i < 30; i++) {
      const idx = M.pamiIndex(gen(lcg(0xDE17A000 + fi * 64 + i)));
      if (idx) pts.push(idx); else nulls++;
    }
  });
  console.log(`  ${pts.length} real pamiIndex outputs (${nulls} nulls), seeds 0xDE17A000+`);
  const nP = pts.length;
  const D = Array.from({ length: nP }, () => new Float64Array(nP));
  for (let i = 0; i < nP; i++) for (let j = i + 1; j < nP; j++) { const d = M.pamiDistance(pts[i], pts[j]); D[i][j] = d; D[j][i] = d; }

  for (const k of [3, 5, 8]) {
    const raw = knnEdges(nP, k, (i, j) => D[i][j], false);
    const rows = [];
    for (const seed of RELABEL_SEEDS.slice(0, 3)) {
      const edges = edgesWithNames(raw, relabel(nP, seed));
      const sig = M.curvatureSignature(edges);
      const st = graphStats(raw, nP, seed);
      rows.push({ delta: sig.delta, rel: st.diam ? sig.delta / st.diam : 0, h: sig.suggested.hyperbolic, t: sig.suggested.toroidal, st });
    }
    arm2['k' + k] = rows;
    console.log(`  k=${k}: |E|=${raw.length}, components=${rows[0].st.components}, giant=${(rows[0].st.giantFrac * 100).toFixed(1)}%, diam≈${rows[0].st.diam}`);
    console.log(`        δ median ${median(rows.map((r) => r.delta))}, δ/diam median ${median(rows.map((r) => r.rel)).toFixed(4)}, hyperbolic ${median(rows.map((r) => r.h)).toFixed(4)} vs toroidal ${median(rows.map((r) => r.t)).toFixed(4)}`);
  }
  const mrows = RELABEL_SEEDS.slice(0, 3).map((s) => {
    const md = metricDelta((i, j) => D[i][j], sampleIdxs(nP, 32, s));
    return md.diam ? md.delta / md.diam : 0;
  });
  console.log(`  metric 4-point δ/diam on pamiDistance: median ${median(mrows).toFixed(4)}`);
  arm2.metricRel = median(mrows);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ VERDICT (pre-registered rule) ═══');
console.log(`  Arm 1 corpus reads: ${arm1.verdictTree ? 'TREE-LIKE (hyperbolic)' : 'CYCLIC-OR-MIXED'}`);
console.log(`  (rule: hyperbolic > toroidal for every k and relabeling AND median δ/diam < ${(global.__cycleRel / 2).toFixed(3)} = cycle-control/2)`);
console.log(failures ? `\n${failures} INSTRUMENT ASSERTION(S) FAILED` : '\ninstrument assertions: all passed');
process.exit(failures ? 1 : 0);
