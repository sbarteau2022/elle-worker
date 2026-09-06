// ============================================================
// HORIZON ATLAS — one central chart, twelve surrounding. PRE-REGISTERED 2026-09-06
// before any head-1024 fixture existed.
//
// Central chart  C0 : readout B on `surprisal`, head 96  (the validated length map).
// Surrounding    C1–C7 : readout B on `surprisal`, heads 136 192 272 384 544 768 1024
//                C8–C12: readout B on `norm48`,   heads 96 192 384 768 1024
// Heads are log-spaced (×√2). Every chart uses NINE 64-token windows with stride
// (head−64)/8, so a chart's feature is always a 9-vector and charts differ only
// in the horizon they read. A row enters a chart only if its completion has at
// least `head` tokens (equal head per chart → length cannot leak inside a chart).
// hyperMap caps nodes at 256: charts with more eligible rows take a seeded
// subsample of 256 (reported).
//
// Per chart (reported, not claimed): n, class counts, P1 preservation (ball kNN
// purity vs Euclidean, k=5), and AUC of the chart's S against the three labels
// (length>512, never-closed@1024, wrong). Cells with < 20 per class: INSUFFICIENT.
//
// Atlas claim H5 (the only claim): DRIFT — for each row, 1 − mean Jaccard overlap
// of its k=10 ball-geodesic neighbour set between C0 and every surrounding chart
// it belongs to — separates FAILURE: AUC ≥ 0.65 with Hanley–McNeil lo95 > 0.5,
// ≥ 20 per class, against never-closed@1024 and separately against wrong.
// Control: labels shuffled (seeds 1..3); any control passing voids the run.
// Falsifier: drift at chance → "many maps" adds nothing beyond the central chart.
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { coupling, makeRng, type FixtureRow } from '../../src/seam-wire';
import { aucStdError } from '../../src/kappa-memory/validate';
import { hyperMap, poincareDist } from '../../../Dynanic-Hyperbolic-Neural-Graph/src/core/hyper';
import type { MemEdge } from '../../../Dynanic-Hyperbolic-Neural-Graph/src/core/types';

type Row = FixtureRow & { n_completion_full: number; streams: Record<string, number[]> };
const files = process.argv.slice(2);
const rows: Row[] = files.flatMap((f, fi) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); r.id = `${fi}:${r.idx}`; return r; }));
const isOpen = (r: Row) => !!(r.open_at_512 ?? r.truncated);
const labels: Record<string, (r: Row) => boolean> = { 'len>512': isOpen, 'never-closed': (r) => !!r.truncated, 'wrong': (r) => !r.correct };

const CHARTS: { id: string; stream: string; head: number }[] = [
  { id: 'C0', stream: 'surprisal', head: 96 },
  ...[136, 192, 272, 384, 544, 768, 1024].map((h, i) => ({ id: `C${i + 1}`, stream: 'surprisal', head: h })),
  ...[96, 192, 384, 768, 1024].map((h, i) => ({ id: `C${i + 8}`, stream: 'norm48', head: h })),
];
const NW = 9, WIN = 64, K = 5, KJ = 10, MAXN = 256;

function feature(series: number[], head: number, seed: number): number[] {
  const stride = (head - WIN) / (NW - 1);
  const out: number[] = [];
  for (let w = 0; w < NW; w++) { const s = Math.round(w * stride); const r = coupling(series.slice(s, s + WIN), { seed: seed * 7919 + w }); out.push(r.kappa * (1 - r.p)); }
  return out;
}
const euc = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
function auc(score: number[], pos: boolean[]) { let w = 0, t = 0, n = 0; for (let i = 0; i < score.length; i++) for (let j = 0; j < score.length; j++) if (pos[i] && !pos[j]) { n++; if (score[i] > score[j]) w++; else if (score[i] === score[j]) t++; } return n ? (w + 0.5 * t) / n : 0.5; }
function cell(score: number[], pos: boolean[]) { const np = pos.filter(Boolean).length, nn = pos.length - np; if (np < 20 || nn < 20) return `INSUF(${np}/${nn})`; const a = auc(score, pos); const lo = a - 1.96 * aucStdError(a, np, nn); return `${a.toFixed(3)}(${lo.toFixed(3)})${a >= 0.65 && lo > 0.5 ? '★' : ''}`; }

type Chart = { id: string; head: number; stream: string; ids: string[]; feat: Map<string, number[]>; S: Map<string, number>; pts: Map<string, number[]>; nb: Map<string, Set<string>> };
const charts: Chart[] = [];
for (const c of CHARTS) {
  let elig = rows.filter((r) => r.n_completion_full >= c.head && (r.streams[c.stream]?.length ?? 0) >= c.head);
  const rng = makeRng(101); if (elig.length > MAXN) elig = elig.slice().sort(() => rng() - 0.5).slice(0, MAXN);
  if (elig.length < 30) { console.log(`${c.id} ${c.stream}@${c.head}: only ${elig.length} eligible rows — skipped`); continue; }
  const feat = new Map<string, number[]>(), S = new Map<string, number>();
  elig.forEach((r, i) => { const f = feature(r.streams[c.stream], c.head, i); feat.set(r.id, f); S.set(r.id, f.reduce((a, b) => a + b, 0)); });
  const ids = elig.map((r) => r.id);
  const D = ids.map((a) => ids.map((b) => euc(feat.get(a)!, feat.get(b)!)));
  const knn = ids.map((_, i) => D[i].map((d, j) => [d, j] as const).filter(([, j]) => j !== i).sort((x, y) => x[0] - y[0]).slice(0, K));
  const all = knn.flat().map(([d]) => d).sort((a, b) => a - b); const sigma = all[Math.floor(all.length / 2)] || 1;
  const edges: MemEdge[] = []; knn.forEach((nbs, i) => nbs.forEach(([d, j]) => edges.push({ src: ids[i], dst: ids[j], kind: 'assoc', weight: Math.exp(-(d * d) / (sigma * sigma)) })));
  const atlas = hyperMap(ids.map((id) => ({ id })), edges, { dim: 16, epochs: 600, seed: 42 });
  const pts = new Map(ids.map((id) => [id, atlas.points[id]]));
  const nb = new Map<string, Set<string>>();
  ids.forEach((id) => nb.set(id, new Set(ids.filter((o) => o !== id).sort((a, b) => poincareDist(pts.get(id)!, pts.get(a)!) - poincareDist(pts.get(id)!, pts.get(b)!)).slice(0, KJ))));
  // P1 purity (length label) at k=5, Euclid vs ball
  const byId = new Map(elig.map((r) => [r.id, r]));
  const purity = (dist: (a: string, b: string) => number) => { let ag = 0, tot = 0; for (const id of ids) { const ns = ids.filter((o) => o !== id).sort((a, b) => dist(id, a) - dist(id, b)).slice(0, K); for (const o of ns) { tot++; if (isOpen(byId.get(o)!) === isOpen(byId.get(id)!)) ag++; } } return ag / tot; };
  const pe = purity((a, b) => euc(feat.get(a)!, feat.get(b)!)), ph = purity((a, b) => poincareDist(pts.get(a)!, pts.get(b)!));
  const sc = ids.map((id) => S.get(id)!);
  const line = Object.entries(labels).map(([n, fn]) => `${n} ${cell(sc, elig.map(fn))}`).join('  ');
  console.log(`${c.id.padEnd(3)} ${c.stream.padEnd(9)}@${String(c.head).padEnd(4)} n=${String(ids.length).padEnd(3)} loss ${atlas.stats.loss.toFixed(2)}  P1 euclid ${pe.toFixed(3)} ball ${ph.toFixed(3)} ${ph >= pe - 0.02 ? 'ok' : 'LOSES'}  |  S-AUC(hi⇒event): ${line}`);
  charts.push({ id: c.id, head: c.head, stream: c.stream, ids, feat, S, pts, nb });
}
// ── H5: drift between the central chart and the surrounding charts ──────────
const C0 = charts.find((c) => c.id === 'C0')!;
const jacc = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
const drift = new Map<string, number>(), nCharts = new Map<string, number>();
for (const id of C0.ids) { let s = 0, n = 0; for (const c of charts) { if (c.id === 'C0' || !c.nb.has(id)) continue; const common = new Set([...c.ids]); const a = new Set([...C0.nb.get(id)!].filter((x) => common.has(x))); const b = new Set([...c.nb.get(id)!].filter((x) => C0.ids.includes(x))); if (a.size === 0 && b.size === 0) continue; s += 1 - jacc(a, b); n++; } if (n > 0) { drift.set(id, s / n); nCharts.set(id, n); } }
const dRows = rows.filter((r) => drift.has(r.id)); const dScore = dRows.map((r) => drift.get(r.id)!);
console.log(`\nH5 drift: ${dRows.length} rows in ≥2 charts (mean charts/row ${(dRows.reduce((a, r) => a + nCharts.get(r.id)!, 0) / dRows.length).toFixed(1)})`);
let voided = false;
for (const [n, fn] of Object.entries(labels)) console.log(`  drift vs ${n.padEnd(12)} ${cell(dScore, dRows.map(fn))}`);
for (const seed of [1, 2, 3]) { const rng = makeRng(seed); const sh = dRows.map(labels['never-closed']).sort(() => rng() - 0.5); const c = cell(dScore, sh); voided ||= c.includes('★'); console.log(`  control shuffle ${seed}   ${c}`); }
console.log(`H5 verdict: ${['never-closed', 'wrong'].map((n) => `${n} ${cell(dScore, dRows.map(labels[n])).includes('★') ? 'HOLDS' : 'FAILS'}`).join(', ')}${voided ? '  — VOID (control passed)' : ''}`);
// snapshot for the viewer: 1 central + 12 surrounding, coords + labels + drift
writeFileSync('research/seam-wire/horizon_atlas.json', JSON.stringify({ charts: charts.map((c) => ({ id: c.id, stream: c.stream, head: c.head, n: c.ids.length, points: Object.fromEntries(c.ids.map((id) => [id, c.pts.get(id)!.slice(0, 3)])), S: Object.fromEntries(c.ids.map((id) => [id, c.S.get(id)!])) })), rows: Object.fromEntries(rows.map((r) => [r.id, { open: isOpen(r), truncated: !!r.truncated, correct: !!r.correct, n: r.n_completion_full, drift: drift.get(r.id) ?? null }])) }));
console.log('wrote research/seam-wire/horizon_atlas.json');
