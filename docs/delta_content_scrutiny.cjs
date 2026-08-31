#!/usr/bin/env node
// ============================================================================
// delta_content_scrutiny.cjs — pipeline calibration for delta_content_probe.
//
// Motivation (written after the probe's first run, BEFORE interpreting it):
// the probe read the real corpus as CYCLIC-OR-MIXED, but two of its numbers
// pull apart: the graph instrument's toroidal pull was 0.92–0.95 while the
// direct metric 4-point δ/diam on the same angular distances was 0.0361 —
// closer to the tree control (0) than the cycle control (0.47). Suspicion:
// any symmetrized k-NN graph has cycle_rank ≈ |E|−n+c ≫ 0, so
// suggested.toroidal = b1/(b1+components) may be foreordained near 1 for ANY
// corpus, tree-shaped or not. If so, the pull comparison half of the
// pre-registered verdict rule is uninformative through this pipeline, and
// only δ/diam and metric-δ carry signal.
//
// Method: run the IDENTICAL pipeline (same tokenizer regex, same tf-idf, same
// knnEdges, same relabeling, same shipped instruments) on two synthetic
// corpora of KNOWN shape:
//   TREE corpus — binary topic tree depth 8 (255 topics), each topic owns 8
//     unique words, each document samples words uniformly from its root→node
//     path vocabulary. Similarity grows with shared-ancestor depth: the
//     underlying structure is a tree by construction.
//   RING corpus — 200 topics on a cycle, each topic owns 8 unique words, each
//     document samples from the vocab of ring-window [i−2..i+2]. The
//     underlying structure is a single large cycle by construction.
// Question per configuration (k ∈ {3,5,8}, 3 relabelings):
//   (a) does suggested.hyperbolic ever exceed suggested.toroidal on the TREE
//       corpus? (If never, that rule-half cannot say TREE-LIKE through k-NN.)
//   (b) do δ/diam and metric-δ/diam separate TREE from RING?
// Seeds: 0xA11C0DE5..7 (docs), relabelings reuse 0xA11C0DE0..2. Disjoint from
// all siege/bridge seeds.
// ============================================================================
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-scrutiny-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, `export { deltaHyperbolicity, curvatureSignature } from ${JSON.stringify(path.join(root, 'src/structure'))};\n`);
const bundle = path.join(tmp, 'bundle.cjs');
execFileSync('npx', ['--no-install', 'esbuild', '--bundle', '--format=cjs', '--platform=node', '--outfile=' + bundle, entry], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const M = require(bundle);

function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function relabel(n, seed) {
  const r = lcg(seed), perm = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  return perm.map((p) => 'n' + p.toString(16).padStart(5, '0'));
}
const edgesWithNames = (raw, names) => raw.map(([a, b]) => ({ src: names[a], dst: names[b] }));
function adjacencyOf(raw, n) { const adj = Array.from({ length: n }, () => new Set()); for (const [a, b] of raw) if (a !== b) { adj[a].add(b); adj[b].add(a); } return adj; }
function bfsDists(adj, src) { const dist = new Map([[src, 0]]); const q = [src]; let h = 0; while (h < q.length) { const u = q[h++]; for (const w of adj[u]) if (!dist.has(w)) { dist.set(w, dist.get(u) + 1); q.push(w); } } return dist; }
function graphStats(raw, n, seed) {
  const adj = adjacencyOf(raw, n); const seen = new Set(); let giant = 0, components = 0;
  for (let i = 0; i < n; i++) if (!seen.has(i)) { components++; const d = bfsDists(adj, i); for (const k of d.keys()) seen.add(k); giant = Math.max(giant, d.size); }
  const r = lcg(seed); let diam = 0;
  for (let t = 0; t < 64; t++) { const d = bfsDists(adj, Math.floor(r() * n)); for (const v of d.values()) diam = Math.max(diam, v); }
  return { components, giantFrac: giant / n, diam };
}
function knnEdges(n, k, score, closerIsHigher) {
  const set = new Set();
  for (let i = 0; i < n; i++) {
    const scored = [];
    for (let j = 0; j < n; j++) if (j !== i) scored.push([score(i, j), j]);
    scored.sort((a, b) => closerIsHigher ? b[0] - a[0] : a[0] - b[0]);
    for (let t = 0; t < Math.min(k, scored.length); t++) {
      if (closerIsHigher && scored[t][0] <= 0) break;
      const j = scored[t][1];
      set.add(i < j ? i + ':' + j : j + ':' + i);
    }
  }
  return [...set].map((s) => s.split(':').map(Number));
}
function metricDelta(dist, idxs) {
  let best = 0, diam = 0;
  for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) diam = Math.max(diam, dist(idxs[i], idxs[j]));
  for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) for (let k = j + 1; k < idxs.length; k++) for (let l = k + 1; l < idxs.length; l++) {
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
const RELABELS = [0xA11C0DE0, 0xA11C0DE1, 0xA11C0DE2];

// ── synthetic corpora of known shape ────────────────────────────────────────
const WORDS_PER_TOPIC = 8, DOC_LEN = 150;
const vocab = (topic, w) => `t${topic}w${w}`;

function treeCorpus(seed) {
  // binary tree, 255 nodes; doc for node i samples uniformly from the vocab
  // of every node on its root→i path.
  const n = 255, r = lcg(seed), docs = [];
  for (let i = 0; i < n; i++) {
    const pathNodes = []; let x = i;
    while (true) { pathNodes.push(x); if (x === 0) break; x = Math.floor((x - 1) / 2); }
    const words = [];
    for (let t = 0; t < DOC_LEN; t++) {
      const node = pathNodes[Math.floor(r() * pathNodes.length)];
      words.push(vocab(node, Math.floor(r() * WORDS_PER_TOPIC)));
    }
    docs.push(words.join(' '));
  }
  return docs;
}
function ringCorpus(seed) {
  // 200 topics on a cycle; doc i samples from topics (i−2..i+2) mod 200.
  const n = 200, r = lcg(seed), docs = [];
  for (let i = 0; i < n; i++) {
    const words = [];
    for (let t = 0; t < DOC_LEN; t++) {
      const node = (i + Math.floor(r() * 5) - 2 + n) % n;
      words.push(vocab(node, Math.floor(r() * WORDS_PER_TOPIC)));
    }
    docs.push(words.join(' '));
  }
  return docs;
}

// ── IDENTICAL tf-idf machinery to the probe ─────────────────────────────────
function tfidfSim(docs) {
  const df = new Map();
  const tokss = docs.map((c) => {
    const counts = new Map();
    for (const t of (c.toLowerCase().match(/[a-z][a-z0-9']+/g) || [])) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
    return counts;
  });
  const nC = docs.length;
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
  const sim = Array.from({ length: nC }, () => new Float64Array(nC));
  for (let i = 0; i < nC; i++) for (let j = i + 1; j < nC; j++) {
    let [a, b] = vecs[i].size <= vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
    let s = 0; for (const [t, w] of a) { const x = b.get(t); if (x) s += w * x; }
    sim[i][j] = s; sim[j][i] = s;
  }
  return sim;
}

function runPipeline(name, docs) {
  const nC = docs.length, sim = tfidfSim(docs);
  console.log(`\n═══ ${name} (n=${nC}, shape known by construction) ═══`);
  let hyperbolicEverWins = false;
  for (const k of [3, 5, 8]) {
    const raw = knnEdges(nC, k, (i, j) => sim[i][j], true);
    const rows = [];
    for (const seed of RELABELS) {
      const edges = edgesWithNames(raw, relabel(nC, seed));
      const sig = M.curvatureSignature(edges);
      const st = graphStats(raw, nC, seed);
      if (sig.suggested.hyperbolic > sig.suggested.toroidal) hyperbolicEverWins = true;
      rows.push({ delta: sig.delta, rel: st.diam ? sig.delta / st.diam : 0, h: sig.suggested.hyperbolic, t: sig.suggested.toroidal, st });
    }
    console.log(`  k=${k}: |E|=${raw.length}, comps=${rows[0].st.components}, giant=${(rows[0].st.giantFrac * 100).toFixed(1)}%, diam≈${rows[0].st.diam}`
      + ` | δ med ${median(rows.map((r) => r.delta))}, δ/diam ${median(rows.map((r) => r.rel)).toFixed(4)}`
      + ` | hyp ${median(rows.map((r) => r.h)).toFixed(4)} vs tor ${median(rows.map((r) => r.t)).toFixed(4)}`);
  }
  const ang = (i, j) => Math.acos(Math.max(-1, Math.min(1, sim[i][j]))) / Math.PI;
  const mrels = RELABELS.map((s) => { const md = metricDelta(ang, sampleIdxs(nC, 32, s)); return md.diam ? md.delta / md.diam : 0; });
  console.log(`  metric 4-point δ/diam on angular distance: median ${median(mrels).toFixed(4)}`);
  console.log(`  hyperbolic pull ever > toroidal pull: ${hyperbolicEverWins}`);
  return { hyperbolicEverWins, metricRel: median(mrels) };
}

const tree = runPipeline('TREE corpus', treeCorpus(0xA11C0DE5));
const ring = runPipeline('RING corpus', ringCorpus(0xA11C0DE6));

console.log('\n═══ CALIBRATION READING ═══');
console.log(`  pull-comparison can say TREE-LIKE through k-NN: ${tree.hyperbolicEverWins}`);
console.log(`  metric δ/diam — tree ${tree.metricRel.toFixed(4)} vs ring ${ring.metricRel.toFixed(4)} (real corpus measured 0.0361)`);
