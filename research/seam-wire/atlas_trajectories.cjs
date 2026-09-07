#!/usr/bin/env node
'use strict';
// atlas_trajectories.cjs — summarises every recorded swarm-task trajectory on
// the atlas. For each task-<seq> workspace with an ATLAS.jsonl, reports the
// turn-by-turn kappa/drift/lastD/strain/coherence arc and how many turns
// wandered more than 1.25x the region radius from the task's anchor point
// (Euclidean distance in the 16-d map-direction space). Cross-references
// each seq against the agent-bridge board for final status and whether a
// REGION directive was ever sent. Local-only, no network, no git.
const fs = require('fs');
const path = require('path');
const os = require('os');

const WS = process.env.ELLE_SWARM_WORKSPACE || path.join(os.homedir(), 'Library', 'Application Support', 'elle', 'swarm-workspace');
const BOARD = process.env.ELLE_BOARD_JSON || path.join(os.homedir(), 'agent-bridge', 'data', 'board.json');
const OUT = path.join(__dirname, 'runs', 'atlas_trajectories.json');
const OUT_OF_REGION_FACTOR = 1.25;

const oddities = [];
function note(kind, detail) { oddities.push({ kind, detail }); }

// ---- board.json: seq -> { status, hasRegionDirective } ----
let boardBySeq = new Map();
try {
  const raw = fs.readFileSync(BOARD, 'utf8');
  const board = JSON.parse(raw);
  const tasks = Array.isArray(board.tasks) ? board.tasks : Object.values(board.tasks || {});
  for (const t of tasks) {
    if (typeof t.seq !== 'number') continue;
    const events = Array.isArray(t.events) ? t.events : [];
    const hasRegionDirective = events.some((e) => e && e.kind === 'directive' && typeof e.body === 'string' && e.body.startsWith('REGION '));
    boardBySeq.set(t.seq, { status: t.status || null, hasRegionDirective });
  }
} catch (e) {
  note('board-read-failed', String(e && e.message || e));
}

function euclid16(a, b) {
  let s = 0;
  for (let i = 0; i < 16; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

function distinctSequence(values) {
  const out = [];
  for (const v of values) { if (out.length === 0 || out[out.length - 1] !== v) out.push(v); }
  return out;
}

function firstLast(nums) {
  if (nums.length === 0) return { first: null, last: null };
  return { first: nums[0], last: nums[nums.length - 1] };
}

const results = [];
let dirs;
try { dirs = fs.readdirSync(WS); } catch (e) {
  console.error(`Cannot read swarm workspace at ${WS}: ${e.message}`);
  process.exit(1);
}

for (const d of dirs.sort()) {
  const m = /^task-(\d+)$/.exec(d);
  if (!m) continue;
  const seq = Number(m[1]);
  const f = path.join(WS, d, 'ATLAS.jsonl');
  if (!fs.existsSync(f)) continue;

  const rawLines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) { note('empty-atlas', d); continue; }

  let head = null;
  try { head = JSON.parse(rawLines[0]); } catch (e) { note('unparsable-header', `${d}: ${e.message}`); continue; }

  const anchorFull = Array.isArray(head.anchor) ? head.anchor : null;
  if (!anchorFull) note('no-anchor', d);
  else if (anchorFull.length !== 17) note('anchor-length-not-17', `${d}: length ${anchorFull.length}`);
  const anchor16 = anchorFull && anchorFull.length >= 17 ? anchorFull.slice(1, 17) : null;

  const region = head.region && typeof head.region.level === 'number' && typeof head.region.radius === 'number'
    ? { level: head.region.level, radius: head.region.radius }
    : null;
  if (!head.region) note('no-region', d);

  const rows = [];
  for (let i = 1; i < rawLines.length; i++) {
    try { rows.push(JSON.parse(rawLines[i])); } catch (e) { note('unparsable-turn-line', `${d} line ${i + 1}: ${e.message}`); }
  }

  const kappas = rows.filter((r) => typeof r.kappa === 'number').map((r) => r.kappa);
  const drifts = rows.filter((r) => typeof r.drift === 'number').map((r) => r.drift);
  const lastDs = rows.filter((r) => typeof r.lastD === 'number').map((r) => r.lastD);
  const strains = rows.filter((r) => typeof r.strain === 'number').map((r) => r.strain);
  const coherences = rows.map((r) => (r.coherence === undefined ? null : r.coherence));

  const nonLockedTurns = coherences.filter((c) => c !== 'locked').length;

  let outOfRegionTurns = null;
  if (anchor16 && region) {
    outOfRegionTurns = 0;
    const threshold = OUT_OF_REGION_FACTOR * region.radius;
    for (const r of rows) {
      if (!Array.isArray(r.dir)) { note('turn-missing-dir', `${d} step ${r.step}`); continue; }
      if (r.dir.length !== 16) { note('turn-dir-length-not-16', `${d} step ${r.step}: length ${r.dir.length}`); continue; }
      if (euclid16(r.dir, anchor16) > threshold) outOfRegionTurns++;
    }
  }

  const board = boardBySeq.get(seq) || null;

  results.push({
    seq,
    status: board ? board.status : null,
    hasRegionDirective: board ? board.hasRegionDirective : null,
    regionLevel: region ? region.level : null,
    regionRadius: region ? region.radius : null,
    turns: rows.length,
    kappaFirst: firstLast(kappas).first,
    kappaLast: firstLast(kappas).last,
    driftFirst: firstLast(drifts).first,
    driftLast: firstLast(drifts).last,
    lastDMin: lastDs.length ? Math.min(...lastDs) : null,
    lastDMax: lastDs.length ? Math.max(...lastDs) : null,
    maxStrain: strains.length ? Math.max(...strains) : null,
    nonLockedTurns,
    outOfRegionTurns,
    coherenceSequence: distinctSequence(coherences),
  });
}

// ---- aggregates ----
function mean(nums) { const v = nums.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

const n = results.length;
const byStatus = {};
for (const r of results) { const k = r.status || 'unknown'; byStatus[k] = (byStatus[k] || 0) + 1; }

const meanTurns = mean(results.map((r) => r.turns));
const anyOutOfRegionShare = n ? results.filter((r) => r.outOfRegionTurns !== null && r.outOfRegionTurns > 0).length / n : null;
const anyNonLockedShare = n ? results.filter((r) => r.nonLockedTurns > 0).length / n : null;

const byRegionLevel = {};
for (const r of results) { const k = r.regionLevel === null ? 'null' : String(r.regionLevel); byRegionLevel[k] = (byRegionLevel[k] || 0) + 1; }

function statusMeans(status) {
  const rows = results.filter((r) => r.status === status);
  return { n: rows.length, kappaLast: mean(rows.map((r) => r.kappaLast)), driftLast: mean(rows.map((r) => r.driftLast)), maxStrain: mean(rows.map((r) => r.maxStrain)) };
}
const approvedMeans = statusMeans('approved');
const blockedMeans = statusMeans('blocked');

const longest = [...results].sort((a, b) => b.turns - a.turns).slice(0, 5).map((r) => ({ seq: r.seq, turns: r.turns }));

const report = { at: new Date().toISOString(), n, oddities, tasks: results, aggregates: { byStatus, meanTurns, anyOutOfRegionShare, anyNonLockedShare, byRegionLevel, approvedMeans, blockedMeans, longest } };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));

// ---- console table ----
const fmt = (x, d) => (x === null || x === undefined ? 'n/a' : typeof x === 'number' ? x.toFixed(d === undefined ? 3 : d) : String(x));
console.log('seq\tstatus\tregion(lvl/r)\tturns\tkappa(f->l)\tdrift(f->l)\tlastD(min/max)\tmaxStrain\tnonLocked\toutOfRegion\tcoherenceSeq');
for (const r of results) {
  const reg = r.regionLevel === null ? 'null' : `${r.regionLevel}/${fmt(r.regionRadius)}`;
  console.log([
    r.seq, r.status || 'unknown', reg, r.turns,
    `${fmt(r.kappaFirst)}->${fmt(r.kappaLast)}`,
    `${fmt(r.driftFirst)}->${fmt(r.driftLast)}`,
    `${fmt(r.lastDMin)}/${fmt(r.lastDMax)}`,
    fmt(r.maxStrain), r.nonLockedTurns, r.outOfRegionTurns === null ? 'n/a' : r.outOfRegionTurns,
    r.coherenceSequence.join('>'),
  ].join('\t'));
}
console.log('');
console.log(`n tasks: ${n}`);
console.log(`tasks by status: ${JSON.stringify(byStatus)}`);
console.log(`mean turns: ${fmt(meanTurns)}`);
console.log(`share of tasks with any out-of-region turn: ${anyOutOfRegionShare === null ? 'n/a' : (anyOutOfRegionShare * 100).toFixed(1) + '%'}`);
console.log(`share of tasks with any non-locked turn: ${anyNonLockedShare === null ? 'n/a' : (anyNonLockedShare * 100).toFixed(1) + '%'}`);
console.log(`per-region-level counts: ${JSON.stringify(byRegionLevel)}`);
console.log(`approved (n=${approvedMeans.n}): mean kappaLast=${fmt(approvedMeans.kappaLast)} driftLast=${fmt(approvedMeans.driftLast)} maxStrain=${fmt(approvedMeans.maxStrain)}`);
console.log(`blocked  (n=${blockedMeans.n}): mean kappaLast=${fmt(blockedMeans.kappaLast)} driftLast=${fmt(blockedMeans.driftLast)} maxStrain=${fmt(blockedMeans.maxStrain)}`);
console.log(`5 longest trajectories (seq: turns): ${longest.map((l) => `${l.seq}:${l.turns}`).join(', ')}`);
console.log(`oddities: ${oddities.length} (${[...new Set(oddities.map((o) => o.kind))].join('; ') || 'none'})`);
console.log(`-> ${OUT}`);
