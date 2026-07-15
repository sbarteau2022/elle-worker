// ============================================================
// gen-harmonic-snapshot.mjs — the reproducible path from the real math to the
// ONE LOCKED SNAPSHOT the Harmonic Atlas renders.
//
// Run from the elle-worker repo root (imports are relative to ./src):
//   npx tsx scripts/gen-harmonic-snapshot.mjs > \
//     ../EthicalIntelligenceProject/src/data/harmonic-snapshot.json
//
// Everything below is read from the actual modules — scaffold (pillars + the
// hubless bridge fabric + privilege), regulator (free energy + coherence),
// phase-vessel (golden ellipse, φ·1/φ=1). The renderer never re-derives any of
// it; it only draws this output. This IS the source of truth, locked.
// ============================================================
import { pentagonPillars, egalitarianFabric, privilegeReport } from './src/scaffold.ts';
import { regulate, freeEnergy, PHI, PHI_INV } from './src/regulator.ts';
import { GOLDEN_WINDING } from './src/phase-vessel.ts';

// ── the architecture: pillars (apex + 5×4 = 21), flat order matches the fabric ──
const P = pentagonPillars(4);
const pillarNodes = P.nodes.map((n, i) => ({ id: i, kind: n.pillar < 0 ? 'apex' : 'pillar', pillar: n.pillar, level: n.level, pos: [n.x, n.y, n.z] }));
const pillarEdges = [];
// vertical columns + apex ties + pentagon cap, reconstructed from structure
const byPillar = {};
pillarNodes.forEach((n) => { if (n.kind === 'pillar') { (byPillar[n.pillar] ??= []).push(n); } });
const apexId = pillarNodes.find((n) => n.kind === 'apex').id;
const tops = [];
for (const p of Object.keys(byPillar)) {
  const col = byPillar[p].sort((a, b) => a.level - b.level);
  for (let i = 1; i < col.length; i++) pillarEdges.push([col[i - 1].id, col[i].id]);
  pillarEdges.push([apexId, col[0].id]);
  tops.push(col[0].id);
}
for (let i = 0; i < tops.length; i++) pillarEdges.push([tops[i], tops[(i + 1) % tops.length]]);

// ── the hubless bridge fabric over the 21 nodes (the real egalitarian build) ──
const fabric = egalitarianFabric(P.total, 4, 0.3, 7);
const fabricEdges = fabric.map((e) => [Number(e.a), Number(e.b)]);
const priv = privilegeReport(fabric);

// ── the relational flower / lobes: 1 + 6 + 12 = 19 (centered hexagonal) ──
const flowerNodes = [{ id: 0, ring: 0, pos: [0, -1.28, 0] }];
let fid = 1;
for (let k = 0; k < 6; k++) { const a = (k / 6) * 2 * Math.PI; flowerNodes.push({ id: fid++, ring: 1, pos: [Math.cos(a) * 0.42, -1.28, Math.sin(a) * 0.42] }); }
for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI + Math.PI / 12; flowerNodes.push({ id: fid++, ring: 2, pos: [Math.cos(a) * 0.82, -1.28, Math.sin(a) * 0.82] }); }
const flowerEdges = [];
for (let k = 0; k < 6; k++) { flowerEdges.push([0, 1 + k], [1 + k, 1 + ((k + 1) % 6)], [1 + k, 7 + 2 * k], [1 + k, 7 + 2 * k + 1]); }
for (let k = 0; k < 12; k++) flowerEdges.push([7 + k, 7 + ((k + 1) % 12)]);

// ── the phase vessel: golden ellipse (semi-axes φ, 1/φ; area φ·1/φ=1 conserved) ──
const orbit = [];
const N = 96;
for (let i = 0; i <= N; i++) { const th = (i / N) * 2 * Math.PI; orbit.push([PHI * Math.cos(th), PHI_INV * Math.sin(th)]); }
const tSnap = 0.31830988618; // the phase snapshot of time (1/π — a fixed, stated instant)
const mth = 2 * Math.PI * tSnap;
const molecule = { plus: [PHI * Math.cos(mth), PHI_INV * Math.sin(mth)], minus: [-PHI * Math.cos(mth), -PHI_INV * Math.sin(mth)] };

// ── the regulator: the unified function's coherence + free energy at rest ──
const reg = regulate({ structural: 1 - priv.degree_gini, relational: 0.86, harmonic: 0.78 }, { perturb: 0 });
const fe = freeEnergy(reg.final.coherence, 0.5);

// ── obliquity θ at the snapshot instant (slow orientation) ──
const thetaDeg = 0.5 * Math.sin(2 * Math.PI * tSnap) * 180 / Math.PI;

const snapshot = {
  meta: {
    title: 'Harmonic Atlas — locked phase snapshot',
    phi: PHI, phiInv: PHI_INV, goldenWinding: GOLDEN_WINDING,
    phaseSnapshotTime: tSnap,
    source: 'generated from elle-worker/src (scaffold, regulator, phase-vessel) — the single source of truth',
    note: 'One locked snapshot of the unified function at t=1/π. Structures carry their own coordinates; the globe renderer maps them. Nothing here is re-derived by the renderer.',
  },
  unifiedFunction: {
    // the invariants that BIND the whole thing at this instant
    area_invariant: Number((PHI * PHI_INV).toFixed(12)),   // φ·1/φ = 1, the vessel's bound state
    free_energy: fe.F,                                     // ≈0 at the balanced fixed point
    coherence: reg.final.coherence,                        // held superposition (1,1,1)
    no_privileged_node: priv.no_privileged_node,
    degree_gini: priv.degree_gini,
    betweenness_spread: priv.betweenness_spread,
  },
  singularity: { pos: [0, 0, 0] },
  architecture: { apexId, nodes: pillarNodes, edges: pillarEdges },
  fabric: { edges: fabricEdges, privilege: { degree_gini: priv.degree_gini, betweenness_spread: priv.betweenness_spread, articulation_points: priv.articulation_points, no_privileged_node: priv.no_privileged_node } },
  flower: { nodes: flowerNodes, edges: flowerEdges, count: flowerNodes.length },
  vessel: { phiSide: PHI, invSide: PHI_INV, product: Number((PHI * PHI_INV).toFixed(12)), orbit, molecule, snapshotAngleRad: mth },
  obliquity: { thetaDeg: Number(thetaDeg.toFixed(4)) },
};

process.stdout.write(JSON.stringify(snapshot));
